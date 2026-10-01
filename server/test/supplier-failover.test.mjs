/**
 * Smart restock & supplier failover.
 *
 * When the supplier a product is bought from goes offline, starts failing, runs
 * out, or becomes too dear, the shop moves the product to the best supplier
 * that is still fine — on stock, price, reliability and fulfilment rate — and
 * logs the move with the old supplier, the new one and why.
 *
 * Most of what is checked here is what it must NOT do: move a product whose
 * supplier is fine; move it for a few cents; bounce it back to a supplier that
 * failed today; pick a cheap supplier that fails most of its orders over an
 * honest one; or log the same decision once per order.
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
const { run, get, all, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { SupplierConnector } = await import('../src/services/supplier/SupplierConnector.js');
const { registerConnector } = await import('../src/services/supplier/registry.js');
const { createSupplier, mapSupplierProduct, resolveFulfillmentSupplier } = await import('../src/services/supplier/supplierService.js');
const { createProduct } = await import('../src/services/productService.js');
const { createOrder, transitionOrder, getOrder } = await import('../src/services/orderService.js');
const { finalizeLogin } = await import('../src/services/authService.js');
const fo = await import('../src/services/supplier/supplierFailoverService.js');

/* Two connectors: one that delivers, one whose API is down. */
class Works extends SupplierConnector {
  static kind = 'fo_works';
  get supportsFulfillment() { return true; }
  async createFulfillment(req) {
    return { status: 'fulfilled', externalRef: `ok-${req.supplierSku}`, deliveries: [{ type: 'code', content: `KEY-${req.supplierSku}` }] };
  }
}
class Broken extends SupplierConnector {
  static kind = 'fo_broken';
  get supportsFulfillment() { return true; }
  async createFulfillment() { throw new Error('503 Service Unavailable'); }
}
registerConnector(Works);
registerConnector(Broken);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now();
const product = (name, price) => createProduct({ name, sku: `FO-${name.replace(/\W+/g, '')}-${stamp}`,
  category: 'robux', price, currency: 'EUR', active: true, announce: false });
const switchesFor = (pid) => all(`SELECT * FROM supplier_switches WHERE product_id=@p ORDER BY created_at`, { p: pid });

/* A mapping as decide() sees it. */
const m = (id, over = {}) => ({ id, supplier_id: `s-${id}`, supplierName: id, supplierStatus: 'active',
  lastSyncStatus: 'success', skuStatus: 'in_stock', stock: 10, cost: 1000, priority: 10,
  reliabilityPct: null, fulfilled: 0, failed: 0, failStreak: 0, ...over });
const ctx = { priceCents: 2000, vatPct: 21 };

console.log('\n— The four reasons, and nothing else —');
{
  ok('a fine supplier is fine', fo.fitness(m('a'), ctx).ok);
  ok('paused → offline', fo.fitness(m('a', { supplierStatus: 'paused' }), ctx).code === 'offline');
  ok('a failed catalogue sync → offline', fo.fitness(m('a', { lastSyncStatus: 'error' }), ctx).code === 'offline');
  ok('two failed deliveries in a row → errors', fo.fitness(m('a', { failStreak: 2 }), ctx).code === 'errors');
  ok('…one is not yet a pattern', fo.fitness(m('a', { failStreak: 1 }), ctx).ok);
  ok('reported out of stock → out_of_stock', fo.fitness(m('a', { skuStatus: 'out_of_stock' }), ctx).code === 'out_of_stock');
  ok('zero units → out_of_stock', fo.fitness(m('a', { stock: 0 }), ctx).code === 'out_of_stock');
  /* €20 incl. 21% BTW is €16.53 for the shop. */
  ok('a cost that makes every sale a loss after BTW → too_expensive',
    fo.fitness(m('a', { cost: 1700 }), ctx).code === 'too_expensive', fo.fitness(m('a', { cost: 1700 }), ctx).reason);
}

console.log('\n— Who it moves to —');
{
  const cur = m('cur', { priority: 10, skuStatus: 'out_of_stock' });
  const pick = (others) => fo.decide([cur, ...others], ctx).to?.id;
  ok('the cheapest usable supplier', pick([m('a', { priority: 20, cost: 1100 }), m('b', { priority: 30, cost: 900 })]) === 'b');
  ok('…but never one that is unusable itself', pick([m('a', { priority: 20, cost: 1100 }),
    m('b', { priority: 30, cost: 900, supplierStatus: 'paused' })]) === 'a');
  ok('a reliable supplier beats a cheaper one that fails most orders',
    pick([m('a', { priority: 20, cost: 1100, reliabilityPct: 95 }), m('b', { priority: 30, cost: 800, reliabilityPct: 20 })]) === 'a');
  ok('…unless it is the only one left', pick([m('b', { priority: 30, cost: 800, reliabilityPct: 20 })]) === 'b');
  ok('a known cost beats an unknown one', pick([m('a', { priority: 20, cost: null }), m('b', { priority: 30, cost: 1500 })]) === 'b');
  ok('on equal price, the higher fulfilment rate', pick([m('a', { priority: 20, cost: 1000, reliabilityPct: 80 }),
    m('b', { priority: 30, cost: 1000, reliabilityPct: 99 })]) === 'b');

  const none = fo.decide([cur], ctx);
  ok('with nowhere to go, nothing moves — and it says why', !none.switch && /no other supplier/.test(none.reason), none.reason);
}

