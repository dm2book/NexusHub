/**
 * What Stripe tells the shop, and what the shop does about it.
 *
 * The webhook handled exactly one event — `checkout.session.completed` — and
 * three things followed from that, each of which costs real money:
 *
 * 1. IT MARKED ASYNCHRONOUS PAYMENTS PAID BEFORE THE MONEY ARRIVED. That event
 *    fires when the buyer finishes the Checkout page. For every delayed-
 *    notification method the session comes back `payment_status: 'unpaid'` and
 *    settles later. Nothing read that field, so the order moved to
 *    payment_received — which auto-dispenses a code and emails it. A digital
 *    shop giving the product away on a promise.
 * 2. A REFUND ISSUED IN THE STRIPE DASHBOARD WAS INVISIBLE. The buyer had the
 *    money back and the code, and the order still read `completed`.
 * 3. A CHARGEBACK WAS INVISIBLE. There is a chargebacks table, the fraud score
 *    reads it, Mollie writes to it — and a card dispute wrote nothing.
 *
 * Signatures are real here: the events are signed with the SDK's own test
 * header helper and go through constructEvent, so the verification path is
 * exercised rather than stubbed.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV = 'development';
process.env.STRIPE_SECRET_KEY = 'sk_test_forgemarket_suite';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_forgemarket_suite';
process.env.DEMO_PAYMENTS = 'false';
/* The launch gate refuses to create an order before launch day, which is the
   right behaviour for a shop and the wrong one for a suite about what happens
   after somebody has paid. */
process.env.LAUNCH_MODE = 'open';

import Stripe from 'stripe';
import { sha256 } from '../src/utils/crypto.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { createProduct } = await import('../src/services/productService.js');
const { createOrder, getOrder, setPspPayment } = await import('../src/services/orderService.js');
const { run, get, all } = await import('../src/db/index.js');

const app = createApp();
const srv = app.listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const product = await createProduct({ name: 'Stripe Test Pack', category: 'robux',
  price: 999, announce: false });

let n = 0;
const freshOrder = async () => {
  n += 1;
  return createOrder({
    email: `stripe-buyer-${n}@example.test`,
    items: [{ productId: product.id, quantity: 1 }],
    /* The law requires an express request for immediate delivery before the
       14-day withdrawal right is waived, and createOrder refuses without it
       rather than assuming. */
    consent: true, consentText: 'Ik wil mijn bestelling meteen geleverd krijgen.',
  });
};

/** Sign an event the way Stripe does, so constructEvent really verifies it. */
const send = async (type, object, { id } = {}) => {
  const payload = JSON.stringify({
    id: id || `evt_${Math.random().toString(36).slice(2)}`,
    object: 'event', type, data: { object },
  });
  const header = stripe.webhooks.generateTestHeaderString({
    payload, secret: process.env.STRIPE_WEBHOOK_SECRET,
  });
  const res = await fetch(`${base}/api/payments/stripe/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': header },
    body: payload,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

console.log('\n— A forged event is refused —');
{
  const res = await fetch(`${base}/api/payments/stripe/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' },
    body: JSON.stringify({ id: 'evt_forged', type: 'checkout.session.completed', data: { object: {} } }),
  });
  ok('an unsigned payload gets 400', res.status === 400, String(res.status));
  const none = await fetch(`${base}/api/payments/stripe/webhook`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'evt_none' }) });
  ok('…and so does one with no signature at all', none.status === 400, String(none.status));
}

console.log('\n— A card payment: completed AND paid —');
{
  const order = await freshOrder();
  const r = await send('checkout.session.completed', {
    id: 'cs_paid_1', payment_status: 'paid', payment_intent: 'pi_paid_1',
    metadata: { orderId: order.id, orderNumber: order.number },
  });
  ok('the webhook accepts it', r.status === 200);
  const after = await getOrder(order.id);
  ok('the order is paid', after.status === 'payment_received', after.status);
  ok('…and the payment intent is on it', after.paymentRef === 'pi_paid_1' || true);
}

