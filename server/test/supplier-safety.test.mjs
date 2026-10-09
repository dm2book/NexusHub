/**
 * Suppliers: inside the time, inside the internet, and once.
 *
 *   (a) A payment's supplier stage ran from the Stripe webhook with the queue's
 *       22-second budget, checked only between orders, while one purchase can
 *       take 15 s — production logged "Task timed out after 30 seconds". Now
 *       the payment drains for at most 8 s and the supplier call is cut off at
 *       that deadline. A purchase cut off has no answer: it may have gone
 *       through, so it is never bought again automatically — it goes to a
 *       person. What the payment did not reach is bought by the next sweep,
 *       and a payment and a sweep running at once never buy an order twice.
 *       Two holes on the way to "every paid order is delivered or with a
 *       person" are closed with it: a purchase a killed function left
 *       half-done, and an item every supplier refused, sat paid and
 *       undelivered where neither the queue nor the sweep would look.
 *   (b) A boxes-only order was queued for hand delivery beside its own box
 *       opening ("[autodispense] Cannot move order from completed to
 *       processing"). The opening is its delivery.
 *   (c) A supplier URL typed into the admin was fetched by the server as is:
 *       localhost, the private network and the cloud metadata service were
 *       one test-connection click away. Refused when saved and when fetched,
 *       written as an address, behind a name, or behind a redirect.
 *   (d) The catalogue sync was reported to call the supplier inside its
 *       transaction. Checked: it does not (no change).
 *
 * Supplier hosts are answered by a fetch stub and given public addresses by a
 * DNS stub, so nothing here leaves the machine; the shop's own code — webhook
 * path, queue, sweep, connectors, admin routes — runs for real.
 */
import './_selling-shop.mjs';   // must come first — see that file
import http from 'node:http';
import dnsPromises from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';
import pg from 'pg';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms) => {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v || Date.now() > until) return v;
    await sleep(50);
  }
};

// ── DNS: the test's supplier names resolve where the test says ─────────────
const realLookup = dnsPromises.lookup;
const fakeDns = new Map();
const looked = [];                  // every name the shop asked DNS for
dnsPromises.lookup = async (host, opts) => {
  looked.push(host);
  if (!fakeDns.has(host)) return realLookup(host, opts);
  const answer = { address: fakeDns.get(host), family: 4 };
  return opts?.all ? [answer] : answer;
};
syncBuiltinESMExports();
const PUBLIC_IP = '203.0.113.10';   // documentation range: public, and nobody's

// ── fetch: supplier hosts answered here, everything else as normal ──────────
const realFetch = globalThis.fetch;
const hosts = new Map();            // "host[:port]" → (url, init) => Response
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const answer = hosts.get(u.host);
  if (!answer) return realFetch(url, init);
  const res = await answer(u, init);
  /* What fetch itself does with redirect: 'follow' (the default) — a stub that
     answered a redirect without following it would hide what a real request
     does with one. */
  if ([301, 302, 303, 307, 308].includes(res.status) && init.redirect !== 'manual') {
    return globalThis.fetch(new URL(res.headers.get('location'), u).toString(), { ...init, method: 'GET', body: undefined });
  }
  return res;
};
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const supplierHost = (name, answer) => { fakeDns.set(name, PUBLIC_IP); hosts.set(name, answer); };

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { run, get, all, nowIso, tx } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { claimInterval } = await import('../src/services/bootUpkeep.js');
const { SupplierConnector } = await import('../src/services/supplier/SupplierConnector.js');
const { registerConnector, createConnector } = await import('../src/services/supplier/registry.js');
const { createSupplier, mapSupplierProduct, syncSupplier } = await import('../src/services/supplier/supplierService.js');
const { createProduct } = await import('../src/services/productService.js');
const { createOrder, markPaymentReceived } = await import('../src/services/orderService.js');
const fulfil = await import('../src/services/fulfillmentService.js');
const { runMaintenance } = await import('../src/services/maintenanceService.js');
const { finalizeLogin } = await import('../src/services/authService.js');
const { balanceOf } = await import('../src/services/walletService.js');

/* The self-scheduling maintenance rides on live traffic. Claimed for this run
   so it cannot start by itself in the middle of a check; the checks that want
   a sweep run one on purpose. */
await claimInterval('maintenance_auto', 3_600_000);

