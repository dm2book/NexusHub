/**
 * Order lifecycle + state machine.
 *
 * Status flow (per spec):
 *   pending → payment_received → processing → awaiting_fulfillment
 *           → completed | refunded | cancelled
 *
 * Transitions are validated centrally; every change appends to
 * order_status_history (powering real-time tracking) and emits the matching
 * customer notification + branded email.
 */
import { run, get, all, nowIso, tx } from '../db/index.js';
import { newId, newOrderNumber } from '../utils/ids.js';
import { formatMoney } from '../utils/money.js';
import { config, manualPayMethods } from '../config/env.js';
import { badRequest, notFound, conflict } from '../utils/errors.js';
import { sendEmailAsync } from './emailService.js';
import { notify } from './notificationService.js';
import { scoreOrder } from './fraudService.js';
import { getProduct } from './productService.js';
import { postOrderEvent } from './discordService.js';
import { grantTierForOrder, syncLoyaltyRoles, sendDeliveryDm } from './discordRolesService.js';
import { availableCount, claimCodes, checkLowStock } from './codeStockService.js';
import { memberDiscountPercent } from './membershipService.js';
import { recordOrderCommission } from './affiliateService.js';
import { recordPurchaseEvent } from './socialProofService.js';
import { bustSocialCaches } from '../routes/social.js';
import { balanceOf, debit, credit, hasOrderEntry } from './walletService.js';
import { grantTierRewards } from './loyaltyService.js';
import { awardCoinsForOrder } from './forgeCoinService.js';
import { settleMysteryForOrder } from './mysteryBoxService.js';
import { evaluateCoupon, recordCouponRedemption } from './couponService.js';
import { bestBundleDiscount } from './bundleService.js';

export const STATUSES = [
  'pending', 'payment_received', 'processing', 'awaiting_fulfillment',
  'completed', 'refunded', 'cancelled', 'failed',
];

const TRANSITIONS = {
  pending: ['payment_received', 'cancelled', 'failed'],
  payment_received: ['processing', 'refunded', 'cancelled', 'failed'],
  processing: ['awaiting_fulfillment', 'completed', 'refunded', 'cancelled', 'failed'],
  awaiting_fulfillment: ['completed', 'refunded', 'cancelled', 'failed'],
  completed: ['refunded'],
  refunded: [],
  cancelled: [],
  failed: ['cancelled', 'pending'],   // can retry or close out a failed order
};

const STATUS_EMAIL = {
  payment_received: 'payment_confirmed',
  processing: 'order_processing',
  completed: 'order_completed',
  refunded: 'refund_issued',
};

const parse = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

export function canTransition(from, to) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Creation ───────────────────────────────────────────────────────────────

