/**
 * The whole payment lifecycle, against a Mollie that answers the way Mollie does.
 *
 * Only their server is stubbed. Every line of our own service, route, state
 * machine and fulfilment path is the real one, reached over real HTTP — the
 * webhook is posted as form data the way Mollie posts it, and the order is
 * placed through the checkout route a buyer uses.
 *
 * Three things this found, each of which failed here before it was fixed:
 *
 *   /api/orders/:id/pay marks an order paid without a PSP, and is refused when a
 *   real payment method is configured — a list that checked manual links and
 *   Stripe but not Mollie, the one provider this shop is launching on. A live
 *   iDEAL deployment with DEMO_PAYMENTS still set handed anyone a working "mark
 *   my own order paid" endpoint.
 *
 *   A webhook for a payment id Mollie has never heard of answered 500, which
 *   asks Mollie to retry. The id comes from an unauthenticated caller, so anyone
 *   could put Mollie's retry schedule behind a payment that will never exist.
 *
 *   A failed payment left no trace at all — no audit row, nothing — so a shop
 *   losing a quarter of its attempts to one broken bank could not find out.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_pay_test';
process.env.NODE_ENV ||= 'development';
process.env.MOLLIE_API_KEY = 'test_fake_key_for_the_harness';
process.env.APP_URL = 'http://localhost:3000';

/* The checkout refuses to take money it cannot deliver against — with no mail
   transport, commerceBlockers() answers 503 before any of this can run, which
   is correct and is its own test elsewhere. So: a throwaway SMTP server that
   accepts and discards. Enough of RFC 5321 for nodemailer. */
import net from 'node:net';
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
process.env.SMTP_URL = `smtp://127.0.0.1:${sink.address().port}`;
process.env.DEMO_PAYMENTS = 'true';

/* Mollie, as far as our code can tell. Payments live in a map; the tests move
   them through states and then fire the webhook, exactly as Mollie would. */
const payments = new Map();
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.mollie.com/')) return realFetch(url, init);
  const m = u.match(/\/v2\/payments\/(tr_[A-Za-z0-9]+)/);
  if (init.method === 'POST' && /\/v2\/payments$/.test(u)) {
    const body = JSON.parse(init.body);
    const id = `tr_${Math.random().toString(36).slice(2, 12)}`;
    const p = {
      id, status: 'open', amount: body.amount, method: body.method || null,
      metadata: body.metadata, description: body.description,
      _links: { checkout: { href: `https://pay.mollie.test/${id}` } },
    };
    payments.set(id, p);
    return new Response(JSON.stringify(p), { status: 201, headers: { 'content-type': 'application/json' } });
  }
  if (m) {
    const p = payments.get(m[1]);
    if (!p) return new Response(JSON.stringify({ detail: 'No payment exists' }), { status: 404 });
    return new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (/\/v2\/methods/.test(u)) {
    return new Response(JSON.stringify({ _embedded: { methods: [
      { id: 'ideal', description: 'iDEAL', image: { svg: 'x' } },
      { id: 'creditcard', description: 'Card', image: { svg: 'x' } },
    ] } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
};

const { ensureReady, createApp } = await import('../src/app.js');
await ensureReady();
await new Promise((r) => setTimeout(r, 4000));
const { run, get, all, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const os = await import('../src/services/orderService.js');
const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n} ${x}`); } };
const settle = (n = 2) => new Promise((r) => setTimeout(r, 1500 * n));

async function product(name, codes = 3) {
  const id = newId('prd');
  await run(`INSERT INTO products (id, sku, name, category, description, price, currency, kind, active, metadata, created_at, updated_at)
             VALUES (@id,@s,@n,'robux','t',999,'EUR','digital',1,@m,@at,@at)`,
    { id, s: `P-${id.slice(-8)}`, n: name,
      m: JSON.stringify({ deliveryMode: 'auto', image: '/products/icons/robux.webp' }), at: nowIso() });
  for (let i = 0; i < codes; i++) {
    await run(`INSERT INTO product_codes (id, product_id, code, status, created_at) VALUES (@i,@p,@c,'available',@at)`,
      { i: newId('pcd'), p: id, c: `${name}-C${i}`, at: nowIso() });
  }
  return id;
}
const place = async (pid) => {
  const r = await fetch(`${base}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `b-${newId('x').slice(-6)}@example.com`, consent: true, consentText: 'ok',
      items: [{ productId: pid, quantity: 1 }] }) });
  return (await r.json()).order;
};
const startPay = async (order, method = 'ideal') => {
  const r = await fetch(`${base}/api/orders/${order.id}/mollie`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: order.email, method, locale: 'nl' }) });
  return { status: r.status, body: await r.json() };
};
const hook = (id) => fetch(`${base}/api/payments/mollie/webhook`, {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: `id=${id}` });
const snap = async (id) => {
  const o = await get(`SELECT status, payment_status, psp_status, psp_payment_id FROM orders WHERE id=@id`, { id });
  const d = await all(`SELECT content FROM deliveries WHERE order_id=@id`, { id });
  const a = await all(`SELECT action FROM audit_logs WHERE target_id=@id ORDER BY created_at`, { id });
  return { ...o, deliveries: d.length, audit: a.map((x) => x.action) };
};

