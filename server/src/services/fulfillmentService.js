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
import { getOrder, transitionOrder, canTransition, autoDispenseFromStock, insertDeliveries, openMysteryBoxes } from './orderService.js';
import { notify } from './notificationService.js';
import { alertOwner } from './notifyService.js';
import { config } from '../config/env.js';
import { marginAt } from './market/pricing.js';
import { planningVat } from './vatService.js';

/** Profit in cents on one unit, after BTW and the payment fee. */
function profitAfterCosts(revenueCents, costCents) {
  const m = marginAt(revenueCents / 100, costCents / 100, { ...config.market, vatPercent: planningVat().pct });
  return Math.round(m.profitEur * 100);
}

const parse = (s) => { try { return JSON.parse(s || 'null'); } catch { return null; } };

/**
 * Why this item may only be delivered by a person, or null.
 *
 * autoDispenseFromStock already refused both cases; the supplier path did not.
 * A Robux order with a username is a top-up ONTO that account — a supplier
 * sells a gift-card code, so buying one "completed" the order with a code
 * nobody saw while the mail told the buyer it had landed on their account. And
 * a product the owner set to hand delivery is hand delivery, whoever stocks it.
 */
async function handOnly(order, item) {
  if (order?.billing?.deliveryMethod === 'account') return 'delivered onto the buyer\'s account by hand';
  if (item?.product_id) {
    const p = await get('SELECT metadata FROM products WHERE id=@id', { id: item.product_id }).catch(() => null);
    if (parse(p?.metadata)?.deliveryMode === 'manual') return 'this product is delivered by hand';
  }
  return null;
}