export async function createOrder(input, ctx = {}) {
  const email = String(input.email || '').toLowerCase();
  if (!email) throw badRequest('Customer email is required');
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw badRequest('An order needs at least one item');
  }

  const orderId = newId('ord');
  const number = newOrderNumber();
  const at = nowIso();
  let subtotal = 0;
  const currency = input.currency || 'EUR';
  const lineItems = [];

  for (const li of input.items) {
    const product = await getProduct(li.productId);
    if (!product) throw badRequest(`Unknown product: ${li.productId}`);
    if (!product.active) throw conflict(`Product not available: ${product.name}`);
    const qty = Math.max(1, Number(li.quantity || 1));
    const unit = product.price;
    subtotal += unit * qty;
    lineItems.push({
      id: newId('oit'), product_id: product.id, name: product.name,
      quantity: qty, unit_price: unit, metadata: li.metadata || {},
    });
  }
  // Apply a discount coupon if one was supplied and is valid (DB-backed; server
  // is authoritative — the discount is recomputed here, never trusted from client).
  const couponEval = await evaluateCoupon(input.coupon, { subtotal, userId: input.userId, email });
  const couponCode = couponEval.ok ? couponEval.code : null;
  const couponDiscount = couponEval.ok ? couponEval.discount : 0;
  // Forge+ members get a standing discount on top (stacked with any coupon).
  const memberPercent = input.userId ? await memberDiscountPercent(input.userId) : 0;
  const memberDiscount = memberPercent ? Math.round(subtotal * memberPercent / 100) : 0;
  // Bundle discount: best single bundle whose products are all in the order.
  const bundle = await bestBundleDiscount(lineItems);
  const bundleDiscount = bundle.discount;
  const discount = Math.min(subtotal, couponDiscount + memberDiscount + bundleDiscount);
  const afterDiscount = Math.max(0, subtotal - discount);
  // Optionally pay part of the order with the customer's store credit.
  let creditApplied = 0;
  if (input.userId && input.useCredit) {
    const bal = await balanceOf(input.userId);
    creditApplied = Math.max(0, Math.min(Math.round(Number(input.useCredit) || 0), bal, afterDiscount));
  }
  const total = Math.max(0, afterDiscount - creditApplied);
  const billing = { ...(input.billing || {}) };
  if (couponCode) { billing.coupon = couponCode; billing.discount = couponDiscount; }
  if (memberDiscount) { billing.memberDiscount = memberDiscount; billing.memberPercent = memberPercent; }
  if (bundleDiscount) { billing.bundle = bundle.bundle?.name; billing.bundleDiscount = bundleDiscount; }
  if (creditApplied) billing.creditApplied = creditApplied;

  await tx(async () => {
    await run(`INSERT INTO orders
          (id, number, user_id, email, status, currency, subtotal, total, billing, created_at, updated_at)
         VALUES (@id, @num, @uid, @email, 'pending', @cur, @sub, @tot, @bill, @at, @at)`,
        { id: orderId, num: number, uid: input.userId || null, email,
          cur: currency, sub: subtotal, tot: total,
          bill: JSON.stringify(billing), at });
    for (const it of lineItems) {
      await run(`INSERT INTO order_items (id, order_id, product_id, name, quantity, unit_price, metadata)
           VALUES (@id, @oid, @pid, @name, @qty, @price, @meta)`,
          { id: it.id, oid: orderId, pid: it.product_id, name: it.name,
            qty: it.quantity, price: it.unit_price, meta: JSON.stringify(it.metadata) });
    }
    // Spend the store credit atomically with the order (rolls back if it can't).
    if (creditApplied) {
      await debit(input.userId, creditApplied, 'spend',
        `Applied to order ${number}`, { orderId, createdBy: input.userId });
    }
    await appendHistory(orderId, null, 'pending', ctx.actorId || 'system', 'Order created');
  });

  // Record the coupon redemption (per-user limits + usage counter). Best-effort.
  if (couponCode) {
    await recordCouponRedemption({ code: couponCode, userId: input.userId, email, orderId, ip: ctx.ip })
      .catch((e) => console.error('[coupon] redemption', e.message));
  }

  // Fraud screening (records signals; may flag/block).
  const order = await getOrder(orderId);
  const fraud = await scoreOrder({ order, user: ctx.user, email });
  await run('UPDATE orders SET fraud_score=@s, fraud_status=@d WHERE id=@id',
      { s: fraud.score, d: fraud.decision, id: orderId });

  // Customer comms.
  const fresh = await getOrder(orderId);
  await sendEmailAsync('order_received', email, emailContext(fresh));
  await postOrderEvent(fresh, 'received').catch(() => {});
  if (input.userId) {
    await notify(input.userId, {
      type: 'order_update', title: `Order ${number} received`,
      body: 'We have received your order and it is pending payment.',
      link: `/account/orders/${orderId}`,
    });
  }
  return fresh;
}

// ── State machine ────────────────────────────────────────────────────────

/** Staff: attach delivery code(s) to an order and complete it — the codes are
 *  e-mailed to the customer via the order_completed template (deliveriesHtml). */
export async function deliverOrder(orderId, deliveries = [], ctx = {}) {
  const order = await getOrderRow(orderId);
  if (!order) throw notFound('Order not found');
  for (const d of deliveries) {
    const content = String(d.content || '').trim();
    if (!content) continue;
    await run(`INSERT INTO deliveries (id, order_id, order_item_id, type, content, created_at)
         VALUES (@id, @oid, @iid, @type, @c, @at)`,
        { id: newId('dlv'), oid: orderId, iid: d.orderItemId || null, type: d.type || 'code', c: content, at: nowIso() });
  }
  // Force-complete from any state — staff is explicitly fulfilling the order.
  return transitionOrder(orderId, 'completed', { ...ctx, force: true, reason: ctx.reason || 'Delivered by staff' });
}

