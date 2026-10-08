/**
 * Mystery boxes and money: a box must never pay out more than it takes in.
 *
 *   #1  a box bought with store credit paid out more credit than it cost, so
 *       the wallet grew every round (≈ €53.10 back per €49.99 box at the luck
 *       cap with the free reroll). Member, coupon and bundle discounts made the
 *       box cheaper still, and the order limits only looked at the money part.
 *   #2  a fraud hold did not stop the payout, and the held order was completed
 *   #5b a refunded box kept its prize on top of the refund
 *   #5d a refunded or unfinished order could still be rerolled
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
const { createOrder, getOrder, markPaymentReceived, transitionOrder, releaseFraudHold } = os;
const mbs = await import('../src/services/mysteryBoxService.js');
const { credit, balanceOf } = await import('../src/services/walletService.js');
const { grantMembership, memberDiscountPercent } = await import('../src/services/membershipService.js');
const { createCoupon } = await import('../src/services/couponService.js');
const { grantCoins, redeemReward } = await import('../src/services/forgeCoinService.js');
const { createBundle } = await import('../src/services/bundleService.js');
const { refundOrder } = await import('../src/services/refundService.js');
const { currentLimits } = await import('../src/services/orderLimitService.js');
const { config } = await import('../src/config/env.js');

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
/** A box with its pool written straight to the table — how an old database holds it. */
const makeBox = async (price, pool, name = 'Test Box') => {
  const p = await createProduct({ name: `${name} ${stamp}-${++userN}`, category: 'mystery', kind: 'mystery', price, announce: false });
  for (const r of pool) {
    await run(`INSERT INTO mystery_box_rewards (id, box_id, label, weight, credit_cents, created_at)
               VALUES (@id, @b, @l, @w, @c, @at)`,
      { id: newId('mbr'), b: p.id, l: r.label, w: r.weight, c: r.credit, at: nowIso() });
  }
  return p;
};
const makeCard = (price, name = 'Test Card') =>
  createProduct({ name: `${name} ${stamp}-${++userN}`, category: 'giftcard', price, announce: false });
const pullsOf = (orderId) => all(`SELECT * FROM mystery_pulls WHERE order_id=@o`, { o: orderId });
const statusOf = async (orderId) => (await get(`SELECT status FROM orders WHERE id=@o`, { o: orderId }))?.status;

/* An independent oracle for what a box pays out, from the same weights roll()
   uses: the box rolls at `luck`, the free reroll at luck 1, the buyer keeps the
   higher. Written out here rather than imported, so a mistake in the service's
   own arithmetic cannot vouch for itself. */
const chancesAt = (pool, luck) => {
  const max = Math.max(1, ...pool.map((r) => r.credit || 0));
  const ws = pool.map((r) => Math.max(1, r.weight) * (1 + (luck - 1) * ((r.credit || 0) / max)));
  const t = ws.reduce((a, b) => a + b, 0);
  return ws.map((w) => w / t);
};
const payoutWithReroll = (pool, luck) => {
  const p = chancesAt(pool, luck), q = chancesAt(pool, 1);
  let e = 0;
  for (let i = 0; i < pool.length; i++) for (let j = 0; j < pool.length; j++) {
    e += p[i] * q[j] * Math.max(pool[i].credit, pool[j].credit);
  }
  return e;
};
const OLD_SEED = [
  { label: '€20 store credit', weight: 40, credit: 2000 },
  { label: '€35 store credit', weight: 30, credit: 3500 },
  { label: '€50 store credit', weight: 18, credit: 5000 },
  { label: '€75 store credit', weight: 9, credit: 7500 },
  { label: '€150 JACKPOT 💎', weight: 3, credit: 15000 },
];
// One prize only, so a payout is exact: €20 per box.
const FLAT20 = [{ label: '€20 store credit', weight: 1, credit: 2000 }];

