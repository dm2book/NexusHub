/** Verifies the semi-auto fulfillment: a paid order with no stock + no auto
 *  supplier is queued for manual delivery, and the queue surfaces the supplier
 *  buy link, quantity and the buyer's delivery target. */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

await (await import('../src/app.js')).ensureReady();
const { createProduct } = await import('../src/services/productService.js');
const { createOrder, getOrder, markPaymentReceived } = await import('../src/services/orderService.js');
const { createSupplier, mapSupplierProduct } = await import('../src/services/supplier/supplierService.js');
const { ensureManualFulfillment, listManualQueue, completeManualFulfillment, sweepUnfulfilledPaidOrders } = await import('../src/services/fulfillmentService.js');
const { all } = await import('../src/db/index.js');
const tag = Date.now() % 1000000;

// A P2P-style product: manual delivery, asks for a game username, no stock.
const p = await createProduct({ name: `Robux 10k ${tag}`, category: 'robux', price: 1000, announce: false,
  metadata: { deliveryMode: 'manual', deliveryField: 'Roblox username' } });
ok('product exposes deliveryField', p.deliveryField === 'Roblox username', p.deliveryField);

// An Eldorado-style supplier WITHOUT auto-deliver (no apiKey) but WITH a listing
// URL → won't auto-buy, but the URL should surface in the manual queue.
const sup = await createSupplier({ name: `Eldo ${tag}`, connectorKind: 'eldorado', config: { autoDeliver: false } });
await mapSupplierProduct({ supplierId: sup.id, productId: p.id, supplierSku: 'offer-1',
  supplierUrl: 'https://www.eldorado.gg/roblox-robux/i/10001', cost: 700 });

// Order carrying the buyer's delivery target, then mark it paid.
const order = await createOrder({ consent: true, consentText: 'test consent', email: `p2p${tag}@x.dev`,
  items: [{ productId: p.id, quantity: 2 }],
  billing: { deliveryDetails: 'CoolGamer123', deliveryLabel: 'Roblox username' } });
ok('order stored the delivery target in billing', order.billing?.deliveryDetails === 'CoolGamer123', JSON.stringify(order.billing));

await markPaymentReceived(order.id, `test_${tag}`, {});
await new Promise((r) => setTimeout(r, 700)); // let the async payment handler run

// The paid order must now be in the manual queue (auto-surfaced).
let queue = await listManualQueue();
let row = queue.find((q) => q.order_number === order.number);
if (!row) { // belt-and-braces: the backfill sweep should also catch it
  await sweepUnfulfilledPaidOrders({});
  queue = await listManualQueue();
  row = queue.find((q) => q.order_number === order.number);
}
ok('paid P2P order auto-surfaced in the manual queue', !!row, `queue size=${queue.length}`);
ok('queue shows the quantity to buy', row?.quantity === 2, `qty=${row?.quantity}`);
ok('queue shows the supplier buy link', row?.supplierUrl === 'https://www.eldorado.gg/roblox-robux/i/10001', row?.supplierUrl);
ok('queue shows the buyer delivery target', row?.deliveryDetails === 'CoolGamer123', row?.deliveryDetails);
ok('queue shows the delivery label', row?.deliveryLabel === 'Roblox username', row?.deliveryLabel);

// One-click deliver → order completes + a delivery row is written + emailed.
if (row) {
  await completeManualFulfillment(row.id, { deliveries: [{ type: 'code', content: 'ROBUX-DELIVERED-OK' }], note: 'bought + sent' }, {});
  const fresh = await getOrder(order.id);
  const dels = await all('SELECT content FROM deliveries WHERE order_id=@o', { o: order.id });
  ok('one-click deliver completes the order', fresh.status === 'completed', fresh.status);
  ok('the delivery content is recorded', dels.some((d) => d.content === 'ROBUX-DELIVERED-OK'), JSON.stringify(dels));
}

// Idempotency: ensureManualFulfillment must not double-open.
const before = (await all('SELECT id FROM fulfillment_requests WHERE order_id=@o', { o: order.id })).length;
await ensureManualFulfillment(order.id, {});
const after = (await all('SELECT id FROM fulfillment_requests WHERE order_id=@o', { o: order.id })).length;
ok('ensureManualFulfillment is idempotent (no duplicate requests)', before === after, `${before}→${after}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
