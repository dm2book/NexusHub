/**
 * Refunds and chargebacks give back what an order took — once, and no more.
 *
 *   #3  the fraud-review "Reject" refunded through Mollie only: a Stripe
 *       payment was marked refunded and mailed as refunded while the money
 *       stayed in Stripe
 *   #4  a chargeback put the store credit spent on the order back in the
 *       wallet, and a store-credit refund followed by a chargeback paid the
 *       buyer twice
 *   #5  the Forge Coins, the tier bonus and the mystery prize an order earned
 *       stayed after it was refunded or charged back, and a store-credit refund
 *       of an opened box was quoted as if no prize had been paid
 *   #6  a partial refund made in the Stripe or Mollie dashboard was not
 *       recorded, so a later refund paid the whole order again
 *   #12 the refund mail for an order paid fully with store credit said €0,00
 *
 * Stripe is stubbed at the SDK's resource prototypes and Mollie at fetch, so
 * the shop's own client code, webhooks and admin routes all run for real.
 */
import './_selling-shop.mjs';   // must come first — see that file
import Stripe from 'stripe';

process.env.STRIPE_SECRET_KEY = 'sk_test_forgemarket_refunds';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_forgemarket_refunds';
process.env.MOLLIE_API_KEY = 'test_refundsuite';
process.env.DEMO_PAYMENTS = 'false';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

// ── Stripe, stubbed where the SDK keeps its methods ─────────────────────────
// Every client the SDK builds shares these prototypes, including the one
// stripeService creates on first use.
const probe = new Stripe('sk_test_probe');
const stripeRefunds = [];
let stripeRefusal = null;
Object.getPrototypeOf(probe.refunds).create = async function create(params) {
  if (stripeRefusal) throw new Error(stripeRefusal);
  stripeRefunds.push({ ...params });
  return { id: `re_suite_${stripeRefunds.length}`, status: 'succeeded', amount: params.amount };
};
const radar = new Map();                       // payment intent → Radar risk level
Object.getPrototypeOf(probe.paymentIntents).retrieve = async function retrieve(id) {
  return { id, latest_charge: { outcome: { risk_level: radar.get(id) || 'normal', risk_score: 12 },
    payment_method_details: { card: { country: null } } } };
};

// ── Mollie, stubbed at fetch ────────────────────────────────────────────────
const molliePayments = new Map();
const mollieRefunds = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.mollie.com/')) return realFetch(url, init);
  const json = (status, data) => new Response(JSON.stringify(data), { status });
  const refund = u.match(/\/v2\/payments\/([^/?]+)\/refunds$/);
  if (refund && init.method === 'POST') {
    const body = JSON.parse(init.body);
    mollieRefunds.push({ paymentId: decodeURIComponent(refund[1]), amount: body.amount });
    return json(201, { id: `re_m${mollieRefunds.length}`, status: 'pending', amount: body.amount });
  }
  const m = u.match(/\/v2\/payments\/([^/?]+)$/);
  if (m) {
    const p = molliePayments.get(decodeURIComponent(m[1]));
    return p ? json(200, p) : json(404, { detail: 'No payment exists with token' });
  }
  return json(404, { detail: `unstubbed ${u}` });
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { all, get, run, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { createProduct } = await import('../src/services/productService.js');
const { createOrder, getOrder, transitionOrder, deliverOrder, setPspPayment } = await import('../src/services/orderService.js');
const { refundOrder, creditRefundAmount } = await import('../src/services/refundService.js');
const { requestRefund } = await import('../src/services/supportService.js');
const { addEntry, balanceOf } = await import('../src/services/walletService.js');
const { coinBalance } = await import('../src/services/forgeCoinService.js');
const { applyPayment } = await import('../src/routes/mollie.js');
const mollie = await import('../src/services/mollieService.js');

const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const stamp = Date.now().toString(36);
const consent = { consent: true, consentText: 'Ik wil mijn bestelling meteen geleverd krijgen.' };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
/** Poll until fn() is truthy: rewards and deliveries run in the background. */
const waitFor = async (fn, ms = 6000) => {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v || Date.now() > until) return v;
    await pause(60);
  }
};