console.log('— The seeded box —');
const BOX_ID = 'prd_starter_mystery_box';
{
  // Before any test box exists: the seeder only creates the box in a shop with none.
  await (await import('../src/db/starterContent.js')).seedStarterContent();
  // The boot upkeep may be writing the same pool right now: wait until two reads agree.
  const readPool = () => all(`SELECT label, weight, credit_cents AS credit FROM mystery_box_rewards WHERE box_id=@b ORDER BY credit_cents`, { b: BOX_ID });
  const pool = await waitFor(async () => {
    const a = await readPool();
    await pause(200);
    const b = await readPool();
    return a.length && JSON.stringify(a) === JSON.stringify(b) ? b : null;
  });
  const box = await get(`SELECT price FROM products WHERE id=@b`, { b: BOX_ID });
  ok('the starter box and its pool exist', !!pool && !!box, JSON.stringify({ pool, box }));
  const worst = pool ? payoutWithReroll(pool, 2) : Infinity;
  ok('the seeded pool pays out less than the box costs, even at the luck cap with the reroll used',
    worst < (box?.price || 0), `worst case ${(worst / 100).toFixed(2)} for ${(box?.price / 100).toFixed(2)}`);
  ok('…and clearly less (at most 85% of the price)', worst <= (box?.price || 0) * 0.85,
    `${(worst / 100).toFixed(2)} = ${((worst / (box?.price || 1)) * 100).toFixed(1)}%`);
  ok('the old seed was a money printer (this is what the audit measured)',
    Math.round(payoutWithReroll(OLD_SEED, 2)) === 5310 && Math.round(payoutWithReroll(OLD_SEED, 1)) === 5032);
  ok('the copy still holds: every box wins a prize and the jackpot is €150',
    !!pool && Math.min(...pool.map((r) => r.credit)) > 0 && Math.max(...pool.map((r) => r.credit)) === 15000);
  if (typeof mbs.expectedPayout === 'function' && pool) {
    ok('the service computes the same payout as this oracle',
      Math.abs(mbs.expectedPayout(pool, 2) - payoutWithReroll(pool, 2)) < 0.5
      && Math.abs(mbs.expectedPayout(OLD_SEED, 1) - payoutWithReroll(OLD_SEED, 1)) < 0.5);
  } else ok('the service exposes expectedPayout()', false);
}

const box20 = await makeBox(4999, FLAT20, 'Flat Box');
const card10 = await makeCard(1000, 'Code €10');

console.log('— Store credit cannot buy a box (the credit loop) —');
{
  const m = await newUser();
  await grantMembership(m.id, 30);
  await credit(m.id, 70000, 'adjustment', 'test top-up');
  const err = await throws(() => createOrder({ email: m.email, userId: m.id, useCredit: 70000,
    items: [{ productId: BOX_ID, quantity: 14 }], ...consent }));
  ok('fourteen boxes paid with €700 of credit are refused', !!err && /mystery/i.test(err.message), err?.message || 'accepted');
  const rows = await all(`SELECT id FROM orders WHERE user_id=@u`, { u: m.id });
  ok('…no order is written and the wallet is untouched', rows.length === 0 && (await balanceOf(m.id)) === 70000,
    `${rows.length} order(s), wallet ${await balanceOf(m.id)}`);

  const mixed = await throws(() => createOrder({ email: m.email, userId: m.id, useCredit: 1000,
    items: [{ productId: box20.id, quantity: 1 }, { productId: card10.id, quantity: 1 }], ...consent }));
  ok('credit is refused on a cart that holds a box next to a code', !!mixed && /mystery/i.test(mixed.message), mixed?.message || 'accepted');

  const plain = await createOrder({ email: m.email, userId: m.id, useCredit: 1000,
    items: [{ productId: card10.id, quantity: 1 }], ...consent });
  const due = 1000 - Math.round(1000 * (await memberDiscountPercent(m.id)) / 100);
  ok('credit still pays for a code, member discount and all (legitimate use unchanged)',
    plain.total === 0 && plain.billing.creditApplied === due, `${plain.total} ${JSON.stringify(plain.billing)}`);
}

