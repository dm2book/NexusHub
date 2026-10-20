/**
 * Reloadly — official gift cards, bought automatically for paid orders.
 *
 * The connector, end to end through the real fulfilment path, against a stub
 * of Reloadly's API (nothing leaves the machine):
 *   - one login token, reused until it is about to expire
 *   - sandbox by default; the live host only when it is switched off
 *   - SUCCESSFUL → the cards are delivered, once
 *   - PENDING → in progress with the transaction id; the sweep delivers later
 *   - our order item id is the customIdentifier (Reloadly's idempotency key)
 *   - a 4xx refusal fails over to the next supplier; a 5xx or a used
 *     identifier after the call went out is "may have been bought": a person
 *   - a sandbox connector on an open production shop refuses to "buy"
 *   - the keys and the sandbox switch live in Admin → Keys and connections
 *   - the launch check says so while a Reloadly supplier is in the sandbox
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_reloadly_connector';
process.env.NODE_ENV ||= 'development';
process.env.LAUNCH_MODE ||= 'open';
delete process.env.RELOADLY_CLIENT_ID;
delete process.env.RELOADLY_CLIENT_SECRET;
delete process.env.RELOADLY_SANDBOX;

import { existsSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n} ${x}`); } };

const connectorPath = new URL('../src/services/supplier/ReloadlyConnector.js', import.meta.url);
if (!existsSync(connectorPath)) {
  ok('a Reloadly connector exists (server/src/services/supplier/ReloadlyConnector.js)', false);
  console.log(`\n❌ reloadly-connector: ${pass} passed, ${fail} failed`);
  process.exit(1);
}

/* ── Reloadly, as far as our code can tell ─────────────────────────────── */
const calls = [];
let authCalls = 0;
let orderMode = 'successful';      // successful | pending | refuse | broken | duplicate
const cardsByTx = new Map();
const statusByTx = new Map();
let txSeq = 0;
const realFetch = globalThis.fetch;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = (init.method || 'GET').toUpperCase();
  if (u === 'https://auth.reloadly.com/oauth/token') {
    authCalls += 1;
    const b = JSON.parse(init.body || '{}');
    calls.push({ u, method, body: b });
    if (b.client_secret === 'wrong') return json({ message: 'invalid credentials' }, 401);
    return json({ access_token: `T-${authCalls}`, expires_in: 86400, token_type: 'Bearer' });
  }
  const m = /^https:\/\/(giftcards(?:-sandbox)?)\.reloadly\.com(\/.*)$/.exec(u);
  if (!m) return realFetch(url, init);
  const [, host, path] = m;
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ u, host, path, method, body, auth: init.headers?.Authorization });
  if (path === '/accounts/balance') return json({ balance: 500, currencyCode: 'EUR' });
  if (path.startsWith('/products?')) {
    return json({ content: [{
      productId: 15077, productName: 'Steam NL', brand: { brandName: 'Steam' }, country: { isoName: 'NL' },
      recipientCurrencyCode: 'EUR', senderCurrencyCode: 'EUR',
      fixedRecipientDenominations: [20, 25], fixedSenderDenominations: [20, 25],
      discountPercentage: 4, senderFee: 0.5,
    }, {
      productId: 999, productName: 'Unrelated Card', brand: { brandName: 'Other' },
      recipientCurrencyCode: 'EUR', senderCurrencyCode: 'EUR', fixedRecipientDenominations: [10], fixedSenderDenominations: [10],
    }] });
  }
  if (method === 'POST' && path === '/orders') {
    if (orderMode === 'refuse') return json({ message: 'Insufficient balance', errorCode: 'INSUFFICIENT_BALANCE' }, 400);
    if (orderMode === 'broken') return json({ message: 'Internal error' }, 502);
    if (orderMode === 'duplicate') return json({ message: 'customIdentifier already used', errorCode: 'DUPLICATE_CUSTOM_IDENTIFIER' }, 400);
    const tx = 9000 + (++txSeq);
    if (orderMode === 'successful') {
      cardsByTx.set(String(tx), [{ cardNumber: `STEAM-${tx}`, pinCode: '1234' }]);
      return json({ transactionId: tx, status: 'SUCCESSFUL', amount: 23.5 });
    }
    statusByTx.set(String(tx), 'PENDING');
    return json({ transactionId: tx, status: 'PENDING' });
  }
  const c = /^\/orders\/transactions\/(\d+)\/cards$/.exec(path);
  if (c) return json(cardsByTx.get(c[1]) || []);
  const t = /^\/reports\/transactions\/(\d+)$/.exec(path);
  if (t) return json({ transactionId: Number(t[1]), status: statusByTx.get(t[1]) || 'PENDING' });
  return json({ message: 'unexpected' }, 404);
};

