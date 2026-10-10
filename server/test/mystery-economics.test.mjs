/**
 * Mystery boxes and money, after the retirement.
 *
 * Boxes are no longer sold (paid random prizes are very likely a game of
 * chance under the Dutch Wet op de kansspelen — see mystery-retired.test.mjs).
 * What stays is the money of the boxes that WERE sold, and the rules this
 * suite pinned for them still hold for those orders:
 *
 *   #1  the credit loop: store credit bought boxes that paid out more credit
 *       than they cost. No box can be bought at all now — with credit or
 *       without — and credit still pays for a code.
 *   #1b the order limits count the store credit, not only the money part
 *   #2  a fraud hold keeps a box shut, and the held order is not completed
 *   #5b a refunded or charged-back box gives its prize back — once, and a prize
 *       already spent is owed
 *   #5d the free reroll is gone with the boxes (410), so it can no longer pay
 *       out on a refunded or unfinished order either
 *
 * What went with the boxes: the payout oracle against expectedPayout() and the
 * admin's pool and price checks (no pool can be saved), the starter box and
 * its pool healing (nothing seeds a box), the discount rules on a cart with a
 * box (no such cart can be priced) and the checkout's "credit is off" line
 * (pinned as gone, last).
 */
import './_selling-shop.mjs';   // must come first — see that file
import { ensureReady, createApp } from '../src/app.js';
import { all, get, run, nowIso } from '../src/db/index.js';
import { newId } from '../src/utils/ids.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
await ensureReady();
const stamp = Date.now();

const { createProduct } = await import('../src/services/productService.js');
const os = await import('../src/services/orderService.js');
const { createOrder, markPaymentReceived, transitionOrder, releaseFraudHold } = os;
const mbs = await import('../src/services/mysteryBoxService.js');
const { credit, balanceOf } = await import('../src/services/walletService.js');
const { grantMembership, memberDiscountPercent } = await import('../src/services/membershipService.js');
const { refundOrder } = await import('../src/services/refundService.js');
const { currentLimits } = await import('../src/services/orderLimitService.js');

