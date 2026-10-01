/**
 * Customer Lifetime Value engine → Growth → Top Customers.
 *
 * The figures per customer have to be the shop's real money and nothing else:
 *
 *   a refunded or unpaid order is not revenue, and does not make a customer;
 *   profit is after 21% BTW, supplier cost AND the referral commission the
 *   order paid out — and unknown, not free, where no cost was entered;
 *   a guest order with an account's e-mail is that account's order;
 *   referral revenue is what the people they referred actually paid.
 *
 * And the scores have to mean something: one order is not a buying rhythm, so
 * it projects nothing; a customer is "at risk" against their own pace; and the
 * VIP score is absolute, so the only customer of a new shop is not a VIP for €5.
 */
import './_selling-shop.mjs';   // must come first — see that file
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { run, get, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { finalizeLogin } = await import('../src/services/authService.js');
const { netCents, planningVat } = await import('../src/services/vatService.js');
const { getOrCreateCode, attributeSignup } = await import('../src/services/affiliateService.js');
const { createOrder, markPaymentReceived } = await import('../src/services/orderService.js');
const { createProduct } = await import('../src/services/productService.js');
const clv = await import('../src/services/customerValueService.js');

const DAY = 86_400_000;
const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
const stamp = Date.now();

console.log('\n— The scores, as functions —');
{
  ok('retention: one order, just placed, is half-way — recency only',
    clv.retentionScore({ orders: 1, daysSinceLast: 0, gapDays: 30 }) === 60);
  ok('…coming back raises it', clv.retentionScore({ orders: 2, daysSinceLast: 0, gapDays: 30 }) === 80);
  ok('…staying away one extra gap costs a factor e on recency',
    clv.retentionScore({ orders: 1, daysSinceLast: 60, gapDays: 30 }) === Math.round(60 / Math.E));
  ok('…and long gone is near zero', clv.retentionScore({ orders: 1, daysSinceLast: 365, gapDays: 30 }) <= 1);
  ok('status: one recent order is new, not at risk', clv.retentionStatus(60, 1, 5, 30) === 'new');
  ok('…a regular inside their pace is active', clv.retentionStatus(85, 4, 10, 30) === 'active');
  ok('…overdue is at risk, then lapsed', clv.retentionStatus(40, 3, 50, 30) === 'at_risk' && clv.retentionStatus(5, 3, 200, 30) === 'lapsed');

  ok('one order projects nothing', clv.projectRevenue({ orders: 1, firstAt: ago(5), lastAt: ago(5), aov: 2000, retention: 60 }) === null);
  ok('two orders on the same day are one visit — still nothing',
    clv.projectRevenue({ orders: 2, firstAt: ago(5), lastAt: new Date(Date.now() - 5 * DAY + 3600_000).toISOString(), aov: 2000, retention: 80 }) === null);
  const p = clv.projectRevenue({ orders: 3, firstAt: ago(60), lastAt: ago(0), aov: 2000, retention: 100 });
  ok('a monthly €20 buyer at full retention is worth ~€243 a year', Math.abs(p - Math.round(2000 * (2 / 60) * 365)) <= 1, String(p));
  ok('…and half that at 50% retention',
    clv.projectRevenue({ orders: 3, firstAt: ago(60), lastAt: ago(0), aov: 2000, retention: 50 }) === Math.round(p / 2));

  const tiny = clv.vipScore({ revenue: 500, profit: 100, orders: 1, retention: 60, referralRevenue: 0 });
  ok('a single €5 order is not a VIP', clv.segmentFor(tiny) === 'new' && tiny < 20, String(tiny));
  const big = clv.vipScore({ revenue: 100_000, profit: 25_000, orders: 10, retention: 100, referralRevenue: 50_000 });
  ok('€1,000, €250 profit, 10 orders, retained, €500 referred is 100', big === 100, String(big));
  const noCost = clv.vipScore({ revenue: 100_000, profit: null, orders: 10, retention: 100, referralRevenue: 50_000 });
  ok('an unknown cost does not count against the customer', noCost === 100, String(noCost));
  const loss = clv.vipScore({ revenue: 100_000, profit: -5000, orders: 10, retention: 100, referralRevenue: 50_000 });
  ok('…but a known loss does', loss === 80, String(loss));

  const g = clv.shopGapDays([{ orders: 2, spanDays: 10 }, { orders: 3, spanDays: 40 }]);
  ok('too few repeat customers: the default gap, and it says so', g.days === clv.CLV.DEFAULT_GAP_DAYS && !g.measured);
  const m = clv.shopGapDays([10, 12, 14, 16, 18].map((d) => ({ orders: 2, spanDays: d })));
  ok('five or more: the median gap they actually show', m.measured && m.days === 14, JSON.stringify(m));
}

console.log('\n— Customers, from the database —');
const vat = planningVat();
ok('profit is figured at 21% BTW while the shop is unregistered', vat.pct === 21);

async function product(name, price, cost) {
  const p = await createProduct({ name, sku: `CLV-${name.replace(/\W+/g, '')}-${stamp}`, category: 'robux',
    price, currency: 'EUR', active: true, announce: false });
  if (cost != null) await run(`UPDATE products SET metadata=@m WHERE id=@id`, { id: p.id, m: JSON.stringify({ cost }) });
  return p;
}
const costed = await product('Costed 20', 2000, 1000);
const pricey = await product('Costed 100', 10000, 6000);
const loose = await product('Uncosted 50', 5000, null);

async function user(name, email, { referredBy = null } = {}) {
  const id = newId('usr');
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, @n, @at, @at)`,
    { id, e: email, n: name, at: nowIso() });
  if (referredBy) await attributeSignup(id, await getOrCreateCode(referredBy, 'r@x.dev'));
  return id;
}
let seq = 0;
/** A historical order, written as the pipeline leaves it. */
async function order({ userId = null, email, p, qty = 1, status = 'completed', daysAgo = 0 }) {
  const id = newId('ord'); seq += 1;
  const at = ago(daysAgo);
  const total = p.price * qty;
  await run(`INSERT INTO orders (id, number, user_id, email, status, currency, subtotal, total, billing, created_at, updated_at)
             VALUES (@id, @num, @u, @e, @st, 'EUR', @t, @t, '{}', @at, @at)`,
    { id, num: `CLV-${stamp}-${seq}`, u: userId, e: email, st: status, t: total, at });
  await run(`INSERT INTO order_items (id, order_id, product_id, name, quantity, unit_price) VALUES (@id, @o, @p, @n, @q, @u)`,
    { id: newId('oi'), o: id, p: p.id, n: p.name, q: qty, u: p.price });
  return { id, total };
}

const alice = await user('Alice', `alice-${stamp}@x.dev`);
const bob = await user('Bob', `bob-${stamp}@x.dev`, { referredBy: alice });
const dave = await user('Dave', `dave-${stamp}@x.dev`);
const frank = await user('Frank', `frank-${stamp}@x.dev`);

// Alice: €20 a month, three times, last two days ago.
for (const d of [62, 32, 2]) await order({ userId: alice, email: `alice-${stamp}@x.dev`, p: costed, daysAgo: d });
// Bob, referred by Alice: one costed and one uncosted order, through the REAL
// payment path so the 5% commission is recorded the way production records it.
async function paid(uid, email, p) {
  const o = await createOrder({ consent: true, consentText: 'test', email, userId: uid,
    items: [{ productId: p.id, quantity: 1 }] }, { actorId: uid });
  await markPaymentReceived(o.id, `t_${o.id}`, {});
  return o;
}
const bob1 = await paid(bob, `bob-${stamp}@x.dev`, costed);
await paid(bob, `bob-${stamp}@x.dev`, loose);
// Dave: an account order, and a guest order with Dave's e-mail in capitals.
await order({ userId: dave, email: `dave-${stamp}@x.dev`, p: costed, daysAgo: 40 });
await order({ email: `DAVE-${stamp}@x.dev`, p: costed, daysAgo: 10 });
// Carol: a guest, once, long ago.
await order({ email: `carol-${stamp}@x.dev`, p: loose, daysAgo: 200 });
// Erin: refunded, and an unpaid order. Neither is revenue.
await order({ email: `erin-${stamp}@x.dev`, p: pricey, status: 'refunded', daysAgo: 3 });
await order({ email: `erin-${stamp}@x.dev`, p: pricey, status: 'pending', daysAgo: 1 });
// Frank: €100 every month for ten months, last five days ago.
for (let i = 0; i < 10; i++) await order({ userId: frank, email: `frank-${stamp}@x.dev`, p: pricey, daysAgo: 5 + i * 30 });

const { customers } = await clv.customerValues();
const find = (uidOrEmail) => customers.find((c) => c.userId === uidOrEmail || c.email === uidOrEmail);
const A = find(alice); const B = find(bob); const D = find(dave); const C = find(`carol-${stamp}@x.dev`); const F = find(frank);
const net = (cents) => netCents(cents, vat.rate);

{
  ok('every paying customer is listed — and only those', customers.length === 5 && !find(`erin-${stamp}@x.dev`),
    customers.map((c) => c.email).join(', '));

  ok('Alice: total revenue', A.revenue === 6000, String(A.revenue));
  ok('…number of orders', A.orders === 3);
  ok('…average order value', A.averageOrderValue === 2000);
  ok('…last purchase', Math.abs(new Date(A.lastPurchaseAt) - new Date(ago(2))) < 60_000 && A.daysSinceLastPurchase === 2);
  ok('…profit after BTW and cost', A.profit === 3 * (net(2000) - 1000) && A.profitCoverage.complete, String(A.profit));
  ok('…referral revenue: what Bob paid', A.referralRevenue === bob1.total + 5000 && A.referredCustomers === 1,
    `${A.referralRevenue} vs ${bob1.total + 5000}`);
  ok('…retention against her own 30-day pace: active', A.retention.status === 'active' && A.retention.gapSource === 'own'
    && A.retention.gapDays === 30, JSON.stringify(A.retention));
  ok('…and a projection, because she has a rhythm', A.lifetimeValue.projected12m > 0
    && A.lifetimeValue.value === A.revenue + A.lifetimeValue.projected12m, JSON.stringify(A.lifetimeValue));

  const commission = (await get(`SELECT commission FROM referral_events WHERE order_id=@o AND kind='order'`, { o: bob1.id }))?.commission;
  ok('Bob\'s order paid Alice a real commission', commission === Math.round(bob1.total * 0.05), String(commission));
  ok('Bob: profit takes the commission off, and covers only the costed order',
    B.profit === net(bob1.total) - 1000 - commission && B.profitCoverage.orders === 1 && B.profitCoverage.of === 2,
    JSON.stringify({ profit: B.profit, cov: B.profitCoverage }));
  ok('…two orders the same day are no rhythm: nothing projected', B.lifetimeValue.projected12m === null
    && B.lifetimeValue.value === B.revenue);

  ok('a guest order with an account\'s e-mail belongs to the account', D.orders === 2 && D.userId === dave);
  ok('Carol, a guest, is her e-mail', C && C.userId === null && C.orders === 1);
  ok('…with no cost entered, her profit is unknown — not her whole revenue', C.profit === null && C.profitCoverage.orders === 0);
  ok('…gone 200 days on one order: lapsed', C.retention.status === 'lapsed' && C.retention.score <= 2, JSON.stringify(C.retention));

  ok('Frank: ten orders, €1,000', F.orders === 10 && F.revenue === 100_000);
  ok('…is a VIP', F.vip.segment === 'vip' && F.vip.score >= 85, JSON.stringify(F.vip));
  ok('…retention is high on his own monthly pace', F.retention.score >= 90 && F.retention.status === 'active');
  ok('Carol is not', C.vip.segment === 'new' && C.vip.score < F.vip.score);
}

console.log('\n— Admin → Top Customers —');
const owner = await user('Owner', `owner-${stamp}@x.dev`);
await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, 'owner', @at) ON CONFLICT DO NOTHING`, { u: owner, at: nowIso() });
const { accessToken } = await finalizeLogin(await get(`SELECT * FROM users WHERE id=@id`, { id: owner }), {});
const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}/api/admin/analytics/customers`;
const call = async (qs = '', auth = true) => {
  const r = await fetch(`${base}${qs}`, { headers: auth ? { authorization: `Bearer ${accessToken}` } : {} });
  return { status: r.status, body: await r.json() };
};
{
  ok('only for staff', (await call('', false)).status === 401);
  const { status, body } = await call();
  ok('the page answers', status === 200, JSON.stringify(body).slice(0, 200));
  ok('sorted by lifetime value, Frank first', body.customers[0].userId === frank && body.sort === 'ltv');
  ok('every row carries the six figures and three scores', body.customers.every((c) =>
    ['revenue', 'profit', 'orders', 'averageOrderValue', 'lastPurchaseAt', 'referralRevenue'].every((k) => k in c)
    && Number.isFinite(c.lifetimeValue.value) && Number.isFinite(c.retention.score) && Number.isFinite(c.vip.score)));
  ok('the summary counts the same customers', body.summary.customers === 5 && body.summary.revenue
    === customers.reduce((s, c) => s + c.revenue, 0));
  ok('…and its profit admits how many customers it covers', body.summary.profitCoverage.customers === 4
    && body.summary.profitCoverage.of === 5);
  ok('…repeat rate', body.summary.repeatRate === 80);

  ok('sort by referral revenue puts Alice first', (await call('?sort=referrals')).body.customers[0].userId === alice);
  ok('sort by recency puts Alice or Bob first', [alice, bob].includes((await call('?sort=recent')).body.customers[0].userId));
  ok('filter by segment', (await call('?segment=vip')).body.customers.every((c) => c.vip.segment === 'vip'));
  ok('filter by retention status', (await call('?status=lapsed')).body.customers.map((c) => c.email).join() === `carol-${stamp}@x.dev`);
  ok('search by e-mail or name', (await call(`?q=ALICE`)).body.customers.length === 1);
  ok('an unknown sort or segment falls back instead of failing',
    (await call('?sort=bogus&segment=gold&limit=999')).status === 200);
  ok('…and the limit is respected', (await call('?limit=2')).body.customers.length === 2);
}
srv.close();

console.log('\n— The page —');
{
  const fs = await import('node:fs');
  const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  ok('Growth → Top Customers is in the admin menu', /growth\/customers.*Top Customers/.test(read('src/layouts/AdminLayout.jsx')));
  ok('…and routed', /path="\/admin\/growth\/customers"/.test(read('src/App.jsx')));
  ok('an unknown profit is shown as unknown', /unknown/.test(read('src/pages/admin/TopCustomers.jsx')));
}

console.log(`\n${fail ? '❌' : '✅'} customer-value: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