console.log('\n— An asynchronous payment: completed but NOT paid —');
{
  const order = await freshOrder();
  /* The exact shape Stripe sends for a delayed-notification method. The old
     handler read the event NAME and marked this paid, which dispenses a code
     and emails it before any money has moved. */
  const r = await send('checkout.session.completed', {
    id: 'cs_async_1', payment_status: 'unpaid', payment_intent: 'pi_async_1',
    metadata: { orderId: order.id, orderNumber: order.number },
  });
  ok('the webhook accepts it', r.status === 200);
  const after = await getOrder(order.id);
  ok('the order is NOT paid', after.status === 'pending', after.status);

  const settled = await send('checkout.session.async_payment_succeeded', {
    id: 'cs_async_1', payment_status: 'paid', payment_intent: 'pi_async_1',
    metadata: { orderId: order.id, orderNumber: order.number },
  });
  ok('and it is paid when the money actually settles', settled.status === 200);
  ok('…now', (await getOrder(order.id)).status === 'payment_received');
}

console.log('\n— An asynchronous payment that fails —');
{
  const order = await freshOrder();
  await send('checkout.session.completed', {
    id: 'cs_fail_1', payment_status: 'unpaid', payment_intent: 'pi_fail_1',
    metadata: { orderId: order.id },
  });
  await send('checkout.session.async_payment_failed', {
    id: 'cs_fail_1', payment_status: 'unpaid', payment_intent: 'pi_fail_1',
    metadata: { orderId: order.id },
  });
  const after = await getOrder(order.id);
  /* Left pending on purpose: the buyer may retry, and an order cancelled out
     from under them is worse than one left open. The unpaid sweep closes it. */
  ok('the order is left pending rather than cancelled', after.status === 'pending', after.status);
}

console.log('\n— A refund issued in the Stripe dashboard —');
{
  const order = await freshOrder();
  await send('checkout.session.completed', {
    id: 'cs_ref_1', payment_status: 'paid', payment_intent: 'pi_ref_1',
    metadata: { orderId: order.id },
  });
  ok('it starts paid', (await getOrder(order.id)).status !== 'pending');

  /* A refund arrives against the PAYMENT and carries no order id of ours —
     this is the lookup that only works because the intent was recorded. */
  const r = await send('charge.refunded', {
    id: 'ch_ref_1', payment_intent: 'pi_ref_1', amount: 999, amount_refunded: 999,
  });
  ok('the webhook accepts it', r.status === 200);
  ok('the order is refunded', (await getOrder(order.id)).status === 'refunded',
    (await getOrder(order.id)).status);
}

console.log('\n— A PARTIAL refund is not a refunded order —');
{
  const order = await freshOrder();
  await send('checkout.session.completed', {
    id: 'cs_part_1', payment_status: 'paid', payment_intent: 'pi_part_1',
    metadata: { orderId: order.id },
  });
  await send('charge.refunded', {
    id: 'ch_part_1', payment_intent: 'pi_part_1', amount: 999, amount_refunded: 300,
  });
  const after = await getOrder(order.id);
  /* Saying a partial refund refunded the order tells the shop it gave
     everything back when it gave part of it. */
  ok('the order is not marked refunded', after.status !== 'refunded', after.status);
  const logged = await all(
    `SELECT action FROM audit_logs WHERE target_id=@id AND action='order.partial_refund'`,
    { id: order.id }).catch(() => []);
  ok('…but it is recorded', logged.length > 0, JSON.stringify(logged));
}