const stamp = Date.now().toString(36);
const consent = { consent: true, consentText: 'Ik wil mijn bestelling meteen geleverd krijgen.' };
let n = 0;
const newUser = async () => {
  const id = newId('usr');
  const email = `safety-${stamp}-${++n}@example.test`;
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'S', @at, @at)`,
    { id, e: email, at: nowIso() });
  return { id, email };
};
const buy = async (user, productId, quantity = 1) => createOrder({ ...consent, email: user.email, userId: user.id,
  items: [{ productId, quantity }] });
/** Paid without going through the payment path — the state a sweep finds. */
const paidQuietly = (orderId, minutesAgo = 0) => run(
  `UPDATE orders SET status='payment_received', payment_status='paid', updated_at=@at WHERE id=@id`,
  { id: orderId, at: new Date(Date.now() - minutesAgo * 60_000).toISOString() });
const requestsOf = (orderId) => all(`SELECT * FROM fulfillment_requests WHERE order_id=@o ORDER BY created_at`, { o: orderId });
const manualOf = async (orderId) => (await requestsOf(orderId)).filter((r) => r.mode === 'manual');
const inQueue = async (orderId) => (await fulfil.listManualQueue()).some((q) => q.order_id === orderId);
const statusOf = async (orderId) => (await get(`SELECT status FROM orders WHERE id=@id`, { id: orderId }))?.status;
const leaseFree = async () => !(await get(`SELECT 1 AS x FROM kv WHERE key='supplier_queue_lock'`));
const parse = (s) => { try { return JSON.parse(s || 'null'); } catch { return null; } };

// ── Suppliers the (a) checks buy from ─────────────────────────────────────────
/* A supplier whose buy endpoint never answers: the request hangs until it is
   cut off, and the stub notes when. Its catalogue answers at once, so nothing
   else that reads catalogues (the photo sweep) waits on it. */
const hang = [];
supplierHost('hang.supplier.test', (u, init) => {
  if (u.pathname === '/catalog') return json(200, []);
  return new Promise((_, reject) => {
    const call = { path: u.pathname, at: Date.now(), cutAt: null };
    hang.push(call);
    const cut = () => { call.cutAt = Date.now(); reject(init.signal.reason); };
    if (init.signal?.aborted) cut();
    else init.signal?.addEventListener('abort', cut, { once: true });
  });
});
/* A second supplier that answers at once — the one a failover would buy from. */
const quick = [];
supplierHost('quick.supplier.test', (u) => {
  if (u.pathname === '/catalog') return json(200, []);
  quick.push(u.pathname);
  return json(200, { status: 'fulfilled', id: `Q-${quick.length}`, codes: [`QUICK-${quick.length}`] });
});

/* A supplier that takes `slowMs` per purchase and, like a real connector,
   gives up at the deadline it is handed. Records every purchase by order. */
let slowMs = 1000;
const slowBuys = [];
class SlowSupplier extends SupplierConnector {
  static kind = `safety_slow_${stamp}`;
  get supportsFulfillment() { return true; }
  async createFulfillment(req) {
    slowBuys.push({ order: req.orderNumber, at: Date.now(), deadline: req.deadline || null });
    const left = req.deadline ? req.deadline - Date.now() : Infinity;
    await sleep(Math.max(0, Math.min(slowMs, left)));
    if (left < slowMs) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    return { status: 'fulfilled', externalRef: `S-${req.orderNumber}`,
      deliveries: [{ type: 'code', content: `SLOW-${req.orderNumber}` }] };
  }
}
registerConnector(SlowSupplier);
const boughtTimes = (orderNumber) => slowBuys.filter((b) => b.order === orderNumber).length;

console.log('— (a) A payment\'s supplier stage stays inside its own budget —');
const hangSup = await createSupplier({ name: `Hang ${stamp}`, connectorKind: 'api',
  config: { baseUrl: 'https://hang.supplier.test', endpoints: { catalog: '/catalog', fulfill: '/buy' } } });
const quickSup = await createSupplier({ name: `Quick ${stamp}`, connectorKind: 'api',
  config: { baseUrl: 'https://quick.supplier.test', endpoints: { catalog: '/catalog', fulfill: '/buy' } } });
const hangProduct = await createProduct({ name: `Hanging Card ${stamp}`, category: 'giftcard', price: 2000, announce: false });
await mapSupplierProduct({ supplierId: hangSup.id, productId: hangProduct.id, supplierSku: 'HANG-1', cost: 900, priority: 1 });
await mapSupplierProduct({ supplierId: quickSup.id, productId: hangProduct.id, supplierSku: 'QUICK-1', cost: 1000, priority: 2 });
const a1 = await buy(await newUser(), hangProduct.id);
{
  const t0 = Date.now();
  await markPaymentReceived(a1.id, `pi_safety_${stamp}`, { actorId: 'stripe', reason: 'Stripe webhook (test)' });
  // Long enough to see the old behaviour too: the connector's own 15 s timeout.
  await waitFor(async () => hang[0]?.cutAt, 17_000);
  const settled = await waitFor(async () => (await manualOf(a1.id)).length > 0 && Date.now(), 3_000);
  const call = hang[0];
  ok('the supplier is asked to buy it once', hang.length === 1, `${hang.length} call(s)`);
  ok('…and the call is cut off by the payment\'s 8 s budget, not by the connector\'s own 15 s',
    !!call?.cutAt && call.cutAt - call.at <= 8_500 && call.cutAt - t0 <= 9_000,
    call ? `cut after ${call.cutAt ? call.cutAt - call.at : '—'} ms` : 'never asked');
  ok('the whole supplier stage is over well inside the 30 s invocation (under 10 s)',
    !!settled && settled - t0 < 10_000, settled ? `${settled - t0} ms` : 'not settled');
  ok('a purchase without an answer is not tried at a second supplier (it may have gone through)',
    quick.length === 0, `${quick.length} purchase(s) at the second supplier`);
  ok('…it waits for a person, in the hand-delivery queue', await inQueue(a1.id), await statusOf(a1.id));
  const req = (await requestsOf(a1.id)).find((r) => r.mode === 'auto');
  ok('the request says nobody knows whether it was bought',
    req?.status === 'failed' && parse(req.result)?.outcome === 'unknown', `${req?.status} ${req?.result}`);
  const alert = await get(`SELECT lines FROM owner_alerts WHERE event='fulfillment.failed' AND title LIKE @t`, { t: `${a1.number}%` });
  ok('…and the owner is told to look at the supplier before buying it again',
    /check/i.test(alert?.lines || '') && /before buying it again/i.test(alert?.lines || ''), alert?.lines);
  await waitFor(leaseFree, 5_000);
}

console.log('\n— (a) …and the next sweep does not buy that one again —');
{
  await runMaintenance();
  ok('no second purchase at either supplier', hang.length === 1 && quick.length === 0, `${hang.length}/${quick.length}`);
  ok('still exactly one task for a person', (await manualOf(a1.id)).length === 1, `${(await manualOf(a1.id)).length}`);
}

console.log('\n— (a) What a payment did not reach, the next sweep buys — once each —');
const slowSup = await createSupplier({ name: `Slow ${stamp}`, connectorKind: SlowSupplier.kind, config: {} });
const slowProduct = await createProduct({ name: `Slow Robux ${stamp}`, category: 'robux', price: 2000, announce: false });
await mapSupplierProduct({ supplierId: slowSup.id, productId: slowProduct.id, supplierSku: 'SLOW-1', cost: 900, priority: 1 });
{
  slowMs = 1000;
  const user = await newUser();
  const orders = [];
  for (let i = 0; i < 5; i++) {
    const o = await buy(user, slowProduct.id);
    await run(`UPDATE orders SET created_at=@c WHERE id=@id`, { c: new Date(Date.now() - (50 - i) * 1000).toISOString(), id: o.id });
    await paidQuietly(o.id);
    orders.push(o);
  }
  /* A drain with the room a payment has left — 1.5 s here, so a 1 s purchase
     fits once. Before, the budget was only looked at between orders: the
     second purchase started at 1.1 s and ran on to 2.1 s. */
  const t0 = Date.now();
  const first = await fulfil.drainSupplierQueue({ actorId: 'stripe' }, { budgetMs: 1_500 });
  const took = Date.now() - t0;
  ok('a drain ends inside its budget, also when a purchase is slow', took <= 1_750, `${took} ms for a 1500 ms budget`);
  const untouched = [];
  for (const o of orders) if (!(await requestsOf(o.id)).length) untouched.push(o);
  ok('it buys what fits…', (first.processed || 0) >= 1 && untouched.length >= 1, JSON.stringify(first));
  ok('…and leaves the rest as it found them: no request, no failure, nothing for a person',
    untouched.length === orders.length - (first.processed || 0), `${untouched.length} untouched`);

  await runMaintenance();
  const done = [];
  for (const o of orders) if ((await statusOf(o.id)) === 'completed') done.push(o);
  ok('the next sweep buys and delivers every one the payment did not reach', done.length === orders.length,
    `${done.length}/${orders.length} completed`);
  ok('…each bought exactly once', orders.every((o) => boughtTimes(o.number) === 1),
    JSON.stringify(orders.map((o) => boughtTimes(o.number))));
  const manual = (await Promise.all(orders.map((o) => manualOf(o.id)))).flat();
  ok('…and none of them was handed to a person', manual.length === 0, `${manual.length}`);
}

console.log('\n— (a) A payment and a sweep at the same moment buy each order once —');
{
  slowMs = 300;
  const user = await newUser();
  const orders = [];
  for (let i = 0; i < 4; i++) orders.push(await buy(user, slowProduct.id));
  // Two of them were paid a moment ago and nothing picked them up yet; two are paid now.
  await paidQuietly(orders[0].id);
  await paidQuietly(orders[1].id);
  await Promise.all([
    markPaymentReceived(orders[2].id, `pi_o2_${stamp}`, { actorId: 'stripe' }),
    markPaymentReceived(orders[3].id, `pi_o3_${stamp}`, { actorId: 'stripe' }),
    sleep(20).then(() => runMaintenance()),
    sleep(40).then(() => fulfil.drainSupplierQueue({ actorId: 'system' }, { budgetMs: 8_000 })),
  ]);
  await waitFor(async () => {
    for (const o of orders) if ((await statusOf(o.id)) !== 'completed') return false;
    return true;
  }, 12_000);
  await waitFor(leaseFree, 5_000);
  ok('every order is delivered', (await Promise.all(orders.map((o) => statusOf(o.id)))).every((s) => s === 'completed'),
    JSON.stringify(await Promise.all(orders.map((o) => statusOf(o.id)))));
  ok('…each bought from the supplier exactly once', orders.every((o) => boughtTimes(o.number) === 1),
    JSON.stringify(orders.map((o) => boughtTimes(o.number))));
  const dels = await Promise.all(orders.map((o) => all(`SELECT id FROM deliveries WHERE order_id=@o`, { o: o.id })));
  ok('…with one code each', dels.every((d) => d.length === 1), JSON.stringify(dels.map((d) => d.length)));
  const manual = (await Promise.all(orders.map((o) => manualOf(o.id)))).flat();
  ok('…and no hand-delivery task beside a purchase in flight', manual.length === 0, `${manual.length}`);
}

console.log('\n— (a) A purchase a killed function left half-done reaches a person —');
{
  /* What the timeouts left in production: the request row written, the
     supplier called, the function killed before the answer was recorded. Paid,
     undelivered, and invisible — the sweep skips an order with a request, the
     queue skips it, and nothing re-polls a request that never got a result. */
  const user = await newUser();
  const stale = await buy(user, slowProduct.id);
  const fresh = await buy(user, slowProduct.id);
  const halfDone = async (o, minutesAgo) => {
    await paidQuietly(o.id);
    await run(`UPDATE orders SET status='awaiting_fulfillment' WHERE id=@id`, { id: o.id });
    const item = await get(`SELECT id FROM order_items WHERE order_id=@o`, { o: o.id });
    const at = new Date(Date.now() - minutesAgo * 60_000).toISOString();
    await run(`INSERT INTO fulfillment_requests (id, order_id, order_item_id, supplier_id, mode, status, payload, created_at, updated_at)
               VALUES (@id, @o, @i, @s, 'auto', 'requested', '{}', @at, @at)`,
      { id: newId('ful'), o: o.id, i: item.id, s: slowSup.id, at });
  };
  await halfDone(stale, 30);
  await halfDone(fresh, 0);
  const before = slowBuys.length;
  await fulfil.sweepUnfulfilledPaidOrders({ limit: 50 });
  const staleReq = (await requestsOf(stale.id)).find((r) => r.mode === 'auto');
  ok('the sweep hands the half-done purchase to a person', await inQueue(stale.id), await statusOf(stale.id));
  ok('…marked as an unknown outcome, not as "requested" forever',
    staleReq?.status === 'failed' && parse(staleReq.result)?.outcome === 'unknown', `${staleReq?.status} ${staleReq?.result}`);
  ok('…without buying it again', slowBuys.length === before && boughtTimes(stale.number) === 0);
  const freshReqs = await requestsOf(fresh.id);
  ok('a purchase still in flight is left alone',
    freshReqs.length === 1 && freshReqs[0].status === 'requested', JSON.stringify(freshReqs.map((r) => r.status)));
}

console.log('\n— (a) A delivery no supplier could make reaches a person —');
{
  /* A supplier that answers, with a refusal: a definite "no", so failover may
     try elsewhere — and when there is nowhere else, the item has to reach a
     person. It used to stay a failed row: the queue never takes an order that
     already has a request, and the hand-delivery net said "a supplier would
     still take it". Paid, undelivered, and nobody's. */
  class Refuses extends SupplierConnector {
    static kind = `safety_refuses_${stamp}`;
    get supportsFulfillment() { return true; }
    async createFulfillment() { throw new Error('503 Service Unavailable'); }
  }
  registerConnector(Refuses);
  const refuses = await createSupplier({ name: `Refuses ${stamp}`, connectorKind: Refuses.kind, config: {} });
  const refused = await createProduct({ name: `Refused Card ${stamp}`, category: 'giftcard', price: 2000, announce: false });
  await mapSupplierProduct({ supplierId: refuses.id, productId: refused.id, supplierSku: 'NO-1', cost: 900, priority: 1 });
  slowMs = 50;
  const user = await newUser();
  const alone = await buy(user, refused.id);
  await markPaymentReceived(alone.id, `pi_refused_${stamp}`, { actorId: 'stripe' });
  ok('the paid order waits for a person once its only supplier says no',
    !!(await waitFor(() => inQueue(alone.id), 6_000)), await statusOf(alone.id));
  await waitFor(leaseFree, 5_000);

  // Two items: one bought, one refused. The refused one still needs a person.
  const both = await createOrder({ ...consent, email: user.email, userId: user.id,
    items: [{ productId: slowProduct.id, quantity: 1 }, { productId: refused.id, quantity: 1 }] });
  await markPaymentReceived(both.id, `pi_both_${stamp}`, { actorId: 'stripe' });
  const waiting = (await waitFor(async () => { const m = await manualOf(both.id); return m.length ? m : null; }, 6_000)) || [];
  await waitFor(leaseFree, 5_000);
  const refusedItem = await get(`SELECT id FROM order_items WHERE order_id=@o AND product_id=@p`, { o: both.id, p: refused.id });
  ok('beside a delivered item, the refused item is queued for a person — that item only',
    waiting.length === 1 && waiting[0].order_item_id === refusedItem?.id && boughtTimes(both.number) === 1,
    JSON.stringify(waiting.map((r) => r.order_item_id)));
  if (waiting.length) {
    await fulfil.completeManualFulfillment(waiting[0].id, { deliveries: [{ type: 'code', content: 'BY-HAND' }] }, { actorId: user.id });
  }
  ok('…and once a person delivers it, the order completes', (await statusOf(both.id)) === 'completed', await statusOf(both.id));

  // What an older release left behind: only a failed request, the supplier still mapped.
  const old = await buy(user, slowProduct.id);
  await paidQuietly(old.id);
  await run(`UPDATE orders SET status='awaiting_fulfillment' WHERE id=@id`, { id: old.id });
  const oldItem = await get(`SELECT id FROM order_items WHERE order_id=@o`, { o: old.id });
  await run(`INSERT INTO fulfillment_requests (id, order_id, order_item_id, supplier_id, mode, status, payload, result, created_at, updated_at)
             VALUES (@id, @o, @i, @s, 'auto', 'failed', '{}', '{"error":"502"}', @at, @at)`,
    { id: newId('ful'), o: old.id, i: oldItem.id, s: slowSup.id, at: new Date(Date.now() - 3_600_000).toISOString() });
  await fulfil.sweepUnfulfilledPaidOrders({ limit: 50 });
  ok('an order left with only a failed request is swept to a person', await inQueue(old.id), await statusOf(old.id));
  ok('…not bought again', boughtTimes(old.number) === 0);
}

console.log('\n— (a) The connectors hold their call to the caller\'s deadline —');
{
  const cutWithin = async (connector) => {
    const t = Date.now();
    const call = connector.createFulfillment({ orderNumber: `FM-DL-${stamp}`, supplierSku: '1', quantity: 1, cost: 100,
      deadline: Date.now() + 400 });
    const r = await Promise.race([call.then(() => 'answered', (e) => e?.name || 'error'), sleep(2_500).then(() => 'still running')]);
    return { r, ms: Date.now() - t };
  };
  const base = { baseUrl: 'https://hang.supplier.test' };
  for (const [kind, config] of [
    ['api', { ...base, endpoints: { fulfill: '/buy' } }],
    ['kinguin', { ...base, apiKey: 'K', autoDeliver: true }],
    ['g2a', { ...base, apiHash: 'H', email: 'g2a@example.test', apiKey: 'S', autoDeliver: true }],
    ['eldorado', { ...base, apiKey: 'E', autoDeliver: true }],
  ]) {
    const { r, ms } = await cutWithin(createConnector({ id: `dl-${kind}`, name: kind, connector_kind: kind, config }));
    ok(`${kind}: a purchase is cut off at the deadline`, r === 'TimeoutError' && ms < 1_500, `${r} after ${ms} ms`);
  }
}

console.log('\n— (b) A boxes-only order is delivered by opening its boxes —');
const makeBox = async (credit) => {
  const p = await createProduct({ name: `Safety Box ${stamp}-${++n}`, category: 'mystery', kind: 'mystery', price: 4999, announce: false });
  if (credit) {
    await run(`INSERT INTO mystery_box_rewards (id, box_id, label, weight, credit_cents, created_at)
               VALUES (@id, @b, '€20 store credit', 1, @c, @at)`, { id: newId('mbr'), b: p.id, c: credit, at: nowIso() });
  }
  return p;
};
const box = await makeBox(2000);
{
  const user = await newUser();
  const o = await buy(user, box.id);
  await paidQuietly(o.id);
  const queued = await fulfil.ensureManualFulfillment(o.id, { actorId: 'system' });
  ok('a paid boxes-only order is not queued for a person', queued === false && (await manualOf(o.id)).length === 0,
    `${queued} / ${(await manualOf(o.id)).length} task(s)`);
  ok('…and is not moved along the hand-delivery path', (await statusOf(o.id)) === 'payment_received', await statusOf(o.id));
}
{
  const user = await newUser();
  const o = await buy(user, box.id);
  const errors = [];
  const realError = console.error;
  console.error = (...args) => { errors.push(args.join(' ')); realError(...args); };
  await markPaymentReceived(o.id, `pi_box_${stamp}`, { actorId: 'stripe', reason: 'Stripe webhook (test)' });
  const done = await waitFor(async () => (await statusOf(o.id)) === 'completed', 8_000);
  await sleep(1_500);   // the rest of the payment's background work
  console.error = realError;
  ok('paying for it opens the box and completes the order', !!done && (await balanceOf(user.id)) === 2000,
    `${await statusOf(o.id)} wallet ${await balanceOf(user.id)}`);
  ok('…with no hand-delivery task beside it', (await manualOf(o.id)).length === 0, `${(await manualOf(o.id)).length}`);
  const steps = await all(`SELECT to_status FROM order_status_history WHERE order_id=@o`, { o: o.id });
  ok('…never walked through processing / awaiting fulfilment',
    !steps.some((s) => ['processing', 'awaiting_fulfillment'].includes(s.to_status)), JSON.stringify(steps.map((s) => s.to_status)));
  ok('…and nothing tried to move the completed order back',
    !errors.some((e) => /Cannot move order from "completed"/.test(e)), errors.join(' | ').slice(0, 200));
}
{
  /* The opening never ran — the payment's background work died. The sweep
     retries the delivery that belongs to the order, as it does for stock. */
  const user = await newUser();
  const o = await buy(user, box.id);
  await paidQuietly(o.id, 10);
  await fulfil.sweepUnfulfilledPaidOrders({ limit: 50 });
  const pulls = await all(`SELECT id FROM mystery_pulls WHERE order_id=@o`, { o: o.id });
  ok('the sweep opens a box the payment never opened', pulls.length === 1 && (await balanceOf(user.id)) === 2000,
    `${pulls.length} pull(s), wallet ${await balanceOf(user.id)}`);
  ok('…completes the order, and queues nothing for a person',
    (await statusOf(o.id)) === 'completed' && (await manualOf(o.id)).length === 0,
    `${await statusOf(o.id)} / ${(await manualOf(o.id)).length}`);
  await fulfil.sweepUnfulfilledPaidOrders({ limit: 50 });
  ok('…and a second sweep opens nothing more', (await all(`SELECT id FROM mystery_pulls WHERE order_id=@o`, { o: o.id })).length === 1);
}
{
  // A box with no prizes cannot deliver itself: that order still needs a person.
  const empty = await makeBox(0);
  const user = await newUser();
  const o = await buy(user, empty.id);
  await paidQuietly(o.id);
  ok('a box that cannot pay out is still queued for a person', await fulfil.ensureManualFulfillment(o.id, { actorId: 'system' }) === true);
  // A box next to a code: the code still has to be delivered by somebody.
  const card = await createProduct({ name: `Safety Card ${stamp}`, category: 'giftcard', price: 1500, announce: false });
  const mixed = await createOrder({ ...consent, email: user.email, userId: user.id,
    items: [{ productId: box.id, quantity: 1 }, { productId: card.id, quantity: 1 }] });
  await paidQuietly(mixed.id);
  ok('a box next to a code is still queued for a person', await fulfil.ensureManualFulfillment(mixed.id, { actorId: 'system' }) === true);
}

console.log('\n— (c) A supplier URL never reaches inside —');
/* Something worth stealing on localhost: every request that reaches it is a
   request the guard let through. */
const victimHits = [];
const victim = http.createServer((req, res) => { victimHits.push(req.url); res.setHeader('content-type', 'application/json'); res.end('[]'); });
await new Promise((r) => victim.listen(0, '127.0.0.1', r));
const vport = victim.address().port;
const VICTIM = `http://127.0.0.1:${vport}`;
const owner = newId('usr');
await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'O', @at, @at)`,
  { id: owner, e: `owner-${stamp}@example.test`, at: nowIso() });
await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, 'owner', @at) ON CONFLICT DO NOTHING`, { u: owner, at: nowIso() });
const { accessToken } = await finalizeLogin(await get(`SELECT * FROM users WHERE id=@id`, { id: owner }), {});
const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const call = async (method, path, body) => {
  const r = await realFetch(`${base}${path}`, { method,
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
/** A supplier row as an older release could have saved it — straight into the table, past any check. */
const savedEarlier = async (kind, config) => {
  const id = newId('sup');
  await run(`INSERT INTO suppliers (id, name, connector_kind, status, config, created_at, updated_at)
             VALUES (@id, @n, @k, 'paused', @c, @at, @at)`,
    { id, n: `Old ${kind} ${stamp}`, k: kind, c: JSON.stringify(config), at: nowIso() });
  return id;
};
fakeDns.set('inside.supplier.test', '10.0.0.5');
hosts.set(`inside.supplier.test:${vport}`, (u, init) => realFetch(`${VICTIM}${u.pathname}`, init));
supplierHost('bounce.supplier.test', () => new Response(null, { status: 302, headers: { location: `${VICTIM}/steal` } }));
{
  console.log('  when it is saved:');
  const refused = async (label, connectorKind, config) => {
    const r = await call('POST', '/api/admin/suppliers', { name: `Bad ${label} ${stamp}`, connectorKind, config });
    ok(`${label} is refused`, r.status === 400, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  };
  await refused('localhost by address', 'api', { baseUrl: VICTIM });
  await refused('localhost by name', 'api', { baseUrl: 'http://localhost:5432' });
  await refused('the cloud metadata service', 'api', { baseUrl: 'http://169.254.169.254/latest/meta-data/' });
  await refused('the metadata service written as IPv6', 'api', { baseUrl: 'http://[::ffff:a9fe:a9fe]/latest/' });
  await refused('a name that resolves to the private network', 'api', { baseUrl: 'https://inside.supplier.test' });
  await refused('a CSV feed on the private network', 'csv', { source: { type: 'url', url: 'http://192.168.1.10/feed.csv' } });
  await refused('an absolute endpoint on the private network', 'api',
    { baseUrl: 'https://quick.supplier.test', endpoints: { fulfill: 'http://10.1.2.3/buy' } });
  await refused('a Kinguin base URL moved inside', 'kinguin', { apiKey: 'K', baseUrl: 'http://10.0.0.7/api' });

  const good = await call('POST', '/api/admin/suppliers', { name: `Good ${stamp}`, connectorKind: 'api',
    config: { baseUrl: 'https://quick.supplier.test', apiKey: 'sk_live_safety_9876', endpoints: { catalog: '/catalog' } } });
  ok('a public supplier is saved', good.status === 201, `${good.status} ${JSON.stringify(good.body).slice(0, 160)}`);
  ok('…with its key masked in the answer', good.body.supplier?.config?.apiKey === '••••••9876', good.body.supplier?.config?.apiKey);
  const id = good.body.supplier?.id;
  const moved = await call('PATCH', `/api/admin/suppliers/${id}`, { config: { ...good.body.supplier?.config, baseUrl: 'http://10.0.0.9' } });
  const kept = parse((await get(`SELECT config FROM suppliers WHERE id=@id`, { id }))?.config);
  ok('moving it inside later is refused too', moved.status === 400 && kept?.baseUrl === 'https://quick.supplier.test',
    `${moved.status} ${kept?.baseUrl}`);
  const renamed = await call('PATCH', `/api/admin/suppliers/${id}`, { name: `Good 2 ${stamp}`, config: { ...good.body.supplier?.config } });
  const after = parse((await get(`SELECT config FROM suppliers WHERE id=@id`, { id }))?.config);
  ok('saving the form back with the mask still keeps the real key', renamed.status === 200 && after?.apiKey === 'sk_live_safety_9876',
    `${renamed.status} ${after?.apiKey}`);
  await run(`UPDATE suppliers SET status='paused' WHERE id=@id`, { id });
}
{
  console.log('  when it is fetched:');
  const tested = async (label, kind, config) => {
    victimHits.length = 0;
    const id = await savedEarlier(kind, config);
    const r = await call('POST', `/api/admin/suppliers/${id}/test`);
    ok(`${label}: the test-connection button refuses it`, r.status === 200 && r.body.ok === false
      && /not allowed/i.test(r.body.detail || ''), `${r.status} ${JSON.stringify(r.body)}`);
    ok(`${label}: …before a single request reaches it`, victimHits.length === 0, victimHits.join(', '));
  };
  await tested('a saved base URL on localhost', 'api', { baseUrl: VICTIM, endpoints: { catalog: '/catalog' } });
  await tested('a name that resolves inside', 'api', { baseUrl: `http://inside.supplier.test:${vport}`, endpoints: { catalog: '/catalog' } });
  await tested('a public supplier that redirects inside', 'api', { baseUrl: 'https://bounce.supplier.test', endpoints: { catalog: '/catalog' } });
  await tested('an address written as IPv6', 'api', { baseUrl: `http://[::ffff:7f00:1]:${vport}`, endpoints: { catalog: '/catalog' } });
  await tested('a CSV feed on localhost', 'csv', { source: { type: 'url', url: `${VICTIM}/feed.csv` } });
  await tested('a Kinguin base URL on localhost', 'kinguin', { apiKey: 'K', baseUrl: VICTIM });
  await tested('a G2A base URL on localhost', 'g2a', { apiHash: 'H', email: 'g@example.test', apiKey: 'S', baseUrl: VICTIM });
  await tested('an Eldorado base URL on localhost', 'eldorado', { apiKey: 'E', baseUrl: VICTIM });

  victimHits.length = 0;
  const syncId = await savedEarlier('api', { baseUrl: VICTIM, endpoints: { catalog: '/catalog' } });
  const synced = await syncSupplier(syncId, 'full');
  ok('a catalogue sync of such a supplier fails without calling it', synced.status === 'error' && victimHits.length === 0,
    `${synced.status} ${synced.detail} hits=${victimHits.length}`);

  // The test doubles the other suites use — a made-up host answered by a stub — still work.
  hosts.set('made-up.supplier.test', () => json(200, { items: [{ sku: 'm1', name: 'Made up', cost: '8.00' }] }));
  const doubled = await createConnector({ id: 'x', connector_kind: 'api',
    config: { baseUrl: 'https://made-up.supplier.test', endpoints: { catalog: '/c' } } }).fetchCatalog().catch((e) => e.message);
  ok('a stubbed supplier on a made-up host still answers', Array.isArray(doubled) && doubled[0]?.cost === 800, JSON.stringify(doubled));
  /* Kinguin, G2A and Eldorado on their own built-in hosts are not checked:
     that host is written in this code, not typed in — and the connector
     suites' stubs for it keep answering without any DNS. */
  hosts.set('gateway.kinguin.net', () => json(200, { results: [] }));
  const from = looked.length;
  const kg = await createConnector({ id: 'k', connector_kind: 'kinguin', config: { apiKey: 'K' } }).testConnection();
  ok('Kinguin on its built-in host goes straight to it, as before',
    kg.ok === true && !looked.slice(from).includes('gateway.kinguin.net'), JSON.stringify(kg));
  hosts.delete('gateway.kinguin.net');
}
victim.close();
srv.close();

console.log('\n— (d) The catalogue sync calls the supplier outside its transaction —');
{
  /* "idle in transaction" with supplier_products in its last statement is
     exactly what a sync holding its transaction open while it waits on a
     supplier looks like from the database. */
  const watcher = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await watcher.connect();
  const holding = async () => (await watcher.query(
    `SELECT COUNT(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND state LIKE 'idle in transaction%' AND query ILIKE '%supplier_products%'`)).rows[0].n;
  const control = await tx(async () => { await get(`SELECT id FROM supplier_products LIMIT 1`); return holding(); });
  ok('the check sees a transaction left open on supplier_products (control)', control >= 1, String(control));

  let duringFetch = null;
  supplierHost('catalog.supplier.test', async () => {
    duringFetch = await holding();
    return json(200, { items: [{ sku: 'c1', name: 'One', cost: 500, stock: 3 }, { sku: 'c2', name: 'Two', cost: 700, stock: 0 }] });
  });
  const sup = await createSupplier({ name: `Catalog ${stamp}`, connectorKind: 'api',
    config: { baseUrl: 'https://catalog.supplier.test', endpoints: { catalog: '/items' } } });
  const synced = await syncSupplier(sup.id, 'full');
  ok('the sync succeeds', synced.status === 'success' && synced.items_processed === 2, JSON.stringify(synced));
  ok('…and no transaction is open while the supplier is being asked', duringFetch === 0, String(duringFetch));
  await watcher.end();
}

console.log('\n— (e) The admin\'s Fulfil button buys an item once —');
{
  slowMs = 300;
  const user = await newUser();
  const o = await buy(user, slowProduct.id);
  await paidQuietly(o.id);
  const [x, y] = await Promise.all([
    fulfil.fulfillOrderByHand(o.id, { actorId: 'admin' }).catch((e) => e),
    fulfil.fulfillOrderByHand(o.id, { actorId: 'admin' }).catch((e) => e),
  ]);
  ok('two clicks at once buy the item once', boughtTimes(o.number) === 1, `${boughtTimes(o.number)} purchases`);
  ok('…the second click is told the queue is busy rather than buying',
    [x, y].some((r) => r instanceof Error && r.status === 409), JSON.stringify([x?.message || 'ok', y?.message || 'ok']));
  const again = await fulfil.fulfillOrderByHand(o.id, { actorId: 'admin' }).catch((e) => e);
  ok('a later click does not buy a delivered item again', boughtTimes(o.number) === 1
    && (again instanceof Error || (again.skipped || []).length === 1), again?.message || JSON.stringify(again?.skipped));

  const held = await buy(user, slowProduct.id);
  await paidQuietly(held.id);
  await run(`UPDATE orders SET fraud_hold=1 WHERE id=@id`, { id: held.id });
  const heldTry = await fulfil.fulfillOrderByHand(held.id, { actorId: 'admin' }).catch((e) => e);
  ok('an order held for fraud review is not bought by hand', heldTry?.status === 409 && boughtTimes(held.number) === 0,
    heldTry?.message || 'bought');

  const lost = await buy(user, slowProduct.id);
  await paidQuietly(lost.id);
  const lostOrder = await get(`SELECT id FROM order_items WHERE order_id=@o`, { o: lost.id });
  await run(`INSERT INTO fulfillment_requests (id, order_id, order_item_id, supplier_id, mode, status, result, created_at, updated_at)
             VALUES (@id, @o, @i, @s, 'auto', 'failed', @res, @at, @at)`,
    { id: newId('ful'), o: lost.id, i: lostOrder.id, s: slowSup.id, at: nowIso(),
      res: JSON.stringify({ error: 'no answer', outcome: 'unknown' }) });
  const lostTry = await fulfil.fulfillOrderByHand(lost.id, { actorId: 'admin' }).catch((e) => e);
  ok('an item whose earlier purchase got no answer is not bought again by the button',
    boughtTimes(lost.number) === 0 && /no answer/.test(JSON.stringify(lostTry?.skipped || lostTry?.message || '')),
    JSON.stringify(lostTry?.skipped || lostTry?.message));

  await run(`INSERT INTO kv (key, value, updated_at) VALUES ('supplier_queue_lock', 'someone', @at)
             ON CONFLICT (key) DO UPDATE SET value='someone', updated_at=@at`, { at: nowIso() });
  const busy = await buy(user, slowProduct.id);
  await paidQuietly(busy.id);
  const busyTry = await fulfil.fulfillOrderByHand(busy.id, { actorId: 'admin' }).catch((e) => e);
  ok('while the queue holds its lease the button waits its turn', busyTry?.status === 409 && boughtTimes(busy.number) === 0,
    busyTry?.message || 'bought');
  await run(`DELETE FROM kv WHERE key='supplier_queue_lock' AND value='someone'`);
}

console.log(`\n${fail ? '❌' : '✅'} supplier-safety: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
