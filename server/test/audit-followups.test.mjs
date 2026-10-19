/**
 * The open items of the release audit, each with the failure it closes.
 *
 *   - A supplier that broke the connection or answered 5xx AFTER our purchase
 *     request may have sold us the code; buying it again elsewhere is paying
 *     twice. Only a clear "no" fails over — the rest goes to a person.
 *   - A purchase that was pending at the supplier and failed later sat as a
 *     failed request, with nobody told, while the buyer waited.
 *   - The checkout quote said whether a coupon code exists at 60 tries a
 *     minute, which made the coupon lookup's limit decorative.
 *   - One screenshot could prove payment for two orders.
 */
import './_selling-shop.mjs';
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit_followups';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
await (await import('../src/services/bootUpkeep.js')).claimInterval('maintenance_auto', 3_600_000);
const { run, get, all } = await import('../src/db/index.js');
const { SupplierConnector } = await import('../src/services/supplier/SupplierConnector.js');
const { registerConnector } = await import('../src/services/supplier/registry.js');
const { createSupplier, mapSupplierProduct } = await import('../src/services/supplier/supplierService.js');
const { createProduct } = await import('../src/services/productService.js');
const { createOrder, transitionOrder, getOrder } = await import('../src/services/orderService.js');
const { refreshFulfillment } = await import('../src/services/fulfillmentService.js');
const { submitProof } = await import('../src/services/paymentProofService.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now();

/* Suppliers that fail in each way that matters. */
let pendingThenFail = 'pending';
const kinds = {
  af_works: async (req) => ({ status: 'fulfilled', externalRef: `ok-${req.supplierSku}`, deliveries: [{ type: 'code', content: `KEY-${req.supplierSku}` }] }),
  af_5xx: async () => { throw Object.assign(new Error('Supplier API error: HTTP 502'), { status: 502 }); },
  af_net: async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }); },
  af_noref: async () => { throw Object.assign(new Error('Kinguin: order created but no orderId returned'), { outcomeUnknown: true }); },
  af_4xx: async () => { throw Object.assign(new Error('Supplier API error: out of stock'), { status: 409 }); },
  af_async: async () => ({ status: 'in_progress', externalRef: `async-${stamp}`, deliveries: [] }),
};
for (const [kind, fn] of Object.entries(kinds)) {
  class C extends SupplierConnector {
    static kind = kind;
    get supportsFulfillment() { return true; }
    async createFulfillment(req) { return fn(req); }
    async checkFulfillment() { return pendingThenFail === 'failed' ? { status: 'failed', error: 'card declined at supplier' } : { status: 'in_progress' }; }
  }
  registerConnector(C);
}

async function scenario(firstKind, label) {
  const first = await createSupplier({ name: `${label}-first`, connectorKind: firstKind, config: {} });
  const backup = await createSupplier({ name: `${label}-backup`, connectorKind: 'af_works', config: {} });
  const p = await createProduct({ name: `AF ${label}`, sku: `AF-${label}-${stamp}`, category: 'robux', price: 2000,
    currency: 'EUR', active: true, announce: false });
  await mapSupplierProduct({ supplierId: first.id, productId: p.id, supplierSku: `${label}-1`, cost: 1000, priority: 10 });
  await mapSupplierProduct({ supplierId: backup.id, productId: p.id, supplierSku: `${label}-B`, cost: 1100, priority: 20 });
  const o = await createOrder({ consent: true, consentText: 'test', email: `af-${label}-${stamp}@test.local`,
    items: [{ productId: p.id, quantity: 1 }] });
  await transitionOrder(o.id, 'payment_received', { actorId: 'admin' });
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    const reqs = await all(`SELECT status, mode FROM fulfillment_requests WHERE order_id=@o`, { o: o.id });
    const s = (await getOrder(o.id)).status;
    if (s === 'completed' || reqs.some((r) => r.mode === 'manual') || reqs.some((r) => r.status === 'in_progress')) break;
  }
  const reqs = await all(`SELECT id, supplier_id, status, mode FROM fulfillment_requests WHERE order_id=@o ORDER BY created_at`, { o: o.id });
  return { o, reqs, backup };
}