const { ensureReady } = await import('../src/app.js');
await ensureReady();
await (await import('../src/services/bootUpkeep.js')).claimInterval('maintenance_auto', 3_600_000);
const { run, get, all, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { config } = await import('../src/config/env.js');
const { SupplierConnector } = await import('../src/services/supplier/SupplierConnector.js');
const { registerConnector, createConnector, availableKinds } = await import('../src/services/supplier/registry.js');
const { createSupplier, mapSupplierProduct } = await import('../src/services/supplier/supplierService.js');
const { ReloadlyConnector, parseSku, clearReloadlyTokens } = await import('../src/services/supplier/ReloadlyConnector.js');
const { createProduct } = await import('../src/services/productService.js');
const { createOrder } = await import('../src/services/orderService.js');
const fulfil = await import('../src/services/fulfillmentService.js');
const secrets = await import('../src/services/secretStore.js');
const { launchChecks } = await import('../src/services/launchCheckService.js');

const stamp = Date.now().toString(36);
const consent = { consent: true, consentText: 'Ik wil mijn bestelling meteen geleverd krijgen.' };
const creds = { clientId: 'cid-test', clientSecret: 'secret-test-123456' };

console.log('— The connector on its own —');
{
  ok('"reloadly" is a registered connector kind', availableKinds().includes('reloadly'));
  ok('the SKU is "<productId>:<amount>"', JSON.stringify(parseSku('15077:25')) === '{"productId":15077,"amount":25}' && parseSku('15077') === null);

  clearReloadlyTokens();
  const c = new ReloadlyConnector({ config: { ...creds } });
  ok('sandbox by default (nothing said otherwise)', c.sandbox === true);
  const before = authCalls;
  const t1 = await c.testConnection();
  const t2 = await c.testConnection();
  ok('it connects and says it is the SANDBOX, with the balance', t1.ok && /SANDBOX/.test(t1.detail) && /500/.test(t1.detail), t1.detail);
  ok('one login token, reused for the next request', authCalls - before === 1 && t2.ok, `auth calls ${authCalls - before}`);
  const sandboxCalls = calls.filter((x) => x.path === '/accounts/balance');
  ok('…sent to the sandbox host with the sandbox audience', sandboxCalls.every((x) => x.host === 'giftcards-sandbox')
    && calls.find((x) => x.u?.includes('oauth'))?.body.audience === 'https://giftcards-sandbox.reloadly.com');

  const live = new ReloadlyConnector({ config: { ...creds, sandbox: false } });
  await live.testConnection();
  ok('sandbox:false uses the live host and the live audience', calls.at(-1).host === 'giftcards'
    && calls.filter((x) => x.u?.includes('oauth')).at(-1).body.audience === 'https://giftcards.reloadly.com');

  const results = await c.searchCatalog('Steam');
  ok('search lists each denomination as its own SKU, unrelated cards left out',
    results.map((r) => r.supplierSku).join(',') === '15077:20,15077:25', JSON.stringify(results.map((r) => r.supplierSku)));
  ok('…with the cost in cents: amount − 4% discount + €0.50 fee', results.find((r) => r.supplierSku === '15077:25')?.cost === 2450,
    String(results.find((r) => r.supplierSku === '15077:25')?.cost));

  const bad = new ReloadlyConnector({ config: { clientId: 'cid-x', clientSecret: 'wrong' } });
  const tb = await bad.testConnection();
  ok('wrong credentials: a clear failure, no crash', !tb.ok && /Reloadly login/.test(tb.detail), tb.detail);
}

/* ── Through the real fulfilment path ───────────────────────────────────── */
const bought = { backup: [] };
class BackupSupplier extends SupplierConnector {
  static kind = `rl_backup_${stamp}`;
  get supportsFulfillment() { return true; }
  async createFulfillment(req) {
    bought.backup.push(req.orderNumber);
    return { status: 'fulfilled', externalRef: `BK-${req.orderNumber}`, deliveries: [{ type: 'code', content: `BACKUP-${req.orderNumber}` }] };
  }
}
registerConnector(BackupSupplier);
const reloadly = await createSupplier({ name: `Reloadly ${stamp}`, connectorKind: 'reloadly', config: { ...creds } });
/* A fresh Reloadly row per failure scenario: a supplier that just failed is
   (rightly) routed around for a while, which would hide the next scenario. */
const freshReloadly = (tag) => createSupplier({ name: `Reloadly ${tag} ${stamp}`, connectorKind: 'reloadly', config: { ...creds } });
const backup = await createSupplier({ name: `Backup ${stamp}`, connectorKind: BackupSupplier.kind, config: {} });

let n = 0;
async function paidOrderFor(sku, { withBackup = false, supplier = reloadly } = {}) {
  // Sold well above the card's cost, so both suppliers clear the margin guard.
  const p = await createProduct({ name: `Steam €25 ${stamp}-${++n}`, sku: `RL-${stamp}-${n}`, category: 'steam',
    price: 4000, currency: 'EUR', active: true, announce: false });
  await mapSupplierProduct({ supplierId: supplier.id, productId: p.id, supplierSku: sku, cost: 2450, priority: 1 });
  if (withBackup) await mapSupplierProduct({ supplierId: backup.id, productId: p.id, supplierSku: 'BK-1', cost: 2400, priority: 2 });
  const o = await createOrder({ ...consent, email: `rl-${stamp}-${n}@example.test`, items: [{ productId: p.id, quantity: 1 }] });
  await run(`UPDATE orders SET status='payment_received', payment_status='paid', updated_at=@at WHERE id=@id`, { id: o.id, at: nowIso() });
  return o;
}
const deliveriesOf = (id) => all(`SELECT content FROM deliveries WHERE order_id=@o`, { o: id });
const requestsOf = (id) => all(`SELECT * FROM fulfillment_requests WHERE order_id=@o ORDER BY created_at`, { o: id });
const orderPosts = () => calls.filter((x) => x.method === 'POST' && x.path === '/orders');

console.log('\n— SUCCESSFUL: the card is delivered, once —');
{
  orderMode = 'successful';
  const o = await paidOrderFor('15077:25');
  const before = orderPosts().length;
  await fulfil.fulfillOrder(o.id, { actorId: 'system' });
  const posts = orderPosts().slice(before);
  const item = await get(`SELECT id FROM order_items WHERE order_id=@o`, { o: o.id });
  ok('one order placed at Reloadly', posts.length === 1, String(posts.length));
  ok('…for product 15077, €25, quantity 1, from the sandbox', posts[0]?.body.productId === 15077 && posts[0]?.body.unitPrice === 25
    && posts[0]?.body.quantity === 1 && posts[0]?.host === 'giftcards-sandbox', JSON.stringify(posts[0]?.body));
  ok('…with our order item id as customIdentifier (Reloadly refuses a second order with it)',
    posts[0]?.body.customIdentifier === `fm-${item.id}`, posts[0]?.body.customIdentifier);
  const d = await deliveriesOf(o.id);
  ok('the card and its PIN are delivered', d.length === 1 && /^STEAM-\d+ · PIN 1234$/.test(d[0].content), JSON.stringify(d));
  await fulfil.fulfillOrder(o.id, { actorId: 'system' }).catch(() => null);
  ok('fulfilling again buys nothing more and delivers nothing twice',
    orderPosts().length === before + 1 && (await deliveriesOf(o.id)).length === 1);
}

console.log('\n— PENDING: in progress with the transaction id, delivered by the sweep —');
{
  orderMode = 'pending';
  const o = await paidOrderFor('15077:20');
  await fulfil.fulfillOrder(o.id, { actorId: 'system' });
  const [r] = (await requestsOf(o.id)).filter((x) => x.mode === 'auto');
  ok('the request waits, with Reloadly\'s transaction id to ask about', r?.status === 'in_progress' && /^9\d{3}$/.test(String(r?.external_ref)),
    `${r?.status} ${r?.external_ref}`);
  ok('…and nothing is delivered yet', (await deliveriesOf(o.id)).length === 0);
  cardsByTx.set(String(r.external_ref), [{ cardNumber: 'LATE-CARD-1' }]);
  await fulfil.retryPendingFulfillments({ limit: 50 });
  const d = await deliveriesOf(o.id);
  ok('once Reloadly has the card, the sweep delivers it', d.length === 1 && d[0].content === 'LATE-CARD-1', JSON.stringify(d));
}

console.log('\n— A clear "no" fails over; "may have been bought" goes to a person —');
{
  orderMode = 'refuse';
  const o = await paidOrderFor('15077:25', { withBackup: true, supplier: await freshReloadly('refuse') });
  bought.backup.length = 0;
  await fulfil.fulfillOrder(o.id, { actorId: 'system' });
  ok('Reloadly refusing with a 4xx (no balance): the next supplier delivers', bought.backup.length === 1
    && (await deliveriesOf(o.id)).some((d) => d.content.startsWith('BACKUP-')), JSON.stringify(bought.backup));

  orderMode = 'broken';
  const o2 = await paidOrderFor('15077:25', { withBackup: true, supplier: await freshReloadly('broken') });
  bought.backup.length = 0;
  await fulfil.fulfillOrder(o2.id, { actorId: 'system' }).catch(() => null);
  const r2 = await requestsOf(o2.id);
  ok('a 5xx after the order went out: never bought again elsewhere', bought.backup.length === 0, JSON.stringify(bought.backup));
  ok('…recorded as "may have been bought" and handed to a person',
    r2.some((x) => /"outcome":"unknown"/.test(String(x.result || ''))) && r2.some((x) => x.mode === 'manual'),
    JSON.stringify(r2.map((x) => [x.mode, x.status])));

  orderMode = 'duplicate';
  const o3 = await paidOrderFor('15077:25', { withBackup: true, supplier: await freshReloadly('duplicate') });
  bought.backup.length = 0;
  await fulfil.fulfillOrder(o3.id, { actorId: 'system' }).catch(() => null);
  const r3 = await requestsOf(o3.id);
  ok('Reloadly saying the identifier is used: an order exists there — a person checks, no second buy',
    bought.backup.length === 0 && r3.some((x) => /"outcome":"unknown"/.test(String(x.result || ''))),
    JSON.stringify(r3.map((x) => [x.mode, x.status, x.result])));
}

console.log('\n— Sandbox on an open production shop —');
{
  orderMode = 'successful';
  const wasProd = config.isProd;
  const wasDate = config.launch.date;
  config.isProd = true;
  config.launch.date = '2026-01-01T00:00:00Z';
  const o = await paidOrderFor('15077:25', { withBackup: true, supplier: await freshReloadly('sandbox') });
  const before = orderPosts().length;
  bought.backup.length = 0;
  await fulfil.fulfillOrder(o.id, { actorId: 'system' }).catch(() => null);
  config.isProd = wasProd;
  config.launch.date = wasDate;
  ok('a sandbox Reloadly sends no order once the shop is open', orderPosts().length === before, String(orderPosts().length - before));
  ok('…and the item goes to the next supplier instead of getting a fake card', bought.backup.length === 1
    && !(await deliveriesOf(o.id)).some((d) => d.content.startsWith('STEAM-')));
}

console.log('\n— The keys and the switch in Admin → Keys and connections —');
{
  await secrets.setSecret('reloadly.clientId', 'cid-from-admin');
  await secrets.setSecret('reloadly.clientSecret', 'secret-from-admin-123');
  const shared = createConnector({ connector_kind: 'reloadly', config: {} });
  ok('a supplier row with an empty config uses the keys from the admin', shared.supportsFulfillment
    && config.suppliers.reloadly.clientId === 'cid-from-admin');
  ok('…and is in the sandbox while the switch is empty', shared.sandbox === true);
  await secrets.setSecret('reloadly.sandbox', 'false');
  ok('switching the sandbox off in the admin moves it to live', createConnector({ connector_kind: 'reloadly', config: {} }).sandbox === false);
  let refused = null;
  try { await secrets.setSecret('reloadly.sandbox', 'maybe'); } catch (e) { refused = e; }
  ok('a switch value that is not true/false is refused', !!refused && /true or false/i.test(refused.message), refused?.message);
  await secrets.setSecret('reloadly.sandbox', '');
  ok('clearing it goes back to the sandbox', createConnector({ connector_kind: 'reloadly', config: {} }).sandbox === true);
}

console.log('\n— The launch check —');
{
  const { checks } = await launchChecks();
  const c = checks.find((x) => x.id === 'supplier-sandbox');
  ok('a Reloadly supplier in the sandbox is named in the launch check', !!c && /SANDBOX/.test(c.detail) && ['warn', 'fail'].includes(c.status),
    JSON.stringify(c));
}

console.log(`\n${fail ? '❌' : '✅'} reloadly-connector: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
