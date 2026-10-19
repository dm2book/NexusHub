/**
 * Which payment configuration may take an order — in PRODUCTION mode, over HTTP.
 *
 * C2: a provider that is configured but not the one the checkout uses must not
 *     pause a shop that can be paid. A Stripe sk_test_ key or a Mollie test_
 *     key left behind after switching to Pay. paused every order at the launch
 *     moment, while Pay. was ready.
 * C3: no usable provider means no new order. With no provider at all — or a
 *     Pay. setup with only one of its two values — the shop accepted orders
 *     nobody could pay.
 * C4: a provider's own "start payment" route only works while it IS the
 *     provider: a leftover Stripe or Mollie key kept their payment pages
 *     reachable by a direct request.
 *
 * Each case boots the real app in a child process with NODE_ENV=production
 * (the blockers that matter are production-only) and its own payment
 * environment, places an order through POST /api/orders as a buyer would, and
 * tries the provider routes directly.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_provider_guards';
process.env.NODE_ENV ||= 'development';

import net from 'node:net';
import { spawnSync } from 'node:child_process';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

// Migrate the database once, in this (development) process.
const { ensureReady } = await import('../src/app.js');
await ensureReady();

/* A mail sink, so "no way to email the buyer" is not the blocker under test. */
const sink = net.createServer((sock) => {
  let buf = '', inData = false;
  sock.write('220 sink ESMTP\r\n');
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    for (;;) {
      const i = buf.indexOf('\r\n');
      if (i < 0) break;
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (inData) { if (line === '.') { inData = false; sock.write('250 OK\r\n'); } continue; }
      const cmd = line.split(' ')[0].toUpperCase();
      if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250-sink\r\n250 8BITMIME\r\n');
      else if (cmd === 'DATA') { inData = true; sock.write('354 go\r\n'); }
      else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
      else sock.write('250 OK\r\n');
    }
  });
  sock.on('error', () => {});
});
await new Promise((r) => sink.listen(0, r));

const src = (p) => new URL(`../src/${p}`, import.meta.url).pathname;
const CHILD = `
  const { ensureReady, createApp } = await import('${src('app.js')}');
  await ensureReady();
  const { commerceBlockers, activePaymentProvider } = await import('${src('config/env.js')}');
  const { createProduct } = await import('${src('services/productService.js')}');
  const { createOrder } = await import('${src('services/orderService.js')}');
  /* No real provider is ever called: every outbound request is answered here,
     so a route that would reach Stripe/Mollie/Pay. fails fast and visibly. */
  globalThis.fetch = ((real) => async (url, init) => (String(url).startsWith('http://127.0.0.1')
    ? real(url, init) : new Response('{"error":"blocked in test"}', { status: 599 })))(globalThis.fetch);
  const srv = createApp().listen(0);
  const base = 'http://127.0.0.1:' + srv.address().port;
  const p = await createProduct({ name: 'Guard ' + Date.now() + Math.random(), category: 'robux', price: 1000,
    currency: 'EUR', active: true, announce: false });
  const email = 'guard-' + Date.now() + '@example.test';
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body) });
  const r = await post('/api/orders', { email, consent: true, consentText: 'ok', items: [{ productId: p.id, quantity: 1 }] });
  const body = await r.json().catch(() => null);
  /* The provider routes are tried on an order that exists either way, so C4 is
     tested even where C3 refuses the order: one made directly, as a stale
     pending order from before a provider switch would be. */
  const existing = body?.order || await createOrder({ email, consent: true, consentText: 'ok',
    items: [{ productId: p.id, quantity: 1 }] });
  const stripe = (await post('/api/orders/' + existing.id + '/checkout', { email })).status;
  const mollie = (await post('/api/orders/' + existing.id + '/mollie', { email })).status;
  const cfg = await (await fetch(base + '/api/config')).json();
  console.log('RESULT ' + JSON.stringify({ provider: activePaymentProvider(), blockers: commerceBlockers(),
    order: r.status, message: body?.error?.message || null, paused: cfg.orderingPaused, stripe, mollie }));
  srv.close();
  process.exit(0);
`;

const PAST = '2026-01-01T00:00:00Z';     // the shop has opened
const FUTURE = '2099-01-01T00:00:00Z';   // the shop has not opened yet
const PAY = { PAYNL_SERVICE_ID: 'SL-1234-5678', PAYNL_SERVICE_SECRET: 'a'.repeat(40) };
const CLEAN = {
  STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', MOLLIE_API_KEY: '', PAYNL_SERVICE_ID: '', PAYNL_SERVICE_SECRET: '',
  PAYNL_TEST_MODE: '', PAY_TIKKIE: '', PAY_REVOLUT: '', PAY_PAYPAL: '', DEMO_PAYMENTS: '', RESEND_API_KEY: '',
};
function run(label, env) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], {
    encoding: 'utf8', timeout: 90_000,
    env: {
      ...process.env, ...CLEAN,
      NODE_ENV: 'production', DATABASE_SSL: 'false', DATABASE_SSL_INSECURE: 'true',
      JWT_SECRET: 'x'.repeat(64), APP_URL: 'https://shop.example.test', API_URL: 'https://shop.example.test',
      SMTP_URL: `smtp://127.0.0.1:${sink.address().port}`, LAUNCH_MODE: 'open', LAUNCH_DATE: PAST,
      ...env,
    },
  });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('RESULT '));
  if (!line) {
    console.log(`  (child for "${label}" printed no result)\n${(r.stderr || '').slice(-1500)}`);
    return null;
  }
  return JSON.parse(line.slice(7));
}
const leaks = (msg) => /PAYNL|STRIPE|MOLLIE|SECRET|PAY_|sk_|whsec|test_/i.test(String(msg || ''));