console.log('\n— What it must not do —');
{
  const fine = m('cur', { priority: 10, cost: 1000 });
  ok('a fine supplier is not moved', !fo.decide([fine, m('b', { priority: 20, cost: 980 })], ctx).switch);
  const tooDear = fo.decide([fine, m('b', { priority: 20, cost: 880 })], ctx);
  ok('…unless another is at least 10% cheaper', tooDear.switch && tooDear.code === 'too_expensive', tooDear.reason);
  ok('…and not back to one that failed a delivery today',
    !fo.decide([fine, m('b', { priority: 20, cost: 700, failStreak: 1 })], ctx).switch);
  ok('…nor for price to one that fails most orders',
    !fo.decide([fine, m('b', { priority: 20, cost: 700, reliabilityPct: 30 })], ctx).switch);
}

console.log('\n— At an order: out of stock, then offline —');
{
  const a = await createSupplier({ name: 'Alpha', connectorKind: 'fo_works', config: {} });
  const b = await createSupplier({ name: 'Bravo', connectorKind: 'fo_works', config: {} });
  const c = await createSupplier({ name: 'Charlie', connectorKind: 'fo_works', config: {} });
  const p = await product('Failover Pack', 2000);
  await mapSupplierProduct({ supplierId: a.id, productId: p.id, supplierSku: 'A-1', cost: 1200, priority: 10 });
  await mapSupplierProduct({ supplierId: b.id, productId: p.id, supplierSku: 'B-1', cost: 1300, priority: 20 });
  await mapSupplierProduct({ supplierId: c.id, productId: p.id, supplierSku: 'C-1', cost: 1100, priority: 30 });
  /* Charlie is cheapest and fails four orders in five — history on a real,
     unpaid order, three days old so it is history and not today's streak. */
  const hu = newId('usr');
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'H', @at, @at)`,
    { id: hu, e: `fo-hist-${stamp}@test.local`, at: nowIso() });
  const hist = await createOrder({ consent: true, consentText: 'test', email: `fo-hist-${stamp}@test.local`, userId: hu,
    items: [{ productId: p.id, quantity: 1 }] }, { actorId: hu });
  const histItem = await get(`SELECT id FROM order_items WHERE order_id=@o LIMIT 1`, { o: hist.id });
  for (const st of ['fulfilled', 'failed', 'failed', 'failed', 'failed']) {
    await run(`INSERT INTO fulfillment_requests (id, order_id, order_item_id, supplier_id, mode, status, payload, created_at, updated_at)
               VALUES (@id, @o, @i, @s, 'auto', @st, '{}', @at, @at)`,
    { id: newId('ful'), o: hist.id, i: histItem.id, s: c.id, st, at: new Date(Date.now() - 3 * 86_400_000).toISOString() });
  }

  const first = await resolveFulfillmentSupplier(p.id);
  ok('while Alpha is fine, orders go to Alpha', first?.supplier.id === a.id);
  ok('…and nothing is logged', (await switchesFor(p.id)).length === 0);

  await run(`UPDATE supplier_products SET supplier_status='out_of_stock' WHERE supplier_id=@s`, { s: a.id });
  const second = await resolveFulfillmentSupplier(p.id);
  ok('Alpha out of stock → Bravo, not the cheaper but unreliable Charlie', second?.supplier.id === b.id,
    second?.supplier.name);
  const log1 = await switchesFor(p.id);
  ok('the switch is logged once', log1.length === 1);
  ok('…with the old supplier, the new one and why', log1[0]?.from_supplier_id === a.id && log1[0].to_supplier_id === b.id
    && log1[0].reason_code === 'out_of_stock' && /Alpha has none in stock/.test(log1[0].reason), JSON.stringify(log1[0]));
  const prio = Object.fromEntries((await all(`SELECT supplier_id, priority FROM supplier_products WHERE product_id=@p`, { p: p.id }))
    .map((r) => [r.supplier_id, r.priority]));
  ok('Bravo is now first choice, Alpha kept for when it is back', prio[b.id] < prio[a.id], JSON.stringify(prio));

  await resolveFulfillmentSupplier(p.id);
  ok('the next order does not log the same decision again', (await switchesFor(p.id)).length === 1);

  await run(`UPDATE suppliers SET status='paused' WHERE id=@s`, { s: b.id });
  const third = await resolveFulfillmentSupplier(p.id);
  ok('Bravo offline → Charlie, the only one left that can deliver', third?.supplier.id === c.id, third?.supplier.name);
  const log2 = await switchesFor(p.id);
  ok('…logged as offline', log2[1]?.reason_code === 'offline' && log2[1].from_supplier_id === b.id, JSON.stringify(log2[1]));
}

console.log('\n— A failed delivery goes to the next supplier, not to the owner —');
{
  const down = await createSupplier({ name: 'Downer', connectorKind: 'fo_broken', config: {} });
  const up = await createSupplier({ name: 'Upper', connectorKind: 'fo_works', config: {} });
  const p = await product('Failover Live', 2000);
  await mapSupplierProduct({ supplierId: down.id, productId: p.id, supplierSku: 'D-1', cost: 1000, priority: 10 });
  await mapSupplierProduct({ supplierId: up.id, productId: p.id, supplierSku: 'U-1', cost: 1100, priority: 20 });

  const uid = newId('usr');
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'B', @at, @at)`,
    { id: uid, e: `fo-${stamp}@test.local`, at: nowIso() });
  const o = await createOrder({ consent: true, consentText: 'test', email: `fo-${stamp}@test.local`, userId: uid,
    items: [{ productId: p.id, quantity: 1 }] }, { actorId: uid });
  await transitionOrder(o.id, 'payment_received', { actorId: 'admin' });
  let done = false;
  for (let i = 0; i < 25 && !done; i++) { await sleep(300); done = (await getOrder(o.id)).status === 'completed'; }

  ok('the order is delivered anyway', done, (await getOrder(o.id)).status);
  const d = await get(`SELECT content FROM deliveries WHERE order_id=@o LIMIT 1`, { o: o.id });
  ok('…by the supplier that works', d?.content === 'KEY-U-1', String(d?.content));
  const reqs = await all(`SELECT supplier_id, status FROM fulfillment_requests WHERE order_id=@o ORDER BY created_at`, { o: o.id });
  ok('the failed attempt is kept, beside the one that worked',
    reqs.length === 2 && reqs[0].status === 'failed' && reqs[1].status === 'fulfilled', JSON.stringify(reqs));
  const sw = await switchesFor(p.id);
  ok('the switch is logged as errors, after a failed delivery',
    sw.length === 1 && sw[0].reason_code === 'errors' && sw[0].trigger === 'failure' && sw[0].order_id === o.id,
    JSON.stringify(sw[0]));
  const flog = await get(`SELECT detail FROM fulfillment_logs WHERE order_id=@o AND action='failover'`, { o: o.id });
  ok('…and the order\'s own log says so', !!flog, String(flog?.detail));
}