export async function transitionOrder(orderId, to, ctx = {}) {
  const order = await getOrderRow(orderId);
  if (!order) throw notFound('Order not found');
  if (order.status === to) return getOrder(orderId);
  if (!ctx.force && !canTransition(order.status, to)) {
    throw conflict(`Cannot move order from "${order.status}" to "${to}"`);
  }

  let paymentSet = '';
  if (to === 'payment_received') paymentSet = ", payment_status='paid'";
  if (to === 'refunded') paymentSet = ", payment_status='refunded'";

  await tx(async () => {
    await run(`UPDATE orders SET status=@status, updated_at=@at${paymentSet} WHERE id=@id`,
        { status: to, at: nowIso(), id: orderId });
    await appendHistory(orderId, order.status, to, ctx.actorId || 'system', ctx.reason);
  });

  const updated = await getOrder(orderId);
  const emailEvent = STATUS_EMAIL[to];
  if (emailEvent) {
    await sendEmailAsync(emailEvent, updated.email, emailContext(updated, ctx));
  }
  if (to === 'completed') {
    await postOrderEvent(updated, 'completed').catch(() => {});
    // Capture a privacy-safe snapshot for the live social-proof feed (best-effort).
    await recordPurchaseEvent(updated).catch(() => {});
    // Delivered count / live feed just changed → refresh the public stats now.
    bustSocialCaches();
    // DM Discord-linked buyers their codes + a /vouch prompt (best-effort).
    await sendDeliveryDm(updated).catch(() => {});
  }
  // If the order is cancelled/refunded, return any store credit that was spent on it.
  if ((to === 'refunded' || to === 'cancelled') && updated.userId && updated.billing?.creditApplied > 0) {
    if (!(await hasOrderEntry(orderId, 'refund').catch(() => true))) {
      await credit(updated.userId, updated.billing.creditApplied, 'refund',
        `Store credit returned · order ${updated.number}`, { orderId }).catch((e) => console.error('[wallet refund]', e.message));
    }
  }
  if (to === 'refunded') await postOrderEvent(updated, 'refunded').catch(() => {});
  // Grant the buyer's Discord tier (Verified vs VIP) once the order is paid,
  // and mirror their loyalty tier (Bronze→Platinum) as a server role.
  if (to === 'payment_received' || to === 'completed') {
    await grantTierForOrder(updated);
    await syncLoyaltyRoles(updated.userId).catch(() => {});
  }
  if (updated.userId) {
    await notify(updated.userId, {
      type: 'order_update',
      title: `Order ${updated.number}: ${labelFor(to)}`,
      body: statusBlurb(to),
      link: `/account/orders/${orderId}`,
    });
  }
  // Once paid, auto-deliver from code stock if every item is in stock; if not,
  // fall through to supplier auto-fulfillment (hands-off). Only engages when a
  // supplier integration actually covers an item — otherwise the order waits in
  // the manual queue exactly as before.
  if (to === 'payment_received') {
    autoDispenseFromStock(orderId, ctx)
      .then(async (delivered) => {
        if (delivered) return;
        // Not in local stock → hand off to the serial supplier queue, which
        // buys + delivers paid orders one at a time, oldest first.
        const { drainSupplierQueue } = await import('./fulfillmentService.js');
        await drainSupplierQueue(ctx);
      })
      .catch((e) => console.error('[autodispense]', e.message));
    // Paid spend may push the buyer into a new loyalty tier → grant its bonus.
    if (updated.userId) grantTierRewards(updated.userId).catch((e) => console.error('[loyalty]', e.message));
    // Earn Forge Coins (€10 = 1 coin), idempotent per order.
    if (updated.userId) awardCoinsForOrder(updated).catch((e) => console.error('[coins]', e.message));
    // Open any mystery boxes in the order → roll rewards, grant store credit.
    // A pure mystery-box order is fully delivered by that payout, so complete
    // it right away instead of leaving it in the manual-fulfillment queue.
    if (updated.userId) {
      settleMysteryForOrder(updated).then(async (won) => {
        if (!won.length) return;
        const kinds = await Promise.all(updated.items.map((it) =>
          get('SELECT kind FROM products WHERE id=@id', { id: it.product_id })));
        if (kinds.length && kinds.every((k) => k?.kind === 'mystery')) {
          await transitionOrder(orderId, 'completed',
            { force: true, reason: 'Mystery box opened — prize paid out as store credit' });
        }
      }).catch((e) => console.error('[mystery]', e.message));
    }
  }
  return updated;
}

