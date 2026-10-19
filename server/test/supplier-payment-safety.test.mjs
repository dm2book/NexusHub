/**
 * The money path, after the server audit: supplier purchases and Pay. payments
 * that could buy twice, deliver without payment, or get stuck with nobody told.
 *
 *   #1  An error AFTER the supplier answered (writing its answer down) is not a
 *       supplier refusal: no failover, no second purchase — a person, with the
 *       supplier's reference.
 *   #2  Eldorado's HTTP errors carry their status, so a 5xx is read as "may have
 *       been bought" like Kinguin's and G2A's.
 *   #3  An account top-up, or a product set to hand delivery, is never bought
 *       from a supplier — it goes to a person.
 *   #4  A purchase "in progress" without a reference, or still not delivered
 *       after two hours, goes to a person; a failing status check moves to the
 *       back of the poll line.
 *   #5  Under Pay. a screenshot can neither be submitted nor mark an order paid,
 *       and does not keep an unpaid order from being cancelled after 14 days.
 *   #7  A Pay. payment the order could not take (moved by a cancel in the same
 *       moment) is reported as stray money, not as settled.
 *   #8  Unpaid orders placed in someone else's name do not use up THEIR limits.
 *   #9  Pay. timing out or answering unusably is a clear 502, not a 500.
 *   #10 The Pay. callback says FALSE (retry) when the keys are momentarily
 *       unreadable; a failed key read never resets admin-saved keys.
 *   #11 Marking an order paid needs the refund permission, not orders.update.
 *   #12 A refund that closes a purchase while its status is being polled wins:
 *       no codes are written onto the refunded order.
 *
 * Supplier connectors are registered in-process; Pay.'s server is a fetch stub.
 * Nothing leaves the machine.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_supplier_payment_safety';
process.env.NODE_ENV ||= 'development';
process.env.LAUNCH_MODE ||= 'open';
process.env.LIMIT_CHECKOUT_PER_MINUTE = '10000';
process.env.PAYNL_SERVICE_ID = 'SL-1234-5678';
process.env.PAYNL_SERVICE_SECRET = 'a'.repeat(40);
process.env.PAYNL_TEST_MODE = 'true';
process.env.APP_URL = 'http://localhost:3000';
delete process.env.MOLLIE_API_KEY;
delete process.env.STRIPE_SECRET_KEY;

import net from 'node:net';
const sink = net.createServer((sock) => {
  let buf = '', inData = false;
  sock.write('220 sink ESMTP\r\n');
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    for (;;) {
      const i = buf.indexOf('\r\n');
      if (i < 0) break;
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

/* Pay. and Eldorado, as far as our code can tell. */
const payOrders = new Map();
let payMode = 'ok';                 // 'ok' | 'network' | 'unusable'
let eldoradoStatus = 200;
const realFetch = globalThis.fetch;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.eldorado.gg/')) {
    return eldoradoStatus === 200 ? json({ id: 'E-1', status: 'processing' }) : json({ message: 'upstream broke' }, eldoradoStatus);
  }
  if (!u.startsWith('https://connect.pay.nl/')) return realFetch(url, init);
  if ((init.method || 'GET') === 'POST' && /\/v1\/orders$/.test(u)) {
    if (payMode === 'network') throw new TypeError('fetch failed');
    if (payMode === 'unusable') return json({}, 201);
    const b = JSON.parse(init.body);
    const id = `${Math.random().toString(16).slice(2, 10)}-aaaa-bbbb-cccc-${Date.now().toString(16)}`;
    const o = { id, orderId: `51${Math.floor(Math.random() * 1e9)}X`, serviceId: b.serviceId, reference: b.reference,
      description: b.description, amount: b.amount, status: { code: 20, action: 'PENDING' },
      integration: { test: !!b.integration?.test }, payments: [{ paymentMethod: { id: b.paymentMethod?.id ?? null } }],
      links: { redirect: `https://checkout.pay.nl/test/${id}`, status: `https://connect.pay.nl/v1/orders/${id}/status` } };
    payOrders.set(id, o);
    return json(o, 201);
  }
  const m = u.match(/\/v1\/orders\/([A-Za-z0-9-]+)\/status$/);
  if (m) { const o = payOrders.get(m[1]); return o ? json(o) : json({ message: 'Order not found' }, 404); }
  return json({ message: 'unexpected' }, 404);
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
await (await import('../src/services/bootUpkeep.js')).claimInterval('maintenance_auto', 3_600_000);
const { run, get, all, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { config } = await import('../src/config/env.js');
const { SupplierConnector } = await import('../src/services/supplier/SupplierConnector.js');
const { registerConnector } = await import('../src/services/supplier/registry.js');
const { createSupplier, mapSupplierProduct } = await import('../src/services/supplier/supplierService.js');
const { EldoradoConnector } = await import('../src/services/supplier/EldoradoConnector.js');
const { createProduct } = await import('../src/services/productService.js');
const { createOrder } = await import('../src/services/orderService.js');
const fulfil = await import('../src/services/fulfillmentService.js');
const { confirmProof } = await import('../src/services/paymentProofService.js');
const secrets = await import('../src/services/secretStore.js');
const { applyPaynl } = await import('../src/routes/paynl.js');
const { finalizeLogin } = await import('../src/services/authService.js');
const { runMaintenance } = await import('../src/services/maintenanceService.js');

const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n} ${x}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms) => {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v || Date.now() > until) return v;
    await sleep(60);
  }
};
const parse = (s) => { try { return JSON.parse(s || 'null'); } catch { return null; } };
const stamp = Date.now().toString(36);
const consent = { consent: true, consentText: 'Ik wil mijn bestelling meteen geleverd krijgen.' };
let n = 0;
const newUser = async (role = null) => {
  const id = newId('usr');
  const email = `sps-${stamp}-${++n}@example.test`;
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'S', @at, @at)`,
    { id, e: email, at: nowIso() });
  if (role) await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, @r, @at) ON CONFLICT DO NOTHING`, { u: id, r: role, at: nowIso() });
  return { id, email };
};
const buy = (user, productId, extra = {}, ctx = {}) => createOrder({ ...consent, email: user.email, userId: user.id,
  items: [{ productId, quantity: 1 }], ...extra }, ctx);