console.log('— A supplier that may have sold it is never bought from twice —');
for (const [kind, label] of [['af_5xx', 'server error after the request'], ['af_net', 'connection reset'], ['af_noref', 'created but no order id']]) {
  const r = await scenario(kind, kind);
  const boughtAgain = r.reqs.some((q) => q.supplier_id === r.backup.id);
  ok(`${label}: not bought again elsewhere, handed to a person`, !boughtAgain && r.reqs.some((q) => q.mode === 'manual'),
    JSON.stringify(r.reqs));
}
{
  const r = await scenario('af_4xx', 'af4xx');
  ok('a clear "no" (4xx) still fails over to the next supplier',
    r.reqs.some((q) => q.supplier_id === r.backup.id && q.status === 'fulfilled'), JSON.stringify(r.reqs));
}

console.log('\n— A purchase that fails later reaches a person —');
{
  const r = await scenario('af_async', 'afasync');
  const autoReq = r.reqs.find((q) => q.status === 'in_progress');
  ok('the purchase is pending at the supplier', !!autoReq, JSON.stringify(r.reqs));
  pendingThenFail = 'failed';
  await refreshFulfillment(autoReq.id, { actorId: 'system' });
  const after = await all(`SELECT status, mode FROM fulfillment_requests WHERE order_id=@o`, { o: r.o.id });
  ok('…and when it fails there, it goes to the hand queue', after.some((q) => q.mode === 'manual'), JSON.stringify(after));
  const anyAlert = await get(`SELECT COUNT(*)::int AS n FROM owner_alerts WHERE event='fulfillment.failed'`).catch(() => ({ n: 0 }));
  ok('…and the owner is told', anyAlert?.n > 0, JSON.stringify(anyAlert));
  // A second check (the sweep, or the owner clicking retry) must not queue it again.
  await refreshFulfillment(autoReq.id, { actorId: 'system' }).catch(() => {});
  const again = await all(`SELECT 1 FROM fulfillment_requests WHERE order_id=@o AND mode='manual'`, { o: r.o.id });
  ok('…once: a second check does not queue it twice', again.length === 1, `${again.length}`);
}

console.log('\n— The quote does not tell a code guesser which codes exist —');
{
  const srv = createApp().listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const p = await createProduct({ name: 'AF Quote', sku: `AF-Q-${stamp}`, category: 'robux', price: 1000,
    currency: 'EUR', active: true, announce: false });
  const quote = (coupon) => fetch(`${base}/api/checkout/quote`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: [{ productId: p.id, quantity: 1 }], ...(coupon ? { coupon } : {}) }) });
  let limited = 0;
  for (let i = 0; i < 25; i++) if ((await quote(`GUESS${i}X`)).status === 429) limited++;
  ok(`25 wrong codes in a row are cut off by the coupon limit (${limited} refused)`, limited >= 5);
  const plain = await quote(null);
  ok('…while a quote without a code still answers', plain.status === 200, `${plain.status}`);
  srv.close();
}