let n = 0;
const newUser = async () => {
  const id = newId('usr');
  const email = `refund-${stamp}-${++n}@example.test`;
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'R', @at, @at)`,
    { id, e: email, at: nowIso() });
  return { id, email };
};
/** Hand-delivered, so nothing dispenses on its own and every status is the test's. */
const card = (price, name = 'Refund Card') => createProduct({ name: `${name} ${stamp}-${++n}`,
  category: 'giftcard', price, announce: false, deliveryMode: 'manual' });
const order = (who, product, extra = {}) => createOrder({ email: who.email, userId: who.id,
  items: [{ productId: product.id, quantity: 1 }], ...consent, ...extra });
const statusOf = async (id) => (await get(`SELECT status FROM orders WHERE id=@id`, { id }))?.status;

// The owner, signed in, for the admin routes.
const owner = await newUser();
await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, 'owner', @at) ON CONFLICT DO NOTHING`,
  { u: owner.id, at: nowIso() });
const { finalizeLogin } = await import('../src/services/authService.js');
const { accessToken } = await finalizeLogin(await get(`SELECT * FROM users WHERE id=@id`, { id: owner.id }), {});
const admin = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method,
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

/** Sign an event the way Stripe does, so the webhook verifies it for real. */
const stripeEvent = async (type, object) => {
  const payload = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, object: 'event', type, data: { object } });
  const header = probe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const res = await fetch(`${base}/api/payments/stripe/webhook`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
/** Paid by card through Stripe Checkout: the session is recorded on the order
    when it is created (routes/catalog.js), then the webhook reports it paid. */
const payStripe = async (o, pi) => {
  await setPspPayment(o.id, { provider: 'stripe', paymentId: `cs_${pi}`, status: 'created' });
  const r = await stripeEvent('checkout.session.completed', { id: `cs_${pi}`, payment_status: 'paid',
    payment_intent: pi, amount_total: o.total, currency: 'eur', metadata: { orderId: o.id, orderNumber: o.number } });
  await waitFor(async () => (await statusOf(o.id)) !== 'pending', 3000);
  return r;
};
const dispute = (pi, amount) => stripeEvent('charge.dispute.created', { id: `dp_${pi}_${Math.random().toString(36).slice(2, 6)}`,
  payment_intent: pi, charge: `ch_${pi}`, amount, currency: 'eur', reason: 'fraudulent' });
/** Paid through Mollie: the payment exists there, and the webhook applies it. */
const payMollie = async (o, id) => {
  molliePayments.set(id, { id, status: 'paid', method: 'ideal', amount: mollie.toAmount(o.total, 'EUR'),
    metadata: { orderId: o.id, orderNumber: o.number } });
  const r = await applyPayment(id);
  await waitFor(async () => (await statusOf(o.id)) !== 'pending', 3000);
  return r;
};

// ═════════════════════════════════════════════════════════════════════════════
console.log('— #3 Rejecting a held order refunds through the provider that holds the money —');
{
  const guest = { email: `held-${stamp}@example.test` };
  const product = await card(12000, 'Held Card');
  const o = await createOrder({ email: guest.email, items: [{ productId: product.id, quantity: 1 }], ...consent });
  radar.set(`pi_held_${stamp}`, 'elevated');
  await payStripe(o, `pi_held_${stamp}`);
  const held = await getOrder(o.id);
  ok('Stripe Radar holds the paid order for review', held.fraudHold && held.status === 'payment_received',
    `${held.status} hold=${held.fraudHold}`);

  const before = stripeRefunds.length;
  const r = await admin('POST', `/api/admin/security/fraud/${o.id}/reject`, { reason: 'Stolen card' });
  const sent = stripeRefunds.slice(before);
  ok('the reject is accepted', r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  ok('…and Stripe is asked to refund the payment, in full',
    sent.length === 1 && sent[0].payment_intent === `pi_held_${stamp}` && sent[0].amount === 12000, JSON.stringify(sent));
  const after = await getOrder(o.id);
  ok('…the order is refunded and stays blocked', after.status === 'refunded' && after.fraudStatus === 'block' && after.fraudHold,
    `${after.status} ${after.fraudStatus}`);
  ok('…and the answer names the provider that sent it', r.body.refund?.provider === 'stripe', JSON.stringify(r.body.refund));

  // Stripe says no: nothing may change, and the owner is told.
  const o2 = await createOrder({ email: `held2-${stamp}@example.test`, items: [{ productId: product.id, quantity: 1 }], ...consent });
  radar.set(`pi_held2_${stamp}`, 'highest');
  await payStripe(o2, `pi_held2_${stamp}`);
  stripeRefusal = 'This PaymentIntent has no successful charge to refund';
  const refused = await admin('POST', `/api/admin/security/fraud/${o2.id}/reject`, {});
  stripeRefusal = null;
  const still = await getOrder(o2.id);
  ok('a refund Stripe refuses is an error, not a refunded order',
    refused.status >= 400 && still.status === 'payment_received', `${refused.status} → ${still.status}`);
  ok('…and the error says Stripe refused it', /Stripe/.test(refused.body?.error?.message || refused.body?.message || ''),
    JSON.stringify(refused.body));
  ok('…the hold is still there to decide again', still.fraudHold && still.fraudStatus !== 'block', still.fraudStatus);

  // Paid by hand: no provider to call, the owner sends it back the same way.
  const o3 = await createOrder({ email: `held3-${stamp}@example.test`, items: [{ productId: product.id, quantity: 1 }], ...consent });
  await transitionOrder(o3.id, 'payment_received', { actorId: 'test', reason: 'Bank transfer seen' });
  await run(`UPDATE orders SET fraud_hold=1, fraud_status='review' WHERE id=@id`, { id: o3.id });
  const manual = await admin('POST', `/api/admin/security/fraud/${o3.id}/reject`, {});
  ok('a hand-paid held order is refunded by hand', manual.status === 200 && (await statusOf(o3.id)) === 'refunded'
    && manual.body.refund?.provider === 'manual', JSON.stringify(manual.body.refund));

  const page = (await import('node:fs')).readFileSync(new URL('../../src/pages/admin/Security.jsx', import.meta.url), 'utf8');
  ok('the admin page says a hand-paid order is sent back by hand', /by hand/i.test(page) && /Stripe or Mollie/.test(page));
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('— #4 A chargeback is not a refund —');
{
  // €20 of credit and €30 by card, delivered, then the card is disputed.
  const u = await newUser();
  await addEntry({ userId: u.id, amount: 2000, type: 'grant', description: 'test' });
  const product = await card(5000);
  const o = await order(u, product, { useCredit: 2000 });
  ok('the order used €20 of credit, €30 left to pay', o.total === 3000 && (await balanceOf(u.id)) === 0);
  await payStripe(o, `pi_cb1_${stamp}`);
  await deliverOrder(o.id, [{ orderItemId: o.items[0].id, content: `CODE-${stamp}-1`, type: 'code' }], { actorId: 'test' });
  ok('…paid and delivered', (await statusOf(o.id)) === 'completed');
  await dispute(`pi_cb1_${stamp}`, 3000);
  await waitFor(async () => (await statusOf(o.id)) === 'refunded', 2000);
  ok('the dispute settles the order as refunded', (await statusOf(o.id)) === 'refunded');
  ok('…but the credit spent on it does NOT come back (the buyer kept the code)', (await balanceOf(u.id)) === 0,
    `wallet ${await balanceOf(u.id)}`);

  // The same through Mollie.
  const um = await newUser();
  await addEntry({ userId: um.id, amount: 2000, type: 'grant', description: 'test' });
  const om = await order(um, product, { useCredit: 2000 });
  const mid = `tr_cbm${stamp}`;
  await payMollie(om, mid);
  molliePayments.get(mid).amountChargedBack = mollie.toAmount(3000, 'EUR');
  await applyPayment(mid);
  ok('a Mollie chargeback does not return the credit either', (await statusOf(om.id)) === 'refunded' && (await balanceOf(um.id)) === 0,
    `${await statusOf(om.id)} wallet ${await balanceOf(um.id)}`);

  // A refund the shop gives is still a refund: the credit part goes back.
  const ur = await newUser();
  await addEntry({ userId: ur.id, amount: 2000, type: 'grant', description: 'test' });
  const or = await order(ur, product, { useCredit: 2000 });
  await payStripe(or, `pi_full_${stamp}`);
  await stripeEvent('charge.refunded', { id: `ch_full_${stamp}`, payment_intent: `pi_full_${stamp}`, amount: 3000, amount_refunded: 3000 });
  ok('a full refund in Stripe still returns the €20 credit part', (await statusOf(or.id)) === 'refunded' && (await balanceOf(ur.id)) === 2000,
    `${await statusOf(or.id)} wallet ${await balanceOf(ur.id)}`);

  // Refunded as store credit first, then charged back as well.
  const u2 = await newUser();
  const o2 = await order(u2, product);
  await payStripe(o2, `pi_cb2_${stamp}`);
  await refundOrder(o2.id, { method: 'credit', actorId: 'test', reason: 'test' });
  ok('the store-credit refund put €50 in the wallet', (await balanceOf(u2.id)) === 5000, `wallet ${await balanceOf(u2.id)}`);
  await dispute(`pi_cb2_${stamp}`, 5000);
  ok('a chargeback on top takes that credit back — €50 of value for €50, not €100',
    await waitFor(async () => (await balanceOf(u2.id)) === 0, 2000), `wallet ${await balanceOf(u2.id)}`);
  ok('…the chargeback is on record', !!(await get(`SELECT 1 FROM chargebacks WHERE order_id=@o`, { o: o2.id })));
  await dispute(`pi_cb2_${stamp}`, 5000);
  ok('…and the bank reporting it twice takes nothing more', (await balanceOf(u2.id)) === 0, `wallet ${await balanceOf(u2.id)}`);

  const u3 = await newUser();
  const o3 = await order(u3, product);
  const mid3 = `tr_cbc${stamp}`;
  await payMollie(o3, mid3);
  await refundOrder(o3.id, { method: 'credit', actorId: 'test', reason: 'test' });
  molliePayments.get(mid3).amountChargedBack = mollie.toAmount(5000, 'EUR');
  await applyPayment(mid3);
  ok('the same through Mollie', (await balanceOf(u3.id)) === 0, `wallet ${await balanceOf(u3.id)}`);

  // Part of the credit refund already spent: the buyer owes it, like a reversed commission.
  const u4 = await newUser();
  const o4 = await order(u4, product);
  await payStripe(o4, `pi_cb4_${stamp}`);
  await refundOrder(o4.id, { method: 'credit', actorId: 'test', reason: 'test' });
  const spendIt = await order(u4, await card(4000), { useCredit: 4000 });
  ok('…€40 of that credit is spent on another order', spendIt.total === 0 && (await balanceOf(u4.id)) === 1000);
  await dispute(`pi_cb4_${stamp}`, 5000);
  ok('…so the chargeback leaves the wallet at −€40, owed', (await balanceOf(u4.id)) === -4000, `wallet ${await balanceOf(u4.id)}`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('— #5 What an order earned goes back with it —');
{
  const u = await newUser();
  const big = await card(15000, 'Big Card');
  const o = await order(u, big);
  await transitionOrder(o.id, 'payment_received', { actorId: 'test', reason: 'Bank transfer seen' });
  const earned = await waitFor(async () => (await coinBalance(u.id)) === 15 && (await balanceOf(u.id)) === 200);
  ok('a €150 order earns 15 Forge Coins and the €2 Silver bonus', !!earned,
    `coins ${await coinBalance(u.id)} wallet ${await balanceOf(u.id)}`);
  await refundOrder(o.id, { method: 'money', actorId: 'test', reason: 'test' });
  ok('refunded, the coins go back', (await coinBalance(u.id)) === 0, `coins ${await coinBalance(u.id)}`);
  ok('…and so does the Silver bonus it unlocked', (await balanceOf(u.id)) === 0, `wallet ${await balanceOf(u.id)}`);
  const rows = await all(`SELECT delta FROM forge_coin_ledger WHERE ref=@o AND delta < 0`, { o: o.id });
  ok('…one reversal row for the order', rows.length === 1 && Number(rows[0].delta) === -15, JSON.stringify(rows));
  // A second undo path (a replayed webhook, the reversal run by hand) takes nothing more.
  const fcs = await import('../src/services/forgeCoinService.js');
  const loy = await import('../src/services/loyaltyService.js');
  const refunded = await getOrder(o.id);
  await fcs.reverseCoinsForOrder?.(refunded);
  await loy.revokeTierRewards?.(u.id, 'replayed');
  const { settleAsRefunded } = await import('../src/services/refundSettlement.js');
  await settleAsRefunded(o.id, 'replayed', { actorId: 'test', backoff: [0] });
  ok('…and undoing it again takes nothing more', typeof fcs.reverseCoinsForOrder === 'function'
    && (await coinBalance(u.id)) === 0 && (await balanceOf(u.id)) === 0
    && (await all(`SELECT 1 FROM forge_coin_ledger WHERE ref=@o AND delta < 0`, { o: o.id })).length === 1,
    `coins ${await coinBalance(u.id)} wallet ${await balanceOf(u.id)}`);
  const totals = await fcs.coinTotals(u.id);
  ok('…and the account shows them as never earned, not as spent', totals.earned === 0 && totals.spent === 0, JSON.stringify(totals));

  // Earned again, honestly: the bonus and the coins come back with the spend.
  const again = await order(u, big);
  await transitionOrder(again.id, 'payment_received', { actorId: 'test', reason: 'Bank transfer seen' });
  await waitFor(async () => (await get(`SELECT 1 AS x FROM forge_coin_ledger WHERE reason='order' AND ref=@o`, { o: again.id }))
    && (await all(`SELECT 1 FROM credit_transactions WHERE user_id=@u AND tag LIKE 'loyalty:silver%'`, { u: u.id })).length === 2);
  ok('reaching Silver again pays the bonus again, with the coins — once each',
    (await coinBalance(u.id)) === 15 && (await balanceOf(u.id)) === 200, `coins ${await coinBalance(u.id)} wallet ${await balanceOf(u.id)}`);

  // A chargeback takes them too.
  const c = await newUser();
  const oc = await order(c, big);
  await payStripe(oc, `pi_coins_${stamp}`);
  await waitFor(async () => (await coinBalance(c.id)) === 15 && (await balanceOf(c.id)) === 200);
  await dispute(`pi_coins_${stamp}`, 15000);
  ok('a chargeback takes the coins and the bonus back', await waitFor(async () =>
    (await coinBalance(c.id)) === 0 && (await balanceOf(c.id)) === 0, 2000), `coins ${await coinBalance(c.id)} wallet ${await balanceOf(c.id)}`);

  // Refunded in the same moment it was paid: the background award must not land after the refund.
  const r = await newUser();
  const quick = await order(r, big);
  await transitionOrder(quick.id, 'payment_received', { actorId: 'test', reason: 'Bank transfer seen' });
  await refundOrder(quick.id, { method: 'money', actorId: 'test', reason: 'test' });
  await pause(800);
  ok('a refund racing the payment leaves no coins and no bonus behind', (await coinBalance(r.id)) === 0 && (await balanceOf(r.id)) === 0,
    `coins ${await coinBalance(r.id)} wallet ${await balanceOf(r.id)}`);
  ok('…and an award that arrives after the refund awards nothing', (await fcs.awardCoinsForOrder(await getOrder(quick.id))) === 0
    && (await coinBalance(r.id)) === 0);

  // A mystery box: €49.99 that always pays €20 of credit.
  const box = await createProduct({ name: `Refund Box ${stamp}`, category: 'mystery', kind: 'mystery', price: 4999, announce: false });
  await run(`INSERT INTO mystery_box_rewards (id, box_id, label, weight, credit_cents, created_at)
             VALUES (@id, @b, '€20 credit', 1, 2000, @at)`, { id: newId('mbr'), b: box.id, at: nowIso() });
  const opened = async (pi) => {
    const who = await newUser();
    const ob = await order(who, box);
    await payStripe(ob, pi);
    await waitFor(async () => (await statusOf(ob.id)) === 'completed' && (await balanceOf(who.id)) === 2000);
    return { who, ob };
  };
  const m = await opened(`pi_box1_${stamp}`);
  ok('the box opened and paid €20', (await balanceOf(m.who.id)) === 2000 && (await statusOf(m.ob.id)) === 'completed',
    `${await statusOf(m.ob.id)} wallet ${await balanceOf(m.who.id)}`);
  ok('a store-credit refund of it is quoted net of the prize already paid (€29.99)',
    (await creditRefundAmount(await getOrder(m.ob.id))) === 2999, String(await creditRefundAmount(await getOrder(m.ob.id))));
  const req = await requestRefund({ orderId: m.ob.id, userId: m.who.id, reason: 'test', method: 'credit' });
  ok('…and the buyer\'s refund request carries that figure', Number(req.amount) === 2999, String(req.amount));
  await refundOrder(m.ob.id, { method: 'credit', actorId: 'test', reason: 'test' });
  ok('…refunded, the wallet holds what the box cost, not cost + prize', (await balanceOf(m.who.id)) === 4999,
    `wallet ${await balanceOf(m.who.id)}`);

  const d = await opened(`pi_box2_${stamp}`);
  await dispute(`pi_box2_${stamp}`, 4999);
  ok('a chargeback on the box takes the prize back', await waitFor(async () => (await balanceOf(d.who.id)) === 0, 2000),
    `wallet ${await balanceOf(d.who.id)}`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('— #6 A partial refund made at the provider is remembered —');
{
  const product = await card(5000);
  const u = await newUser();
  const o = await order(u, product);
  await payStripe(o, `pi_part_${stamp}`);
  await stripeEvent('charge.refunded', { id: `ch_part_${stamp}`, payment_intent: `pi_part_${stamp}`, amount: 5000, amount_refunded: 1000 });
  // Live: paid, or already moved on by the hand-delivery queue in the background.
  ok('€10 back in the Stripe dashboard leaves the order live',
    ['payment_received', 'processing', 'awaiting_fulfillment'].includes(await statusOf(o.id)), await statusOf(o.id));
  const refundedOn = async (id) => Number((await get(`SELECT refunded_cents FROM orders WHERE id=@id`, { id })
    .catch(() => null))?.refunded_cents ?? NaN);
  ok('…and the €10 is written on the order', (await refundedOn(o.id)) === 1000, String(await refundedOn(o.id)));
  ok('…where the admin sees it', (await admin('GET', `/api/admin/orders/${o.id}`)).body.order?.refundedCents === 1000);
  ok('a store-credit refund is quoted for what is left (€40)', (await creditRefundAmount(await getOrder(o.id))) === 4000,
    String(await creditRefundAmount(await getOrder(o.id))));
  await refundOrder(o.id, { method: 'credit', actorId: 'test', reason: 'test' });
  ok('…and credits €40: €50 back on a €50 order, not €60', (await balanceOf(u.id)) === 4000, `wallet ${await balanceOf(u.id)}`);
  const creditMail = await waitFor(() => get(`SELECT subject FROM email_log WHERE template_id='refund_issued' AND context LIKE @c
                                               ORDER BY created_at DESC LIMIT 1`, { c: `%${o.id}%` }), 3000);
  ok('…and its mail states the €40,00 that went into the wallet', /40,00/.test(creditMail?.subject || ''), creditMail?.subject);

  const o2 = await order(await newUser(), product);
  await payStripe(o2, `pi_part2_${stamp}`);
  await stripeEvent('charge.refunded', { id: `ch_part2_${stamp}`, payment_intent: `pi_part2_${stamp}`, amount: 5000, amount_refunded: 1000 });
  // Out of order: an older event with less refunded must not lower the figure.
  await stripeEvent('charge.refunded', { id: `ch_part2_${stamp}`, payment_intent: `pi_part2_${stamp}`, amount: 5000, amount_refunded: 500 });
  ok('a late, older event does not lower what was refunded', (await refundedOn(o2.id)) === 1000, String(await refundedOn(o2.id)));
  const before = stripeRefunds.length;
  const money = await refundOrder(o2.id, { method: 'money', actorId: 'test', reason: 'test' });
  const sent = stripeRefunds.slice(before);
  ok('a money refund sends Stripe only the €40 still held', sent.length === 1 && sent[0].amount === 4000, JSON.stringify(sent));
  ok('…and the order is refunded', money.order.status === 'refunded');

  const o3 = await order(await newUser(), product);
  const mid = `tr_part${stamp}`;
  await payMollie(o3, mid);
  molliePayments.get(mid).amountRefunded = { currency: 'EUR', value: '10.00' };
  await applyPayment(mid);
  ok('a partial refund in Mollie is written on the order too', (await refundedOn(o3.id)) === 1000, String(await refundedOn(o3.id)));
  const mb = mollieRefunds.length;
  await refundOrder(o3.id, { method: 'money', actorId: 'test', reason: 'test' });
  const ms = mollieRefunds.slice(mb);
  ok('…and the money refund asks Mollie for the €40 left', ms.length === 1 && ms[0].amount?.value === '40.00', JSON.stringify(ms));
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('— #12 The refund mail says what came back —');
{
  const product = await card(5000);
  const u = await newUser();
  await addEntry({ userId: u.id, amount: 5000, type: 'grant', description: 'test' });
  const o = await order(u, product, { useCredit: 5000 });
  ok('paid in full with €50 of credit', o.total === 0 && (await statusOf(o.id)) !== 'pending', `${o.total} ${await statusOf(o.id)}`);
  await refundOrder(o.id, { method: 'money', actorId: 'test', reason: 'test' });
  ok('the default Refund button returns the €50 credit', (await balanceOf(u.id)) === 5000, `wallet ${await balanceOf(u.id)}`);
  const mail = await waitFor(() => get(`SELECT subject FROM email_log WHERE template_id='refund_issued' AND context LIKE @c
                                         ORDER BY created_at DESC LIMIT 1`, { c: `%${o.id}%` }), 3000);
  ok('…and the mail says €50,00 came back, not €0,00', /50,00/.test(mail?.subject || '') && !/€\s?0,00/.test(mail?.subject || ''),
    mail?.subject);
  const { renderOrderEmail } = await import('../src/services/orderService.js');
  const body = await renderOrderEmail(o.id, 'refund_issued', {});
  // The order summary below it still reads "Totaal €0,00" — the order's own total, which is right.
  const text = (body?.html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  ok('…in the body too: €50,00 refunded, via the credit in their account',
    /hebben €\s?50,00 terugbetaald/.test(text) && /Terugbetaald €\s?50,00 Via tegoed in je account/.test(text),
    text.slice(text.indexOf('Hoi'), text.indexOf('Hoi') + 220));

  // A plain money refund still states the money.
  const p = await order(await newUser(), await card(2500));
  await transitionOrder(p.id, 'payment_received', { actorId: 'test', reason: 'Bank transfer seen' });
  await refundOrder(p.id, { method: 'money', actorId: 'test', reason: 'test' });
  const plain = await waitFor(() => get(`SELECT subject FROM email_log WHERE template_id='refund_issued' AND context LIKE @c
                                          ORDER BY created_at DESC LIMIT 1`, { c: `%${p.id}%` }), 3000);
  ok('a money refund mail still states the €25 paid', /25,00/.test(plain?.subject || ''), plain?.subject);
}

srv.close();
console.log(`\n${fail ? '❌' : '✅'} refund-integrity: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