/** If every item has enough pre-loaded stock, claim codes and complete the order.
 *  Products set to 'manual' delivery are never auto-dispensed — the whole order
 *  is left in the queue for staff to deliver by hand, even if codes are in stock. */
export async function autoDispenseFromStock(orderId, ctx = {}) {
  const order = await getOrder(orderId);
  if (!order || ['completed', 'refunded', 'cancelled'].includes(order.status)) return false;
  for (const it of order.items) {
    const product = await getProduct(it.product_id);
    if (product?.deliveryMode === 'manual') return false; // owner hand-delivers this product
    if (await availableCount(it.product_id) < it.quantity) return false; // not enough stock → leave for manual
  }
  const deliveries = [];
  for (const it of order.items) {
    const codes = await claimCodes(it.product_id, it.quantity, orderId);
    for (const c of codes) deliveries.push({ orderItemId: it.id, content: c, type: 'code' });
  }
  if (!deliveries.length) return false;
  await deliverOrder(orderId, deliveries, { ...ctx, reason: 'Auto-delivered from stock' });
  // Stock just moved — ping staff once if any item is now running low.
  for (const it of order.items) checkLowStock(it.product_id).catch(() => {});
  return true;
}

/**
 * Abandoned-payment recovery: email a single reminder (with the pay links) for
 * orders that are still unpaid `afterMinutes` after checkout. One reminder per
 * order — reminder_sent_at is stamped BEFORE sending so a crash can never cause
 * duplicates. Runs from the hourly maintenance cron.
 */
export async function sendPaymentReminders({ afterMinutes = 60, maxAgeHours = 72, limit = 50 } = {}) {
  const newest = new Date(Date.now() - afterMinutes * 60_000).toISOString();
  const oldest = new Date(Date.now() - maxAgeHours * 3_600_000).toISOString();
  const rows = await all(
    `SELECT id FROM orders
      WHERE status = 'pending' AND reminder_sent_at IS NULL
        AND created_at < @newest AND created_at > @oldest
      ORDER BY created_at ASC LIMIT @limit`,
    { newest, oldest, limit });

  let sent = 0;
  for (const row of rows) {
    // Claim the reminder atomically; if another cron run got here first, skip.
    const r = await run(
      `UPDATE orders SET reminder_sent_at = @at
        WHERE id = @id AND reminder_sent_at IS NULL AND status = 'pending'`,
      { at: nowIso(), id: row.id });
    if (!r?.changes) continue;
    const order = await getOrder(row.id);
    if (!order) continue;
    await sendEmailAsync('payment_reminder', order.email, emailContext(order));
    if (order.userId) {
      await notify(order.userId, {
        type: 'order_update', title: `Order ${order.number} is waiting for payment`,
        body: 'Complete your payment to receive your items — they are still reserved for you.',
        link: `/account/orders/${order.id}`,
      }).catch(() => {});
    }
    sent++;
  }
  return sent;
}

/**
 * Post-delivery review request: email a single "how was your order?" note for
 * orders completed `afterHours` ago that don't yet have a review. One per order
 * — review_request_sent_at is stamped BEFORE sending so a crash never duplicates
 * it. Runs from maintenance. The link lands the buyer straight on the review
 * widget for their order (works for guests too).
 */