console.log('\n— One screenshot, two orders —');
{
  const p = await createProduct({ name: 'AF Proof', sku: `AF-P-${stamp}`, category: 'robux', price: 1000,
    currency: 'EUR', active: true, announce: false });
  const shot = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const mk = (tag) => createOrder({ consent: true, consentText: 'test', email: `af-p${tag}-${stamp}@test.local`,
    items: [{ productId: p.id, quantity: 1 }] });
  const a = await mk('a'), b = await mk('b'), c = await mk('c');
  const first = await submitProof(a.id, { screenshotUrl: shot, method: 'paypal' });
  const second = await submitProof(b.id, { screenshotUrl: shot, method: 'paypal' });
  ok('the first proof is not flagged', !first.flags.includes('duplicate_screenshot'), JSON.stringify(first.flags));
  ok('the same image for another order is flagged', second.flags.includes('duplicate_screenshot'), JSON.stringify(second.flags));
  await run(`UPDATE payment_proofs SET screenshot_url=NULL WHERE order_id IN (@a, @b)`, { a: a.id, b: b.id });
  const third = await submitProof(c.id, { screenshotUrl: shot, method: 'paypal' });
  ok('…even after the earlier images were deleted after review', third.flags.includes('duplicate_screenshot'));
}


console.log('\n— Maintenance runs once at a time —');
{
  const { runMaintenance } = await import('../src/services/maintenanceService.js');
  const [a, b] = await Promise.all([runMaintenance({ deadline: Date.now() + 20_000 }), runMaintenance({ deadline: Date.now() + 20_000 })]);
  const skipped = [a, b].filter((x) => x?.skipped).length;
  ok(`two simultaneous runs: one works, one stands down (${skipped} skipped)`, skipped === 1, JSON.stringify([a?.skipped, b?.skipped]));
  const c = await runMaintenance({ deadline: Date.now() + 20_000 });
  ok('…and the lease is released afterwards', !c?.skipped, JSON.stringify(c?.skipped));
  const app = (await import('node:fs')).readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  ok('the cron call does not also start the traffic-triggered run',
    /!req\.path\.startsWith\('\/api\/cron\/'\)/.test(app)
    || (/NO_PIGGYBACK = \[[^\]]*'\/api\/cron\/'/.test(app) && /!NO_PIGGYBACK\.some\(\(p\) => req\.path\.startsWith\(p\)\)/.test(app)));
}

console.log('\n— One open hand task per item —');
{
  const p = await createProduct({ name: 'AF Hand', sku: `AF-H-${stamp}`, category: 'robux', price: 1000,
    currency: 'EUR', active: true, announce: false });
  const o = await createOrder({ consent: true, consentText: 'test', email: `af-h-${stamp}@test.local`, items: [{ productId: p.id, quantity: 1 }] });
  const item = await get(`SELECT id FROM order_items WHERE order_id=@o`, { o: o.id });
  const fs = await import('../src/services/fulfillmentService.js');
  const { ensureManualFulfillment } = fs;
  if (ensureManualFulfillment) {
    await transitionOrder(o.id, 'payment_received', { actorId: 'admin' }).catch(() => {});
    await Promise.all([1, 2, 3].map(() => ensureManualFulfillment(o.id, { actorId: 'system' }).catch(() => null)));
  }
  const open = await all(`SELECT 1 FROM fulfillment_requests WHERE order_item_id=@i AND mode='manual' AND status='pending'`, { i: item.id });
  ok(`three sweeps at once open at most one task (${open.length})`, open.length <= 1);
  const idx = await get(`SELECT 1 FROM pg_indexes WHERE indexname='uq_fulfillment_manual_open'`);
  ok('…enforced by a unique index', !!idx);
}

console.log('\n— Discord bot —');
{
  const bot = (await import('node:fs')).readFileSync(new URL('../../discord/src/bot.js', import.meta.url), 'utf8');
  ok('state that was never loaded is never written back to the store',
    /if \(!STATE_LOADED\.has\(key\)\) \{ console\.warn/.test(bot) && /STATE_UNAVAILABLE/.test(bot));
  const digest = bot.slice(bot.indexOf('function maybePostWeeklyDigest'), bot.indexOf('function maybePostWeeklyDigest') + 1500);
  ok('the weekly revenue digest goes to the owners, not a staff channel',
    !/staff-announcements|'leads'/.test(digest) && /OWNER_IDS/.test(digest));
}

console.log(`\n${fail ? '❌' : '✅'} audit-followups: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
