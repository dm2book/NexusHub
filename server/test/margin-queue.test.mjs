/** Proves/validates: a margin-guarded paid order (supplier cost >= effective
 *  revenue) must surface in the manual queue for owner review, not sit
 *  invisible while the drain re-picks it forever. */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';
/* This suite exercises a shop that SELLS, so it says so.
 *
 * The launch gate's default changed: with no LAUNCH_DATE and no LAUNCH_MODE, a
 * shop that has never taken a payment refuses orders. That is the point — it is
 * what stops a deployment opening to the public by accident — and a fresh test
 * database is, by definition, a shop that has never taken a payment.
 *
 * Declaring the intent here is better than the gate having a special case for
 * tests: the production behaviour is the behaviour under test everywhere else. */
process.env.LAUNCH_MODE ||= 'open';


let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

await (await import('../src/app.js')).ensureReady();
const { createProduct } = await import('../src/services/productService.js');
const { createOrder, getOrder, markPaymentReceived } = await import('../src/services/orderService.js');
const { createSupplier, mapSupplierProduct } = await import('../src/services/supplier/supplierService.js');
const { listManualQueue, drainSupplierQueue } = await import('../src/services/fulfillmentService.js');
const { all } = await import('../src/db/index.js');
const tag = Date.now() % 1000000;

// Product €10, supplier cost €12 (loss) with an auto-capable supplier → the
// margin guard refuses the buy. The order must then land in the manual queue.
const p = await createProduct({ name: `LossKey ${tag}`, category: 'giftcard', price: 1000, announce: false });
const sup = await createSupplier({ name: `KgLoss ${tag}`, connectorKind: 'kinguin', config: { apiKey: 'x', autoDeliver: true } });
await mapSupplierProduct({ supplierId: sup.id, productId: p.id, supplierSku: '999',
  supplierUrl: 'https://www.kinguin.net/category/999/losskey', cost: 1200 });

const order = await createOrder({ consent: true, consentText: 'test consent', email: `loss${tag}@x.dev`, items: [{ productId: p.id, quantity: 1 }] });
await markPaymentReceived(order.id, `t_${tag}`, {});
await new Promise((r) => setTimeout(r, 900)); // let the async payment handler finish

const queue = await listManualQueue();
const row = queue.find((q) => q.order_number === order.number);
ok('margin-guarded paid order surfaces in the manual queue', !!row, `queue=${queue.length}`);
ok('queue row carries the supplier listing URL for review', row?.supplierUrl === 'https://www.kinguin.net/category/999/losskey', row?.supplierUrl);

// The drain must now SKIP this order (it has a request) instead of re-picking it.
const res = await drainSupplierQueue({}, {});
const reqs = await all('SELECT mode FROM fulfillment_requests WHERE order_id=@o', { o: order.id });
ok('drain no longer wastes work on it (processed 0 of it)', (res.processed || 0) === 0, JSON.stringify(res));
ok('exactly the manual request(s), no auto duplicates', reqs.length === 1 && reqs[0].mode === 'manual', JSON.stringify(reqs));

// The skip reason is logged for auditability.
const skips = await all(`SELECT detail FROM fulfillment_logs WHERE order_id=@o AND action='skipped'`, { o: order.id });
ok('margin skip is logged', skips.length >= 1, `skips=${skips.length}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