export async function sendReviewRequests({ afterHours = 24, limit = 25 } = {}) {
  const cutoff = new Date(Date.now() - afterHours * 3_600_000).toISOString();
  const rows = await all(
    `SELECT o.id FROM orders o
      WHERE o.status = 'completed' AND o.review_request_sent_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.order_id = o.id)
        AND EXISTS (SELECT 1 FROM order_status_history h
                     WHERE h.order_id = o.id AND h.to_status = 'completed' AND h.created_at < @cutoff)
      ORDER BY o.updated_at ASC LIMIT @limit`,
    { cutoff, limit });

  let sent = 0;
  for (const row of rows) {
    // Claim atomically; if another run got here first, skip.
    const r = await run(
      `UPDATE orders SET review_request_sent_at = @at
        WHERE id = @id AND review_request_sent_at IS NULL AND status = 'completed'`,
      { at: nowIso(), id: row.id });
    if (!r?.changes) continue;
    const order = await getOrder(row.id);
    if (!order?.email) continue;
    await sendEmailAsync('review_request', order.email, {
      user: { name: order.billing?.full_name || order.email.split('@')[0] },
      order: { number: order.number },
      review: { url: `${config.appUrl}/track?number=${encodeURIComponent(order.number)}` },
    });
    sent++;
  }
  return sent;
}

export async function appendHistory(orderId, from, to, changedBy, reason) {
  await run(`INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by, reason, created_at)
       VALUES (@id, @oid, @from, @to, @by, @reason, @at)`,
      { id: newId('osh'), oid: orderId, from, to, by: changedBy || 'system',
        reason: reason || null, at: nowIso() });
}

// ── Reads ──────────────────────────────────────────────────────────────────

function getOrderRow(id) { return get('SELECT * FROM orders WHERE id = @id', { id }); }

export async function getOrder(id) {
  const row = await getOrderRow(id);
  if (!row) return null;
  return hydrate(row);
}

export async function getOrderByNumber(number) {
  const row = await get('SELECT * FROM orders WHERE number = @n', { n: number });
  return row ? hydrate(row) : null;
}