const paidQuietly = (orderId) => run(
  `UPDATE orders SET status='payment_received', payment_status='paid', updated_at=@at WHERE id=@id`, { id: orderId, at: nowIso() });
const requestsOf = (orderId) => all(`SELECT * FROM fulfillment_requests WHERE order_id=@o ORDER BY created_at`, { o: orderId });
const manualOf = async (orderId) => (await requestsOf(orderId)).filter((r) => r.mode === 'manual');
const statusOf = async (orderId) => (await get(`SELECT status FROM orders WHERE id=@id`, { id: orderId }))?.status;
const deliveriesOf = (orderId) => all(`SELECT content FROM deliveries WHERE order_id=@o`, { o: orderId });

/* Suppliers, in process. Each records what it was asked to buy. */
const bought = { boom: [], backup: [], noRef: [], poll: [] };
class BoomSupplier extends SupplierConnector {
  static kind = `sps_boom_${stamp}`;
  get supportsFulfillment() { return true; }
  async createFulfillment(req) {
    bought.boom.push(req.orderNumber);
    // Bought and paid at the supplier — and its code is one our database refuses to store.
    return { status: 'fulfilled', externalRef: `B-${req.orderNumber}`, deliveries: [{ type: 'code', content: `BOOM-${req.orderNumber}` }] };
  }
}
class BackupSupplier extends SupplierConnector {
  static kind = `sps_backup_${stamp}`;
  get supportsFulfillment() { return true; }
  async createFulfillment(req) {
    bought.backup.push(req.orderNumber);
    return { status: 'fulfilled', externalRef: `K-${req.orderNumber}`, deliveries: [{ type: 'code', content: `BACKUP-${req.orderNumber}` }] };
  }
}
class NoRefSupplier extends SupplierConnector {
  static kind = `sps_noref_${stamp}`;
  get supportsFulfillment() { return true; }
  async createFulfillment(req) { bought.noRef.push(req.orderNumber); return { status: 'in_progress', externalRef: null, deliveries: [] }; }
}
let onPoll = async () => ({ status: 'in_progress', externalRef: 'P-1', deliveries: [] });
class PollSupplier extends SupplierConnector {
  static kind = `sps_poll_${stamp}`;
  get supportsFulfillment() { return true; }
  async createFulfillment(req) { bought.poll.push(req.orderNumber); return { status: 'in_progress', externalRef: `P-${req.orderNumber}`, deliveries: [] }; }
  async checkFulfillment(ref) { return onPoll(ref); }
}
for (const C of [BoomSupplier, BackupSupplier, NoRefSupplier, PollSupplier]) registerConnector(C);
const boomSup = await createSupplier({ name: `Boom ${stamp}`, connectorKind: BoomSupplier.kind, config: {} });
const backupSup = await createSupplier({ name: `Backup ${stamp}`, connectorKind: BackupSupplier.kind, config: {} });
const noRefSup = await createSupplier({ name: `NoRef ${stamp}`, connectorKind: NoRefSupplier.kind, config: {} });
const pollSup = await createSupplier({ name: `Poll ${stamp}`, connectorKind: PollSupplier.kind, config: {} });