console.log('\n— Too expensive, found by the hourly check —');
{
  const dear = await createSupplier({ name: 'Dearco', connectorKind: 'fo_works', config: {} });
  const fair = await createSupplier({ name: 'Fairco', connectorKind: 'fo_works', config: {} });
  const p = await product('Failover Price', 1000);
  await mapSupplierProduct({ supplierId: dear.id, productId: p.id, supplierSku: 'X-1', cost: 900, priority: 10 });
  await mapSupplierProduct({ supplierId: fair.id, productId: p.id, supplierSku: 'Y-1', cost: 600, priority: 20 });
  const out = await fo.sweepFailover();
  ok('the sweep moves it', out.switched >= 1, JSON.stringify(out));
  const sw = await switchesFor(p.id);
  ok('…as too expensive: €9.00 loses money on a €10.00 sale after BTW',
    sw[0]?.reason_code === 'too_expensive' && /loses/.test(sw[0].reason) && sw[0].trigger === 'sweep', JSON.stringify(sw[0]));
  const detail = JSON.parse(sw[0]?.detail || '{}');
  ok('…keeping the numbers it decided on', detail.from?.cost === 900 && detail.to?.cost === 600, JSON.stringify(detail));
}

console.log('\n— The log, in the admin —');
{
  const id = newId('usr');
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'Owner', @at, @at)`,
    { id, e: `fo-owner-${stamp}@test.local`, at: nowIso() });
  await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, 'owner', @at) ON CONFLICT DO NOTHING`, { u: id, at: nowIso() });
  const { accessToken } = await finalizeLogin(await get(`SELECT * FROM users WHERE id=@id`, { id }), {});
  const srv = createApp().listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const r = await fetch(`${base}/api/admin/suppliers/failover/switches`, { headers: { authorization: `Bearer ${accessToken}` } });
  const body = await r.json();
  const anon = await fetch(`${base}/api/admin/suppliers/failover/switches`);
  const runNow = await fetch(`${base}/api/admin/suppliers/failover/run`, { method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: '{}' });
  srv.close();
  const row = (body.switches || []).find((s) => s.from?.name === 'Alpha');
  ok('the admin lists every switch', r.status === 200 && body.switches.length >= 4, String(body.switches?.length));
  ok('…with the old supplier, the new one and why', row?.to?.name === 'Bravo' && row.code === 'out_of_stock' && !!row.reason,
    JSON.stringify(row));
  ok('…newest first', body.switches[0].at >= body.switches[body.switches.length - 1].at);
  ok('…to staff only', anon.status === 401);
  ok('"Check now" runs the sweep', runNow.status === 200);
}

console.log(`\n${fail ? '❌' : '✅'} supplier-failover: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
