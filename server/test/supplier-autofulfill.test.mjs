/** Supplier auto-fulfillment activation: paid order with a mapped supplier is
 *  auto-sourced + delivered + completed; margin guard + no-supplier + async
 *  re-poll all behave. Uses an in-memory TestConnector registered at runtime. */
import { ensureReady } from '../src/app.js';
import { get, all, nowIso } from '../src/db/index.js';
import { SupplierConnector } from '../src/services/supplier/SupplierConnector.js';
import { registerConnector } from '../src/services/supplier/registry.js';
import { createSupplier, mapSupplierProduct } from '../src/services/supplier/supplierService.js';
import { retryPendingFulfillments } from '../src/services/fulfillmentService.js';
import { createProduct, getProduct } from '../src/services/productService.js';
import { createOrder, transitionOrder, getOrder } from '../src/services/orderService.js';
import { run } from '../src/db/index.js';

let pass = 0, fail = 0;
const ok = (c, name, extra = '') => c ? (pass++, console.log(`  ✅ ${name}`))
  : (fail++, console.log(`  ❌ ${name} ${extra}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Instant test connector: fulfils immediately with a code.
class TestConnector extends SupplierConnector {
  static kind = 'test';
  get supportsSync() { return false; }
  get supportsFulfillment() { return this.config.autoDeliver !== false; }
  async testConnection() { return { ok: true }; }
  async createFulfillment(req) {
    return { status: 'fulfilled', externalRef: 'test-' + req.supplierSku,
      deliveries: [{ type: 'code', content: `TESTKEY-${req.supplierSku}` }] };
  }
}
// Async test connector: returns in_progress, then fulfils on the next poll.
class AsyncConnector extends SupplierConnector {
  static kind = 'test_async';
  get supportsFulfillment() { return true; }
  async testConnection() { return { ok: true }; }
  async createFulfillment(req) { return { status: 'in_progress', externalRef: 'ap-' + req.supplierSku }; }
  async checkFulfillment(ref) { return { status: 'fulfilled', externalRef: ref, deliveries: [{ type: 'code', content: `ASYNC-${ref}` }] }; }
}
registerConnector(TestConnector);
registerConnector(AsyncConnector);

await ensureReady();
const uid = 'usr_sup';
const at = nowIso();
await run(`INSERT INTO users (id,email,display_name,created_at,updated_at)
           VALUES (@id,'sup@test.dev','S',@at,@at) ON CONFLICT (id) DO NOTHING`, { id: uid, at });

const paidOrder = async (productId) => {
  const o = await createOrder({ email: 'sup@test.dev', userId: uid, items: [{ productId, quantity: 1 }] }, { actorId: uid });
  await transitionOrder(o.id, 'payment_received', { actorId: 'admin' });
  return o;
};
const waitStatus = async (id, target, tries = 20) => {
  for (let i = 0; i < tries; i++) { await sleep(300); if ((await getOrder(id)).status === target) return true; }
  return false;
};

console.log('— Mapped supplier (cost < price) → auto-fulfilled on payment —');
const sup = await createSupplier({ name: 'TestSup', connectorKind: 'test', config: { autoDeliver: true } });
const prod = await createProduct({ name: 'Auto Supplier Product', category: 'robux', price: 2000, announce: false });
await mapSupplierProduct({ supplierId: sup.id, productId: prod.id, supplierSku: 'SKU-A', cost: 1200, priority: 10 });
const o1 = await paidOrder(prod.id);
ok(await waitStatus(o1.id, 'completed'), 'order auto-completed via supplier', (await getOrder(o1.id)).status);
const d1 = await get(`SELECT content FROM deliveries WHERE order_id=@o LIMIT 1`, { o: o1.id });
ok(d1?.content === 'TESTKEY-SKU-A', 'supplier delivery persisted', d1?.content);
const fr1 = await get(`SELECT mode,status FROM fulfillment_requests WHERE order_id=@o LIMIT 1`, { o: o1.id });
ok(fr1?.mode === 'auto' && fr1.status === 'fulfilled', 'auto fulfillment_request recorded', JSON.stringify(fr1));

console.log('\n— Margin guard: cost ≥ price → NOT auto-fulfilled —');
const prod2 = await createProduct({ name: 'Loss Product', category: 'robux', price: 1000, announce: false });
await mapSupplierProduct({ supplierId: sup.id, productId: prod2.id, supplierSku: 'SKU-LOSS', cost: 1000, priority: 10 });
const o2 = await paidOrder(prod2.id);
await sleep(1500);
const s2 = await getOrder(o2.id);
ok(['payment_received','processing','awaiting_fulfillment'].includes(s2.status), 'loss-making order left for manual', s2.status);
const frLoss = await get(`SELECT mode FROM fulfillment_requests WHERE order_id=@o LIMIT 1`, { o: o2.id });
ok(frLoss?.mode === 'manual', 'loss item queued as MANUAL for owner review (no auto-buy)', JSON.stringify(frLoss));

console.log('\n— No supplier mapping → untouched (manual as before) —');
const prod3 = await createProduct({ name: 'Unmapped Product', category: 'robux', price: 1500, announce: false });
const o3 = await paidOrder(prod3.id);
await sleep(1500);
ok((await getOrder(o3.id)).status !== 'completed', 'unmapped order not auto-completed');
const fr3 = await get(`SELECT mode FROM fulfillment_requests WHERE order_id=@o LIMIT 1`, { o: o3.id });
ok(fr3?.mode === 'manual', 'unmapped paid order surfaced as a MANUAL request (semi-auto queue)', JSON.stringify(fr3));

console.log('\n— Async supplier: in_progress → re-poll completes it —');
const supA = await createSupplier({ name: 'AsyncSup', connectorKind: 'test_async', config: {} });
const prod4 = await createProduct({ name: 'Async Product', category: 'robux', price: 3000, announce: false });
await mapSupplierProduct({ supplierId: supA.id, productId: prod4.id, supplierSku: 'SKU-ASYNC', cost: 1500, priority: 10 });
const o4 = await paidOrder(prod4.id);
await sleep(1500);
const mid = await getOrder(o4.id);
ok(mid.status !== 'completed', 'async order not yet complete (in_progress)', mid.status);
const retried = await retryPendingFulfillments({ limit: 10 });
ok(retried >= 1, 'maintenance re-polled the pending fulfillment', `retried ${retried}`);
ok(await waitStatus(o4.id, 'completed', 5), 'async order completes after re-poll', (await getOrder(o4.id)).status);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
