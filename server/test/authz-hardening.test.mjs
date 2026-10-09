/**
 * Authorization fixes from the access-control audit, each pinned:
 *   1  a status that moves money (refunded; cancelled/failed once paid) needs orders.refund
 *   2  switching 2FA on or off signs out every other session and trusted device
 *   3  buyers get a customer view of their orders — no staff notes, fraud signals, IP or staff ids
 *   4  gift cards follow the store-credit rules (staff cap, never redeemed by their issuer);
 *      no Forge Coins or Forge+ to yourself
 *   5  Forge-Coin codes belong to their buyer; the public code lookup gives one answer for every refusal
 */
import './_selling-shop.mjs';   // must come first — see that file
import { ensureReady, createApp } from '../src/app.js';
import { get, run, all, nowIso } from '../src/db/index.js';
import { newId } from '../src/utils/ids.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
await ensureReady();
const { finalizeLogin } = await import('../src/services/authService.js');
const { createProduct } = await import('../src/services/productService.js');
const { createOrder, markPaymentReceived } = await import('../src/services/orderService.js');
const { totpCode } = await import('../src/utils/totp.js');
const { createTrustedDevice } = await import('../src/services/deviceService.js');
const { grantCoins, redeemReward } = await import('../src/services/forgeCoinService.js');
const { balanceOf } = await import('../src/services/walletService.js');