console.log('\n━━ 1. Starting an iDEAL payment ━━');
const p1 = await product('Pay1');
const o1 = await place(p1);
{
  const r = await startPay(o1);
  ok('the checkout hands back a Mollie URL', [200, 201].includes(r.status) && /pay\.mollie\.test/.test(r.body.checkoutUrl || ''),
    JSON.stringify(r.body).slice(0, 120));
  const s = await snap(o1.id);
  ok('the payment id is stored on the order', /^tr_/.test(s.psp_payment_id || ''), s.psp_payment_id);
  ok('the order is still pending', s.status === 'pending', s.status);
  ok('nothing is delivered yet', s.deliveries === 0, `${s.deliveries}`);

  const again = await startPay(o1);
  ok('coming back resumes the same payment rather than making a second',
    again.body.resumed === true && again.body.paymentId === s.psp_payment_id, JSON.stringify(again.body));
}

console.log('\n━━ 1b. Mollie outranks the manual links ━━');
{
  /* The shop's answer to "automatic payments instead of manual Tikkie
     confirmation" is a configuration one: with a Mollie key set, the checkout
     stops offering the hand-confirmed links entirely. Worth pinning, because a
     shop that quietly falls back to Tikkie is a shop where every order waits for
     someone to read a bank app. */
  const cfg = await (await fetch(`${base}/api/config`)).json();
  ok('the checkout runs on Mollie', cfg.paymentProvider === 'mollie', cfg.paymentProvider);
  ok('iDEAL is on the shop-level list', (cfg.mollieMethods || []).includes('ideal'),
    JSON.stringify(cfg.mollieMethods));
  const methods = await (await fetch(`${base}/api/mollie/methods?amount=999&locale=nl`)).json();
  ok('…and Mollie offers it for this amount',
    (methods.methods || []).some((m) => m.id === 'ideal'), JSON.stringify(methods.methods));
}

console.log('\n━━ 2. The webhook before the money moves ━━');
{
  const s0 = await snap(o1.id);
  await hook(s0.psp_payment_id);
  const s = await snap(o1.id);
  ok('an open payment changes nothing', s.status === 'pending' && s.deliveries === 0, s.status);
}

console.log('\n━━ 3. Paid ━━');
{
  const s0 = await snap(o1.id);
  payments.get(s0.psp_payment_id).status = 'paid';
  payments.get(s0.psp_payment_id).paidAt = nowIso();
  const r = await hook(s0.psp_payment_id);
  ok('the webhook answers 200', r.status === 200, `${r.status}`);
  await settle();
  const s = await snap(o1.id);
  ok('the order is completed', s.status === 'completed', s.status);
  ok('payment_status says paid', s.payment_status === 'paid', s.payment_status);
  ok('the code went out', s.deliveries === 1, `${s.deliveries}`);
  ok('it is in the audit log', s.audit.includes('order.payment_received'), JSON.stringify(s.audit));
}

console.log('\n━━ 4. The same webhook, four times at once ━━');
{
  const s0 = await snap(o1.id);
  await Promise.all([1, 2, 3, 4].map(() => hook(s0.psp_payment_id)));
  await settle();
  const s = await snap(o1.id);
  ok('still one delivery', s.deliveries === 1, `${s.deliveries}`);
  ok('still one payment_received in the audit log',
    s.audit.filter((a) => a === 'order.payment_received').length === 1, JSON.stringify(s.audit));
  const mails = await all(`SELECT template_id FROM email_log WHERE to_email=@e AND template_id='order_completed'`,
    { e: o1.email });
  ok('one delivery email', mails.length === 1, `${mails.length}`);
}

