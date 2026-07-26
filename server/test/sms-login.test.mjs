/**
 * Phone login: never claim a code was sent that was not.
 *
 * The login form advertised "Email or phone" and, on submitting a number,
 * showed a green tick reading:
 *
 *     Verification code sent
 *     We sent a 6-digit code by SMS to +31612345678
 *     Code expires in 9:58
 *
 * No SMS provider was ever configured, so nothing was sent. The person waits
 * out the countdown, taps resend, waits again, and concludes the shop is
 * broken — which, for them, it is. A shop that cannot let people back into
 * their own account loses the order and the customer.
 *
 * The rule this pins down: an OTP row is only written when the code can
 * actually be delivered. Everything that offers SMS — login, resend, and adding
 * a number to an account — goes through one choke point, so the promise can
 * only be made where it can be kept.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_sms';
process.env.NODE_ENV ||= 'development';
process.env.APP_URL ||= 'https://forgemarket.nl';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { get } = await import('../src/db/index.js');
const app = createApp();
const srv = app.listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const post = (path, body) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

// Development keeps the console fallback so the flow stays testable locally —
// that IS a real delivery channel for whoever runs the server. Production
// without Twilio is the state that produced the bug.
console.log('— Dev keeps working: the console fallback is a real channel —');
{
  const { smsAvailable } = await import('../src/services/smsService.js');
  ok('SMS counts as available in development', smsAvailable() === true);

  const res = await post('/api/auth/start', { identifier: '+31612345678' });
  const json = await res.json();
  ok('a phone number is accepted', res.status === 200, `status=${res.status}`);
  ok('and reported on the sms channel', json.channel === 'sms', JSON.stringify(json));
  const row = await get('SELECT * FROM sms_verifications WHERE phone=@p', { p: '+31612345678' });
  ok('a code row was written', !!row);
}

console.log('\n— Production without a provider: refuse, do not pretend —');
{
  // Config is read once at import, so the production case needs its own
  // process. Without this the fix would be asserted only in the mode where it
  // does nothing.
  const { spawnSync } = await import('node:child_process');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { createApp, ensureReady } = await import('${new URL('../src/app.js', import.meta.url).pathname}');
    await ensureReady();
    const srv = createApp().listen(0);
    const b = 'http://127.0.0.1:' + srv.address().port;
    const post = (p, body) => fetch(b + p, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(body) });
    const out = {};
    let r = await post('/api/auth/start', { identifier: '+31698765432' });
    out.phoneStatus = r.status; out.phoneBody = await r.text();
    r = await post('/api/auth/start', { identifier: 'buyer@example.com' });
    out.emailStatus = r.status; out.emailBody = await r.text();
    r = await fetch(b + '/api/auth/providers');
    out.providers = await r.text();
    console.log('RESULT=' + JSON.stringify(out));
    srv.close();
  `], {
    // NODE_ENV=production without TWILIO_* — exactly what runs on Vercel today.
    env: { ...process.env, NODE_ENV: 'production', LOG_LEVEL: 'silent',
      TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', TWILIO_FROM: '',
      JWT_SECRET: 'x'.repeat(48), ADMIN_EMAILS: 'a@b.c' },
    encoding: 'utf8',
  });
  const line = (child.stdout || '').split('\n').find((l) => l.startsWith('RESULT='));
  ok('the production probe ran', !!line, (child.stderr || '').slice(-400));
  const out = line ? JSON.parse(line.slice(7)) : {};

  ok('a phone number is refused, not accepted', out.phoneStatus === 400, `status=${out.phoneStatus}`);
  ok('and the refusal points at email instead',
    /email/i.test(out.phoneBody || ''), out.phoneBody);
  // The important half: no row, so nothing counts against the rate limit and
  // no caller can read "we stored a code" as "we sent a code".
  const stored = await get('SELECT * FROM sms_verifications WHERE phone=@p', { p: '+31698765432' });
  ok('no undeliverable code row was written', !stored);

  // Email must be untouched — a guard that takes the whole login down with it
  // would be worse than the bug.
  ok('email login still works in production', out.emailStatus === 200, `status=${out.emailStatus}`);

  const providers = JSON.parse(out.providers || '{}');
  ok('/providers reports email only', JSON.stringify(providers.channels) === '["email"]', out.providers);
  ok('so the storefront can drop the phone field before anyone types in it',
    Array.isArray(providers.channels) && !providers.channels.includes('sms'));
}

console.log('\n— With a provider configured, nothing is blocked —');
{
  const { spawnSync } = await import('node:child_process');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { createApp, ensureReady } = await import('${new URL('../src/app.js', import.meta.url).pathname}');
    await ensureReady();
    const srv = createApp().listen(0);
    const b = 'http://127.0.0.1:' + srv.address().port;
    const r = await fetch(b + '/api/auth/providers');
    console.log('RESULT=' + await r.text());
    srv.close();
  `], {
    env: { ...process.env, NODE_ENV: 'production', LOG_LEVEL: 'silent',
      TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: 'ForgeMarket',
      JWT_SECRET: 'x'.repeat(48), ADMIN_EMAILS: 'a@b.c' },
    encoding: 'utf8',
  });
  const line = (child.stdout || '').split('\n').find((l) => l.startsWith('RESULT='));
  const providers = line ? JSON.parse(line.slice(7)) : {};
  ok('sms is offered again the moment credentials exist',
    (providers.channels || []).includes('sms'), line || (child.stderr || '').slice(-300));
  ok('and email is still there alongside it', (providers.channels || []).includes('email'));
}

srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
