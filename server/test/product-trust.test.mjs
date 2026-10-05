/**
 * The trust layer: stock, last delivery, successful orders, fulfilment rate,
 * average delivery time, refund rate and a trust score per product — measured
 * from the shop's own orders, shown only when the data exists.
 *
 *   a product nobody bought shows its stock and nothing else: no zero, no
 *   dash, no estimate, no score;
 *   only paid, non-test, settled orders count — a free order, a test payment
 *   or an order still in progress is not evidence of anything;
 *   rates and the score wait for MIN_SAMPLE settled orders, the delivery time
 *   for MIN_TIMED orders with both moments on record — and it is measured from
 *   payment to delivery, not from when the order was placed;
 *   the score is 0–100 and follows the facts;
 *   the product page draws a line per field it was sent, and nothing else.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV = 'development';
process.env.LAUNCH_MODE = 'open';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const trust = await import('../src/services/productTrustService.js');
const { trustLines, durationParts } = await import('../../src/lib/trustLines.js');
const HOUR = 3_600_000, DAY = 86_400_000;
const at = (msAgo) => new Date(Date.now() - msAgo).toISOString();

/* An order row as the service reads it. Paid one day ago, delivered `took` later. */
const order = (status, { total = 999, took = HOUR, paid = true, refund = false, test = false, ago = DAY } = {}) => ({
  status, total, billing: '{}', payment_status: paid ? 'paid' : 'unpaid', psp_provider: null,
  paid_at: paid ? at(ago) : null,
  completed_at: status === 'completed' || (status === 'refunded' && took != null) ? at(ago - took) : null,
  updated_at: at(ago - (took || 0)), refund_granted: refund, test_event: test,
});

console.log('\n— Only what exists —');
{
  const none = trust.computeTrust([], { stock: { state: 'on_order' } });
  ok('no orders: only the stock, nothing else', JSON.stringify(none) === JSON.stringify({ stock: { state: 'on_order' } }), JSON.stringify(none));
  ok('…no data at all: an empty object, not zeros', JSON.stringify(trust.computeTrust([])) === '{}');
  const few = trust.computeTrust([order('completed'), order('completed'), order('completed')]);
  ok('three orders: successful count and last delivery, but no percentages yet', few.successfulOrders === 3 && few.lastDelivery
    && few.fulfillmentRate === undefined && few.refundRate === undefined && few.score === undefined);
  ok('…and the delivery time once three are timed', few.avgDelivery?.orders === 3 && few.avgDelivery.seconds === 3600);
  ok('no field is ever null, zero-filled or a placeholder', [none, few].every((o) => Object.values(o).every((v) => v !== null && v !== 0 && v !== '' && v !== '—')));
}

console.log('\n— Which orders count —');
{
  const t = trust.computeTrust([
    order('completed', { total: 0 }),                 // a 100% coupon / giveaway: not a sale
    order('completed', { test: true }),               // paid on a test key
    order('processing'), order('awaiting_fulfillment'), // still being worked on
    order('pending', { paid: false }), order('cancelled', { paid: false }), // never paid
  ]);
  ok('free, test, in-progress and unpaid orders count for nothing', JSON.stringify(t) === '{}', JSON.stringify(t));
  ok('a giveaway is not a real sale', !trust.isRealSale(order('completed', { total: 0 })));
  ok('store credit spent is a real sale', trust.isRealSale({ ...order('completed', { total: 0 }), billing: JSON.stringify({ creditApplied: 500 }) }));
}