/** The supplier for this item — none for an item only a person may deliver. */
async function supplierFor(order, item, opts = {}) {
  if (!item?.product_id || await handOnly(order, item)) return null;
  return resolveFulfillmentSupplier(item.product_id, opts);
}

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
  /* A held order does not start fulfilment at all. The hold was checked only
     after the order had already been moved to processing, so a payment whose
     Radar verdict landed in the same moment showed "processing" while it sat
     in review — nothing was delivered, but the status said otherwise. */
  if (order.fraudHold) throw conflict('This order is held for fraud review — approve it under Security first.');

  if (order.status === 'payment_received') {
    await transitionOrder(orderId, 'processing', { actorId: ctx.actorId, reason: 'Begin fulfillment' });
  }
  order = await getOrder(orderId);
  if (order.status === 'processing' && canTransition('processing', 'awaiting_fulfillment')) {
    await transitionOrder(orderId, 'awaiting_fulfillment',
      { actorId: ctx.actorId, reason: 'Awaiting fulfillment' });
    order = await getOrder(orderId);
  }

  const summary = { auto: 0, manual: 0, skipped: [], requests: [] };
  for (const item of order.items) {
    /* One purchase per item. The admin's Fulfil button runs this too, and it
       used to open a fresh request for every item every time it was pressed:
       a second click, or a click while the queue was buying the same order,
       bought the code twice. An item with a request in flight or delivered is
       left alone; so is one whose earlier purchase got no answer (it may have
       been bought — a person checks at the supplier first); and an item
       already waiting in the hand-delivery queue gets no second manual task. */
    const prior = await all(`SELECT mode, status, result FROM fulfillment_requests
                              WHERE order_id=@o AND order_item_id=@i`, { o: order.id, i: item.id });
    const live = prior.find((r) => ['requested', 'in_progress', 'fulfilled'].includes(r.status));
    const unanswered = prior.find((r) => /"outcome"\s*:\s*"unknown"/.test(String(r.result || '')));
    if (live || unanswered) {
      summary.skipped.push({ item: item.id, reason: live
        ? `already ${live.status === 'fulfilled' ? 'delivered' : 'being bought'}`
        : 'an earlier purchase got no answer — check at the supplier before buying it again' });
      continue;
    }
    const resolved = await supplierFor(order, item, { orderId: order.id });
    if (!resolved && prior.some((r) => r.mode === 'manual' && r.status === 'pending')) {
      summary.skipped.push({ item: item.id, reason: 'already in the hand-delivery queue' });
      continue;
    }
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

/**
 * The admin's Fulfil button.
 *
 * Takes the supplier queue's lease for the duration, so a click cannot run
 * beside the payment webhook or the maintenance drain buying the same order
 * (fulfillOrder's per-item check then sees what they bought), and refuses an
 * order held for fraud review — buying first and reviewing afterwards spends
 * real money on an order that may be refused, the reason the queue skips held
 * orders too.
 */
export async function fulfillOrderByHand(orderId, ctx = {}) {
  const row = await get('SELECT fraud_hold FROM orders WHERE id=@id', { id: orderId });
  if (!row) throw notFound('Order not found');
  if (row.fraud_hold) throw conflict('This order is held for fraud review — approve it under Security first.');
  const token = await acquireLease();
  if (!token) throw conflict('A supplier purchase is running right now — try again in a minute.');
  try {
    return await fulfillOrder(orderId, ctx);
  } finally {
    await releaseLease(token);
  }
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

  /* The supplier call, and ONLY the supplier call, decides whether this item
     may be tried elsewhere. Everything after the supplier answered — writing
     its answer down — is ours: a database error there used to land in the same
     catch as a supplier refusing, and the item was bought a second time at the
     next supplier while the first purchase (paid, with its keys) sat on a
     failed row that nothing ever polled. */
  let result;
  try {
    const connector = createConnector(supplier);
    // Out of time before the call: nothing is sent, and nobody else can be asked in this run either.
    if (ctx.deadline && Date.now() >= ctx.deadline) throw new Error('Not sent: the time for this run was used up');
    await logFulfillment('dispatched', { requestId: reqId, orderId: order.id, actor: supplier.id,
      detail: { sku: supplierProduct.supplier_sku, quantity: item.quantity } });

    result = await connector.createFulfillment({
      orderNumber: order.number,
      supplierSku: supplierProduct.supplier_sku,
      supplierUrl: supplierProduct.supplier_url || null, // exact listing to buy from
      cost: supplierProduct.cost ?? null,                // our buy price (cents) — some APIs require it
      quantity: item.quantity,
      customerEmail: order.email,
      metadata: item.metadata,
      deadline: ctx.deadline || null,                    // the drain's: the call is cut off there
    });
  } catch (err) {
    return failAndMaybeFailover(err, { order, item, supplier, reqId, ctx });
  }

  try {
    await persistResult(reqId, order, item, result);
    await logFulfillment('result', { requestId: reqId, orderId: order.id, actor: supplier.id,
      detail: { status: result.status, deliveries: result.deliveries?.length || 0 } });
  } catch (err) {
    /* The supplier answered and we could not record it. It may well be bought
       (and its codes are in `result`): never again automatically, and the
       person it goes to gets the supplier's reference and answer. */
    return recordUnknown(order, item, supplier, reqId, ctx, result,
      `The supplier answered but the answer could not be saved: ${err.message}`);
  }

  /* A supplier that ANSWERS "failed" has failed this delivery just as surely
     as one that threw — same path, so it gets the same failover. */
  if (result.status === 'failed') {
    return failAndMaybeFailover(new Error(result.error || 'the supplier reported the delivery as failed'),
      { order, item, supplier, reqId, ctx });
  }
  /* "Still working on it" with no reference to ask about later is a purchase
     nobody can follow up: it used to sit in_progress forever, skipped by the
     poll (which needs a reference), the sweep and the Fulfil button alike. */
  if (result.status !== 'fulfilled' && !String(result.externalRef || '').trim()) {
    return recordUnknown(order, item, supplier, reqId, ctx, result,
      'The supplier accepted the order without a reference to follow it up');
  }
  return get('SELECT * FROM fulfillment_requests WHERE id=@id', { id: reqId });
}

/** A purchase whose outcome we cannot know: recorded as such, and to a person. */
async function recordUnknown(order, item, supplier, reqId, ctx, result, error) {
  const failure = { error, outcome: 'unknown', supplierRef: result?.externalRef || null,
    supplierAnswer: result?.raw ?? result ?? null };
  await run(`UPDATE fulfillment_requests SET status='failed', result=@r, updated_at=@at WHERE id=@id`,
    { r: JSON.stringify(failure), at: nowIso(), id: reqId }).catch((e) => console.error('[fulfillment] record unknown', e.message));
  await logFulfillment('error', { requestId: reqId, orderId: order.id, actor: supplier.id,
    detail: { error, outcome: 'unknown', supplierRef: failure.supplierRef } }).catch(() => {});
  await handToPerson(order, item, { requestId: reqId, supplier, error, unanswered: true }, ctx);
  return get('SELECT * FROM fulfillment_requests WHERE id=@id', { id: reqId }).catch(() => null);
}

/** The supplier call itself failed: record it, fail over when that is safe, else a person. */
async function failAndMaybeFailover(err, { order, item, supplier, reqId, ctx }) {
  /* No answer is not a "no". A call cut off by its time limit — the
     connector's own, or the deadline of the drain it is part of — may well
     have reached the supplier and been bought. Another supplier, or the
     queue later on, would then buy it a second time. So such an item is
     never tried again automatically: it goes to a person, who looks at the
     supplier's own order list first. */
  /* The same holds for a broken connection and a server error AFTER the
     request went out: the supplier may have taken it and failed only on the
     way back. Only a clear "no" (the supplier answering failed, or refusing
     with a 4xx) is safe to try elsewhere — a double purchase is real money
     that does not come back. */
  const unanswered = err?.name === 'TimeoutError' || err?.name === 'AbortError' || err?.outcomeUnknown === true
    || Number(err?.status) >= 500
    || /fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE|socket hang up|network/i
      .test(`${err?.message || ''} ${err?.cause?.code || ''}`);
  const failure = { error: err.message, ...(unanswered ? { outcome: 'unknown' } : {}) };
  await run(`UPDATE fulfillment_requests SET status='failed', result=@r, updated_at=@at WHERE id=@id`,
      { r: JSON.stringify(failure), at: nowIso(), id: reqId });
  await logFulfillment('error', { requestId: reqId, orderId: order.id, actor: supplier.id,
    detail: failure });

  /* Failover: try the next best supplier for this item before the owner has
     to. Bounded — at most two hops — and the suppliers that already failed
     this order are excluded, so it cannot loop. The switch itself is logged
     by the failover service with the reason "errors". Not after a call with
     no answer (above), and not once the drain is out of time: the next
     supplier would only be cut off too. */
  const excluded = [...(ctx.excluded || []), supplier.id];
  const depth = ctx.failoverDepth || 0;
  const timeLeft = !ctx.deadline || Date.now() < ctx.deadline;
  if (!unanswered && timeLeft && item.product_id && depth < 2) {
    const { resolveFulfillmentSupplier: next } = await import('./supplier/supplierService.js');
    const alt = await next(item.product_id, { orderId: order.id, exclude: excluded }).catch(() => null);
    if (alt && !excluded.includes(alt.supplier.id)) {
      await logFulfillment('failover', { requestId: reqId, orderId: order.id, actor: 'system',
        detail: { from: supplier.id, to: alt.supplier.id, error: err.message } });
      return runAutoFulfillment(order, item, alt, { ...ctx, excluded, failoverDepth: depth + 1 });
    }
  }

  await handToPerson(order, item, { requestId: reqId, supplier, error: err.message, unanswered }, ctx);
  return get('SELECT * FROM fulfillment_requests WHERE id=@id', { id: reqId });
}

/**
 * An item no supplier delivered goes to a person — now, and per item.
 *
 * It used to stay a failed request and an alert. The order then waited for
 * the sweep, whose net (ensureManualFulfillment) only sees whole orders: an
 * item that failed beside one that was delivered was never queued at all, and
 * one that failed alone was kept out by "a supplier would still take it" —
 * while the queue never takes an order that already has a request. The alert
 * said "the order stays in the queue"; now it does.
 */
async function handToPerson(order, item, { requestId, supplier, error, unanswered }, ctx = {}) {
  await openManualFulfillment(order, item, ctx, unanswered
    ? `No clear answer from ${supplier?.name || 'the supplier'} — it may have been bought there (${String(error || '').slice(0, 160)})`
    : `No supplier could deliver it: ${String(error || 'unknown').slice(0, 200)}`);

  /* Tell the owner, because nobody else will.

     A failed fulfilment is the quietest expensive thing this shop does: the
     buyer has paid, the order sits in the queue, and the first sign is a
     ticket some hours later asking where the code is. Every other failure
     here already had a log line, and a log line is only read by someone who
     already suspects there is a problem.

     Keyed on the request, so the maintenance sweep re-reading the same failed
     request does not page again for a failure that has not changed. */
  await alertOwner('fulfillment.failed', {
    title: `${order.number} · ${item.name || 'item'} could not be fulfilled`,
    lines: [
      `Supplier: ${supplier?.name || supplier?.id || 'unknown'}`,
      `Error: ${String(error || 'unknown').slice(0, 200)}`,
      ...(unanswered ? ['No answer in time — it may have been bought at the supplier. Check there before buying it again.'] : []),
      `Customer: ${order.email}`,
      'The order stays in the queue — deliver it by hand or refund it.',
    ],
    url: `${config.appUrl}/admin/orders/${order.id}`,
    key: requestId,
  }).catch(() => {});
}

async function persistResult(reqId, order, item, result) {
  const status = result.status === 'fulfilled' ? 'fulfilled'
    : result.status === 'failed' ? 'failed' : 'in_progress';
  /* Only a purchase still under way takes an answer. A refund cancels the
     requests it finds in flight; a poll that had already picked the row (or
     the admin Refresh button) then set it back to fulfilled and wrote the
     codes onto the refunded order. */
  const updated = await run(`UPDATE fulfillment_requests SET status=@st, external_ref=@ref, result=@res, updated_at=@at
       WHERE id=@id AND status IN ('requested','in_progress')`,
      { st: status, ref: result.externalRef || null,
        res: JSON.stringify(result.raw ?? result), at: nowIso(), id: reqId });
  if (!updated?.changes) return false;

  /* Once each. retryPendingFulfillments re-reads every in-progress auto request
     on each maintenance pass, and this ran on every one of them — so a supplier
     that returns the code again on a status check wrote it to the order again,
     hourly, for as long as the request stayed in progress. */
  await insertDeliveries(order.id, (result.deliveries || []).map((d) => ({ ...d, orderItemId: item.id })));
  return true;
}

async function openManualFulfillment(order, item, ctx, reason = 'No supplier integration available') {
  /* One open hand task per item. Two sweeps at once both found "nothing open"
     and both inserted, so staff saw the same top-up twice — and two people
     could deliver it twice. Checked here, and enforced by a unique index
     (migration 068) where the database allows it. */
  const open = await get(`SELECT * FROM fulfillment_requests
                           WHERE order_item_id=@iid AND mode='manual' AND status='pending' LIMIT 1`, { iid: item.id });
  if (open) return open;
  const reqId = newId('ful');
  const at = nowIso();
  try {
    await run(`INSERT INTO fulfillment_requests
          (id, order_id, order_item_id, mode, status, created_at, updated_at)
         VALUES (@id, @oid, @iid, 'manual', 'pending', @at, @at)`,
        { id: reqId, oid: order.id, iid: item.id, at });
  } catch (e) {
    if (e.code !== '23505') throw e;   // another sweep opened it a moment ago
    return get(`SELECT * FROM fulfillment_requests
                 WHERE order_item_id=@iid AND mode='manual' AND status='pending' LIMIT 1`, { iid: item.id });
  }
  await logFulfillment('created', { requestId: reqId, orderId: order.id, actor: ctx.actorId,
    detail: { mode: 'manual', item: item.id, reason } });
  return get('SELECT * FROM fulfillment_requests WHERE id=@id', { id: reqId });
}

/* The statuses in which an order may still receive what it bought. */
const DELIVERABLE = ['payment_received', 'processing', 'awaiting_fulfillment'];

/**
 * Complete a manual fulfillment request: a staff member records the delivery
 * (code/file/message). Logged and may auto-complete the order.
 */
export async function completeManualFulfillment(requestId, { deliveries = [], note } = {}, ctx = {}) {
  const req = await get('SELECT * FROM fulfillment_requests WHERE id=@id', { id: requestId });
  if (!req) throw notFound('Fulfillment request not found');
  if (req.mode !== 'manual') throw badRequest('Not a manual fulfillment request');
  /* Only an order that is paid, not refunded or charged back, and not held for
     review may be delivered. The queue used to keep showing a refunded order,
     and one click wrote its Robux onto it anyway. */
  const order = await get('SELECT status, fraud_hold FROM orders WHERE id=@id', { id: req.order_id });
  if (!order || !DELIVERABLE.includes(order.status) || order.fraud_hold) {
    throw badRequest(order?.fraud_hold ? 'This order is held for review — release it first'
      : `This order is ${order?.status || 'gone'} and can no longer be delivered`);
  }

  /* The staff "deliver" button is one click, and one click is easy to make
     twice. Same writer as every other door into an order's deliveries, so a
     second press records nothing new instead of showing the buyer their code
     twice. */
  await insertDeliveries(req.order_id,
    deliveries.map((d) => ({ ...d, orderItemId: req.order_item_id })));
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
  if (!['requested', 'in_progress'].includes(req.status)) {
    throw badRequest(`This purchase is ${req.status} — there is nothing to refresh`);
  }
  const order = await getOrder(req.order_id);
  if (!order || !DELIVERABLE.includes(order.status)) {
    throw badRequest(`This order is ${order?.status || 'gone'} and can no longer be delivered`);
  }
  const supplier = await getSupplier(req.supplier_id);
  const item = order.items.find((i) => i.id === req.order_item_id) || { id: req.order_item_id };
  const result = await createConnector(supplier).checkFulfillment(req.external_ref, { deadline: ctx.deadline });
  if (!(await persistResult(requestId, order, item, result))) {
    throw conflict('This purchase was closed while its status was being checked');
  }
  await logFulfillment('retried', { requestId, orderId: req.order_id, actor: ctx.actorId,
    detail: { status: result.status } });
  /* A purchase that was pending at the supplier and has now FAILED there. It
     used to stay a failed request with nobody told: the buyer had paid, the
     sweep only looks at orders without a request, and the item sat. It goes to
     a person now, exactly like a purchase that failed straight away — once:
     the request only turns failed here from a pending state. */
  if (result.status === 'failed' && req.status !== 'failed') {
    await handToPerson(order, item, { requestId, supplier, error: result.error || 'the supplier reported the delivery as failed' }, ctx);
  }
  await maybeCompleteOrder(req.order_id, ctx);
  return get('SELECT * FROM fulfillment_requests WHERE id=@id', { id: requestId });
}

/** If every fulfillment request for an order is fulfilled, complete the order. */
async function maybeCompleteOrder(orderId, ctx) {
  const reqs = await all('SELECT order_item_id, status FROM fulfillment_requests WHERE order_id=@id', { id: orderId });
  if (!reqs.length) return;
  /* Per ITEM, not per request. Since failover, an item can carry a failed
     attempt at one supplier beside the delivery that worked at the next; the
     check that every REQUEST was fulfilled then left a delivered order waiting
     forever — the buyer had the code and the order never completed. An item is
     done when any of its requests is fulfilled. */
  const byItem = new Map();
  for (const r of reqs) {
    const key = r.order_item_id || '';
    byItem.set(key, byItem.get(key) || r.status === 'fulfilled');
  }
  const allDone = [...byItem.values()].every(Boolean);
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

export async function listManualQueue() {
  const rows = await all(`SELECT fr.*, o.number AS order_number, o.email AS customer,
                 o.billing AS billing, oi.name AS item_name, oi.quantity AS quantity,
                 oi.unit_price AS unit_price, oi.metadata AS item_metadata,
                 (SELECT sp.supplier_url FROM supplier_products sp
                    WHERE sp.product_id = oi.product_id AND sp.supplier_url IS NOT NULL
                    ORDER BY sp.priority ASC LIMIT 1) AS supplier_url
                FROM fulfillment_requests fr
                JOIN orders o ON o.id = fr.order_id
                LEFT JOIN order_items oi ON oi.id = fr.order_item_id
               WHERE fr.mode='manual' AND fr.status IN ('pending','in_progress')
                 AND o.status IN ('payment_received','processing','awaiting_fulfillment')
                 AND COALESCE(o.fraud_hold, 0) = 0
               ORDER BY fr.created_at ASC`);
  // Surface everything the owner needs to fulfil by hand in one glance: the
  // exact listing to buy from, how many, and where to send it (the buyer's
  // delivery target, captured at checkout).
  return rows.map((r) => {
    const billing = parse(r.billing) || {};
    const itemMeta = parse(r.item_metadata) || {};
    const { billing: _b, item_metadata: _m, ...rest } = r;
    return {
      ...rest,
      supplierUrl: r.supplier_url || null,
      // 'account' = top up the buyer's account directly; 'code' = send a code.
      deliveryMethod: billing.deliveryMethod === 'account' ? 'account' : 'code',
      deliveryDetails: billing.deliveryDetails || itemMeta.deliveryDetails || null,
      deliveryLabel: billing.deliveryLabel || itemMeta.deliveryLabel || null,
    };
  });
}

/**
 * Ensure a paid order that can't be delivered automatically becomes visible for
 * hand-delivery. Opens a manual fulfillment request per item when nothing is
 * delivering the order: no request in progress, and either an automatic one
 * already failed or no item resolves to an auto supplier (so the serial queue
 * isn't going to buy it). A boxes-only order is left to its box opening.
 * Idempotent — safe to re-run.
 * This closes the gap where a paid order with no stock and no auto-supplier
 * (e.g. a P2P Robux/V-Bucks top-up) would otherwise sit invisible.
 */
export async function ensureManualFulfillment(orderId, ctx = {}) {
  const order = await getOrder(orderId);
  if (!order || ['completed', 'refunded', 'cancelled'].includes(order.status)) return false;
  /* A boxes-only order is delivered by opening its boxes (openMysteryBoxes),
     which the payment starts right beside this one and which completes the
     order. Queueing it for a person as well raced that: staff got a "deliver
     this" task for a prize already paid out, or the queue tried to move the
     completed order back ("Cannot move order from completed to processing"). */
  if (await opensItself(order)) return false;
  /* A FAILED request is not "already handled".
     This guard asked whether any row existed, so an order whose automatic
     fulfilment had failed looked handled to every caller — including the
     maintenance sweep, whose whole job is to catch orders nothing is doing
     anything about. The order stayed paid and undelivered with a dead row
     standing in for a delivery. */
  const existing = await get(
    `SELECT id FROM fulfillment_requests WHERE order_id=@o AND status <> 'failed' LIMIT 1`, { o: orderId });
  if (existing) return false; // already handled (auto in-flight or manual queued)
  /* "A supplier would take it" only means the queue owns an order it has not
     tried yet: nextSupplierOrder never picks up one that already has a request.
     Asked of a failed order, it kept that order out of both — paid,
     undelivered, and nobody's. */
  const tried = await get(`SELECT id FROM fulfillment_requests WHERE order_id=@o LIMIT 1`, { o: orderId });
  if (!tried) {
    for (const item of order.items) {
      if (await supplierFor(order, item)) return false; // queue owns it
    }
  }
  return queueForHandDelivery(order, ctx);
}

/** Every item a mystery box that opening it will deliver: an account to credit
 *  and a prize to roll — the same test openMysteryBoxes completes the order on.
 *  A box with no prizes cannot deliver itself; that order stays a person's. */
async function opensItself(order) {
  if (!order?.userId || !order.items?.length) return false;
  const rows = await all(
    `SELECT p.kind, EXISTS (SELECT 1 FROM mystery_box_rewards r WHERE r.box_id = p.id) AS "hasPrizes"
       FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = @o`, { o: order.id });
  return rows.length > 0 && rows.every((r) => r.kind === 'mystery') && rows.some((r) => r.hasPrizes);
}

/** Open manual fulfillment requests for every item of a paid order, advancing
 *  its status along the same path fulfillOrder walks so completing the request
 *  can legally complete the order. Idempotent via the existing-request check. */
async function queueForHandDelivery(order, ctx = {}) {
  // Same reading as above: a failed row is not a delivery in progress.
  const existing = await get(
    `SELECT id FROM fulfillment_requests WHERE order_id=@o AND status <> 'failed' LIMIT 1`, { o: order.id });
  if (existing) return false;
  if (order.fraudHold) return false;   // held for review: nothing to queue yet
  if (order.status === 'payment_received') {
    await transitionOrder(order.id, 'processing', { actorId: ctx.actorId || 'system', reason: 'Begin fulfillment' });
    order = await getOrder(order.id);
  }
  if (order.status === 'processing' && canTransition('processing', 'awaiting_fulfillment')) {
    await transitionOrder(order.id, 'awaiting_fulfillment', { actorId: ctx.actorId || 'system', reason: 'Awaiting manual fulfillment' });
    order = await getOrder(order.id);
  }
  for (const item of order.items) await openManualFulfillment(order, item, ctx);
  await logFulfillment('manual_queued', { orderId: order.id, actor: ctx.actorId || 'system',
    detail: { reason: 'not auto-deliverable — queued for hand delivery', items: order.items.length } });
  return true;
}

/* How long a boxes-only order may stay paid before the sweep opens its boxes
   itself — the payment's own opening has long finished by then. */
const BOX_RETRY_AFTER_MS = 5 * 60_000;

/**
 * Backfill sweep (maintenance): paid orders that nothing has picked up.
 *
 * This is the net under the whole pipeline. transitionOrder starts the delivery
 * without awaiting it — deliberately, so the payment webhook answers fast — and
 * on a serverless host the function can be frozen the instant that 200 is
 * written. The work simply never runs. The order sits paid, in stock, and
 * undelivered, and nothing in the system is waiting for it.
 *
 * It used to hand every one of those to a person. That recovered the order from
 * silence, which is the important half, but it also meant a shop holding three
 * codes on the shelf made the buyer wait hours for something it could have sent
 * in a second — and gave staff a queue item that was never theirs to do.
 *
 * So the automatic path is retried first, and only what genuinely cannot be
 * dispensed goes to the queue. autoDispenseFromStock is idempotent (claimCodes
 * hands an order back the codes it already holds, deliverOrder ignores content
 * it has already written), so running it again on an order that half-finished
 * is safe; it either completes it or leaves it exactly where it was.
 */
export async function sweepUnfulfilledPaidOrders({ limit = 50 } = {}) {
  /* Two shapes of stuck order, and only the first was ever picked up.
     `NOT EXISTS (… fulfillment_requests …)` catches an order nothing has
     touched. It also EXCLUDES an order whose automatic fulfilment ran and
     FAILED — the row exists, so the net skips it forever. That order is paid,
     the buyer has nothing, and the only thing that ever happened was one owner
     alert at the moment of failure. If it was missed, nothing chases it: no
     retry, no queue, no second alert. The customer's next move is a chargeback.
     A failed request does not go back through autoDispenseFromStock — that is
     the path that just failed — it goes straight to a person. */
  const interrupted = await recoverInterruptedPurchases({ limit }).catch((e) => {
    console.error('[fulfillment:sweep] interrupted purchases', e.message);
    return 0;
  }) + await escalateStalePurchases({ limit }).catch((e) => {
    console.error('[fulfillment:sweep] stale purchases', e.message);
    return 0;
  });
  const rows = await all(
    `SELECT o.id, o.updated_at AS "updatedAt", EXISTS (
              SELECT 1 FROM fulfillment_requests fr
               WHERE fr.order_id = o.id AND fr.status = 'failed') AS "hadFailure"
       FROM orders o
      WHERE o.status IN ('payment_received','processing','awaiting_fulfillment')
        AND NOT EXISTS (
              SELECT 1 FROM fulfillment_requests fr
               WHERE fr.order_id = o.id AND fr.status <> 'failed')
      ORDER BY o.created_at ASC LIMIT @l`, { l: limit });
  let queued = interrupted, dispensed = 0, recovered = interrupted, opened = 0;
  for (const r of rows) {
    try {
      if (r.hadFailure) {
        if (await ensureManualFulfillment(r.id, { actorId: 'system' })) { queued++; recovered++; }
        continue;
      }
      if (await autoDispenseFromStock(r.id, { actorId: 'system', reason: 'Recovered by maintenance sweep' })) {
        dispensed++;
        continue;
      }
      /* A boxes-only order is delivered by opening its boxes, which the payment
         starts beside all of this. Still paid minutes later, that opening
         failed or never ran — so it is retried here, the way stock is above.
         openMysteryBoxes does not roll a box twice; the minutes keep this from
         running at the same moment as the payment's own opening. */
      if (Date.parse(r.updatedAt) < Date.now() - BOX_RETRY_AFTER_MS
        && await opensItself(await getOrder(r.id)) && (await openMysteryBoxes(r.id)).length) {
        opened++;
        continue;
      }
      if (await ensureManualFulfillment(r.id, { actorId: 'system' })) queued++;
    } catch (e) { console.error('[fulfillment:sweep]', e.message); }
  }
  if (dispensed) console.log(`[fulfillment:sweep] auto-delivered ${dispensed} stuck order(s) from stock`);
  if (opened) console.log(`[fulfillment:sweep] opened the mystery boxes of ${opened} paid order(s)`);
  if (recovered) console.log(`[fulfillment:sweep] ${recovered} failed fulfilment(s) handed to the manual queue`);
  return { queued, dispensed, recovered, opened };
}

/* Far beyond the longest a purchase can be in flight: a drain's budget, or a
   connector's own timeouts and two failover hops when staff press "Fulfil". */
const INTERRUPTED_AFTER_MS = 10 * 60_000;

/**
 * Purchases a function was killed in the middle of.
 *
 * runAutoFulfillment writes the request, calls the supplier, then records the
 * answer. A function killed in between — Vercel's 30-second limit did exactly
 * that from the payment webhook — leaves the request at 'requested' forever.
 * The order is then paid, undelivered and invisible: the sweep above skips an
 * order with a request, the queue skips it, and nothing re-polls a request
 * without an answer. Whether the supplier bought it is unknown, so it is not
 * bought again: it goes to a person, marked as such.
 */
async function recoverInterruptedPurchases({ limit = 50 } = {}) {
  const rows = await all(
    `SELECT fr.id, fr.order_id, fr.order_item_id, fr.supplier_id
       FROM fulfillment_requests fr JOIN orders o ON o.id = fr.order_id
      WHERE fr.mode = 'auto' AND fr.status = 'requested' AND fr.updated_at < @cut
        AND o.status IN ('payment_received','processing','awaiting_fulfillment')
      ORDER BY fr.updated_at ASC LIMIT @l`,
    { cut: new Date(Date.now() - INTERRUPTED_AFTER_MS).toISOString(), l: limit });
  const error = 'The purchase was interrupted before the supplier\'s answer was recorded';
  let handed = 0;
  for (const r of rows) {
    // The status flip is the claim: two sweeps at once hand it over once.
    const claimed = await run(`UPDATE fulfillment_requests SET status='failed', result=@res, updated_at=@at
                                WHERE id=@id AND status='requested'`,
      { res: JSON.stringify({ error, outcome: 'unknown' }), at: nowIso(), id: r.id });
    if (!claimed?.changes) continue;
    const order = await getOrder(r.order_id);
    const item = order?.items.find((i) => i.id === r.order_item_id);
    if (!item) continue;
    await logFulfillment('error', { requestId: r.id, orderId: order.id, actor: 'system',
      detail: { error, outcome: 'unknown' } });
    const supplier = r.supplier_id ? await getSupplier(r.supplier_id).catch(() => null) : null;
    await handToPerson(order, item, { requestId: r.id, supplier, error, unanswered: true }, { actorId: 'system' });
    handed++;
  }
  return handed;
}

/* An automatic purchase that has not delivered in this long goes to a person:
   the buyer has paid, and a supplier that is still "processing" after two hours
   (or that never gave us a reference to ask about) is not going to resolve it
   by being polled again. */
const STALE_PURCHASE_MS = 2 * 3600_000;

/**
 * Automatic purchases stuck "in progress".
 *
 * A purchase the supplier accepted but never finished — or accepted without a
 * reference, so the poll could not even ask — stayed in_progress forever: the
 * paid order sat in awaiting_fulfillment, the sweep and the queue skipped it
 * (it has a live request) and the owner was never told. After two hours it is
 * closed as "outcome unknown" (it may still arrive at the supplier, so it is
 * never bought again automatically) and handed to a person, once.
 */
async function escalateStalePurchases({ limit = 50 } = {}) {
  const rows = await all(
    `SELECT fr.id, fr.order_id, fr.order_item_id, fr.supplier_id, fr.external_ref
       FROM fulfillment_requests fr JOIN orders o ON o.id = fr.order_id
      WHERE fr.mode = 'auto' AND fr.status = 'in_progress' AND fr.created_at < @cut
        AND o.status IN ('payment_received','processing','awaiting_fulfillment')
      ORDER BY fr.created_at ASC LIMIT @l`,
    { cut: new Date(Date.now() - STALE_PURCHASE_MS).toISOString(), l: limit });
  let handed = 0;
  for (const r of rows) {
    const error = r.external_ref
      ? `Still not delivered by the supplier after two hours (their reference: ${r.external_ref})`
      : 'Accepted by the supplier without a reference, and not delivered after two hours';
    // The status flip is the claim: two sweeps at once hand it over once.
    const claimed = await run(`UPDATE fulfillment_requests SET status='failed', result=@res, updated_at=@at
                                WHERE id=@id AND status='in_progress'`,
      { res: JSON.stringify({ error, outcome: 'unknown', supplierRef: r.external_ref || null }), at: nowIso(), id: r.id });
    if (!claimed?.changes) continue;
    const order = await getOrder(r.order_id);
    const item = order?.items.find((i) => i.id === r.order_item_id);
    if (!item) continue;
    await logFulfillment('error', { requestId: r.id, orderId: order.id, actor: 'system',
      detail: { error, outcome: 'unknown' } });
    const supplier = r.supplier_id ? await getSupplier(r.supplier_id).catch(() => null) : null;
    await handToPerson(order, item, { requestId: r.id, supplier, error, unanswered: true }, { actorId: 'system' });
    handed++;
  }
  return handed;
}

/**
 * Auto-fulfil a paid order from a supplier integration — the "hands-off" path.
 * Called after local code-stock dispensing fails (no stock). It ONLY engages a
 * supplier when at least one item resolves to an active connector that
 * `supportsFulfillment`; otherwise it leaves the order for manual staff
 * fulfilment (unchanged behaviour). Safety rails:
 *   - idempotent: skips if the order already has fulfillment_requests;
 *   - margin guard: never auto-buys an item that loses money after BTW and fees;
 *   - a supplier configured with autoDeliver:false won't resolve (shadow/off).
 * Returns true if supplier fulfilment was kicked off.
 */
export async function autoFulfillFromSuppliers(orderId, ctx = {}) {
  const order = await getOrder(orderId);
  if (!order || ['completed', 'refunded', 'cancelled'].includes(order.status)) return false;
  // Idempotency: another pass already opened fulfilment for this order.
  const existing = await get('SELECT id FROM fulfillment_requests WHERE order_id=@o LIMIT 1', { o: orderId });
  if (existing) return false;

  // Revenue actually collected for this order, after coupon/member/bundle
  // discounts but counting store credit (that was real money paid earlier). We
  // pro-rate it back onto each line so the margin guard compares supplier cost
  // to what the buyer effectively paid for THAT item — not the list price.
  const subtotal = Number(order.subtotal || 0);
  const revenue = Number(order.total || 0) + Number(order.billing?.creditApplied || 0);
  const revenueRatio = subtotal > 0 ? revenue / subtotal : 0;

  let anySupplier = false;
  for (const item of order.items) {
    const resolved = await supplierFor(order, item, { orderId: order.id });
    if (!resolved) continue;
    anySupplier = true;
    // Margin guard: refuse to auto-source at a loss. Effective per-unit revenue
    // reflects the discounts the buyer used. An UNKNOWN supplier cost (null) is
    // treated as "don't auto-buy" — we never fire an uncapped purchase blind.
    const cost = resolved.supplierProduct?.cost;
    const effectiveUnit = Math.round(Number(item.unit_price) * revenueRatio);
    /* And after BTW and the payment fee, not only against the price. This
       compared cost to the gross amount the buyer paid, so a €10 sale bought
       in at €9 was auto-bought and delivered — and at 21% BTW €8.26 of that
       €10 is the shop's, so the order lost money the moment it went out.
       Measured against the rate the shop will charge (planningVat): BTW is owed
       from the registration date, not from the day the number is typed into the
       admin. A shop under the KOR is only ever sent to the manual queue by this
       — the safe direction to be wrong in. */
    const unitProfit = cost == null ? null : profitAfterCosts(effectiveUnit, cost);
    if (cost == null || cost >= effectiveUnit || unitProfit <= 0) {
      await logFulfillment('skipped', { orderId, actor: 'system',
        detail: { reason: cost == null ? 'supplier cost unknown'
          : cost >= effectiveUnit ? 'supplier cost >= effective revenue'
            : 'loses money after BTW and payment fees',
          item: item.id, cost, listPrice: item.unit_price, effectiveUnit, unitProfit } });
      // Don't leave the order invisible: put it in the manual queue so the
      // owner reviews it (buy anyway / refund) — and so the serial drain stops
      // re-picking it every run (it now has a fulfillment request).
      await queueForHandDelivery(order, { ...ctx, actorId: ctx.actorId || 'system' });
      return false;
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

/* A drain runs inside one function call, which Vercel ends at 30 s — so a lease
   that outlives that is a lease nobody holds. It was five minutes: a function
   killed mid-drain blocked the queue for five minutes, and every order paid in
   that window waited for the next trigger. 90 s covers a drain's own budget
   plus one supplier call that times out. */
const LEASE_TTL_MS = 90_000;

async function acquireLease(ttlMs = LEASE_TTL_MS) {
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
    // fraud_hold is filtered here rather than at delivery on purpose: this queue
    // BUYS the item from a supplier before delivering it. Discovering the hold
    // afterwards would mean the shop has already spent real money stocking an
    // order it may be about to refuse.
    `SELECT o.id FROM orders o
      WHERE o.status IN ('payment_received','processing')
        AND o.fraud_hold = 0
        AND NOT EXISTS (SELECT 1 FROM fulfillment_requests fr WHERE fr.order_id = o.id)
      ORDER BY o.created_at ASC LIMIT 50`);
  for (const r of rows) {
    if (skip.has(r.id)) continue;
    const order = await getOrder(r.id);
    if (!order) continue;
    for (const it of order.items) {
      if (await supplierFor(order, it)) return r.id;
    }
  }
  return null;
}

/* The end of a drain's budget in which no new purchase is started (see below). */
const MIN_PURCHASE_MS = 2_000;

/**
 * Drain the supplier queue serially: process paid orders one after another,
 * oldest first, buying + delivering each fully before the next. Only one worker
 * runs at a time (lease); bounded by time so it fits a serverless budget — the
 * next trigger (a new payment or the maintenance tick) continues where it left
 * off. Triggered on payment and from maintenance.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 * A payment that arrives while another worker holds the lease does not drain:
 * it leaves its order to the holder. The launch-week simulation showed two ways
 * the holder then dropped it:
 *   - it stopped after 25 orders, so in a burst everything after the 25th sat
 *     paid and untouched until the next payment or the hourly sweep (127 of
 *     500 orders in the burst run);
 *   - an order paid in the moment between the holder's last "anything left?"
 *     and its release was seen by nobody (6 of 20 at a 4-second supplier).
 * So the count cap is gone — time is the only bound — and after letting go the
 * holder looks once more: anything that arrived in that moment is either taken
 * by its own payment (the lease is free now) or by this worker going round
 * again.
 *
 * ── THE BUDGET IS A DEADLINE ────────────────────────────────────────────────
 * It used to be looked at only between orders, so one purchase that took 15 s
 * ran straight past it — from inside the payment webhook, past the 30 s Vercel
 * gives the whole invocation ("Task timed out after 30 seconds"). Now it is
 * handed down to the supplier call, which is cut off when it runs out
 * (supplierFetch). No new order is started in its last MIN_PURCHASE_MS: a
 * purchase cut off has no answer, and that order goes to a person instead of
 * being bought again (runAutoFulfillment).
 */
export async function drainSupplierQueue(ctx = {}, { maxOrders = 500, budgetMs = 22_000 } = {}) {
  const start = Date.now();
  const deadline = start + budgetMs;
  const hasTime = () => deadline - Date.now() > Math.min(MIN_PURCHASE_MS, budgetMs / 2);
  const attempted = new Set();
  let processed = 0;
  let rounds = 0;
  for (;;) {
    const token = await acquireLease();
    if (!token) return rounds ? { processed } : { skipped: true }; // another worker owns the queue
    rounds++;
    let emptied = false;
    try {
      while (attempted.size < maxOrders && hasTime()) {
        const id = await nextSupplierOrder(attempted);
        if (!id) { emptied = true; break; }
        attempted.add(id); // mark before working so a no-op (margin guard) advances
        // Fully source + deliver THIS one order before looking at the next.
        const did = await autoFulfillFromSuppliers(id, { ...ctx, actorId: ctx.actorId || 'system', deadline })
          .catch((e) => { console.error('[supplier-queue]', id, e.message); return false; });
        if (did) processed++;
      }
    } finally {
      await releaseLease(token);
    }
    if (!emptied || !hasTime() || rounds >= 5) break;
    if (!(await nextSupplierOrder(attempted))) break;
  }
  return { processed };
}

/** Is this paid order one the supplier queue will take — no request yet, and an
    item a supplier can deliver right now? The sweep leaves those to the queue. */
export async function supplierQueueOwns(orderId) {
  const open = await get(`SELECT id FROM fulfillment_requests WHERE order_id=@o LIMIT 1`, { o: orderId });
  if (open) return false;
  const order = await getOrder(orderId);
  if (!order) return false;
  for (const it of order.items) {
    if (await supplierFor(order, it)) return true;
  }
  return false;
}

/**
 * Re-poll supplier fulfilments that are still in progress (async suppliers that
 * return a reference and complete later). Runs from maintenance.
 */
export async function retryPendingFulfillments({ limit = 25, deadline = Infinity } = {}) {
  const rows = await all(
    `SELECT id FROM fulfillment_requests
      WHERE mode='auto' AND status='in_progress' AND external_ref IS NOT NULL
      ORDER BY updated_at ASC LIMIT @l`, { l: limit });
  let refreshed = 0;
  for (const r of rows) {
    /* Each poll can wait up to a supplier's 15 s; 25 of them never fitted in a
       30 s function. A poll is a read, so cutting it short loses nothing — the
       oldest are asked first and the rest wait for the next run. */
    if (deadline - Date.now() < 3_000) break;
    try { await refreshFulfillment(r.id, { actorId: 'system', deadline }); refreshed++; }
    catch (e) {
      console.error('[fulfillment:retry]', e.message);
      /* To the back of the line. A poll that fails did not touch the row, so
         ORDER BY updated_at picked the same failing rows first every run, and
         25 of them starved every other purchase of its status check. */
      await run(`UPDATE fulfillment_requests SET updated_at=@at WHERE id=@id`, { at: nowIso(), id: r.id }).catch(() => {});
    }
  }
  return refreshed;
}