async function hydrate(row) {
  const [items, history, deliveries] = await Promise.all([
    all('SELECT * FROM order_items WHERE order_id=@id', { id: row.id }),
    all('SELECT * FROM order_status_history WHERE order_id=@id ORDER BY created_at ASC', { id: row.id }),
    all('SELECT * FROM deliveries WHERE order_id=@id', { id: row.id }),
  ]);
  return {
    id: row.id, number: row.number, userId: row.user_id, email: row.email,
    status: row.status, statusLabel: labelFor(row.status),
    currency: row.currency, subtotal: row.subtotal, total: row.total,
    totalFormatted: formatMoney(row.total, row.currency),
    paymentStatus: row.payment_status, paymentRef: row.payment_ref,
    billing: parse(row.billing), fraudScore: row.fraud_score, fraudStatus: row.fraud_status,
    notes: row.notes,
    items: items.map((i) => ({ ...i, metadata: parse(i.metadata) })),
    history, deliveries,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

// Whitelisted sort columns (never interpolate raw user input into SQL).
const SORT_COLUMNS = { date: 'created_at', amount: 'total', status: 'status', number: 'number' };

export async function listOrders({ status, statuses, userId, email, search, sort, dir, limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = { limit, offset };
  if (status) { where.push('status = @status'); params.status = status; }
  // Multi-status filter (dashboard buckets span several internal statuses).
  const list = Array.isArray(statuses) ? statuses : (statuses ? String(statuses).split(',') : []);
  const clean = list.map((s) => s.trim()).filter((s) => STATUSES.includes(s));
  if (clean.length) {
    where.push(`status IN (${clean.map((_, i) => `@st${i}`).join(',')})`);
    clean.forEach((s, i) => { params[`st${i}`] = s; });
  }
  if (userId) { where.push('user_id = @userId'); params.userId = userId; }
  if (email) { where.push('email = @email'); params.email = String(email).toLowerCase(); }
  if (search) { where.push('(number ILIKE @q OR email ILIKE @q)'); params.q = `%${search}%`; }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const col = SORT_COLUMNS[sort] || 'created_at';
  const order = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const rows = await all(`SELECT * FROM orders ${clause} ORDER BY ${col} ${order}, created_at DESC
                    LIMIT @limit OFFSET @offset`, params);
  const totalRow = await get(`SELECT COUNT(*) AS n FROM orders ${clause}`, params);
  const orders = await Promise.all(rows.map((r) => summarize(r)));
  return { orders, total: totalRow.n };
}

/** Compact row for admin tables: id, customer, product, amount, date, status. */
async function summarize(row) {
  const items = await all('SELECT name, quantity FROM order_items WHERE order_id=@id', { id: row.id });
  const productLabel = items.length
    ? items[0].name + (items.length > 1 ? ` +${items.length - 1} more` : '')
    : '—';
  return {
    id: row.id, number: row.number, customer: row.email, userId: row.user_id,
    product: productLabel, itemCount: items.length,
    amount: row.total, amountFormatted: formatMoney(row.total, row.currency),
    currency: row.currency, status: row.status, statusLabel: labelFor(row.status),
    fraudStatus: row.fraud_status, fraudScore: row.fraud_score,
    date: row.created_at,
  };
}

/**
 * Bookkeeping export: the (filtered) order list as CSV. Money is exported in
 * euros (decimal point) so it drops straight into a spreadsheet; per-order
 * discounts/credit are broken out of the billing snapshot.
 */
export async function exportOrdersCsv({ status, statuses, search, from, to } = {}) {
  const where = [];
  const params = {};
  if (status) { where.push('status = @status'); params.status = status; }
  const list = Array.isArray(statuses) ? statuses : (statuses ? String(statuses).split(',') : []);
  const clean = list.map((s) => s.trim()).filter((s) => STATUSES.includes(s));
  if (clean.length) {
    where.push(`status IN (${clean.map((_, i) => `@st${i}`).join(',')})`);
    clean.forEach((s, i) => { params[`st${i}`] = s; });
  }
  if (search) { where.push('(number ILIKE @q OR email ILIKE @q)'); params.q = `%${search}%`; }
  if (from) { where.push('created_at >= @from'); params.from = new Date(from).toISOString(); }
  if (to) { where.push('created_at <= @to'); params.to = new Date(to).toISOString(); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await all(`SELECT * FROM orders ${clause} ORDER BY created_at ASC LIMIT 10000`, params);

  const eur = (cents) => (Number(cents || 0) / 100).toFixed(2);
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['order_number', 'date', 'customer_email', 'status', 'payment_status',
    'payment_ref', 'currency', 'subtotal_eur', 'discount_eur', 'store_credit_eur',
    'total_eur', 'coupon', 'items'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const billing = parse(r.billing);
    const items = await all('SELECT name, quantity FROM order_items WHERE order_id=@id', { id: r.id });
    const discount = (billing.discount || 0) + (billing.memberDiscount || 0) + (billing.bundleDiscount || 0);
    lines.push([
      cell(r.number), cell(r.created_at), cell(r.email), cell(r.status),
      cell(r.payment_status), cell(r.payment_ref), cell(r.currency),
      eur(r.subtotal), eur(discount), eur(billing.creditApplied || 0), eur(r.total),
      cell(billing.coupon || ''), cell(items.map((i) => `${i.name} x${i.quantity}`).join(' | ')),
    ].join(','));
  }
  return '\ufeff' + lines.join('\n'); // BOM so Excel detects UTF-8
}

export async function markPaymentReceived(orderId, paymentRef, ctx = {}) {
  if (paymentRef) await run('UPDATE orders SET payment_ref=@r WHERE id=@id', { r: paymentRef, id: orderId });
  const result = await transitionOrder(orderId, 'payment_received', { ...ctx, reason: ctx.reason || 'Payment received' });
  // Record an affiliate commission if this buyer was referred (best-effort).
  try { await recordOrderCommission(await getOrder(orderId)); } catch { /* non-fatal */ }
  return result;
}

export async function setOrderNotes(orderId, notes) {
  await run('UPDATE orders SET notes=@n, updated_at=@at WHERE id=@id',
      { n: notes, at: nowIso(), id: orderId });
  return getOrder(orderId);
}

// ── Presentation helpers ───────────────────────────────────────────────────

export function labelFor(status) {
  return {
    pending: 'Pending',
    payment_received: 'Payment Received',
    processing: 'Processing',
    awaiting_fulfillment: 'Awaiting Fulfillment',
    completed: 'Completed',
    refunded: 'Refunded',
    cancelled: 'Cancelled',
    failed: 'Failed',
  }[status] || status;
}

function statusBlurb(status) {
  return {
    payment_received: 'We confirmed your payment and are preparing your order.',
    processing: 'Your order is being processed.',
    awaiting_fulfillment: 'Your order is awaiting fulfillment.',
    completed: 'Your order is complete — check your deliveries & downloads.',
    refunded: 'A refund has been issued for your order.',
    cancelled: 'Your order has been cancelled.',
  }[status] || `Order status: ${labelFor(status)}`;
}

/** Build an email-safe HTML summary table of the order's line items + total. */
/** Manual-payment instructions block for the order-received email (Tikkie/Revolut/PayPal). */
function paymentInstructionsHtml(order) {
  const methods = manualPayMethods();
  if (!methods.length || ['completed', 'refunded', 'cancelled', 'payment_received'].includes(order.status)) return '';
  const amt = formatMoney(order.total, order.currency);
  const eur = (order.total / 100).toFixed(2);
  const rows = methods.map((m) => {
    if (m.kind === 'email') {
      return `<tr><td><strong>${m.label}</strong></td><td class="r">Send ${amt} to ${escapeHtml(m.target)} (Friends &amp; Family)</td></tr>`;
    }
    let url = /^https?:\/\//.test(m.target) ? m.target : `https://${m.target}`;
    if (m.id === 'paypal' && /paypal\.me/i.test(url)) url = `${url.replace(/\/$/, '')}/${eur}EUR`;
    return `<tr><td><strong>${m.label}</strong></td><td class="r"><a href="${url}">${escapeHtml(url.replace(/^https?:\/\//, ''))}</a></td></tr>`;
  }).join('');
  return `<div class="quote"><strong>Complete your payment — ${amt}</strong><br>` +
    `Pay using one of the methods below and put your order number <strong>${order.number}</strong> as the reference. ` +
    `Your order is confirmed as soon as we receive it.</div>` +
    `<table class="summary"><tbody>${rows}</tbody></table>`;
}

function itemsHtml(order) {
  if (!order.items?.length) return '';
  const rows = order.items.map((i) =>
    `<tr><td>${escapeHtml(i.name)} × ${i.quantity}</td>` +
    `<td class="r">${formatMoney(i.unit_price * i.quantity, order.currency)}</td></tr>`).join('');
  return `<table class="summary"><tbody>${rows}` +
    `<tr class="tot"><td>Total</td><td class="r">${formatMoney(order.total, order.currency)}</td></tr>` +
    `</tbody></table>`;
}

/** Render delivered digital goods (codes/keys/messages) for the completion email. */
function deliveriesHtml(order) {
  if (!order.deliveries?.length) return '';
  const items = order.deliveries.map((d) => {
    const label = (d.type || 'code').toUpperCase();
    const value = d.content ? escapeHtml(d.content) : (d.filename ? escapeHtml(d.filename) : '—');
    return `<div style="margin:0 0 8px"><div style="font-size:11px;text-transform:uppercase;` +
      `letter-spacing:1px;color:#8b8fa3">${label}</div><div class="code">${value}</div></div>`;
  }).join('');
  return `<p style="margin:0 0 6px">Your items:</p>${items}`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function emailContext(order, ctx = {}) {
  return {
    user: { name: order.billing?.full_name || order.email.split('@')[0] },
    order: {
      number: order.number,
      total: order.totalFormatted,
      status: order.statusLabel,
      itemsHtml: itemsHtml(order),
      deliveriesHtml: deliveriesHtml(order),
      paymentHtml: paymentInstructionsHtml(order),
      url: `${config.appUrl}/account/orders/${order.id}`,
    },
    refund: ctx.refundAmount != null
      ? { amount: formatMoney(ctx.refundAmount, order.currency) }
      : { amount: order.totalFormatted },
  };
}