const consent = { consent: true, consentText: 'Ik wil mijn bestelling meteen geleverd krijgen.' };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
/** Poll until fn() returns something truthy (background work is not awaited by transitionOrder). */
const waitFor = async (fn, ms = 6000) => {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v || Date.now() > until) return v;
    await pause(60);
  }
};
const throws = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
let userN = 0;
const newUser = async () => {
  const id = newId('usr');
  const email = `myst-${stamp}-${++userN}@example.test`;
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'M', @at, @at)`,
    { id, e: email, at: nowIso() });
  return { id, email };
};
/* A box as an older release left it — the row and its pool written straight
   to the tables, switched off by migration 065. Nothing makes one any more. */
const makeBox = async (price, pool, name = 'Test Box') => {
  const id = newId('prd');
  const full = `${name} ${stamp}-${++userN}`;
  await run(`INSERT INTO products (id, name, category, price, currency, kind, active, metadata, created_at, updated_at)
             VALUES (@id, @n, 'mystery', @p, 'EUR', 'mystery', 0, '{}', @at, @at)`,
    { id, n: full, p: price, at: nowIso() });
  for (const r of pool) {
    await run(`INSERT INTO mystery_box_rewards (id, box_id, label, weight, credit_cents, created_at)
               VALUES (@id, @b, @l, @w, @c, @at)`,
      { id: newId('mbr'), b: id, l: r.label, w: r.weight, c: r.credit, at: nowIso() });
  }
  return { id, name: full, price };
};
const makeCard = (price, name = 'Test Card') =>
  createProduct({ name: `${name} ${stamp}-${++userN}`, category: 'giftcard', price, announce: false });
/* An order for a box placed before the retirement. The checkout refuses a box
   now, so it is placed for a stand-in card at the box's price and its line is
   then pointed at the box — the rows an older release wrote. */
const standIns = new Map();
const boxOrder = async (user, box) => {
  if (!standIns.has(box.price)) standIns.set(box.price, await makeCard(box.price, 'Stand-in'));
  const standIn = standIns.get(box.price);
  const o = await createOrder({ email: user.email, userId: user.id, items: [{ productId: standIn.id, quantity: 1 }], ...consent });
  await run(`UPDATE order_items SET product_id=@b, name=@nm, metadata=@m WHERE order_id=@o AND product_id=@s`,
    { b: box.id, nm: box.name, m: JSON.stringify({ category: 'mystery' }), o: o.id, s: standIn.id });
  return o;
};
const pullsOf = (orderId) => all(`SELECT * FROM mystery_pulls WHERE order_id=@o`, { o: orderId });
const statusOf = async (orderId) => (await get(`SELECT status FROM orders WHERE id=@o`, { o: orderId }))?.status;

// One prize only, so a payout is exact: €20 per box.
const FLAT20 = [{ label: '€20 store credit', weight: 1, credit: 2000 }];
const box20 = await makeBox(4999, FLAT20, 'Flat Box');
const card10 = await makeCard(1000, 'Code €10');

console.log('— No box can be bought: the credit loop is closed for good —');
{
  const m = await newUser();
  await grantMembership(m.id, 30);
  await credit(m.id, 70000, 'adjustment', 'test top-up');
  const err = await throws(() => createOrder({ email: m.email, userId: m.id, useCredit: 70000,
    items: [{ productId: box20.id, quantity: 14 }], ...consent }));
  ok('fourteen boxes paid with €700 of credit are refused', !!err && /mystery/i.test(err.message), err?.message || 'accepted');
  const paid = await throws(() => createOrder({ email: m.email, userId: m.id,
    items: [{ productId: box20.id, quantity: 1 }], ...consent }));
  ok('…and so is one box paid with money', !!paid && /mystery/i.test(paid.message), paid?.message || 'accepted');
  // Even a box switched back on by hand: the order looks at the kind, not only at `active`.
  await run(`UPDATE products SET active=1 WHERE id=@id`, { id: box20.id });
  const live = await throws(() => createOrder({ email: m.email, userId: m.id, useCredit: 5000,
    items: [{ productId: box20.id, quantity: 1 }, { productId: card10.id, quantity: 1 }], ...consent }));
  await run(`UPDATE products SET active=0 WHERE id=@id`, { id: box20.id });
  ok('…and a box switched back on by hand, next to a code', !!live && /retired/i.test(live.message), live?.message || 'accepted');
  const rows = await all(`SELECT id FROM orders WHERE user_id=@u`, { u: m.id });
  ok('…no order is written and the wallet is untouched', rows.length === 0 && (await balanceOf(m.id)) === 70000,
    `${rows.length} order(s), wallet ${await balanceOf(m.id)}`);

  const plain = await createOrder({ email: m.email, userId: m.id, useCredit: 1000,
    items: [{ productId: card10.id, quantity: 1 }], ...consent });
  const due = 1000 - Math.round(1000 * (await memberDiscountPercent(m.id)) / 100);
  ok('credit still pays for a code, member discount and all (legitimate use unchanged)',
    plain.total === 0 && plain.billing.creditApplied === due, `${plain.total} ${JSON.stringify(plain.billing)}`);
}

console.log('— Order limits count the store credit —');
{
  const L = currentLimits();
  if (L.maxOrderValue > 0) {
    const big = await makeCard(L.maxOrderValue + 100, 'Big Card');
    const r = await newUser();
    await credit(r.id, L.maxOrderValue + 100, 'adjustment', 'test top-up');
    const err = await throws(() => createOrder({ email: r.email, userId: r.id, useCredit: L.maxOrderValue + 100,
      items: [{ productId: big.id, quantity: 1 }], ...consent }));
    ok('an order over the single-order ceiling is refused even when credit pays all of it',
      !!err && /larger than we accept/i.test(err.message), err?.message || 'accepted');
    ok('…and the credit stays in the wallet', (await balanceOf(r.id)) === L.maxOrderValue + 100);
  } else ok('single-order ceiling configured', false, 'LIMIT_MAX_ORDER_VALUE is 0');

  if (L.valuePerEmailPerDay > 0 && L.maxOrderValue > 0) {
    const part = Math.min(L.maxOrderValue, Math.floor(L.valuePerEmailPerDay * 0.45));
    const s = await newUser();
    await credit(s.id, part * 2, 'adjustment', 'test top-up');
    const card = await makeCard(part, 'Day Card');
    for (let i = 0; i < 2; i++) {
      await createOrder({ email: s.email, userId: s.id, useCredit: part, items: [{ productId: card.id, quantity: 1 }], ...consent });
    }
    const last = await makeCard(Math.floor(L.valuePerEmailPerDay * 0.2), 'Day Card 2');
    const err = await throws(() => createOrder({ email: s.email, userId: s.id,
      items: [{ productId: last.id, quantity: 1 }], ...consent }));
    ok('orders paid with credit count towards the daily value ceiling', !!err && /24 hours/.test(err.message), err?.message || 'accepted');
  } else ok('daily value ceiling configured', false);
}

console.log('— A fraud hold keeps a box from before shut —');
{
  const h = await newUser();
  const o = await boxOrder(h, box20);
  // What stripeSettlement.markPaid does for a risky payment: hold first, then mark paid.
  await run(`UPDATE orders SET fraud_hold=1, fraud_status='review', fraud_hold_reason='Stripe Radar: elevated risk' WHERE id=@id`, { id: o.id });
  await markPaymentReceived(o.id, `pi_hold_${stamp}`, { actorId: 'stripe', reason: 'test' });
  const opened = await waitFor(async () => (await pullsOf(o.id)).length > 0, 2500);
  ok('a held order opens no box', !opened, `${(await pullsOf(o.id)).length} pull(s)`);
  ok('…pays out no credit', (await balanceOf(h.id)) === 0, String(await balanceOf(h.id)));
  ok('…and is not completed', (await statusOf(o.id)) !== 'completed', await statusOf(o.id));

  if (typeof os.openMysteryBoxes === 'function') {
    const again = await os.openMysteryBoxes(o.id);
    ok('opening it by hand is refused while it is held', again.length === 0 && (await statusOf(o.id)) !== 'completed');
  } else ok('orderService exposes openMysteryBoxes()', false);

  await releaseFraudHold(o.id, { actorId: 'test', reason: 'checked' });
  const done = await waitFor(async () => (await statusOf(o.id)) === 'completed');
  ok('approving the order opens the box it was sold', (await pullsOf(o.id)).length === 1 && (await balanceOf(h.id)) === 2000,
    `${(await pullsOf(o.id)).length} pull(s), wallet ${await balanceOf(h.id)}`);
  ok('…and completes the boxes-only order', !!done, await statusOf(o.id));
}

/** A paid, opened, completed €49.99 box from before that won €20. */
const openedBox = async () => {
  const u = await newUser();
  const o = await boxOrder(u, box20);
  await markPaymentReceived(o.id, `pi_${o.id}`, { actorId: 'stripe', reason: 'test' });
  await waitFor(async () => (await statusOf(o.id)) === 'completed' && (await balanceOf(u.id)) === 2000);
  return { u, o };
};

console.log('— A refund takes the prize back —');
{
  const { u, o } = await openedBox();
  ok('the box paid out €20 and completed', (await balanceOf(u.id)) === 2000 && (await statusOf(o.id)) === 'completed');
  await refundOrder(o.id, { method: 'credit', actorId: 'test', reason: 'test' });
  ok('a store-credit refund leaves exactly the price in the wallet, not price + prize',
    (await balanceOf(u.id)) === 4999, `wallet ${await balanceOf(u.id)}`);

  const b = await openedBox();
  await refundOrder(b.o.id, { method: 'money', actorId: 'test', reason: 'test' });
  ok('a money refund takes the €20 prize back', (await balanceOf(b.u.id)) === 0, `wallet ${await balanceOf(b.u.id)}`);

  const s = await openedBox();
  const card20 = await makeCard(2000, 'Spend Card');
  const spent = await createOrder({ email: s.u.email, userId: s.u.id, useCredit: 2000, items: [{ productId: card20.id, quantity: 1 }], ...consent });
  ok('the prize can be spent on a code', spent.total === 0 && (await balanceOf(s.u.id)) === 0);
  await refundOrder(s.o.id, { method: 'money', actorId: 'test', reason: 'test' });
  ok('a prize already spent is owed: the wallet goes negative, like a reversed commission',
    (await balanceOf(s.u.id)) === -2000, `wallet ${await balanceOf(s.u.id)}`);

  const c = await openedBox();
  await transitionOrder(c.o.id, 'refunded', { actorId: 'stripe', reason: 'Chargeback', silent: true });
  ok('a chargeback (refunded by the webhook) takes the prize back', (await balanceOf(c.u.id)) === 0, `wallet ${await balanceOf(c.u.id)}`);

  if (typeof mbs.reverseMysteryForOrder === 'function') {
    const again = await mbs.reverseMysteryForOrder(c.o.id, 'charged back');
    const rows = await all(`SELECT amount FROM credit_transactions WHERE order_id=@o AND type='mystery_prize' AND amount < 0`, { o: c.o.id });
    ok('reverseMysteryForOrder is idempotent (a second call takes nothing more)',
      again === null && rows.length === 1 && (await balanceOf(c.u.id)) === 0, `${JSON.stringify(again)} ${rows.length}`);
  } else ok('mysteryBoxService exposes reverseMysteryForOrder()', false);
}

console.log('— The free reroll is gone, on every order —');
const { finalizeLogin } = await import('../src/services/authService.js');
const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
{
  ok('the service no longer offers a reroll', typeof mbs.rerollPull === 'undefined');
  const tokenOf = async (id) => (await finalizeLogin(await get(`SELECT * FROM users WHERE id=@id`, { id }), {})).accessToken;
  const reroll = async (u, o, pull) => {
    const r = await fetch(`${base}/api/account/orders/${o.id}/mystery/${pull?.id}/reroll`, { method: 'POST',
      headers: { authorization: `Bearer ${await tokenOf(u.id)}`, 'content-type': 'application/json' } });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  // A completed order — the one case that used to get its free reroll.
  const fine = await openedBox();
  const [fp] = await pullsOf(fine.o.id);
  const r1 = await reroll(fine.u, fine.o, fp);
  ok('a completed order\'s reroll answers 410 Gone', r1.status === 410, `${r1.status} ${JSON.stringify(r1.body)}`);
  ok('…pays nothing and does not mark the box rerolled', (await balanceOf(fine.u.id)) === 2000
    && !(await get(`SELECT rerolled_at FROM mystery_pulls WHERE id=@id`, { id: fp?.id }))?.rerolled_at);
  // A refunded one: the reroll that once paid out on top of a refund cannot.
  const back = await openedBox();
  await refundOrder(back.o.id, { method: 'money', actorId: 'test', reason: 'test' });
  const [bp] = await pullsOf(back.o.id);
  const r2 = await reroll(back.u, back.o, bp);
  ok('a refunded order\'s reroll answers 410 and the wallet stays at zero', r2.status === 410 && (await balanceOf(back.u.id)) === 0,
    `${r2.status} wallet ${await balanceOf(back.u.id)}`);
}

console.log('— The checkout no longer has a box to explain —');
{
  /* This pinned the line telling a buyer why store credit was off for a cart
     holding a mystery box. Boxes are retired — paid random prizes are very
     likely a game of chance under the Dutch Wet op de kansspelen — so the shop
     sells none, no cart can hold one, and the line and its translations went
     with them. What is pinned now is that they stay gone. */
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../src/pages/Checkout.jsx', import.meta.url), 'utf8');
  ok('the checkout no longer special-cases a cart with a box', !/creditNoMystery|hasMystery/.test(src));
  const key = /'checkout\.creditNoMystery':/;
  const files = ['../../src/lib/i18n.jsx', '../../src/lib/i18n/de.js', '../../src/lib/i18n/fr.js'];
  ok('…and its text is gone from Dutch, German and French',
    files.every((f) => !key.test(fs.readFileSync(new URL(f, import.meta.url), 'utf8'))));
}

srv.close();
console.log(`\n${fail ? '❌' : '✅'} mystery-economics: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
