/**
 * Deployment architecture: what a request pays before it does any work.
 *
 * On Vercel this app is one serverless function. That makes three costs real
 * that a long-lived server never notices, and all three were measured here
 * before anything was changed:
 *
 *  1. **The module graph.** Every cold start evaluates it from scratch. Loading
 *     the Stripe SDK cost ~150ms of a ~360ms boot, on a shop that runs on Mollie
 *     and never calls Stripe at all.
 *  2. **Serialized round trips before serving.** `ensureReady()` ran four, one
 *     after another, including a DDL write — against a database where all four
 *     always answer "nothing to do".
 *  3. **Requests no shared cache can absorb.** A CDN cannot help with a POST, or
 *     with a response carrying no `Cache-Control`. A real browser load made four
 *     such requests per visit, so every visitor reached the function no matter
 *     how well the catalog was cached.
 *
 * And one failure that is worse than slow: `pg.Pool` emits 'error' when an idle
 * connection is dropped — which is what a pooler does to connections it
 * reclaims. With no listener, Node's default is to throw and the whole function
 * process dies. That one is asserted by actually killing a connection.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_deploy_arch';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const require_ = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

// ── 1. A dropped idle connection must not kill the function ─────────────────
console.log('— One dead socket must not take the shop down —');
{
  // Run it in a child: the whole point is whether the PROCESS survives, and a
  // regression here would otherwise take this test runner down with it.
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import pg from 'pg';
    const URL = ${JSON.stringify(process.env.DATABASE_URL)};
    const { get, pool } = await import(${JSON.stringify(new URL('../src/db/index.js', import.meta.url).href)});
    await get('SELECT 1 AS ok');
    const { rows } = await pool.query('SELECT pg_backend_pid() AS pid');
    const killer = new pg.Client({ connectionString: URL });
    await killer.connect();
    await killer.query('SELECT pg_terminate_backend($1)', [rows[0].pid]);
    await killer.end();
    await new Promise((r) => setTimeout(r, 1200));      // let the error land
    const again = await get('SELECT 1 AS ok');          // and serve the next request
    console.log(again.ok === 1 ? 'SURVIVED' : 'WRONG_ANSWER');
    process.exit(0);
  `], { env: { ...process.env }, encoding: 'utf8', timeout: 60_000 });

  ok('the process survives a pooler reclaiming an idle connection',
    child.status === 0 && /SURVIVED/.test(child.stdout || ''),
    `exit=${child.status} ${(child.stderr || '').split('\n')[0]}`);
  ok('…and serves the very next query from a fresh connection',
    /SURVIVED/.test(child.stdout || ''),
    'without a pool error listener this is 500 FUNCTION_INVOCATION_FAILED');
  ok('…because somebody is listening for it',
    /_pool\.on\('error'/.test(read('../src/db/index.js')),
    'an unhandled pg pool error event terminates the process');
}

// ── 2. The cold-start module graph carries only what it needs ───────────────
console.log('\n— Cold start loads what it uses, not what it might —');
{
  await import('../src/app.js');
  const loaded = (pkg) => Object.keys(require_.cache).some((k) => k.includes(`/node_modules/${pkg}/`));

  ok('the Stripe SDK is NOT loaded to serve a page', !loaded('stripe'),
    '~150ms of every cold start for an SDK a Mollie shop never calls');
  ok('nodemailer is NOT loaded to serve a page', !loaded('nodemailer'),
    'the recommended transport is Resend over HTTP; SMTP is the exception');
  // Sanity: the detector is not simply blind.
  ok('(the check can see a package that IS loaded)', loaded('express'));

  const stripeSrc = read('../src/services/stripeService.js');
  ok('stripe is imported at the point of use', /await import\('stripe'\)/.test(stripeSrc));
  ok('…and its callers await the lazy client',
    /await stripe\(\)/.test(stripeSrc) && !/= stripe\(\);/.test(stripeSrc),
    'a forgotten await would hand a Promise to the payment code');
}

// ── 3. Seeding is for empty databases, not for every boot ───────────────────
console.log('\n— A running shop does not carry its own installer —');
{
  const appSrc = read('../src/app.js');
  ok('the demo catalog loads only when it is used',
    /await import\('\.\/db\/demoSeed\.js'\)/.test(appSrc) && !/^import .*demoSeed/m.test(appSrc));
  ok('the starter content loads only when it is used',
    /await import\('\.\/db\/starterContent\.js'\)/.test(appSrc) && !/^import .*starterContent/m.test(appSrc));
  ok('the first request checks readiness with as few round trips as possible',
    /Promise\.all\(\[[\s\S]{0,200}isSeeded\(\)/.test(appSrc),
    'two independent reads awaited one after the other is a wasted round trip');

  const migrateSrc = read('../src/db/migrate.js');
  ok('the migration check asks before it writes',
    /try \{\s*if \(await allApplied\(\)\) return 0;/.test(migrateSrc),
    'an unconditional CREATE TABLE is a DDL write on every cold start');
}

// ── 4. Health is a question anyone can afford to ask ────────────────────────
console.log('\n— The status dot costs one query, not thirteen —');
{
  const { createApp, ensureReady } = await import('../src/app.js');
  await ensureReady();
  const srv = createApp().listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;

  const light = await fetch(`${base}/api/health`);
  const lightBody = await light.json();
  ok('the default health check answers', light.status === 200 && lightBody.ok === true);
  ok('…without counting every row in every key table', lightBody.database.tables === undefined,
    'the footer calls this on every page view');
  ok('…and says nothing false about migrations rather than claiming none ran',
    lightBody.database.migrationsApplied === undefined);
  ok('…and can be held at the edge for a moment',
    /s-maxage=\d+/.test(light.headers.get('cache-control') || ''),
    light.headers.get('cache-control'));
  ok('…but is never served stale during an outage',
    !/stale-while-revalidate/.test(light.headers.get('cache-control') || ''),
    'a cached "up" during a real outage is worse than no status at all');

  const full = await (await fetch(`${base}/api/health?tables=1`)).json();
  ok('the full census is still one query parameter away',
    !!full.database.tables && Object.keys(full.database.tables).length > 5);
  ok('…and still lists the applied migrations',
    Array.isArray(full.database.migrationsApplied) && full.database.migrationsApplied.length > 0);

  // Public, byte-identical for everyone → the edge can answer for every visitor.
  for (const path of ['/api/social/feed', '/api/social/stats']) {
    const r = await fetch(`${base}${path}`);
    ok(`${path} tells the shared cache it may hold it`,
      /s-maxage=\d+/.test(r.headers.get('cache-control') || ''),
      'an in-process cache helps one warm instance; the edge helps everyone');
    ok(`${path} sets no cookie, so the edge is allowed to`, !r.headers.get('set-cookie'));
  }
  srv.close();
}

// ── 5. A guest does not negotiate about a session they never had ────────────
console.log('\n— No session, no conversation about a session —');
{
  const auth = read('../src/routes/auth.js');
  const ctx = fs.readFileSync(new URL('../../src/context/AuthContext.jsx', import.meta.url), 'utf8');

  ok('a readable hint is set whenever a real session cookie is',
    /function setSessionCookie[\s\S]{0,200}setSessionHint\(res, true\)/.test(auth));
  ok('…and whenever a device is trusted',
    /function setDeviceCookie[\s\S]{0,200}setSessionHint\(res, true\)/.test(auth));
  ok('…and is cleared on sign-out',
    /setSessionHint\(res, false\)[\s\S]{0,120}clearCookie\(config\.auth\.cookieName/.test(auth),
    'a signed-out browser would keep paying for the silent-login ladder');
  ok('the hint carries no token and is not httpOnly',
    /httpOnly: false/.test(auth) && /res\.cookie\(HINT_COOKIE, '1'/.test(auth),
    'the storefront has to read it, so it must never hold a secret');

  ok('the storefront skips the silent-login ladder without it',
    /!getAccessToken\(\) && hasSessionHint\(\)/.test(ctx),
    'two uncacheable POSTs per first-time visitor');
  ok('…and assumes a session when the cookie cannot be read at all',
    /catch \{ return true; \}/.test(ctx),
    'being accidentally logged out is far worse than one extra request');
}

// ── 6. Caching policy lives where every route can reach it ──────────────────
console.log('\n— The next public route should not have to reinvent this —');
{
  ok('publicCache is a shared utility', fs.existsSync(new URL('../src/utils/httpCache.js', import.meta.url)));
  const catalog = read('../src/routes/catalog.js');
  ok('…and the route that invented it now imports it',
    /import \{ publicCache \} from '\.\.\/utils\/httpCache\.js'/.test(catalog)
    && !/const publicCache = \(res/.test(catalog),
    'two copies drift, and the forgotten one ships with no cache header');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
