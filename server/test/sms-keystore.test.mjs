/**
 * SMS login turns on when the owner types the Twilio keys into the admin.
 *
 * The Twilio credentials were environment variables only, and `sms.enabled`
 * was a boolean frozen at boot. An owner who asked "why can't I receive an
 * SMS code?" had to find three Vercel variables and redeploy; nothing in
 * Admin → Keys and connections could switch it on.
 *
 * Runs the real app in a PRODUCTION child process (development always "has"
 * SMS via the console), with Twilio's API stubbed: no real message is sent.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_sms_keystore';
process.env.NODE_ENV ||= 'development';

import { spawnSync } from 'node:child_process';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

// Migrate once in this (development) process.
const { ensureReady } = await import('../src/app.js');
await ensureReady();

const SID = `AC${'a1'.repeat(16)}`;
const TOKEN = 'b2'.repeat(16);
const src = (p) => new URL(`../src/${p}`, import.meta.url).pathname;

const CHILD = `
  const sent = [];
  globalThis.fetch = ((real) => async (url, init = {}) => {
    if (String(url).startsWith('https://api.twilio.com/')) {
      sent.push({ url: String(url), auth: init.headers?.Authorization || '', body: String(init.body || '') });
      return new Response('{"sid":"SM1"}', { status: 201 });
    }
    return real(url, init);
  })(globalThis.fetch);
  const { createApp, ensureReady } = await import('${src('app.js')}');
  await ensureReady();
  const { setSecret } = await import('${src('services/secretStore.js')}');
  const srv = createApp().listen(0);
  const b = 'http://127.0.0.1:' + srv.address().port;
  const channels = async () => (await (await fetch(b + '/api/auth/providers')).json()).channels;
  const health = async () => (await (await fetch(b + '/api/health')).json()).sms;
  const tryErr = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
  const out = {};
  out.before = await channels();
  out.healthBefore = await health();
  out.unknown = await tryErr(() => setSecret('sms.accountSid', '${SID}'));
  out.badSid = await tryErr(() => setSecret('sms.accountSid', 'not-a-sid'));
  out.badFromShort = await tryErr(() => setSecret('sms.from', '+12'));
  out.badFromLong = await tryErr(() => setSecret('sms.from', 'ForgeMarketShop'));
  out.badFromDigits = await tryErr(() => setSecret('sms.from', '12345'));
  out.goodToken = await tryErr(() => setSecret('sms.authToken', '${TOKEN}'));
  out.goodFrom = await tryErr(() => setSecret('sms.from', 'ForgeMarket'));
  out.after = await channels();
  out.healthAfter = await health();
  const r = await fetch(b + '/api/auth/start', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: '+31612345678' }) });
  out.startStatus = r.status;
  out.sent = sent;
  await setSecret('sms.from', '');
  out.cleared = await channels();
  console.log('RESULT=' + JSON.stringify(out));
  srv.close();
  process.exit(0);
`;

const child = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], {
  encoding: 'utf8', timeout: 120_000,
  env: { ...process.env, NODE_ENV: 'production', DATABASE_SSL: 'false', LOG_LEVEL: 'silent',
    LAUNCH_MODE: 'open', JWT_SECRET: 'k'.repeat(64), ADMIN_EMAILS: 'a@b.c',
    APP_URL: 'https://shop.example.test',
    TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', TWILIO_FROM: '' },
});
const line = (child.stdout || '').split('\n').find((l) => l.startsWith('RESULT='));
ok('the production probe ran', !!line, (child.stderr || '').slice(0, 900));
const out = line ? JSON.parse(line.slice(7)) : {};

console.log('\n— Before: no Twilio keys anywhere —');
ok('the login form offers email only', JSON.stringify(out.before) === '["email"]', JSON.stringify(out.before));
ok('health says SMS is not configured, and where to set it',
  out.healthBefore?.status === 'not_configured' && /Keys and connections/.test(out.healthBefore?.note || ''),
  JSON.stringify(out.healthBefore));

console.log('\n— The admin accepts the three Twilio values, and checks them —');
ok('Twilio Account SID is a setting the admin can save', out.unknown === null, String(out.unknown));
ok('a malformed Account SID is refused', /Twilio Account SID/.test(out.badSid || ''), String(out.badSid));
ok('a too-short sender number is refused', !!out.badFromShort, String(out.badFromShort));
ok('a sender name over 11 characters is refused', !!out.badFromLong, String(out.badFromLong));
ok('an all-digit sender without + is refused', !!out.badFromDigits, String(out.badFromDigits));
ok('a valid auth token and sender name are accepted', out.goodToken === null && out.goodFrom === null,
  `${out.goodToken} / ${out.goodFrom}`);

console.log('\n— After: SMS is on in the running shop, no redeploy —');
ok('the login form now offers SMS', Array.isArray(out.after) && out.after.includes('sms'), JSON.stringify(out.after));
ok('health reports Twilio configured', out.healthAfter?.status === 'configured' && out.healthAfter?.provider === 'twilio',
  JSON.stringify(out.healthAfter));
ok('a phone login is accepted', out.startStatus === 200, String(out.startStatus));
const msg = (out.sent || [])[0] || {};
ok('…and the code goes to Twilio for this account', msg.url === `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, msg.url);
ok('…with Basic auth from the stored SID and token',
  msg.auth === `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString('base64')}`, msg.auth);
const form = new URLSearchParams(msg.body || '');
ok('…to the number, from the sender, with a 6-digit code',
  form.get('To') === '+31612345678' && form.get('From') === 'ForgeMarket' && /\b\d{6}\b/.test(form.get('Body') || ''),
  msg.body);

console.log('\n— Clearing a value turns SMS off again —');
ok('without a sender the form is back to email only', JSON.stringify(out.cleared) === '["email"]', JSON.stringify(out.cleared));

console.log(`\n${fail ? '❌' : '✅'} sms-keystore: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
