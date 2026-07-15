/**
 * Fulfillment engine.
 *
 * For each order item we resolve a supplier able to fulfill it:
 *   - If an integration is available → create a fulfillment request, send it to
 *     the supplier connector, receive the result, store deliveries, and advance
 *     the order automatically.
 *   - If no integration exists → open a manual fulfillment request for a
 *     Fulfillment Manager to complete.
 *
 * EVERY fulfillment action is appended to fulfillment_logs.
 */
import { run, get, all, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { notFound, conflict, badRequest } from '../utils/errors.js';
import { createConnector } from './supplier/registry.js';
import { resolveFulfillmentSupplier, getSupplier } from './supplier/supplierService.js';
import { getOrder, transitionOrder, canTransition } from './orderService.js';
import { notify } from './notificationService.js';

const parse = (s) => { try { return JSON.parse(s || 'null'); } catch { return null; } };

export async function logFulfillment(action, { requestId, orderId, actor, detail } = {}) {
  await run(`INSERT INTO fulfillment_logs (id, request_id, order_id, action, actor, detail, created_at)
       VALUES (@id, @rid, @oid, @action, @actor, @detail, @at)`,
      { id: newId('flog'), rid: requestId || null, oid: orderId || null,
        action, actor: actor || 'system',
        detail: detail ? JSON.stringify(detail) : null, at: nowIso() });
}

/**
 * Kick off fulfillment for an entire order. Moves the order into
 * awaiting_fulfillment, then attempts auto-fulfillment per item.
 */
export async function fulfillOrder(orderId, ctx = {}) {
  let order = await getOrder(orderId);
  if (!order) throw notFound('Order not found');
  if (!['processing', 'awaiting_fulfillment', 'payment_received'].includes(order.status)) {
    throw conflict(`Order in status "${order.status}" cannot be fulfilled`);
  }

  if (order.status === 'payment_received') {
    await transitionOrder(orderId, 'processing', { actorId: ctx.actorId, reason: 'Begin fulfillment' });
  }
  order = await getOrder(orderId);
  if (order.status === 'processing' && canTransition('processing', 'awaiting_fulfillment')) {
    await transitionOrder(orderId, 'awaiting_fulfillment',
      { actorId: ctx.actorId, reason: 'Awaiting fulfillment' });
    order = await getOrder(orderId);
  }

  const summary = { auto: 0, manual: 0, requests: [] };
  for (const item of order.items) {
    const resolved = item.product_id ? await resolveFulfillmentSupplier(item.product_id) : null;
    if (resolved) {
      summary.requests.push(await runAutoFulfillment(order, item, resolved, ctx));
      summary.auto++;
    } else {
      summary.requests.push(await openManualFulfillment(order, item, ctx));
      summary.manual++;
    }
  }

  await maybeCompleteOrder(orderId, ctx);
  return summary;
}

async function runAutoFulfillment(order, item, { supplier, supplierProduct }, ctx) {
  const reqId = newId('ful');
  const at = nowIso();
  await run(`INSERT INTO fulfillment_requests
        (id, order_id, order_item_id, supplier_id, mode, status, payload, created_at, updated_at)
       VALUES (@id, @oid, @iid, @sup, 'auto', 'requested', @payload, @at, @at)`,
      { id: reqId, oid: order.id, iid: item.id, sup: supplier.id,
        payload: JSON.stringify({ sku: supplierProduct.supplier_sku, quantity: item.quantity }), at });
  await logFulfillment('created', { requestId: reqId, orderId: order.id, actor: ctx.actorId,
    detail: { mode: 'auto', supplier: supplier.id, item: item.id } });

  try {
    const connector = createConnector(supplier);
    await logFulfillment('dispatched', { requestId: reqId, orderId: order.id, actor: supplier.id,
      detail: { sku: supplierProduct.supplier_sku, quantity: item.quantity } });

    const result = await connector.createFulfillment({
      orderNumber: order.number,
      supplierSku: supplierProduct.supplier_sku,
      supplierUrl: supplierProduct.supplier_url || null, // exact listing to buy from
      quantity: item.quantity,
      customerEmail: order.email,
      metadata: item.metadata,
    });

    await persistResult(reqId, order, item, result);
    await logFulfillment('result', { requestId: reqId, orderId: order.id, actor: supplier.id,
      detail: { status: result.status, deliveries: result.deliveries?.length || 0 } });
  } catch (err) {
    await run(`UPDATE fulfillment_requests SET status='failed', result=@r, updated_at=@at WHERE id=@id`,
        { r: JSON.stringify({ error: err.message }), at: nowIso(), id: reqId });
    await logFulfillment('error', { requestId: reqId, orderId: order.id, actor: supplier.id,
      detail: { error: err.message } });
  }
  return get('SELECT * FROM fulfillment_requests WHERE id=@id', { id: reqId });
}

async function persistResult(reqId, order, item, result) {
  const status = result.status === 'fulfilled' ? 'fulfilled'
    : result.status === 'failed' ? 'failed' : 'in_progress';
  await run(`UPDATE fulfillment_requests SET status=@st, external_ref=@ref, result=@res, updated_at=@at
       WHERE id=@id`,
      { st: status, ref: result.externalRef || null,
        res: JSON.stringify(result.raw ?? result), at: nowIso(), id: reqId });

  for (const d of result.deliveries || []) {
    await createDelivery(order.id, item.id, d);
  }
}

async function createDelivery(orderId, itemId, d) {
  await run(`INSERT INTO deliveries (id, order_id, order_item_id, type, content, filename, max_downloads, created_at)
       VALUES (@id, @oid, @iid, @type, @content, @file, @max, @at)`,
      { id: newId('dlv'), oid: orderId, iid: itemId, type: d.type || 'code',
        content: d.content || null, file: d.filename || null,
        max: d.maxDownloads ?? null, at: nowIso() });
}

async function openManualFulfillment(order, item, ctx) {
  const reqId = newId('ful');
  const at = nowIso();
  await run(`INSERT INTO fulfillment_requests
        (id, order_id, order_item_id, mode, status, created_at, updated_at)
       VALUES (@id, @oid, @iid, 'manual', 'pending', @at, @at)`,
      { id: reqId, oid: order.id, iid: item.id, at });
  await logFulfillment('created', { requestId: reqId, orderId: order.id, actor: ctx.actorId,
    detail: { mode: 'manual', item: item.id, reason: 'No supplier integration available' } });
  return get('SELECT * FROM fulfillment_requests WHERE id=@id', { id: reqId });
}

/**
 * Complete a manual fulfillment request: a staff member records the delivery
 * (code/file/message). Logged and may auto-complete the order.
 */
export async function completeManualFulfillment(requestId, { deliveries = [], note } = {}, ctx = {}) {
  const req = await get('SELECT * FROM fulfillment_requests WHERE id=@id', { id: requestId });
  if (!req) throw notFound('Fulfillment request not found');
  if (req.mode !== 'manual') throw badRequest('Not a manual fulfillment request');

  for (const d of deliveries) await createDelivery(req.order_id, req.order_item_id, d);
  await run(`UPDATE fulfillment_requests SET status='fulfilled', assigned_to=@by,
        result=@res, updated_at=@at WHERE id=@id`,
      { by: ctx.actorId || null, res: JSON.stringify({ deliveries, note }),
        at: nowIso(), id: requestId });
  await logFulfillment('manual_note', { requestId, orderId: req.order_id, actor: ctx.actorId,
    detail: { note, deliveries: deliveries.length } });

  await maybeCompleteOrder(req.order_id, ctx);
  return get('SELECT * FROM fulfillment_requests WHERE id=@id', { id: requestId });
}

/** Re-poll an in-progress async supplier fulfillment. */
export async function refreshFulfillment(requestId, ctx = {}) {
  const req = await get('SELECT * FROM fulfillment_requests WHERE id=@id', { id: requestId });
  if (!req) throw notFound('Fulfillment request not found');
  if (req.mode !== 'auto' || !req.external_ref) {
    throw badRequest('Nothing to refresh for this request');
  }
  const supplier = await getSupplier(req.supplier_id);
  const order = await getOrder(req.order_id);
  const item = order.items.find((i) => i.id === req.order_item_id) || { id: req.order_item_id };
  const result = await createConnector(supplier).checkFulfillment(req.external_ref);
  await persistResult(requestId, order, item, result);
  await logFulfillment('retried', { requestId, orderId: req.order_id, actor: ctx.actorId,
    detail: { status: result.status } });
  await maybeCompleteOrder(req.order_id, ctx);
  return get('SELECT * FROM fulfillment_requests WHERE id=@id', { id: requestId });
}

/** If every fulfillment request for an order is fulfilled, complete the order. */
async function maybeCompleteOrder(orderId, ctx) {
  const reqs = await all('SELECT status FROM fulfillment_requests WHERE order_id=@id', { id: orderId });
  if (!reqs.length) return;
  const allDone = reqs.every((r) => r.status === 'fulfilled');
  const order = await getOrder(orderId);
  if (allDone && canTransition(order.status, 'completed')) {
    await transitionOrder(orderId, 'completed',
      { actorId: ctx.actorId || 'system', reason: 'All items fulfilled' });
    await logFulfillment('order_completed', { orderId, actor: ctx.actorId || 'system' });
    if (order.userId) {
      await notify(order.userId, { type: 'delivery', title: `Order ${order.number} delivered`,
        body: 'Your deliveries are ready in your dashboard.',
        link: `/account/orders/${orderId}` });
    }
  }
}

export async function listFulfillment(orderId) {
  const rows = await all('SELECT * FROM fulfillment_requests WHERE order_id=@id ORDER BY created_at ASC',
             { id: orderId });
  return rows.map((r) => ({ ...r, payload: parse(r.payload), result: parse(r.result) }));
}

export async function listFulfillmentLogs(orderId) {
  const rows = await all('SELECT * FROM fulfillment_logs WHERE order_id=@id ORDER BY created_at ASC',
             { id: orderId });
  return rows.map((r) => ({ ...r, detail: parse(r.detail) }));
}

export function listManualQueue() {
  return all(`SELECT fr.*, o.number AS order_number, o.email AS customer, oi.name AS item_name
                FROM fulfillment_requests fr
                JOIN orders o ON o.id = fr.order_id
                LEFT JOIN order_items oi ON oi.id = fr.order_item_id
               WHERE fr.mode='manual' AND fr.status IN ('pending','in_progress')
               ORDER BY fr.created_at ASC`);
}

/**
 * Auto-fulfil a paid order from a supplier integration — the "hands-off" path.
 * Called after local code-stock dispensing fails (no stock). It ONLY engages a
 * supplier when at least one item resolves to an active connector that
 * `supportsFulfillment`; otherwise it leaves the order for manual staff
 * fulfilment (unchanged behaviour). Safety rails:
 *   - idempotent: skips if the order already has fulfillment_requests;
 *   - margin guard: never auto-buys an item where supplier cost ≥ our price;
 *   - a supplier configured with autoDeliver:false won't resolve (shadow/off).
 * Returns true if supplier fulfilment was kicked off.
 */
export async function autoFulfillFromSuppliers(orderId, ctx = {}) {
  const order = await getOrder(orderId);
  if (!order || ['completed', 'refunded', 'cancelled'].includes(order.status)) return false;
  // Idempotency: another pass already opened fulfilment for this order.
  const existing = await get('SELECT id FROM fulfillment_requests WHERE order_id=@o LIMIT 1', { o: orderId });
  if (existing) return false;

  let anySupplier = false;
  for (const item of order.items) {
    const resolved = item.product_id ? await resolveFulfillmentSupplier(item.product_id) : null;
    if (!resolved) continue;
    anySupplier = true;
    // Margin guard: refuse to auto-source at a loss (cost known and ≥ our price).
    const cost = resolved.supplierProduct?.cost;
    if (cost != null && cost >= item.unit_price) {
      await logFulfillment('skipped', { orderId, actor: 'system',
        detail: { reason: 'supplier cost >= price', item: item.id, cost, price: item.unit_price } });
      return false; // leave the whole order for manual review
    }
  }
  if (!anySupplier) return false; // nothing to auto-source → manual/admin as before

  await fulfillOrder(orderId, { ...ctx, actorId: ctx.actorId || 'system' });
  return true;
}

// ── Serial supplier queue ────────────────────────────────────────────────────
// The owner wants orders sourced from suppliers ONE AT A TIME, oldest first:
// finish buying + delivering one paid order before starting the next. We hold a
// short DB lease (kv row with a TTL) so only one worker drains at a time, even
// across serverless instances, and process orders strictly in sequence.
const QUEUE_LOCK = 'supplier_queue_lock';

async function acquireLease(ttlMs = 5 * 60_000) {
  const now = Date.now();
  const token = newId('lease');
  // Win when there's no lease, or the current one has expired (crashed worker).
  const r = await run(
    `INSERT INTO kv (key, value, updated_at) VALUES (@k, @v, @at)
       ON CONFLICT (key) DO UPDATE SET value=@v, updated_at=@at
       WHERE kv.updated_at < @cutoff`,
    { k: QUEUE_LOCK, v: token, at: new Date(now).toISOString(),
      cutoff: new Date(now - ttlMs).toISOString() });
  return r?.changes ? token : null;
}
async function releaseLease(token) {
  await run('DELETE FROM kv WHERE key=@k AND value=@v', { k: QUEUE_LOCK, v: token }).catch(() => {});
}

/** The oldest paid order that maps to a supplier and hasn't been fulfilled yet.
 *  `skip` holds ids already attempted this drain (e.g. margin-guarded / no-op),
 *  so the queue advances instead of looping on an order that opens no request. */
async function nextSupplierOrder(skip = new Set()) {
  const rows = await all(
    `SELECT o.id FROM orders o
      WHERE o.status IN ('payment_received','processing')
        AND NOT EXISTS (SELECT 1 FROM fulfillment_requests fr WHERE fr.order_id = o.id)
      ORDER BY o.created_at ASC LIMIT 50`);
  for (const r of rows) {
    if (skip.has(r.id)) continue;
    const order = await getOrder(r.id);
    if (!order) continue;
    for (const it of order.items) {
      if (it.product_id && await resolveFulfillmentSupplier(it.product_id)) return r.id;
    }
  }
  return null;
}

/**
 * Drain the supplier queue serially: process paid orders one after another,
 * oldest first, buying + delivering each fully before the next. Only one worker
 * runs at a time (lease); bounded per call so it fits a serverless budget — the
 * next trigger (a new payment or the maintenance tick) continues where it left
 * off. Triggered on payment and from maintenance.
 */
export async function drainSupplierQueue(ctx = {}, { maxOrders = 25, budgetMs = 25_000 } = {}) {
  const token = await acquireLease();
  if (!token) return { skipped: true }; // another worker owns the queue → stay serial
  const start = Date.now();
  const attempted = new Set();
  let processed = 0;
  try {
    while (attempted.size < maxOrders && Date.now() - start < budgetMs) {
      const id = await nextSupplierOrder(attempted);
      if (!id) break;
      attempted.add(id); // mark before working so a no-op (margin guard) advances
      // Fully source + deliver THIS one order before looking at the next.
      const did = await autoFulfillFromSuppliers(id, { ...ctx, actorId: ctx.actorId || 'system' })
        .catch((e) => { console.error('[supplier-queue]', id, e.message); return false; });
      if (did) processed++;
    }
  } finally {
    await releaseLease(token);
  }
  return { processed };
}

/**
 * Re-poll supplier fulfilments that are still in progress (async suppliers that
 * return a reference and complete later). Runs from maintenance.
 */
export async function retryPendingFulfillments({ limit = 25 } = {}) {
  const rows = await all(
    `SELECT id FROM fulfillment_requests
      WHERE mode='auto' AND status='in_progress' AND external_ref IS NOT NULL
      ORDER BY updated_at ASC LIMIT @l`, { l: limit });
  let refreshed = 0;
  for (const r of rows) {
    try { await refreshFulfillment(r.id, { actorId: 'system' }); refreshed++; }
    catch (e) { console.error('[fulfillment:retry]', e.message); }
  }
  return refreshed;
}
