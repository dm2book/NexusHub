/**
 * The social-login entry points are *navigated to*, not fetched.
 *
 * That distinction is the whole test. Every other route in this API answers a
 * fetch, so an error body is fine — the SPA reads it and writes a sentence. But
 * `/api/auth/oauth/:provider/start` and its callback are hit by the browser
 * itself: whatever they return is what the buyer looks at. When Discord login
 * was not configured in production, a buyer tapping "link account" landed on a
 * blank white page reading:
 *
 *     {"error":{"message":"Provider discord not configured"}}
 *
 * On a phone, that reads as a broken shop. Nothing here may answer a navigation
 * with JSON — every failure has to go back to the login page carrying a reason
 * the SPA can put into words.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_oauth';
process.env.NODE_ENV ||= 'development';
process.env.APP_URL ||= 'https://forgemarket.nl';
// Deliberately unconfigured: this is exactly the production state that produced
// the raw JSON page.
delete process.env.DISCORD_CLIENT_ID;
delete process.env.DISCORD_CLIENT_SECRET;
delete process.env.GOOGLE_CLIENT_ID;

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const app = createApp();
const srv = app.listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;

// `redirect: 'manual'` so we see the 302 itself rather than chasing it to a
// domain that does not exist in this sandbox.
const nav = (path) => fetch(`${base}${path}`, { redirect: 'manual' });

console.log('— An unconfigured provider never shows the buyer JSON —');
{
  const res = await nav('/api/auth/oauth/discord/start');
  const loc = res.headers.get('location') || '';
  ok('start redirects instead of erroring', res.status >= 300 && res.status < 400, `status=${res.status}`);
  ok('it lands back on the login page', loc.startsWith('https://forgemarket.nl/login?'), loc);
  ok('it carries a reason the SPA can translate', /error=oauth_unavailable/.test(loc), loc);
  ok('it names the provider so the message can too', /provider=discord/.test(loc), loc);

  const body = await res.text();
  ok('the body is not an API error envelope', !/"error"\s*:/.test(body), body.slice(0, 120));
  ok('the buyer never sees the internal wording', !/not configured/i.test(body), body.slice(0, 120));
}

console.log('\n— The same holds for a provider that does not exist at all —');
{
  // A stale link, a typo, or a crawler poking at /oauth/facebook/start.
  const res = await nav('/api/auth/oauth/facebook/start');
  const loc = res.headers.get('location') || '';
  ok('unknown provider redirects too', res.status >= 300 && res.status < 400, `status=${res.status}`);
  ok('and lands on login, not on a JSON page', /\/login\?error=oauth_unavailable/.test(loc), loc);
  // The provider name goes into a URL the browser follows, so it has to survive
  // someone putting a slash or a quote in the path.
  const dirty = await nav('/api/auth/oauth/e%20vil%2Fx/start');
  const dloc = dirty.headers.get('location') || '';
  ok('a hostile provider name is encoded, not reflected raw',
    !/[ "'<>]/.test(dloc) && dloc.startsWith('https://forgemarket.nl/login?'), dloc);
}

console.log('\n— The callback is a navigation too —');
{
  // No state cookie: the single most common real failure (the buyer took ten
  // minutes, or came back in a different browser).
  const res = await nav('/api/auth/oauth/discord/callback?code=abc&state=xyz');
  const loc = res.headers.get('location') || '';
  ok('a missing/mismatched state redirects', res.status >= 300 && res.status < 400, `status=${res.status}`);
  ok('with a reason attached', /error=oauth_state/.test(loc), loc);
  const body = await res.text();
  ok('and no JSON body', !/"error"\s*:/.test(body), body.slice(0, 120));
}

console.log('\n— The storefront can tell in advance —');
{
  // This is what lets the SPA hide the button rather than offer a dead end.
  const res = await fetch(`${base}/api/auth/providers`);
  const json = await res.json();
  ok('/api/auth/providers answers', res.status === 200, `status=${res.status}`);
  ok('and reports discord as unavailable here', !json.providers.includes('discord'), JSON.stringify(json));
}

console.log('\n— And when it IS configured, the guard gets out of the way —');
{
  // Config is read once at import, so the configured case needs its own
  // process. Without this assertion a guard that always fires would look
  // perfect above while quietly breaking every real Discord login.
  const { spawnSync } = await import('node:child_process');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { createApp, ensureReady } = await import('${new URL('../src/app.js', import.meta.url).pathname}');
    await ensureReady();
    const srv = createApp().listen(0);
    const res = await fetch(\`http://127.0.0.1:\${srv.address().port}/api/auth/oauth/discord/start\`, { redirect: 'manual' });
    console.log('LOCATION=' + res.headers.get('location'));
    srv.close();
  `], {
    env: { ...process.env, DISCORD_CLIENT_ID: 'test-client-id', DISCORD_CLIENT_SECRET: 'test-secret', LOG_LEVEL: 'silent' },
    encoding: 'utf8',
  });
  const loc = (child.stdout || '').split('\n').find((l) => l.startsWith('LOCATION='))?.slice(9) || '';
  ok('a configured provider goes to the provider, not to /login',
    loc.startsWith('https://discord.com/api/oauth2/authorize'), loc || child.stderr?.slice(0, 700));
  ok('carrying our client id', /client_id=test-client-id/.test(loc), loc);
  ok('and a state to verify on the way back', /[?&]state=[^&]+/.test(loc), loc);
}

srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
