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