/* ── #10 first: before anything re-reads the stored keys behind our back. ── */
console.log('— #10 The Pay. callback when the keys are momentarily unreadable —');
{
  await secrets.refreshStoredSecrets({ maxAgeMs: 0 });
  const saved = { ...config.payments.paynl };
  config.payments.paynl.serviceId = '';
  const r = await realFetch(`${base}/api/payments/paynl/exchange`, { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'action=new_ppt&order_id=abc' });
  const text = await r.text();
  ok('"not configured" is answered FALSE with a 503, so Pay. retries the callback',
    r.status === 503 && text.startsWith('FALSE|'), `${r.status} ${text}`);
  Object.assign(config.payments.paynl, saved);

  // A key saved in the admin (different from the environment's) survives a failed read.
  config.payments.paynl.serviceId = 'SL-9999-0000';
  await run('ALTER TABLE app_secrets RENAME TO app_secrets_away');
  let threw = false;
  try { await secrets.applyStoredSecrets(); } catch { threw = true; }
  const afterApply = config.payments.paynl.serviceId;
  await secrets.refreshStoredSecrets({ maxAgeMs: 0 });
  const afterRefresh = config.payments.paynl.serviceId;
  await run('ALTER TABLE app_secrets_away RENAME TO app_secrets');
  ok('a failed read of the stored keys leaves the live keys as they were', afterApply === 'SL-9999-0000' && afterRefresh === 'SL-9999-0000',
    `after apply=${afterApply} after refresh=${afterRefresh} threw=${threw}`);
  Object.assign(config.payments.paynl, saved);
  await secrets.refreshStoredSecrets({ maxAgeMs: 0 });
}