console.log('— C3: no usable provider, no new order —');
{
  const r = run('none', {});
  ok('no provider at all: the provider is none', r?.provider === 'none', JSON.stringify(r));
  ok('…and the order is refused (503), the shop shows paused', r?.order === 503 && r?.paused === true, JSON.stringify(r));
  ok('…with a message that names no setting', r && !leaks(r.message), r?.message);
}
{
  const r = run('pay half', { PAYNL_SERVICE_ID: PAY.PAYNL_SERVICE_ID });
  ok('Pay. with only its service id: the order is refused', r?.order === 503 && r?.paused === true, JSON.stringify(r));
}
{
  const r = run('pay half + manual', { PAYNL_SERVICE_SECRET: PAY.PAYNL_SERVICE_SECRET, PAY_TIKKIE: 'https://tikkie.me/pay/x' });
  ok('Pay. with only its secret is refused too, even with a manual link to fall back on',
    r?.order === 503 && r?.provider === 'manual', JSON.stringify(r));
}
{
  const r = run('manual only', { PAY_TIKKIE: 'https://tikkie.me/pay/x' });
  ok('a deliberate manual-link shop still takes orders', r?.order === 201 && r?.paused === false, JSON.stringify(r));
}

console.log('\n— C2: an inactive provider\'s test key does not pause Pay. —');
{
  const r = run('pay + stripe test', { ...PAY, STRIPE_SECRET_KEY: 'sk_test_leftover123', STRIPE_WEBHOOK_SECRET: 'whsec_x' });
  ok('Pay. live with a leftover Stripe sk_test_ key after launch: orders go through',
    r?.provider === 'paynl' && r?.order === 201 && r?.paused === false, JSON.stringify(r));
  ok('…and the Stripe payment route is closed (C4)', r?.stripe === 400, JSON.stringify(r));
}
{
  const r = run('pay + mollie test', { ...PAY, MOLLIE_API_KEY: 'test_leftover123' });
  ok('Pay. live with a leftover Mollie test_ key: orders go through',
    r?.provider === 'paynl' && r?.order === 201 && r?.paused === false, JSON.stringify(r));
  ok('…and the Mollie payment route is closed (C4)', r?.mollie === 400, JSON.stringify(r));
}
{
  const r = run('pay + stripe live no webhook', { ...PAY, STRIPE_SECRET_KEY: 'sk_live_leftover123' });
  ok('Pay. live with a leftover live Stripe key and no webhook: orders go through',
    r?.provider === 'paynl' && r?.order === 201, JSON.stringify(r));
  ok('…and the Stripe payment route is closed (C4)', r?.stripe === 400, JSON.stringify(r));
}

console.log('\n— What must still block —');
{
  const r = run('pay sandbox after launch', { ...PAY, PAYNL_TEST_MODE: 'true' });
  ok('Pay. sandbox after the launch moment: refused', r?.provider === 'paynl' && r?.order === 503, JSON.stringify(r));
}
{
  const r = run('pay sandbox before launch', { ...PAY, PAYNL_TEST_MODE: 'true', LAUNCH_DATE: FUTURE });
  ok('Pay. sandbox before the launch date: the owner can test (not paused)',
    r?.provider === 'paynl' && r?.paused === false, JSON.stringify(r));
}
{
  const r = run('stripe test active', { STRIPE_SECRET_KEY: 'sk_test_active123', STRIPE_WEBHOOK_SECRET: 'whsec_x' });
  ok('Stripe as the provider with a test key after launch: refused', r?.provider === 'stripe' && r?.order === 503, JSON.stringify(r));
}
{
  const r = run('stripe no webhook', { STRIPE_SECRET_KEY: 'sk_live_active123' });
  ok('Stripe as the provider without its webhook secret: refused', r?.provider === 'stripe' && r?.order === 503, JSON.stringify(r));
}
{
  const r = run('mollie test active', { MOLLIE_API_KEY: 'test_active123' });
  ok('Mollie as the provider with a test key: refused', r?.provider === 'mollie' && r?.order === 503, JSON.stringify(r));
}
{
  const r = run('pay full', { ...PAY });
  ok('Pay. correctly configured: orders go through, not paused', r?.provider === 'paynl' && r?.order === 201 && r?.paused === false,
    JSON.stringify(r));
}

sink.close();
console.log(`\n${fail ? '❌' : '✅'} launch-provider-guards: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