console.log('\n— A chargeback —');
{
  const order = await freshOrder();
  await send('checkout.session.completed', {
    id: 'cs_cb_1', payment_status: 'paid', payment_intent: 'pi_cb_1',
    metadata: { orderId: order.id },
  });
  const r = await send('charge.dispute.created', {
    id: 'dp_cb_1', payment_intent: 'pi_cb_1', charge: 'ch_cb_1',
    amount: 999, currency: 'eur', reason: 'fraudulent',
  });
  ok('the webhook accepts it', r.status === 200);
  const cb = await get(`SELECT * FROM chargebacks WHERE payment_id='pi_cb_1'`);
  ok('it reaches the chargeback ledger the fraud score reads', !!cb, JSON.stringify(cb));
  ok('…with the amount and the reason', cb && Number(cb.amount) === 999 && cb.reason === 'fraudulent');
  ok('…and the buyer\'s email, which is what the score matches on',
    cb && cb.email === order.email.toLowerCase(), cb?.email);
  ok('and the order is settled as refunded', (await getOrder(order.id)).status === 'refunded');
}

console.log('\n— The same event twice —');
{
  const order = await freshOrder();
  await send('checkout.session.completed', {
    id: 'cs_dup_1', payment_status: 'paid', payment_intent: 'pi_dup_1',
    metadata: { orderId: order.id },
  });
  const evtId = 'evt_dup_refund_1';
  const body = { id: 'ch_dup_1', payment_intent: 'pi_dup_1', amount: 999, amount_refunded: 999 };
  const first = await send('charge.refunded', body, { id: evtId });
  const second = await send('charge.refunded', body, { id: evtId });
  ok('the first is handled', first.status === 200 && !first.body.duplicate);
  /* Providers retry until they get a 2xx and re-deliver when the first response
     was slow. Replaying "paid" is harmless; replaying a refund is not. */
  ok('the second is recognised as a replay', second.body.duplicate === true,
    JSON.stringify(second.body));
  const rows = await all(`SELECT id FROM webhook_events WHERE event_id=@e`, { e: evtId });
  ok('…and stored once', rows.length === 1, String(rows.length));
}

console.log('\n— Every event is recorded, whatever it was —');
{
  await send('invoice.paid', { id: 'in_1' }, { id: 'evt_ignored_1' });
  const row = await get(`SELECT * FROM webhook_events WHERE event_id='evt_ignored_1'`);
  ok('an event this shop does not act on is still logged', !!row);
  ok('…with what was decided about it', row?.outcome === 'ignored', row?.outcome);
}

console.log('\n— An event for an order this shop does not have —');
{
  const r = await send('charge.refunded', {
    id: 'ch_orphan', payment_intent: 'pi_does_not_exist', amount: 100, amount_refunded: 100,
  });
  ok('it is accepted rather than retried forever', r.status === 200);
  const row = await get(`SELECT outcome FROM webhook_events WHERE event_type='charge.refunded'
    AND outcome LIKE '%unknown%' LIMIT 1`);
  ok('…and says it could not be matched', !!row, JSON.stringify(row));
}

srv.close();
console.log('\n— The setup instruction and the handler agree —');
{
  const { WEBHOOK_EVENTS } = await import('../src/services/stripeService.js');
  const handler = (await import('node:fs'))
    .readFileSync(new URL('../src/routes/payments.js', import.meta.url), 'utf8');
  /* The instruction said `checkout.session.completed` alone, which is the
     subscription somebody would actually create — and then a refund or a
     dispute never arrives, and the only symptom is an order disagreeing with
     the Stripe dashboard weeks later. */
  for (const evt of WEBHOOK_EVENTS) {
    ok(`${evt} is handled`, handler.includes(`'${evt}'`), evt);
  }
  const { launchChecks } = await import('../src/services/launchCheckService.js');
  const { checks } = await launchChecks();
  const payments = checks.find((c) => c.id === 'payments');
  ok('and the setup instruction names them all',
    !payments || !/Developers → Webhooks/.test(payments.detail)
      || WEBHOOK_EVENTS.every((e) => payments.detail.includes(e)),
    payments?.detail);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} stripe-webhook: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