console.log('\n— Rates, delivery time and score —');
{
  const ten = [...Array(8)].map(() => order('completed', { took: 2 * HOUR })).concat(
    order('refunded', { took: 2 * HOUR }),            // delivered, then refunded
    order('cancelled'),                               // paid, never delivered
  );
  const t = trust.computeTrust(ten, { stock: { state: 'in_stock' } });
  ok('fulfilment = delivered ÷ settled paid orders (9 of 10)', t.fulfillmentRate === 90 && t.sample === 10, JSON.stringify(t));
  ok('refund rate = refunded ÷ settled (1 of 10)', t.refundRate === 10);
  ok('successful = delivered and not refunded (8)', t.successfulOrders === 8);
  ok('average delivery runs from payment to delivery: 2 hours', t.avgDelivery.seconds === 7200 && t.avgDelivery.orders === 9);
  ok('a granted refund request counts as refunded too', trust.computeTrust([...Array(5)].map((_, i) => order('completed', { refund: i === 0 }))).refundRate === 20);
  ok('a score appears, within 0–100', Number.isInteger(t.score) && t.score >= 0 && t.score <= 100);
  const perfect = trust.computeTrust([...Array(60)].map(() => order('completed')), { stock: { state: 'in_stock' } });
  ok('60 delivered, none refunded, in stock, recent: 100', perfect.score === 100, String(perfect.score));
  const out = trust.computeTrust([...Array(60)].map(() => order('completed')), { stock: { state: 'out_of_stock' } });
  ok('…out of stock costs points', out.score === 90);
  const old = trust.computeTrust([...Array(60)].map(() => order('completed', { ago: 200 * DAY })), { stock: { state: 'in_stock' } });
  ok('…and so does a last delivery months ago', old.score === 90);
  const bad = trust.computeTrust([...Array(5)].map((_, i) => order(i < 2 ? 'completed' : 'refunded', { took: null })));
  ok('a product that mostly failed scores low', bad.fulfillmentRate === 40 && bad.refundRate === 60 && bad.score < 40, JSON.stringify(bad));
  const untimed = trust.computeTrust([...Array(6)].map(() => ({ ...order('completed'), paid_at: null })));
  ok('no payment moment on record: no delivery time, rather than one from the order date', untimed.avgDelivery === undefined && untimed.fulfillmentRate === 100);
}

console.log('\n— Stock —');
{
  ok('auto-delivered with codes on the shelf: in stock', trust.stockState({ deliveryMode: 'auto' }, 40).state === 'in_stock' && trust.stockState({ deliveryMode: 'auto' }, 40).left === undefined);
  ok('…with a few left: the number', trust.stockState({ deliveryMode: 'auto' }, 3).left === 3);
  ok('…with none: bought in per order, never "sold out" (the order is still taken and delivered by hand)', trust.stockState({ deliveryMode: 'auto' }, 0).state === 'on_order');
  ok('delivered by hand: bought in per order', trust.stockState({ deliveryMode: 'manual' }, 0).state === 'on_order');
}