console.log('— A box takes no discount —');
{
  const m = await newUser();
  await grantMembership(m.id, 30);
  const pct = await memberDiscountPercent(m.id);
  ok('the test member really has a discount', pct > 0, String(pct));
  const solo = await createOrder({ email: m.email, userId: m.id, items: [{ productId: box20.id, quantity: 1 }], ...consent });
  ok('a Forge+ member pays the full box price', solo.total === 4999 && !solo.billing.memberDiscount, `${solo.total} ${JSON.stringify(solo.billing)}`);
  const card = await makeCard(2000);
  const both = await createOrder({ email: m.email, userId: m.id,
    items: [{ productId: box20.id, quantity: 1 }, { productId: card.id, quantity: 1 }], ...consent });
  const off = Math.round(2000 * pct / 100);
  ok('…and the member discount on the rest of the cart only', both.total === 4999 + 2000 - off,
    `${both.total} ≠ ${4999 + 2000 - off}`);

  const u = await newUser();
  const code = `BOXOFF${stamp}`;
  await createCoupon({ code, kind: 'percent', value: 20, active: true, announce: false }, 'test');
  const refused = await throws(() => createOrder({ email: u.email, userId: u.id, coupon: code,
    items: [{ productId: box20.id, quantity: 1 }], ...consent }));
  ok('a coupon on a boxes-only cart is refused, and says why', !!refused && /mystery/i.test(refused.message), refused?.message || 'accepted');
  const used = await get(`SELECT COUNT(*)::int AS n FROM coupon_redemptions WHERE code=@c`, { c: code });
  ok('…without using up the code', Number(used?.n) === 0, String(used?.n));
  const card2 = await makeCard(3000);
  const withCode = await createOrder({ email: u.email, userId: u.id, coupon: code,
    items: [{ productId: box20.id, quantity: 1 }, { productId: card2.id, quantity: 1 }], ...consent });
  ok('a coupon on a mixed cart discounts the code only', withCode.total === 4999 + 3000 - 600, `${withCode.total}`);

  // Forge-Coin coupons are coupons — the same rule, and the same ceiling on what they may take.
  const c = await newUser();
  await grantCoins(c.id, 15);
  const { couponCode } = await redeemReward(c.id, 'coupon5');
  const coinRefused = await throws(() => createOrder({ email: c.email, userId: c.id, coupon: couponCode,
    items: [{ productId: box20.id, quantity: 1 }], ...consent }));
  ok('a €5 Forge-Coin coupon does not pay for a box', !!coinRefused, coinRefused?.message || 'accepted');
  const coinMixed = await createOrder({ email: c.email, userId: c.id, coupon: couponCode,
    items: [{ productId: box20.id, quantity: 1 }, { productId: card10.id, quantity: 1 }], ...consent })
    .catch((e) => ({ total: NaN, error: e.message }));
  const ceiling = Math.round(1000 * config.market.maxTotalDiscountPercent / 100);
  ok('…and on a mixed cart takes no more than the ceiling of the code it discounts',
    coinMixed.total === 4999 + 1000 - Math.min(500, ceiling), `${coinMixed.total} ≠ ${4999 + 1000 - Math.min(500, ceiling)}`);

  const b = await newUser();
  const card3 = await makeCard(2500);
  await createBundle({ name: `Box bundle ${stamp}`, productIds: [box20.id, card3.id], discountPercent: 20, announce: false });
  const bundled = await createOrder({ email: b.email, userId: b.id,
    items: [{ productId: box20.id, quantity: 1 }, { productId: card3.id, quantity: 1 }], ...consent });
  ok('a bundle that includes a box gives no discount on it', bundled.total === 4999 + 2500 && !bundled.billing.bundleDiscount,
    `${bundled.total} ${JSON.stringify(bundled.billing)}`);
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

console.log('— A fraud hold keeps the box shut —');
{
  const h = await newUser();
  const o = await createOrder({ email: h.email, userId: h.id, items: [{ productId: box20.id, quantity: 1 }], ...consent });
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
  ok('approving the order opens the box', (await pullsOf(o.id)).length === 1 && (await balanceOf(h.id)) === 2000,
    `${(await pullsOf(o.id)).length} pull(s), wallet ${await balanceOf(h.id)}`);
  ok('…and completes the boxes-only order', !!done, await statusOf(o.id));
}

/** A paid, opened, completed €49.99 box that won €20. */
const openedBox = async () => {
  const u = await newUser();
  const o = await createOrder({ email: u.email, userId: u.id, items: [{ productId: box20.id, quantity: 1 }], ...consent });
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

console.log('— Rerolls only on a finished, kept sale —');
{
  const { u, o } = await openedBox();
  await refundOrder(o.id, { method: 'money', actorId: 'test', reason: 'test' });
  const [pull] = await pullsOf(o.id);
  const before = await balanceOf(u.id);
  const err = await throws(() => mbs.rerollPull(u.id, o.id, pull?.id));
  ok('a refunded box cannot be rerolled', !!pull && !!err, pull ? 'reroll accepted' : 'no pull to reroll');
  ok('…and the reroll is not used up', !!pull && !(await get(`SELECT rerolled_at FROM mystery_pulls WHERE id=@id`, { id: pull.id }))?.rerolled_at
    && (await balanceOf(u.id)) === before);

  // A box next to a code waits for the code: the order is paid, not finished.
  const m = await newUser();
  const card = await makeCard(1500, 'Wait Card');
  const mo = await createOrder({ email: m.email, userId: m.id,
    items: [{ productId: box20.id, quantity: 1 }, { productId: card.id, quantity: 1 }], ...consent });
  await markPaymentReceived(mo.id, `pi_${mo.id}`, { actorId: 'stripe', reason: 'test' });
  const mp = await waitFor(async () => (await pullsOf(mo.id))[0]);
  ok('the box in a mixed order is opened on payment', !!mp);
  const st = await statusOf(mo.id);
  const early = mp ? await throws(() => mbs.rerollPull(m.id, mo.id, mp.id)) : null;
  ok('…but cannot be rerolled before the order is complete', st !== 'completed' && !!early, `${st} ${early?.message || 'accepted'}`);

  // Held: pulls written by an older release, then held again — still no reroll.
  const h = await openedBox();
  await run(`UPDATE orders SET fraud_hold=1 WHERE id=@id`, { id: h.o.id });
  const [hp] = await pullsOf(h.o.id);
  const held = await throws(() => mbs.rerollPull(h.u.id, h.o.id, hp?.id));
  ok('a held order cannot be rerolled', !!hp && !!held, hp ? 'reroll accepted' : 'no pull to reroll');
  await run(`UPDATE orders SET fraud_hold=0 WHERE id=@id`, { id: h.o.id });

  const fine = await mbs.rerollPull(h.u.id, h.o.id, hp?.id).catch((e) => ({ error: e.message }));
  ok('a completed order still gets its one free reroll', !fine.error && fine.credit === 2000, JSON.stringify(fine));
}

console.log('— The admin cannot save a pool that pays out more than the box —');
const owner = newId('usr');
await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'O', @at, @at)`,
  { id: owner, e: `o-${stamp}@x.dev`, at: nowIso() });
await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, 'owner', @at) ON CONFLICT DO NOTHING`, { u: owner, at: nowIso() });
const { finalizeLogin } = await import('../src/services/authService.js');
const { accessToken } = await finalizeLogin(await get(`SELECT * FROM users WHERE id=@id`, { id: owner }), {});
const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const H = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
{
  const box = await makeBox(4999, FLAT20, 'Admin Box');
  const bad = await call('PUT', `/api/admin/products/${box.id}/mystery`, { rewards: OLD_SEED });
  ok('saving the old seed pool on a €49.99 box is refused', bad.status === 400, `${bad.status} ${JSON.stringify(bad.body)}`);
  ok('…with the numbers in the message', /49[.,]99/.test(JSON.stringify(bad.body)) && /53[.,]10/.test(JSON.stringify(bad.body)), JSON.stringify(bad.body));
  const kept = await all(`SELECT credit_cents FROM mystery_box_rewards WHERE box_id=@b`, { b: box.id });
  ok('…and the old pool is left as it was', kept.length === 1 && kept[0].credit_cents === 2000);
  const good = await call('PUT', `/api/admin/products/${box.id}/mystery`, { rewards: [
    { label: '€20', weight: 70, credit: 2000 }, { label: '€40', weight: 25, credit: 4000 }, { label: '€150', weight: 5, credit: 15000 }] });
  ok('a pool that pays out less than the price is saved', good.status === 200 && good.body.rewards?.length === 3, JSON.stringify(good.body));
  const cheap = await call('PATCH', `/api/admin/products/${box.id}`, { price: 1999 });
  ok('lowering the box price below what its pool pays out is refused', cheap.status === 400, `${cheap.status} ${JSON.stringify(cheap.body)}`);
  ok('…and the price stays', (await get(`SELECT price FROM products WHERE id=@id`, { id: box.id }))?.price === 4999);
  const fair = await call('PATCH', `/api/admin/products/${box.id}`, { price: 5999 });
  ok('raising it is fine', fair.status === 200 && fair.body.product?.price === 5999, `${fair.status}`);
}