console.log('\n━━ 5. A payment for the wrong amount ━━');
{
  const p = await product('Wrong');
  const o = await place(p);
  await startPay(o);
  const s0 = await snap(o.id);
  const pay = payments.get(s0.psp_payment_id);
  pay.status = 'paid';
  pay.amount = { currency: 'EUR', value: '0.01' };   // paid a cent
  await hook(s0.psp_payment_id);
  await settle();
  const s = await snap(o.id);
  ok('the order is NOT marked paid', s.status === 'pending', s.status);
  ok('nothing is delivered', s.deliveries === 0, `${s.deliveries}`);
  ok('the mismatch is in the audit log', s.audit.includes('order.payment_mismatch'), JSON.stringify(s.audit));
}

console.log('\n━━ 6. Failed, cancelled, expired ━━');
for (const state of ['failed', 'canceled', 'expired']) {
  const p = await product(`St-${state}`);
  const o = await place(p);
  await startPay(o);
  const s0 = await snap(o.id);
  payments.get(s0.psp_payment_id).status = state;
  await hook(s0.psp_payment_id);
  await settle(1);
  const s = await snap(o.id);
  ok(`${state}: nothing is delivered`, s.deliveries === 0, `${s.deliveries}`);
  ok(`${state}: the order is not completed`, s.status !== 'completed', s.status);
  ok(`${state}: the buyer can still see what happened`, !!s.status, s.status);
}

console.log('\n━━ 7. Refund ━━');
{
  const p = await product('Refund');
  const o = await place(p);
  await startPay(o);
  const s0 = await snap(o.id);
  const pay = payments.get(s0.psp_payment_id);
  pay.status = 'paid';
  await hook(s0.psp_payment_id);
  await settle();
  const mid = await snap(o.id);
  ok('it delivered first', mid.status === 'completed' && mid.deliveries === 1, `${mid.status}/${mid.deliveries}`);
  pay.amountRefunded = { currency: 'EUR', value: '9.99' };
  await hook(s0.psp_payment_id);
  await settle();
  const s = await snap(o.id);
  ok('the order is refunded', s.status === 'refunded', s.status);
  ok('the refund is in the audit log', s.audit.includes('order.refunded'), JSON.stringify(s.audit));
}

console.log('\n━━ 8. Chargeback ━━');
{
  const p = await product('Chargeback');
  const o = await place(p);
  await startPay(o);
  const s0 = await snap(o.id);
  const pay = payments.get(s0.psp_payment_id);
  pay.status = 'paid';
  await hook(s0.psp_payment_id);
  await settle();
  pay.amountChargedBack = { currency: 'EUR', value: '9.99' };
  await hook(s0.psp_payment_id);
  await settle();
  const s = await snap(o.id);
  ok('the order is refunded', s.status === 'refunded', s.status);
  const cb = await all(`SELECT id, amount FROM chargebacks WHERE order_id=@id`, { id: o.id });
  ok('the chargeback is on the ledger', cb.length === 1, JSON.stringify(cb));
  await hook(s0.psp_payment_id);
  await settle(1);
  const cb2 = await all(`SELECT id FROM chargebacks WHERE order_id=@id`, { id: o.id });
  ok('a repeated chargeback webhook does not double it', cb2.length === 1, `${cb2.length}`);
}

console.log('\n━━ 8b. Free stock via the demo route ━━');
{
  const p = await product('DemoHole');
  const o = await place(p);
  const r = await fetch(`${base}/api/orders/${o.id}/pay`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: o.email }) });
  await settle();
  const s = await snap(o.id);
  ok('a buyer cannot mark their own order paid while Mollie is live',
    r.status === 404, `demo route answered ${r.status}, order is ${s.status}, ${s.deliveries} delivered`);
  ok('…and got no stock for free', s.deliveries === 0, `${s.deliveries}`);
}

console.log('\n━━ 9. A webhook nobody should trust ━━');
{
  const bad = await hook('tr_totallymadeup');
  ok('an unknown payment id is answered, not crashed', bad.status === 200, `${bad.status}`);
  const junk = await hook('not-a-payment-id');
  ok('a malformed id is dropped without a retry loop', junk.status === 200, `${junk.status}`);
}

srv.close(); sink.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

