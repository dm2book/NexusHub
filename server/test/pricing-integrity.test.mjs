/**
 * The price a buyer is shown is the price the order charges — every figure.
 *
 *   #7  the checkout quoted the price saved in the cart when the item was
 *       added, did its own discount arithmetic (mystery boxes included, which
 *       the order excludes) and ignored the €0.50 card minimum, so the amount
 *       on the "Pay" button was not the amount of the order
 *   #8  a bundle took its percentage off EVERY unit of its products, not off
 *       complete sets: 10×A + 1×B got 10% off eleven units
 *   #9  a "once per customer" code could be used several times by placing the
 *       orders at the same moment
 *   #10 when the 40% ceiling cut the discount stack, the uncut amounts were
 *       stored, so the mail, the CSV export and the reports did not add up
 *   #11 a €25 Forge-Coin code ("€25 off any order") gave 40% of a small order
 *       and was used up in full
 *
 * Quotes go through the real HTTP route; orders through createOrder and, where
 * the route itself is the point, through POST /api/orders.
 */
import './_selling-shop.mjs';   // must come first — see that file
import net from 'node:net';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

/* POST /api/orders refuses to sell without a way to email the code, so a mail
   transport has to exist. A sink on a free port that accepts everything. */
const sink = net.createServer((sock) => {
  sock.write('220 sink\r\n');
  let buf = '', inData = false;
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    for (;;) {
      const i = buf.indexOf('\r\n'); if (i < 0) break;
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

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { all, get, run, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { formatMoney } = await import('../src/utils/money.js');
const { config } = await import('../src/config/env.js');
const { createProduct, updateProduct } = await import('../src/services/productService.js');
const orderService = await import('../src/services/orderService.js');
const { createOrder, exportOrdersCsv, renderOrderEmail } = orderService;
const { createCoupon } = await import('../src/services/couponService.js');
const { createBundle, pricedBundles, bestBundleDiscount } = await import('../src/services/bundleService.js');
const { credit, balanceOf } = await import('../src/services/walletService.js');
const { grantMembership } = await import('../src/services/membershipService.js');
const { grantCoins, redeemReward, FORGE_SHOP } = await import('../src/services/forgeCoinService.js');
const { monetizationReport } = await import('../src/services/analyticsService.js');
const { finalizeLogin } = await import('../src/services/authService.js');
const { matchBundle } = await import('../../src/lib/bundles.js');

const ROOT = new URL('../../', import.meta.url);
const src = (p) => readFileSync(new URL(p, ROOT), 'utf8')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const stamp = Date.now();
const consent = { consent: true, consentText: 'Ik wil mijn bestelling meteen geleverd krijgen.' };
const throws = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
let n = 0;
const newUser = async () => {
  const id = newId('usr');
  const email = `price-${stamp}-${++n}@example.test`;
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'P', @at, @at)`,
    { id, e: email, at: nowIso() });
  const { accessToken } = await finalizeLogin(await get('SELECT * FROM users WHERE id=@id', { id }), {});
  return { id, email, token: accessToken };
};
const card = (price, name = 'Card') =>
  createProduct({ name: `${name} ${stamp}-${++n}`, category: 'giftcard', price, announce: false });
const guestEmail = () => `guest-${stamp}-${++n}@example.test`;

const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const post = async (path, body, token) => {
  const r = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const quote = (body, token) => post('/api/checkout/quote', body, token);
const lines = (...xs) => xs.map(([p, q = 1]) => ({ productId: p.id, quantity: q }));

/* What every stored order must satisfy, whatever discounts it carries: the
   lines on the receipt add up to what was charged. */
const addsUp = (o) => {
  const b = o.billing || {};
  return o.subtotal - Number(b.discount || 0) - Number(b.memberDiscount || 0)
    - Number(b.bundleDiscount || 0) - Number(b.creditApplied || 0) === o.total;
};
/* The quote and the order it describes, figure by figure. */
const sameFigures = (q, o) => {
  const b = o.billing || {};
  const pairs = {
    subtotal: [q.subtotal, o.subtotal],
    coupon: [q.coupon?.applied || 0, Number(b.discount || 0)],
    member: [q.memberDiscount || 0, Number(b.memberDiscount || 0)],
    bundle: [q.bundleDiscount || 0, Number(b.bundleDiscount || 0)],
    credit: [q.creditApplied || 0, Number(b.creditApplied || 0)],
    total: [q.total, o.total],
  };
  const off = Object.entries(pairs).filter(([, [a, z]]) => a !== z);
  return { same: off.length === 0, why: JSON.stringify(Object.fromEntries(off)) };
};

console.log('— #7 The price at the order button is the price of the order —');
{
  ok('the pricing is one exported function both the order and the quote use',
    typeof orderService.priceOrder === 'function');

  const c = await card(999, 'Quote Card');
  const plain = await quote({ items: lines([c, 2]) });
  ok('POST /api/checkout/quote answers with the server\'s figures',
    plain.status === 200 && plain.body.subtotal === 1998 && plain.body.total === 1998,
    `${plain.status} ${JSON.stringify(plain.body).slice(0, 200)}`);
  ok('…line by line, at the catalogue price',
    plain.body.lines?.[0]?.unitPrice === 999 && plain.body.lines?.[0]?.quantity === 2, JSON.stringify(plain.body.lines));

  // A price changed after the cart was saved: the quote carries today's price.
  await updateProduct(c.id, { price: 1299 });
  const later = await quote({ items: lines([c, 1]) });
  ok('a price changed since the cart was filled is quoted at today\'s price',
    later.body.lines?.[0]?.unitPrice === 1299 && later.body.total === 1299, JSON.stringify(later.body).slice(0, 200));
  const charged = await createOrder({ email: guestEmail(), items: lines([c, 1]), ...consent });
  ok('…which is what the order charges', charged.total === later.body.total, `${charged.total} vs ${later.body.total}`);

  // Every discount at once, for a Forge+ member: the quote and the order agree to the cent.
  const m = await newUser();
  await grantMembership(m.id, 30);
  const a = await card(2000, 'Duo A'), b = await card(2000, 'Duo B');
  await createBundle({ name: `Quote Duo ${stamp}`, productIds: [a.id, b.id], discountPercent: 10, announce: false });
  const code = `QSTACK${stamp % 100000}`;
  await createCoupon({ code, kind: 'percent', value: 10, announce: false }, 'test');
  const body = { items: lines([a], [b]), coupon: code };
  const q = await quote(body, m.token);
  const o = await createOrder({ email: m.email, userId: m.id, ...body, ...consent });
  const f = sameFigures(q.body, o);
  ok('member + bundle + coupon: the quote is the order, figure by figure', q.status === 200 && f.same, `${q.status} ${f.why}`);

  // The ceiling: a 50% code on €9.99 is held to 40%.
  const half = `QHALF${stamp % 100000}`;
  await createCoupon({ code: half, kind: 'percent', value: 50, announce: false }, 'test');
  const ten = await card(999, 'Ceiling Card');
  const u = await newUser();
  const qc = await quote({ items: lines([ten]), coupon: half }, u.token);
  const oc = await createOrder({ email: u.email, userId: u.id, items: lines([ten]), coupon: half, ...consent });
  ok('a code above the 40% ceiling: quoted at what the order charges (€5.99)',
    qc.body.total === 599 && oc.total === 599, `${qc.body.total} / ${oc.total}`);
  ok('…and the quote says the ceiling cut it', qc.body.clamped === true && qc.body.coupon?.offered === 500
    && qc.body.coupon?.applied === 400, JSON.stringify(qc.body.coupon));

  // Credit that would leave 20 cents to pay leaves the card minimum instead.
  const w = await newUser();
  await credit(w.id, 4980, 'adjustment', 'test top-up');
  const fifty = await card(5000, 'Floor Card');
  const qf = await quote({ items: lines([fifty]), useCredit: 4980 }, w.token);
  ok('the €0.50 card minimum is in the quote: €0.50 to pay, €49.50 of credit',
    qf.body.total === 50 && qf.body.creditApplied === 4950, `${qf.body.total} ${qf.body.creditApplied}`);
  ok('…and the quote spent nothing', (await balanceOf(w.id)) === 4980, String(await balanceOf(w.id)));
  const of = await createOrder({ email: w.email, userId: w.id, items: lines([fifty]), useCredit: 4980, ...consent });
  ok('…exactly what the order then takes', sameFigures(qf.body, of).same, sameFigures(qf.body, of).why);

  /* A mystery box next to a code used to be quoted with no discount on the box,
     like the order. Boxes are retired now (paid random prizes are very likely a
     game of chance under the Dutch Wet op de kansspelen): the quote refuses one
     exactly as the order does — same status, same words — even a box switched
     back on by hand, as this one is. */
  const boxId = newId('prd');
  await run(`INSERT INTO products (id, name, category, price, currency, kind, active, metadata, created_at, updated_at)
             VALUES (@id, @n, 'mystery', 4999, 'EUR', 'mystery', 1, '{}', @at, @at)`,
    { id: boxId, n: `Quote Box ${stamp}`, at: nowIso() });
  const mm = await newUser();
  await grantMembership(mm.id, 30);
  const tenCode = `QBOX${stamp % 100000}`;
  await createCoupon({ code: tenCode, kind: 'percent', value: 10, announce: false }, 'test');
  const mixed = { items: lines([{ id: boxId }], [a]), coupon: tenCode };
  const qm = await quote(mixed, mm.token);
  const om = await throws(() => createOrder({ email: mm.email, userId: mm.id, ...mixed, ...consent }));
  ok('box + code for a member: the quote refuses the box, like the order',
    qm.status === 409 && om?.status === 409 && qm.body.error?.message === om.message && /retired/.test(om.message),
    `${qm.status} ${qm.body.error?.message} / ${om?.status} ${om?.message}`);
  ok('…and nothing of the code was used', Number((await get('SELECT redeemed_count FROM coupons WHERE code=@c', { c: tenCode }))?.redeemed_count) === 0);
  await run(`UPDATE products SET active=0 WHERE id=@id`, { id: boxId });

  // A single-use code is not used up by asking for a quote.
  const once = `QONCE${stamp % 100000}`;
  await createCoupon({ code: once, kind: 'fixed', value: 300, maxRedemptions: 1, announce: false }, 'test');
  await quote({ items: lines([a]), coupon: once });
  await quote({ items: lines([a]), coupon: once });
  const after = await get('SELECT redeemed_count FROM coupons WHERE code=@c', { c: once });
  ok('quoting a single-use code twice leaves it unused', Number(after?.redeemed_count) === 0, String(after?.redeemed_count));

  // A code the order would refuse is refused in the quote, with the reason.
  const minCode = `QMIN${stamp % 100000}`;
  await createCoupon({ code: minCode, kind: 'fixed', value: 500, minSubtotal: 5000, announce: false }, 'test');
  const qr = await quote({ items: lines([a]), coupon: minCode });
  const or = await throws(() => createOrder({ email: guestEmail(), items: lines([a]), coupon: minCode, ...consent }));
  const prob = (qr.body.problems || []).find((p) => p.code === 'coupon');
  ok('a code under its minimum: the quote names the problem the order refuses with',
    !!prob && !!or && or.status === 409 && prob.message === or.message, `${JSON.stringify(prob)} / ${or?.status} ${or?.message}`);
  ok('…with the minimum, so the checkout can say it in the buyer\'s language',
    prob?.reason === 'min_subtotal' && prob?.minSubtotal === 5000, JSON.stringify(prob));

  // The client never names a price.
  const p = await card(2500, 'Trust Card');
  const viaRoute = await post('/api/orders', {
    email: guestEmail(), ...consent,
    items: [{ productId: p.id, quantity: 1, price: 1, unitPrice: 1, unit_price: 1, metadata: { price: 1, unit_price: 1 } }],
    subtotal: 1, total: 1, billing: { discount: 2400, creditApplied: 2400 },
  });
  ok('POST /api/orders with prices in the request charges the catalogue price',
    viaRoute.status === 201 && viaRoute.body.order?.total === 2500 && viaRoute.body.order?.subtotal === 2500,
    `${viaRoute.status} ${JSON.stringify(viaRoute.body).slice(0, 200)}`);
  const viaService = await createOrder({ email: guestEmail(), ...consent, subtotal: 1, total: 1,
    items: [{ productId: p.id, quantity: 2, price: 1, unit_price: 1 }] });
  ok('…and so does createOrder called with them', viaService.total === 5000
    && viaService.items?.[0]?.unitPrice !== 1 && Number(viaService.items?.[0]?.unit_price ?? viaService.items?.[0]?.unitPrice) === 2500,
    `${viaService.total} ${JSON.stringify(viaService.items?.[0])}`);

  console.log('  · the storefront');
  const cart = src('src/context/CartContext.jsx');
  const checkout = src('src/pages/Checkout.jsx');
  const cartPage = src('src/pages/Cart.jsx');
  const addFn = cart.slice(cart.indexOf('const add ='), cart.indexOf('const setQty'));
  // Only the branch for a line that is already there — a new line always had the price.
  const existing = addFn.slice(addFn.indexOf('if (found)'), addFn.indexOf('return [...cur'));
  ok('adding a product that is already in the cart stores its current price',
    /price:[^,}]*product\.price/.test(existing), existing.slice(0, 300));
  ok('the cart asks the server for its price and refreshes stale lines with it',
    /\/api\/checkout\/quote/.test(cart) && /unitPrice/.test(cart));
  ok('the checkout shows the server\'s figures', /quote/.test(checkout) && !/matchBundle\(/.test(checkout));
  ok('…and does no discount arithmetic of its own (member %, ceiling, bundle, coupon)',
    !/memberPercent\s*\/\s*100|\*\s*memberPercent/.test(checkout)
    && !/\*\s*maxDiscountPercent|maxDiscountPercent\s*\/\s*100|setMaxDiscountPercent/.test(checkout)
    && !/discountCeiling/.test(checkout) && !/coupon\.percent\s*\/\s*100|\*\s*coupon\.percent/.test(checkout));
  ok('the cart page does none either', !/matchBundle\(/.test(cartPage) && !/\*\s*memberPercent/.test(cartPage));
  ok('the checkout compares the order\'s total with the total it showed before paying',
    /order\.total\s*!==/.test(checkout));
  const keys = ['checkout.priceChanged', 'checkout.totalChanged', 'checkout.couponCapped'];
  const nl = readFileSync(new URL('src/lib/i18n.jsx', ROOT), 'utf8');
  const de = (await import('../../src/lib/i18n/de.js')).default;
  const fr = (await import('../../src/lib/i18n/fr.js')).default;
  for (const k of keys) {
    ok(`"${k}" is said in the checkout, in Dutch, German and French`,
      checkout.includes(`'${k}'`) && new RegExp(`'${k.replace('.', '\\.')}':\\s*'`).test(nl) && !!de[k] && !!fr[k]);
  }
}

console.log('\n— #8 A bundle discounts complete sets only —');
{
  const A = await card(800, 'Set A'), B = await card(800, 'Set B');
  await createBundle({ name: `Set Duo ${stamp}`, productIds: [A.id, B.id], discountPercent: 10, announce: false });
  const priced = (await pricedBundles()).find((x) => x.name === `Set Duo ${stamp}`);
  const server = (qa, qb) => bestBundleDiscount([
    { product_id: A.id, unit_price: 800, quantity: qa }, { product_id: B.id, unit_price: 800, quantity: qb }]);
  const client = (qa, qb) => matchBundle([{ id: A.id, price: 800, qty: qa }, { id: B.id, price: 800, qty: qb }], [priced])?.discount || 0;

  ok('10×A + 1×B is one set: €1.60 off on the server, not €8.80', (await server(10, 1)).discount === 160,
    String((await server(10, 1)).discount));
  ok('…and in the storefront mirror', client(10, 1) === 160, String(client(10, 1)));
  ok('two of each is two sets', (await server(2, 2)).discount === 320 && client(2, 2) === 320);
  ok('3×A + 2×B is two sets', (await server(3, 2)).discount === 320 && client(3, 2) === 320,
    `${(await server(3, 2)).discount} / ${client(3, 2)}`);
  let agree = true;
  for (const [x, y] of [[1, 1], [1, 4], [5, 2], [7, 7], [0, 3]]) {
    const s = x && y ? (await server(x, y)).discount : 0;
    if (s !== client(x, y)) agree = false;
  }
  ok('server and storefront agree on every mix', agree);

  const o = await createOrder({ email: guestEmail(), items: lines([A, 10], [B, 1]), ...consent });
  ok('the order: 10×A + 1×B pays €86.40, not €79.20', o.billing?.bundleDiscount === 160 && o.total === 8640,
    `${o.billing?.bundleDiscount} ${o.total}`);
  const qo = await quote({ items: lines([A, 10], [B, 1]) });
  ok('…as quoted', qo.body.bundleDiscount === 160 && qo.body.total === 8640, JSON.stringify(qo.body).slice(0, 160));
}

console.log('\n— #9 Once per customer, even at the same moment —');
{
  const c = await card(2000, 'Race Card');
  const per = `RACE${stamp % 100000}`;
  await createCoupon({ code: per, kind: 'percent', value: 10, perUserLimit: 1, announce: false }, 'test');
  const u = await newUser();
  const tries = await Promise.all(Array.from({ length: 5 }, () => createOrder({
    email: u.email, userId: u.id, coupon: per, items: lines([c]), ...consent,
  }).then((x) => `ok:${x.total}`, (e) => `err:${e.status}`)));
  ok('five checkouts at once from one account: the code is used once', tries.filter((t) => t.startsWith('ok')).length === 1,
    tries.join(','));
  const used = await get('SELECT COUNT(*)::int AS n FROM coupon_redemptions WHERE code=@c AND user_id=@u', { c: per, u: u.id });
  ok('…and recorded once', Number(used?.n) === 1, String(used?.n));

  const per2 = `RACEM${stamp % 100000}`;
  await createCoupon({ code: per2, kind: 'percent', value: 10, perUserLimit: 1, announce: false }, 'test');
  const spellings = ['race.mail+1@gmail.com', 'racemail+2@gmail.com', 'r.a.c.e.mail@googlemail.com'];
  const guests = await Promise.all(spellings.map((email) => createOrder({ email, coupon: per2, items: lines([c]), ...consent })
    .then(() => 'ok', (e) => `err:${e.status}`)));
  ok('three spellings of one gmail at once: the code is used once', guests.filter((t) => t === 'ok').length === 1, guests.join(','));

  const two = `RACEX${stamp % 100000}`;
  await createCoupon({ code: two, kind: 'percent', value: 10, maxRedemptions: 2, announce: false }, 'test');
  const many = await Promise.all(Array.from({ length: 6 }, () => createOrder({ email: guestEmail(), coupon: two, items: lines([c]), ...consent })
    .then(() => 'ok', (e) => `err:${e.status}`)));
  ok('a two-use code taken by six guests at once is used twice', many.filter((t) => t === 'ok').length === 2, many.join(','));
}

console.log('\n— #10 When the ceiling cuts, the stored discounts are what was given —');
{
  const half = `CAP${stamp % 100000}`;
  await createCoupon({ code: half, kind: 'percent', value: 50, announce: false }, 'test');
  const p = await card(999, 'Cap Card');
  const o = await createOrder({ email: guestEmail(), items: lines([p]), coupon: half, billing: { lang: 'nl' }, ...consent });
  ok('a 50% code on €9.99 charges €5.99', o.total === 599, String(o.total));
  ok('…and stores the €4.00 it gave, not €5.00', o.billing?.discount === 400, String(o.billing?.discount));
  ok('…so subtotal − discounts − credit = total', addsUp(o), JSON.stringify(o.billing));

  const mail = await renderOrderEmail(o.id, 'order_received');
  const html = mail?.html || '';
  const money = (c) => formatMoney(c, 'EUR', 'nl').replace(/&/g, '&amp;');
  ok('the order mail reads €9,99 − €4,00 = €5,99', html.includes(`−${money(400)}`) && !html.includes(`−${money(500)}`)
    && html.includes(money(599)), (html.match(/−[^<]{0,12}/g) || []).join(' | '));

  const csv = await exportOrdersCsv({ search: o.number });
  const row = csv.split('\n').find((l) => l.startsWith(o.number)) || '';
  const [,,,,,,, sub, disc, cred, tot] = row.split(',');
  ok('the CSV export: discount_eur 4.00, and the columns add up', disc === '4.00'
    && Math.round((Number(sub) - Number(disc) - Number(cred)) * 100) === Math.round(Number(tot) * 100), row);

  await run(`UPDATE orders SET status='payment_received' WHERE id=@id`, { id: o.id });
  const rep = await monetizationReport({ days: 1 });
  const line = rep.coupons.find((r) => r.code === half);
  ok('the monetization report counts the €4.00 given', line?.discount === 400, JSON.stringify(line));

  // Member + bundle + coupon over the ceiling: the coupon gives way first.
  const m = await newUser();
  await grantMembership(m.id, 30);
  const A = await card(2000, 'Stack A'), B = await card(2000, 'Stack B');
  await createBundle({ name: `Stack Duo ${stamp}`, productIds: [A.id, B.id], discountPercent: 20, announce: false });
  const thirty = `STACK${stamp % 100000}`;
  await createCoupon({ code: thirty, kind: 'percent', value: 30, announce: false }, 'test');
  const s = await createOrder({ email: m.email, userId: m.id, items: lines([A], [B]), coupon: thirty, ...consent });
  ok('a stack of €22 on €40 is held to €16', s.total === 2400, String(s.total));
  ok('…the coupon gives way first: €6 coupon, €8 bundle, €2 Forge+',
    s.billing?.discount === 600 && s.billing?.bundleDiscount === 800 && s.billing?.memberDiscount === 200,
    JSON.stringify(s.billing));
  ok('…and the stored lines add up', addsUp(s));

  // A code that the ceiling leaves nothing for is not used up for nothing.
  const big = await card(2000, 'Full A'), big2 = await card(2000, 'Full B');
  await createBundle({ name: `Full Duo ${stamp}`, productIds: [big.id, big2.id], discountPercent: 40, announce: false });
  const spare = `SPARE${stamp % 100000}`;
  await createCoupon({ code: spare, kind: 'fixed', value: 500, maxRedemptions: 1, announce: false }, 'test');
  const z = await createOrder({ email: guestEmail(), items: lines([big], [big2]), coupon: spare, ...consent })
    .catch((e) => ({ error: e.message }));
  const left = await get('SELECT redeemed_count FROM coupons WHERE code=@c', { c: spare });
  ok('a single-use code the 40% ceiling leaves €0 for is kept for another order',
    z.total === 2400 && Number(left?.redeemed_count) === 0 && !z.billing?.coupon && addsUp(z),
    `${JSON.stringify(z.billing || z)} used=${left?.redeemed_count}`);
}

console.log('\n— #11 A Forge-Coin code is worth what it says —');
{
  const reward = (id) => FORGE_SHOP.find((r) => r.id === id);
  const u = await newUser();
  await grantCoins(u.id, 65 + 28 + 15);
  const c25 = (await redeemReward(u.id, 'coupon25')).couponCode;
  const c10 = (await redeemReward(u.id, 'coupon10')).couponCode;
  const c5 = (await redeemReward(u.id, 'coupon5')).couponCode;
  const minOf = async (code) => Number((await get('SELECT min_subtotal FROM coupons WHERE code=@c', { c: code }))?.min_subtotal);
  ok('a new €25 code needs an order of €62.50 — the order where 40% is €25', (await minOf(c25)) === 6250, String(await minOf(c25)));
  ok('…€10 needs €25.00 and €5 needs €12.50', (await minOf(c10)) === 2500 && (await minOf(c5)) === 1250,
    `${await minOf(c10)} ${await minOf(c5)}`);

  const thirty = await card(3000, 'Coin Thirty');
  const small = await throws(() => createOrder({ email: u.email, userId: u.id, coupon: c25, items: lines([thirty]), ...consent }));
  ok('on a €30 order it is refused, saying from what amount it works', !!small && small.status === 409 && /62[.,]50/.test(small.message),
    `${small?.status} ${small?.message}`);
  const unused = await get('SELECT redeemed_count FROM coupons WHERE code=@c', { c: c25 });
  ok('…and stays unused', Number(unused?.redeemed_count) === 0);
  const qs = await quote({ items: lines([thirty]), coupon: c25 }, u.token);
  const qp = (qs.body.problems || []).find((p) => p.code === 'coupon');
  ok('…the quote says so too, with the minimum', qp?.reason === 'min_subtotal' && qp?.minSubtotal === 6250, JSON.stringify(qp));

  const sixty = await card(6250, 'Coin Sixty');
  const full = await createOrder({ email: u.email, userId: u.id, coupon: c25, items: lines([sixty]), ...consent })
    .catch((e) => ({ error: e.message }));
  ok('on a €62.50 order all €25 comes off', full.total === 3750 && full.billing?.discount === 2500,
    full.error || `${full.total} ${full.billing?.discount}`);

  const m = await newUser();
  await grantMembership(m.id, 30);
  await grantCoins(m.id, 65);
  const mc = (await redeemReward(m.id, 'coupon25')).couponCode;
  const mo = await createOrder({ email: m.email, userId: m.id, coupon: mc, items: lines([sixty]), ...consent })
    .catch((e) => ({ error: e.message }));
  ok('with Forge+ on top, the order still gets at least the €25', mo.subtotal - mo.total >= 2500 && addsUp(mo),
    mo.error || `${mo.subtotal - mo.total} ${JSON.stringify(mo.billing)}`);

  ok('the reward says it in English', /62\.50/.test(reward('coupon25').blurb) && /25\.00/.test(reward('coupon10').blurb)
    && /12\.50/.test(reward('coupon5').blurb), FORGE_SHOP.map((r) => r.blurb).join(' | '));
  // The page reads the storefront dictionary first, then the account one.
  const nlMain = readFileSync(new URL('src/lib/i18n.jsx', ROOT), 'utf8');
  const nlPick = (k) => (nlMain.match(new RegExp(`'${k.replace(/\./g, '\\.')}':\\s*'([^']*)'`)) || [])[1];
  const accNl = (await import('../../src/lib/i18n/account.nl.js')).default;
  const accDe = (await import('../../src/lib/i18n/account.de.js')).default;
  const accFr = (await import('../../src/lib/i18n/account.fr.js')).default;
  const de = (await import('../../src/lib/i18n/de.js')).default;
  const fr = (await import('../../src/lib/i18n/fr.js')).default;
  const shown = (k) => ({ nl: nlPick(k) ?? accNl[k], de: de[k] ?? accDe[k], fr: fr[k] ?? accFr[k] });
  const t25 = shown('acc.shop.item.coupon25.blurb'), t10 = shown('acc.shop.item.coupon10.blurb'), t5 = shown('acc.shop.item.coupon5.blurb');
  ok('…and in Dutch, German and French', [t25.nl, t25.de, t25.fr].every((s) => /62,50/.test(s || ''))
    && [t10.nl, t10.de, t10.fr].every((s) => /25,00/.test(s || '')) && [t5.nl, t5.de, t5.fr].every((s) => /12,50/.test(s || '')),
    JSON.stringify({ t25, t10, t5 }));

  // A code bought before this change keeps the terms it was sold with.
  const old = `FORGEOLD${stamp % 1000}`;
  await createCoupon({ code: old, kind: 'fixed', value: 2500, perUserLimit: 1, maxRedemptions: 1, active: true, announce: false }, u.id);
  await run(`INSERT INTO forge_coin_ledger (id, user_id, delta, reason, ref, created_at) VALUES (@id, @u, -65, 'redeem', @r, @at)`,
    { id: newId('coin'), u: u.id, r: old, at: nowIso() });
  const oq = await quote({ items: lines([thirty]), coupon: old }, u.token);
  ok('an already-issued €25 code still works on a €30 order (no minimum added to it)',
    oq.status === 200 && !(oq.body.problems || []).length && oq.body.coupon?.code === old, JSON.stringify(oq.body).slice(0, 220));
  ok('…and the quote shows the ceiling takes only €12 of it, so the checkout can warn before it is used up',
    oq.body.coupon?.offered === 2500 && oq.body.coupon?.applied === 1200, JSON.stringify(oq.body.coupon));
}

srv.close();
sink.close();
console.log(`\n${fail ? '❌' : '✅'} pricing-integrity: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