console.log('— The launch check names a box that pays out too much —');
{
  const { launchChecks } = await import('../src/services/launchCheckService.js');
  const loser = await makeBox(4999, OLD_SEED.map((r) => ({ ...r, weight: r.weight + (r.credit === 15000 ? 1 : 0) })), 'Owner Box');
  const { checks } = await launchChecks();
  const item = checks.filter((c) => c.id === 'mystery_gambling');
  ok('still one mystery item, not two', item.length === 1, String(item.length));
  ok('it fails, and names the box with its payout and price',
    item[0]?.status === 'fail' && item[0].detail.includes(loser.name) && /49[.,]99/.test(item[0].detail),
    JSON.stringify(item[0]));
  ok('…and keeps the gambling-law warning', /kansspelen/i.test(item[0]?.detail || ''));
  // What the admin form sends on every save: the price and kind come along unchanged.
  const off = await call('PATCH', `/api/admin/products/${loser.id}`, { name: loser.name, price: 4999, kind: 'mystery', active: false });
  ok('the owner can still switch that box off from its form', off.status === 200 && off.body.product?.active === false,
    `${off.status} ${JSON.stringify(off.body).slice(0, 200)}`);
  const after = (await launchChecks()).checks.find((c) => c.id === 'mystery_gambling');
  ok('with only safe boxes left it is back to the plain warning', after?.status === 'warn', JSON.stringify(after));
}