const stamp = Date.now().toString(36);
let n = 0;
const user = async (role = null) => {
  const id = newId('usr');
  const email = `authz-${stamp}-${++n}@example.test`;
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'U', @at, @at)`, { id, e: email, at: nowIso() });
  if (role) await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, @r, @at) ON CONFLICT DO NOTHING`, { u: id, r: role, at: nowIso() });
  const s = await finalizeLogin(await get(`SELECT * FROM users WHERE id=@id`, { id }), {});
  return { id, email, token: s.accessToken, session: s };
};
const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const call = async (u, method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(u ? { authorization: `Bearer ${u.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const consent = { consent: true, consentText: 'Ik wil mijn bestelling meteen geleverd krijgen.' };
const product = await createProduct({ name: `Authz card ${stamp}`, category: 'giftcard', price: 2000, announce: false });
const paidOrder = async (buyer) => {
  const o = await createOrder({ ...consent, email: buyer.email, userId: buyer.id, items: [{ productId: product.id, quantity: 1 }] });
  await markPaymentReceived(o.id, `pi_${o.id}`, { actorId: 'test' });
  return o;
};

console.log('— 1 Money-moving statuses need orders.refund —');
{
  const fm = await user('fulfillment_manager');
  const owner = await user('owner');
  const buyer = await user();
  const o = await paidOrder(buyer);
  const t = await call(fm, 'POST', `/api/admin/orders/${o.id}/transition`, { to: 'refunded', reason: 'x' });
  ok('a fulfilment manager cannot mark a paid order refunded', t.status === 403, `${t.status} ${JSON.stringify(t.body)}`);
  const c = await call(fm, 'POST', `/api/admin/orders/${o.id}/cancel`, { reason: 'x' });
  ok('…nor cancel it once paid (that is a refund too)', c.status === 403, `${c.status}`);
  ok('…and the order is untouched', (await get(`SELECT status FROM orders WHERE id=@id`, { id: o.id })).status !== 'refunded');
  const pending = await createOrder({ ...consent, email: buyer.email, userId: buyer.id, items: [{ productId: product.id, quantity: 1 }] });
  const cp = await call(fm, 'POST', `/api/admin/orders/${pending.id}/cancel`, { reason: 'never paid' });
  ok('an unpaid order can still be cancelled by fulfilment', cp.status === 200, `${cp.status} ${JSON.stringify(cp.body).slice(0, 200)}`);
  const ot = await call(owner, 'POST', `/api/admin/orders/${o.id}/transition`, { to: 'refunded', reason: 'owner decides' });
  ok('the owner (orders.refund) still can', ot.status === 200, `${ot.status} ${JSON.stringify(ot.body).slice(0, 200)}`);
}

console.log('— 2 Switching 2FA signs out everything else —');
{
  const u = await user();
  const other = await finalizeLogin(await get(`SELECT * FROM users WHERE id=@id`, { id: u.id }), {});
  await createTrustedDevice(u.id, { ip: '203.0.113.5', userAgent: 'test' });
  const setup = await call(u, 'POST', '/api/auth/totp/setup');
  const en = await call(u, 'POST', '/api/auth/totp/enable', { code: totpCode(setup.body.secret) });
  ok('2FA turns on', en.body.enabled === true, JSON.stringify(en.body));
  const fromOther = await fetch(`${base}/api/account/orders`, { headers: { authorization: `Bearer ${other.accessToken}` } });
  ok('the session that signed in before 2FA is signed out', fromOther.status === 401, String(fromOther.status));
  const mine = await call(u, 'GET', '/api/account/orders');
  ok('…the browser that switched it on stays signed in', mine.status === 200, String(mine.status));
  const td = await get(`SELECT COUNT(*)::int AS n FROM trusted_devices WHERE user_id=@u AND revoked_at IS NULL`, { u: u.id });
  ok('…and no trusted device can skip the new factor', td.n === 0, `${td.n} active`);
}

console.log('— 3 Buyers see a customer view of their orders —');
{
  const buyer = await user();
  const o = await paidOrder(buyer);
  await run(`UPDATE orders SET notes='INTERNAL: do not trust', fraud_score=72, fraud_status='review',
             fraud_hold_reason='VPN · other emails today', ip='203.0.113.9' WHERE id=@id`, { id: o.id });
  const one = await call(buyer, 'GET', `/api/account/orders/${o.id}`);
  const txt = JSON.stringify(one.body);
  ok('the buyer gets their order', one.status === 200 && one.body.order?.id === o.id);
  ok('…without staff notes, fraud score, the rules that flagged it, or their IP',
    !/INTERNAL|fraudScore|fraudStatus|fraudHoldReason|VPN|203\.0\.113\.9/.test(txt), txt.slice(0, 300));
  ok('…and the timeline carries only status and time', (one.body.order.history || []).every((h) => Object.keys(h).sort().join() === 'created_at,id,to_status'));
  const list = await call(buyer, 'GET', '/api/account/orders');
  ok('the order list carries no fraud figures either', !/fraudScore|fraudStatus/.test(JSON.stringify(list.body)));
  const track = await call(buyer, 'GET', `/api/account/orders/${o.id}/track`);
  ok('…nor the tracking view', !/changed_by|reason/.test(JSON.stringify(track.body.history || [])));
}

console.log('— 4 Gift cards, coins and Forge+ —');
{
  const admin = await user('admin');
  const big = await call(admin, 'POST', '/api/admin/monetization/gift-cards', { amount: 5_000_000 });
  ok('an admin cannot issue a €50,000 gift card (needs the Owner)', big.status === 400, `${big.status} ${JSON.stringify(big.body)}`);
  const small = await call(admin, 'POST', '/api/admin/monetization/gift-cards', { amount: 2500 });
  ok('a small one is fine', small.status === 201 && !!small.body.giftCard?.code, `${small.status}`);
  const self = await call(admin, 'POST', '/api/account/wallet/redeem', { code: small.body.giftCard.code });
  ok('…but not redeemed by the admin who issued it', self.status === 400 && (await balanceOf(admin.id)) === 0, `${self.status} ${JSON.stringify(self.body)}`);
  const other = await user();
  const theirs = await call(other, 'POST', '/api/account/wallet/redeem', { code: small.body.giftCard.code });
  ok('…while a customer redeems it normally', theirs.status === 200 && (await balanceOf(other.id)) === 2500, `${theirs.status}`);
  const coins = await call(admin, 'POST', `/api/admin/security/users/${admin.id}/coins`, { amount: 1000 });
  ok('no Forge Coins to yourself', coins.status === 400, `${coins.status}`);
  const plus = await call(admin, 'POST', `/api/admin/security/users/${admin.id}/membership`, { days: 3650 });
  ok('no Forge+ to yourself', plus.status === 400, `${plus.status}`);
  const plusOther = await call(admin, 'POST', `/api/admin/security/users/${other.id}/membership`, { days: 30 });
  ok('…while granting it to a customer still works', plusOther.status === 200, `${plusOther.status}`);
}

console.log('— 5 Forge-Coin codes belong to their buyer —');
{
  const alice = await user();
  const bob = await user();
  await grantCoins(alice.id, 40);
  const { couponCode } = await redeemReward(alice.id, 'coupon5');
  ok('the code is long and from the crypto source', /^FORGE[A-Z0-9]{10}$/.test(couponCode), couponCode);
  const card = await createProduct({ name: `Authz big ${stamp}`, category: 'giftcard', price: 2500, announce: false });
  const bobTry = await createOrder({ ...consent, email: bob.email, userId: bob.id, coupon: couponCode,
    items: [{ productId: card.id, quantity: 1 }] }).catch((e) => e);
  ok('someone else cannot spend it', bobTry instanceof Error, bobTry?.total ? `charged ${bobTry.total}` : '');
  const look = await call(bob, 'GET', `/api/coupons/${couponCode}?subtotal=2500`);
  ok('…and the lookup does not even confirm it exists', look.status === 404 && look.body?.error?.message === 'Invalid or expired code', JSON.stringify(look.body));
  const aliceOrder = await createOrder({ ...consent, email: alice.email, userId: alice.id, coupon: couponCode,
    items: [{ productId: card.id, quantity: 1 }] });
  ok('its buyer can', aliceOrder.total === 2000, `${aliceOrder.total}`);
  let limited = 0;
  for (let i = 0; i < 25; i++) {
    const r = await fetch(`${base}/api/coupons/GUESS${i}${stamp}`);
    if (r.status === 429) { limited = i; break; }
  }
  ok('guessing codes is limited (20 per 10 minutes)', limited > 0 && limited <= 21, `limited after ${limited}`);
}

srv.close();
console.log(`\n${fail ? '❌' : '✅'} authz-hardening: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