console.log('\n— #1 An error after the supplier answered is not a supplier refusal —');
{
  // Our database refuses the code the supplier hands over (a stand-in for a timeout at launch load).
  await run(`CREATE OR REPLACE FUNCTION sps_refuse_boom() RETURNS trigger AS $$
             BEGIN IF NEW.content LIKE 'BOOM-%' THEN RAISE EXCEPTION 'timeout exceeded when trying to connect'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
  await run(`DROP TRIGGER IF EXISTS sps_refuse_boom ON deliveries`);
  await run(`CREATE TRIGGER sps_refuse_boom BEFORE INSERT ON deliveries FOR EACH ROW EXECUTE FUNCTION sps_refuse_boom()`);
  const p = await createProduct({ name: `Boom Card ${stamp}`, category: 'giftcard', price: 2000, announce: false });
  await mapSupplierProduct({ supplierId: boomSup.id, productId: p.id, supplierSku: 'BOOM-1', cost: 900, priority: 1 });
  await mapSupplierProduct({ supplierId: backupSup.id, productId: p.id, supplierSku: 'BACK-1', cost: 950, priority: 2 });
  const o = await buy(await newUser(), p.id);
  await paidQuietly(o.id);
  await fulfil.fulfillOrder(o.id, { actorId: 'system' }).catch(() => null);
  const reqs = await requestsOf(o.id);
  const auto = reqs.find((r) => r.mode === 'auto' && r.supplier_id === boomSup.id);
  ok('it is bought once — never again at the next supplier', bought.boom.length === 1 && bought.backup.length === 0,
    `boom=${bought.boom.length} backup=${bought.backup.length}`);
  ok('the request says the outcome is unknown and keeps the supplier\'s reference',
    auto?.status === 'failed' && parse(auto.result)?.outcome === 'unknown' && parse(auto.result)?.supplierRef === `B-${o.number}`,
    `${auto?.status} ${auto?.result}`);
  ok('…and the item waits for a person', (await manualOf(o.id)).length === 1, String((await manualOf(o.id)).length));
  await run(`DROP TRIGGER IF EXISTS sps_refuse_boom ON deliveries`);
}

console.log('\n— #2 Eldorado errors carry their HTTP status —');
{
  const c = new EldoradoConnector({ config: { apiKey: 'k' } });
  eldoradoStatus = 502;
  let err = null;
  try { await c.createFulfillment({ orderNumber: 'X', supplierSku: 'S', quantity: 1 }); } catch (e) { err = e; }
  ok('a 502 after the order went out is a 502 to the caller (read as "may have been bought")',
    Number(err?.status) === 502, `status=${err?.status} ${err?.message}`);
  eldoradoStatus = 200;
}

console.log('\n— #3 An account top-up and a hand-delivery product are never bought from a supplier —');
{
  const robux = await createProduct({ name: `Robux ${stamp}`, category: 'robux', price: 2000, announce: false });
  await mapSupplierProduct({ supplierId: backupSup.id, productId: robux.id, supplierSku: 'RBX-1', cost: 900, priority: 1 });
  const before = bought.backup.length;
  const user = await newUser();
  const o = await buy(user, robux.id, { billing: { deliveryMethod: 'account', deliveryDetails: 'Test_User1' } });
  await paidQuietly(o.id);
  await fulfil.drainSupplierQueue({ actorId: 'system' }, { budgetMs: 3_000 });
  await fulfil.ensureManualFulfillment(o.id, { actorId: 'system' });
  ok('a Robux top-up onto an account is not bought as a code', bought.backup.length === before, `${bought.backup.length - before} purchase(s)`);
  ok('…it goes to a person', (await manualOf(o.id)).length === 1, String((await manualOf(o.id)).length));

  const hand = await createProduct({ name: `Hand ${stamp}`, category: 'giftcard', price: 2000, announce: false,
    metadata: { deliveryMode: 'manual' } });
  await run(`UPDATE products SET metadata=@m WHERE id=@id`, { id: hand.id, m: JSON.stringify({ deliveryMode: 'manual' }) });
  await mapSupplierProduct({ supplierId: backupSup.id, productId: hand.id, supplierSku: 'HAND-1', cost: 900, priority: 1 });
  const o2 = await buy(await newUser(), hand.id);
  await paidQuietly(o2.id);
  const before2 = bought.backup.length;
  await fulfil.fulfillOrder(o2.id, { actorId: 'system' });
  ok('a product the owner set to hand delivery is not bought from a supplier, even by the Fulfil button',
    bought.backup.length === before2 && (await manualOf(o2.id)).length === 1,
    `${bought.backup.length - before2} purchase(s), ${(await manualOf(o2.id)).length} hand task(s)`);
}

console.log('\n— #4 Purchases nobody can follow up go to a person —');
{
  const p = await createProduct({ name: `NoRef ${stamp}`, category: 'giftcard', price: 2000, announce: false });
  await mapSupplierProduct({ supplierId: noRefSup.id, productId: p.id, supplierSku: 'NR-1', cost: 900, priority: 1 });
  const o = await buy(await newUser(), p.id);
  await paidQuietly(o.id);
  await fulfil.fulfillOrder(o.id, { actorId: 'system' });
  const auto = (await requestsOf(o.id)).find((r) => r.mode === 'auto');
  ok('"in progress" without a reference is recorded as unknown, not left in progress',
    auto?.status === 'failed' && parse(auto.result)?.outcome === 'unknown', `${auto?.status} ${auto?.result}`);
  ok('…and handed to a person straight away', (await manualOf(o.id)).length === 1);

  // Bought, accepted with a reference, and still not delivered after three hours.
  const p2 = await createProduct({ name: `Stale ${stamp}`, category: 'giftcard', price: 2000, announce: false });
  await mapSupplierProduct({ supplierId: pollSup.id, productId: p2.id, supplierSku: 'ST-1', cost: 900, priority: 1 });
  const o2 = await buy(await newUser(), p2.id);
  await paidQuietly(o2.id);
  await fulfil.fulfillOrder(o2.id, { actorId: 'system' });
  const old = new Date(Date.now() - 3 * 3600_000).toISOString();
  await run(`UPDATE fulfillment_requests SET created_at=@c WHERE order_id=@o AND mode='auto'`, { c: old, o: o2.id });
  await fulfil.sweepUnfulfilledPaidOrders();
  const stale = (await requestsOf(o2.id)).find((r) => r.mode === 'auto');
  ok('a purchase still in progress after two hours is closed as unknown…',
    stale?.status === 'failed' && parse(stale.result)?.outcome === 'unknown', `${stale?.status}`);
  ok('…and goes to a person', (await manualOf(o2.id)).length === 1);

  // A poll that fails moves the request to the back of the line.
  const p3 = await createProduct({ name: `Poll ${stamp}`, category: 'giftcard', price: 2000, announce: false });
  await mapSupplierProduct({ supplierId: pollSup.id, productId: p3.id, supplierSku: 'PL-1', cost: 900, priority: 1 });
  const o3 = await buy(await newUser(), p3.id);
  await paidQuietly(o3.id);
  await fulfil.fulfillOrder(o3.id, { actorId: 'system' });
  const longAgo = new Date(Date.now() - 50 * 60_000).toISOString();
  await run(`UPDATE fulfillment_requests SET updated_at=@u WHERE order_id=@o AND mode='auto'`, { u: longAgo, o: o3.id });
  onPoll = async () => { throw new Error('status endpoint down'); };
  await fulfil.retryPendingFulfillments({ limit: 50 });
  const polled = (await requestsOf(o3.id)).find((r) => r.mode === 'auto');
  ok('a failed status check moves the purchase to the back of the poll line',
    polled && polled.updated_at > longAgo, `${polled?.updated_at} vs ${longAgo}`);
  onPoll = async () => ({ status: 'in_progress', externalRef: 'P-1', deliveries: [] });
}

console.log('\n— #12 A refund closing a purchase mid-poll wins —');
{
  const p = await createProduct({ name: `Race ${stamp}`, category: 'giftcard', price: 2000, announce: false });
  await mapSupplierProduct({ supplierId: pollSup.id, productId: p.id, supplierSku: 'RC-1', cost: 900, priority: 1 });
  const o = await buy(await newUser(), p.id);
  await paidQuietly(o.id);
  await fulfil.fulfillOrder(o.id, { actorId: 'system' });
  const req = (await requestsOf(o.id)).find((r) => r.mode === 'auto');
  // The refund lands while the supplier is being asked: it cancels the request it finds in flight.
  onPoll = async () => {
    await run(`UPDATE fulfillment_requests SET status='cancelled' WHERE id=@id`, { id: req.id });
    await run(`UPDATE orders SET status='refunded' WHERE id=@id`, { id: o.id });
    return { status: 'fulfilled', externalRef: req.external_ref, deliveries: [{ type: 'code', content: `LATE-${o.number}` }] };
  };
  let err = null;
  try { await fulfil.refreshFulfillment(req.id, { actorId: 'system' }); } catch (e) { err = e; }
  const after = await get(`SELECT status FROM fulfillment_requests WHERE id=@id`, { id: req.id });
  ok('the purchase stays cancelled and no code is written onto the refunded order',
    after?.status === 'cancelled' && (await deliveriesOf(o.id)).length === 0,
    `${after?.status}, ${(await deliveriesOf(o.id)).length} delivery(ies), err=${err?.message}`);
  onPoll = async () => ({ status: 'fulfilled', externalRef: 'x', deliveries: [{ type: 'code', content: 'NEVER' }] });
  let refused = null;
  try { await fulfil.refreshFulfillment(req.id, { actorId: 'system' }); } catch (e) { refused = e; }
  ok('…and Refresh on it afterwards is refused', !!refused && (await deliveriesOf(o.id)).length === 0, refused?.message);
  onPoll = async () => ({ status: 'in_progress', externalRef: 'P-1', deliveries: [] });
}

// A plain product for the payment checks.
const card = await createProduct({ name: `Card ${stamp}`, category: 'giftcard', price: 1500, announce: false });
const place = async (email) => {
  const r = await realFetch(`${base}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, ...consent, items: [{ productId: card.id, quantity: 1 }] }) });
  return (await r.json()).order;
};
const startPay = async (order) => {
  const r = await realFetch(`${base}/api/orders/${order.id}/paynl`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: order.email, method: 'ideal' }) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