console.log('— An untouched old seed is corrected; an owner-edited pool is left alone —');
{
  const untouched = await makeBox(4999, OLD_SEED, 'Old Seed Box');
  const edited = await makeBox(4999, OLD_SEED.map((r, i) => (i === 0 ? { ...r, weight: 41 } : r)), 'Edited Box');
  await (await import('../src/db/starterContent.js')).seedStarterContent();
  const healed = await all(`SELECT label, weight, credit_cents AS credit FROM mystery_box_rewards WHERE box_id=@b`, { b: untouched.id });
  ok('the untouched seed pool is replaced', healed.length > 0 && JSON.stringify(healed.map((r) => r.credit).sort()) !== JSON.stringify(OLD_SEED.map((r) => r.credit).sort())
    && payoutWithReroll(healed, 2) <= 4999 * 0.85, JSON.stringify(healed));
  const starter = await all(`SELECT label, weight, credit_cents AS credit FROM mystery_box_rewards WHERE box_id=@b ORDER BY credit_cents`, { b: BOX_ID });
  ok('…by the same pool a new shop is seeded with',
    JSON.stringify(healed.sort((a, b) => a.credit - b.credit)) === JSON.stringify(starter));
  const left = await all(`SELECT weight FROM mystery_box_rewards WHERE box_id=@b ORDER BY credit_cents`, { b: edited.id });
  ok('a pool the owner changed is not touched', JSON.stringify(left.map((r) => r.weight)) === JSON.stringify([41, 30, 18, 9, 3]), JSON.stringify(left));
  await run(`UPDATE products SET active=0 WHERE id IN (@a, @b)`, { a: untouched.id, b: edited.id });
}

console.log('— The checkout says why credit is off —');
{
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../src/pages/Checkout.jsx', import.meta.url), 'utf8');
  ok('the checkout shows a message for a cart with a box', /checkout\.creditNoMystery/.test(src));
  const key = /'checkout\.creditNoMystery':\s*'[^']+'/;
  const files = ['../../src/lib/i18n.jsx', '../../src/lib/i18n/de.js', '../../src/lib/i18n/fr.js'];
  ok('…in Dutch, German and French', files.every((f) => key.test(fs.readFileSync(new URL(f, import.meta.url), 'utf8'))));
}

srv.close();
console.log(`\n${fail ? '❌' : '✅'} mystery-economics: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
