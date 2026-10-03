/**
 * Three ways the money path paid out what it never took in.
 *
 * 1. THE BUYER CHOSE THE CURRENCY. Prices are euro cents, but the order took
 *    `currency` from the request: a €50 card ordered "in KRW" was sent to
 *    Stripe as 5000 won.
 * 2. THE BUYER WROTE THEIR OWN STORE CREDIT. `billing` was copied whole, so
 *    `billing.creditApplied: 25000` rode along on an unpaid order — and the
 *    unpaid-order cancel credited it back to the wallet.
 * 3. A FAILED WEBHOOK WAS ANSWERED 200 AND MARKED DONE. Stripe's retry was
 *    then dismissed as a duplicate and the paid order stayed pending. Nor did
 *    the handler check that the session paid this order's amount, in euro.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV = 'development';
process.env.STRIPE_SECRET_KEY = 'sk_test_forgemarket_guards';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_forgemarket_guards';
process.env.DEMO_PAYMENTS = 'false';
process.env.LAUNCH_MODE = 'open';

import Stripe from 'stripe';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { createProduct } = await import('../src/services/productService.js');
const { createOrder, getOrder, transitionOrder } = await import('../src/services/orderService.js');
const { credit, balanceOf } = await import('../src/services/walletService.js');
const { run, get, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');

const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const product = await createProduct({ name: 'Guard Test Card', category: 'giftcard', price: 5000, announce: false });
const consent = { consent: true, consentText: 'Ik wil mijn bestelling meteen geleverd krijgen.' };
const newUser = async () => {
  const id = newId('usr');
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'G', @at, @at)`,
    { id, e: `${id}@example.test`, at: nowIso() });
  return id;
};

console.log('\n— The currency is the shop\'s —');
{
  const o = await createOrder({ email: 'krw@example.test', currency: 'KRW', items: [{ productId: product.id, quantity: 1 }], ...consent });
  ok('an order asked for "in KRW" is in EUR, at the euro price', o.currency === 'EUR' && o.total === 5000, `${o.currency} ${o.total}`);
}

console.log('\n— Store credit comes from the wallet, never from the request —');
{
  const u = await newUser();
  const o = await createOrder({ email: 'inject@example.test', userId: u, billing: { creditApplied: 25000, discount: 4000, full_name: 'X' },
    items: [{ productId: product.id, quantity: 1 }], ...consent });
  ok('a "creditApplied" sent by the buyer is not stored', !o.billing.creditApplied && !o.billing.discount && o.total === 5000, JSON.stringify(o.billing));
  await transitionOrder(o.id, 'cancelled', { actorId: 'test', reason: 'unpaid' });
  ok('…and cancelling the order pays nothing out', (await balanceOf(u)) === 0, String(await balanceOf(u)));

  const v = await newUser();
  await credit(v, 1500, 'adjustment', 'test top-up');
  const p = await createOrder({ email: 'real@example.test', userId: v, useCredit: 1500, items: [{ productId: product.id, quantity: 1 }], ...consent });
  ok('real credit is used and stored', p.billing.creditApplied === 1500 && p.total === 3500 && (await balanceOf(v)) === 0);
  await transitionOrder(p.id, 'cancelled', { actorId: 'test', reason: 'unpaid' });
  ok('…and on cancel exactly that comes back, once', (await balanceOf(v)) === 1500, String(await balanceOf(v)));
  await transitionOrder(p.id, 'refunded', { actorId: 'test' }).catch(() => {});
  ok('…not twice', (await balanceOf(v)) === 1500, String(await balanceOf(v)));
}

console.log('\n— The webhook —');
const send = async (type, object, id = `evt_${Math.random().toString(36).slice(2)}`, livemode = false) => {
  const payload = JSON.stringify({ id, object: 'event', type, livemode, data: { object } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const res = await fetch(`${base}/api/payments/stripe/webhook`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const fresh = (i) => createOrder({ email: `wh-${i}@example.test`, items: [{ productId: product.id, quantity: 1 }], ...consent });
{
  const a = await fresh(1);
  await send('checkout.session.completed', { id: 'cs_a', object: 'checkout.session', payment_status: 'paid',
    amount_total: 1, currency: 'eur', metadata: { orderId: a.id }, payment_intent: 'pi_a' });
  ok('a session that paid 1 cent does not pay a €50 order', (await getOrder(a.id)).status === 'pending');

  const b = await fresh(2);
  await send('checkout.session.completed', { id: 'cs_b', object: 'checkout.session', payment_status: 'paid',
    amount_total: 5000, currency: 'krw', metadata: { orderId: b.id }, payment_intent: 'pi_b' });
  ok('…nor one paid in won', (await getOrder(b.id)).status === 'pending');

  const c = await fresh(3);
  await send('checkout.session.completed', { id: 'cs_c', object: 'checkout.session', payment_status: 'paid',
    amount_total: 5000, currency: 'eur', metadata: { orderId: c.id }, payment_intent: 'pi_c' }, undefined, true);
  ok('…nor a live-mode event at a shop running a test key', (await getOrder(c.id)).status === 'pending');

  const d = await fresh(4);
  const okEvt = await send('checkout.session.completed', { id: 'cs_d', object: 'checkout.session', payment_status: 'paid',
    amount_total: 5000, currency: 'eur', metadata: { orderId: d.id }, payment_intent: 'pi_d' });
  ok('the right amount, in euro, in test mode: paid', okEvt.status === 200 && (await getOrder(d.id)).status !== 'pending');

  /* A handler that fails half-way: the database refuses the update that
     marks this one order paid (a trigger stands in for a dropped connection). */
  const e = await fresh(5);
  const evt = `evt_fail_${Date.now()}`;
  await run(`CREATE OR REPLACE FUNCTION fm_refuse() RETURNS trigger AS $$ BEGIN
    IF NEW.id = '${e.id}' AND NEW.status <> OLD.status THEN RAISE EXCEPTION 'database went away'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
  await run(`CREATE TRIGGER fm_refuse BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION fm_refuse()`);
  const first = await send('checkout.session.completed', { id: 'cs_e', object: 'checkout.session', payment_status: 'paid',
    amount_total: 5000, currency: 'eur', metadata: { orderId: e.id }, payment_intent: 'pi_e' }, evt).catch((x) => ({ status: 0, err: x.message }));
  await run(`DROP TRIGGER fm_refuse ON orders`);
  ok('a failure is answered 500, so Stripe retries', first.status === 500, JSON.stringify(first));
  const retry = await send('checkout.session.completed', { id: 'cs_e', object: 'checkout.session', payment_status: 'paid',
    amount_total: 5000, currency: 'eur', metadata: { orderId: e.id }, payment_intent: 'pi_e' }, evt);
  ok('…and the retry is processed, not dismissed as a duplicate', retry.status === 200 && !retry.body.duplicate
    && (await getOrder(e.id)).status !== 'pending', JSON.stringify(retry.body));
  const again = await send('checkout.session.completed', { id: 'cs_e', object: 'checkout.session', payment_status: 'paid',
    amount_total: 5000, currency: 'eur', metadata: { orderId: e.id }, payment_intent: 'pi_e' }, evt);
  ok('…after which a third delivery IS a duplicate', again.body.duplicate === true);

  const row = await get(`SELECT outcome FROM webhook_events WHERE event_id=@e`, { e: evt });
  ok('the event ends with a real outcome', row?.outcome === 'paid', row?.outcome);
}

console.log('\n— Stock and the hand-delivery queue —');
{
  const { addProductCodes } = await import('../src/services/codeStockService.js');
  const { listManualQueue, completeManualFulfillment } = await import('../src/services/fulfillmentService.js');
  const coded = await createProduct({ name: 'Guard Code Card', category: 'giftcard', price: 1000, announce: false });
  ok('the same code uploaded twice is in stock once', (await addProductCodes(coded.id, ['SAME-0001', 'SAME-0001'])) === 1
    && (await addProductCodes(coded.id, ['SAME-0001', 'OTHER-0002'])) === 1);
  const two = await createOrder({ email: 'lines@example.test', items: [{ productId: coded.id, quantity: 1 }, { productId: coded.id, quantity: 1 }], ...consent });
  ok('two lines of one product become one line of two', two.items.length === 1 && two.items[0].quantity === 2 && two.total === 2000,
    JSON.stringify(two.items.map((i) => i.quantity)));

  const o = await createOrder({ email: 'queue@example.test', items: [{ productId: product.id, quantity: 1 }], ...consent });
  await run(`UPDATE orders SET status='payment_received' WHERE id=@id`, { id: o.id });
  const rid = newId('ful');
  await run(`INSERT INTO fulfillment_requests (id, order_id, order_item_id, mode, status, created_at, updated_at)
             VALUES (@id, @o, @i, 'manual', 'pending', @at, @at)`, { id: rid, o: o.id, i: o.items[0].id, at: nowIso() });
  ok('a paid order is in the queue', (await listManualQueue()).some((r) => r.id === rid));
  await transitionOrder(o.id, 'refunded', { actorId: 'test' });
  ok('…refunded, it leaves the queue', !(await listManualQueue()).some((r) => r.id === rid));
  const done = await completeManualFulfillment(rid, { deliveries: [{ type: 'code', content: 'X' }] }).then(() => 'delivered', (e) => e.message);
  ok('…and cannot be delivered any more', /no longer be delivered/.test(done), done);
}

console.log('\n— Coupons and Roblox names —');
{
  const { createCoupon } = await import('../src/services/couponService.js');
  const code = `ONCE${Date.now() % 100000}`;
  await createCoupon({ code, kind: 'percent', value: 10, maxRedemptions: 1, announce: false }, 'test');
  const tries = await Promise.all(Array.from({ length: 6 }, (_, i) => createOrder({ email: `c${i}@example.test`, coupon: code,
    items: [{ productId: product.id, quantity: 1 }], ...consent }).then(() => 'ok', (e) => e.status)));
  ok('a one-time code is used once, even by six orders at the same moment', tries.filter((t) => t === 'ok').length === 1, tries.join(','));
  const bad = await createOrder({ email: 'bad@example.test', coupon: 'NOPE-NOT-A-CODE', items: [{ productId: product.id, quantity: 1 }], ...consent })
    .then(() => 'charged full price', (e) => e.status);
  ok('a code that does not apply is refused with a reason, not dropped silently', bad === 409, String(bad));
  const per = `PER${Date.now() % 100000}`;
  await createCoupon({ code: per, kind: 'percent', value: 10, perUserLimit: 1, announce: false }, 'test');
  await createOrder({ email: 'same.person@gmail.com', coupon: per, items: [{ productId: product.id, quantity: 1 }], ...consent });
  const alias = await createOrder({ email: 'sameperson+2@gmail.com', coupon: per, items: [{ productId: product.id, quantity: 1 }], ...consent })
    .then(() => 'used again', (e) => e.status);
  ok('…and a plus-alias of the same gmail is the same person', alias === 409, String(alias));
  const once2 = `UNDO${Date.now() % 100000}`;
  await createCoupon({ code: once2, kind: 'percent', value: 10, maxRedemptions: 1, announce: false }, 'test');
  const first = await createOrder({ email: 'undo@example.test', coupon: once2, items: [{ productId: product.id, quantity: 1 }], ...consent });
  await transitionOrder(first.id, 'cancelled', { actorId: 'test', reason: 'unpaid' });
  const second = await createOrder({ email: 'undo2@example.test', coupon: once2, items: [{ productId: product.id, quantity: 1 }], ...consent })
    .then(() => 'ok', (e) => e.status);
  ok('an unpaid order that is cancelled gives its use back', second === 'ok', String(second));

  const rbx = await createProduct({ name: '1,000 Robux', category: 'robux', price: 999, announce: false });
  const invalid = await createOrder({ email: 'r@example.test', billing: { deliveryMethod: 'account', deliveryDetails: 'not a valid name!! <>' },
    items: [{ productId: rbx.id, quantity: 1 }], ...consent }).then(() => 'accepted', (e) => e.status);
  ok('a Roblox name that cannot exist is refused', invalid === 400, String(invalid));
  const valid = await createOrder({ email: 'r2@example.test', billing: { deliveryMethod: 'account', deliveryDetails: 'Speler_123' },
    items: [{ productId: rbx.id, quantity: 1 }], ...consent }).then(() => 'accepted', (e) => e.message);
  ok('…a real one is accepted', valid === 'accepted', valid);
}

console.log('\n— The launch blockers —');
{
  const { config, commerceBlockers } = await import('../src/config/env.js');
  const saved = config.payments.stripe.webhookSecret;
  config.payments.stripe.webhookSecret = '';
  ok('a Stripe key without a webhook secret pauses ordering', commerceBlockers().some((r) => /STRIPE_WEBHOOK_SECRET/.test(r)));
  config.payments.stripe.webhookSecret = saved;
}

srv.close();
console.log(`\n${fail ? '❌' : '✅'} money-guards: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