console.log('\n— #9 Pay. not answering, or answering unusably, is a 502 —');
for (const [mode, label] of [['network', 'a dropped connection'], ['unusable', 'an answer without an order id or link']]) {
  const o = await place(`pay9-${mode}-${stamp}@example.test`);
  payMode = mode;
  const r = await startPay(o);
  payMode = 'ok';
  ok(`${label}: 502 "nothing has been charged", not a 500`,
    r.status === 502 && r.body?.error?.code === 'payment_provider_refused', `${r.status} ${JSON.stringify(r.body)}`);
}

console.log('\n— #7 A payment the order could not take is stray money, not "settled" —');
{
  const o = await place(`pay7-${stamp}@example.test`);
  const s = await startPay(o);
  const payment = payOrders.get(s.body.paymentId);
  payment.status = { code: 100, action: 'PAID' };
  // The order is moved by a cancel in the very moment the payment is applied: its move to "paid" finds nothing to move.
  await run(`CREATE OR REPLACE FUNCTION sps_lose_race() RETURNS trigger AS $$
             BEGIN IF OLD.status = 'pending' AND NEW.status = 'payment_received' AND NEW.number = '${o.number}' THEN RETURN NULL; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
  await run(`DROP TRIGGER IF EXISTS sps_lose_race ON orders`);
  await run(`CREATE TRIGGER sps_lose_race BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION sps_lose_race()`);
  const res = await applyPaynl(o.id).catch((e) => ({ error: e.message }));
  await run(`DROP TRIGGER IF EXISTS sps_lose_race ON orders`);
  const stray = await get(`SELECT 1 AS x FROM audit_logs WHERE target_id=@id AND action='order.payment_stray'`, { id: o.id });
  ok('it is not reported as settled', !res?.settled, JSON.stringify(res));
  ok('…the owner is told there is money on an order that did not take it', !!stray);
}

console.log('\n— #5 Under Pay. a screenshot is not a payment —');
{
  const o = await place(`pay5-${stamp}@example.test`);
  const r = await realFetch(`${base}/api/orders/${o.id}/proof`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: o.email, transactionId: 'TX-FAKE-1' }) });
  ok('submitting proof for a Pay. order is refused (409)', r.status === 409, String(r.status));

  // A proof that got in anyway (submitted before the switch to Pay.).
  const proofId = newId('ppf');
  await run(`INSERT INTO payment_proofs (id, order_id, transaction_id, status, fraud_flags, created_at)
             VALUES (@id, @o, 'TX-FAKE-2', 'pending', '[]', @at)`, { id: proofId, o: o.id, at: nowIso() });
  let err = null;
  try { await confirmProof(proofId, { user: { id: 'admin' } }); } catch (e) { err = e; }
  ok('confirming it does not mark the order paid when Pay. has no payment',
    !!err && (await statusOf(o.id)) === 'pending', `${await statusOf(o.id)} ${err?.message}`);

  // …and it does not keep the unpaid order from being cancelled after 14 days.
  await run(`UPDATE orders SET created_at=@c WHERE id=@id`, { c: new Date(Date.now() - 15 * 86_400_000).toISOString(), id: o.id });
  await runMaintenance({ deadline: Date.now() + 25_000 });
  ok('a pending screenshot does not keep an unpaid Pay. order open forever', (await statusOf(o.id)) === 'cancelled',
    await statusOf(o.id));
}

console.log('\n— #8 Unpaid orders in someone else\'s name do not lock them out —');
{
  const saved = { ...config.security.orderLimits };
  config.security.orderLimits.perEmailPerDay = 2;
  const victim = await newUser();
  const attackerIp = '198.51.100.7';
  for (let i = 0; i < 2; i++) await buy(victim, card.id, {}, { ip: attackerIp });
  let err = null;
  try { await buy(victim, card.id, {}, { ip: '203.0.113.9' }); } catch (e) { err = e; }
  ok('the owner of the address can still order from their own connection', !err, err?.message);
  let again = null;
  try { await buy(victim, card.id, {}, { ip: attackerIp }); } catch (e) { again = e; }
  ok('…while unpaid orders from the same connection still count', !!again, 'third order from the same IP went through');
  Object.assign(config.security.orderLimits, saved);
}

console.log('\n— #11 Marking an order paid needs the refund permission —');
{
  const fm = await newUser('fulfillment_manager');
  const { accessToken } = await finalizeLogin(await get(`SELECT * FROM users WHERE id=@id`, { id: fm.id }), {});
  const call = async (path, body) => {
    const r = await realFetch(`${base}${path}`, { method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    return r.status;
  };
  const o = await place(`pay11-${stamp}@example.test`);
  const a = await call(`/api/admin/orders/${o.id}/payment-received`, { paymentRef: 'friend' });
  const b = await call(`/api/admin/orders/${o.id}/transition`, { to: 'payment_received' });
  const proofId = newId('ppf');
  await run(`INSERT INTO payment_proofs (id, order_id, transaction_id, status, fraud_flags, created_at)
             VALUES (@id, @o, 'TX-3', 'pending', '[]', @at)`, { id: proofId, o: o.id, at: nowIso() });
  const c = await call(`/api/admin/orders/payment/proofs/${proofId}/confirm`);
  ok('a fulfilment manager cannot mark an unpaid order paid (payment-received, transition, proof confirm)',
    a === 403 && b === 403 && c === 403 && (await statusOf(o.id)) === 'pending', `${a} ${b} ${c} ${await statusOf(o.id)}`);
}

srv.close();
sink.close();
console.log(`\n${fail ? '❌' : '✅'} supplier-payment-safety: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
