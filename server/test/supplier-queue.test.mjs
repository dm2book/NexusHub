/** Serial supplier queue: paid orders are sourced ONE AT A TIME, oldest first;
 *  the listing URL is stored + passed to the connector; the lease keeps a second
 *  drain from running concurrently. */
import { ensureReady } from '../src/app.js';
import { get, all, run, nowIso } from '../src/db/index.js';
import { SupplierConnector } from '../src/services/supplier/SupplierConnector.js';
import { registerConnector } from '../src/services/supplier/registry.js';
import { createSupplier, mapSupplierProduct, listSupplierProducts } from '../src/services/supplier/supplierService.js';
import { drainSupplierQueue } from '../src/services/fulfillmentService.js';
import { createProduct } from '../src/services/productService.js';
import { createOrder, transitionOrder, getOrder } from '../src/services/orderService.js';

let pass = 0, fail = 0;
const ok = (c, name, extra = '') => c ? (pass++, console.log(`  ✅ ${name}`))
  : (fail++, console.log(`  ❌ ${name} ${extra}`));

// Records the order in which the connector is asked to buy + captures the URL.
const buyLog = [];
class SerialConnector extends SupplierConnector {
  static kind = 'serial_test';
  get supportsFulfillment() { return true; }
  async testConnection() { return { ok: true }; }
  async createFulfillment(req) {
    buyLog.push({ order: req.orderNumber, url: req.supplierUrl, qty: req.quantity });
    return { status: 'fulfilled', externalRef: 'r-' + req.orderNumber,
      deliveries: [{ type: 'code', content: `KEY-${req.orderNumber}` }] };
  }
}
registerConnector(SerialConnector);

await ensureReady();
const uid = 'usr_q';
const at = nowIso();
await run(`INSERT INTO users (id,email,display_name,created_at,updated_at)
           VALUES (@id,'q@test.dev','Q',@at,@at) ON CONFLICT (id) DO NOTHING`, { id: uid, at });

const sup = await createSupplier({ name: 'SerialSup', connectorKind: 'serial_test', config: {} });
const prod = await createProduct({ name: 'Queued Robux', category: 'robux', price: 2000, announce: false });
const URL = 'https://www.eldorado.gg/robux/10000';
await mapSupplierProduct({ supplierId: sup.id, productId: prod.id, supplierSku: 'ELD-RBX', supplierUrl: URL, cost: 1200, priority: 10 });

console.log('— Listing URL stored + returned —');
const maps = await listSupplierProducts(sup.id);
ok(maps[0]?.supplier_url === URL, 'supplier_url persisted on the mapping', maps[0]?.supplier_url);

console.log('\n— Three orders paid in a known order → queue buys oldest-first, one at a time —');
const nums = [];
for (let i = 0; i < 3; i++) {
  const o = await createOrder({ consent: true, consentText: 'test consent', email: 'q@test.dev', userId: uid, items: [{ productId: prod.id, quantity: 1 }] }, { actorId: uid });
  // stagger created_at so "oldest first" is deterministic
  await run(`UPDATE orders SET created_at=@c WHERE id=@id`, { c: new Date(Date.now() - (100 - i) * 1000).toISOString(), id: o.id });
  await run(`UPDATE orders SET status='payment_received', payment_status='paid' WHERE id=@id`, { id: o.id });
  nums.push(o.number);
}
const res = await drainSupplierQueue({ actorId: 'admin' });
ok(res.processed === 3, 'all three orders processed', JSON.stringify(res));
ok(buyLog.length === 3, 'connector was asked to buy exactly 3 times');
ok(buyLog.every((b) => b.url === URL), 'every buy used the listing URL', JSON.stringify(buyLog.map((b) => b.url)));
ok(JSON.stringify(buyLog.map((b) => b.order)) === JSON.stringify(nums), 'bought strictly oldest-first (serial order)', JSON.stringify(buyLog.map((b) => b.order)) + ' vs ' + JSON.stringify(nums));

// all completed + delivered
const completed = await get(`SELECT COUNT(*) AS n FROM orders o WHERE o.user_id='usr_q' AND o.status='completed'`);
ok(Number(completed.n) === 3, 'all three orders completed');

console.log('\n— Lease: a second drain while one holds the lease is skipped —');
// manually hold the lease, then a drain must skip
await run(`INSERT INTO kv (key,value,updated_at) VALUES ('supplier_queue_lock','other',@at)
           ON CONFLICT (key) DO UPDATE SET value='other', updated_at=@at`, { at: nowIso() });
const skipped = await drainSupplierQueue({ actorId: 'admin' });
ok(skipped.skipped === true, 'drain skips when the lease is held by another worker', JSON.stringify(skipped));
await run(`DELETE FROM kv WHERE key='supplier_queue_lock'`);

console.log('\n— No double-processing: draining again buys nothing more —');
buyLog.length = 0;
const again = await drainSupplierQueue({ actorId: 'admin' });
ok((again.processed || 0) === 0 && buyLog.length === 0, 'already-fulfilled orders are not re-bought');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