console.log('\n— What the product page draws —');
{
  const t = (_k, en, vars) => Object.entries(vars || {}).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), en);
  ok('nothing sent: no lines, so no block', trustLines(null, t).length === 0 && trustLines({}, t).length === 0);
  ok('only stock sent: one line', trustLines({ stock: { state: 'in_stock' } }, t).map((l) => l.k).join() === 'stock');
  const all = trustLines({ stock: { state: 'in_stock', left: 2 }, lastDelivery: at(DAY), successfulOrders: 12, sample: 14,
    fulfillmentRate: 92.9, refundRate: 7.1, avgDelivery: { seconds: 5400, orders: 10 }, score: 81 }, t);
  ok('every field sent: a line each', all.map((l) => l.k).join() === 'stock,last,orders,fulfil,refund,avg,score');
  ok('…with the real numbers in them', /2 left/.test(all[0].text) && /12 successful/.test(all[2].text) && /92\.9% delivered, of 14/.test(all[3].text)
    && /1\.5 h .*10 orders/.test(all[5].text) && /81\/100/.test(all[6].text));
  ok('one order reads in the singular', trustLines({ successfulOrders: 1 }, t)[0].text === '1 successful order');
  ok('durations read as minutes, hours, days', durationParts(600)[2] === 10 && durationParts(7200)[0] === 'tr.hours' && durationParts(3 * 86_400)[0] === 'tr.days');
  const fs = await import('node:fs');
  const page = fs.readFileSync(new URL('../../src/pages/ProductDetail.jsx', import.meta.url), 'utf8');
  ok('the product page renders the trust block', page.includes('<ProductTrust '));
  const comp = fs.readFileSync(new URL('../../src/components/store/ProductTrust.jsx', import.meta.url), 'utf8');
  ok('…which draws nothing when there are no lines', comp.includes('if (!lines.length) return null'));
  const svc = fs.readFileSync(new URL('../src/services/productTrustService.js', import.meta.url), 'utf8');
  ok('no reviews or ratings go into the trust layer', !/FROM reviews|rating/i.test(svc.replace(/\/\*[\s\S]*?\*\//g, '')));
  for (const f of ['../../src/lib/i18n.jsx', '../../src/lib/i18n/de.js', '../../src/lib/i18n/fr.js']) {
    const d = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    ok(`${f.split('/').pop()} carries every trust line`, ['tr.title', 'tr.inStock', 'tr.inStockLeft', 'tr.onOrder', 'tr.out', 'tr.last', 'tr.order1', 'tr.orders',
      'tr.fulfilled', 'tr.refunds', 'tr.avg', 'tr.score', 'tr.mins', 'tr.hours', 'tr.days'].every((k) => d.includes(`'${k}'`)));
  }
}

console.log('\n— From the database, over HTTP —');
{
  const { createApp, ensureReady } = await import('../src/app.js');
  await ensureReady();
  const { run, get, nowIso } = await import('../src/db/index.js');
  const { newId } = await import('../src/utils/ids.js');
  const { finalizeLogin } = await import('../src/services/authService.js');
  const { createProduct } = await import('../src/services/productService.js');
  const p = await createProduct({ name: `2,200 Robux ${Date.now().toString(36)}`, category: 'robux', price: 1999, announce: false });
  const srv = createApp().listen(0);
  const base = `http://127.0.0.1:${srv.address().port}/api`;

  const fresh = (await (await fetch(`${base}/products/${p.id}/trust`)).json()).trust;
  ok('a product nobody bought: only its stock', Object.keys(fresh).join() === 'stock', JSON.stringify(fresh));

  /* Six real orders: five delivered (paid 1 h before), one cancelled after payment. Plus one free and one test order. */
  const place = async (status, { total = 1999, minutes = 60, test = false } = {}) => {
    const id = newId('ord'), paidAt = at(DAY), doneAt = at(DAY - minutes * 60_000);
    await run(`INSERT INTO orders (id, number, email, status, total, subtotal, payment_status, billing, created_at, updated_at)
      VALUES (@id, @n, 'b@example.test', @st, @t, @t, 'paid', '{}', @c, @u)`, { id, n: `T-${id.slice(-10)}`, st: status, t: total, c: at(2 * DAY), u: doneAt });
    await run(`INSERT INTO order_items (id, order_id, product_id, name, quantity, unit_price) VALUES (@i, @o, @p, 'Robux', 1, @t)`, { i: newId('oi'), o: id, p: p.id, t: total });
    await run(`INSERT INTO order_status_history (id, order_id, from_status, to_status, created_at) VALUES (@i, @o, 'pending', 'payment_received', @a)`, { i: newId('osh'), o: id, a: paidAt });
    if (status === 'completed') await run(`INSERT INTO order_status_history (id, order_id, from_status, to_status, created_at) VALUES (@i, @o, 'processing', 'completed', @a)`, { i: newId('osh'), o: id, a: doneAt });
    if (test) await run(`INSERT INTO social_events (id, order_id, product_label, status, test, created_at) VALUES (@i, @o, 'x', 'visible', 1, @a)`, { i: newId('soc'), o: id, a: doneAt });
  };
  for (let i = 0; i < 5; i++) await place('completed', { minutes: 30 + i * 15 }); // eslint-disable-line no-await-in-loop
  await place('cancelled');
  await place('completed', { total: 0 });
  await place('completed', { test: true });

  const t = (await (await fetch(`${base}/products/${p.id}/trust`)).json()).trust;
  ok('six real orders: 5 successful, 83.3% delivered of 6, 0% refunded', t.successfulOrders === 5 && t.fulfillmentRate === 83.3 && t.sample === 6 && t.refundRate === 0, JSON.stringify(t));
  ok('…average delivery 1 h from payment (30–90 min)', t.avgDelivery?.seconds === 3600 && t.avgDelivery.orders === 5);
  ok('…the last delivery and a score', !!t.lastDelivery && Number.isInteger(t.score));
  ok('…the free and the test order did not count', t.sample === 6);

  const owner = newId('usr');
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'O', @at, @at)`, { id: owner, e: `o-${owner}@example.test`, at: nowIso() });
  await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, 'owner', @at)`, { u: owner, at: nowIso() });
  const { accessToken } = await finalizeLogin(await get('SELECT * FROM users WHERE id=@id', { id: owner }), {});
  const rep = await (await fetch(`${base}/admin/products/trust`, { headers: { authorization: `Bearer ${accessToken}` } })).json();
  const row = rep.items.find((i) => i.id === p.id);
  ok('the admin report has every active product, with the same facts', rep.items.length === rep.total && row?.score === t.score && row.fulfillmentRate === 83.3);
  ok('…scored products first', rep.items.findIndex((i) => i.score == null) === -1 || rep.items.findIndex((i) => i.score == null) >= rep.scored);
  ok('…not for a visitor', (await fetch(`${base}/admin/products/trust`)).status === 401);
  srv.close();
}

console.log(`\n${fail ? '❌' : '✅'} product-trust: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
