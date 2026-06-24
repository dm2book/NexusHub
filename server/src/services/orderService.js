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
import { grantTierForOrder } from './discordRolesService.js';

export const STATUSES = [
  'pending', 'payment_received', 'processing', 'awaiting_fulfillment',
  'completed', 'refunded', 'cancelled',
];

const TRANSITIONS = {
  pending: ['payment_received', 'cancelled'],
  payment_received: ['processing', 'refunded', 'cancelled'],
  processing: ['awaiting_fulfillment', 'completed', 'refunded', 'cancelled'],
  awaiting_fulfillment: ['completed', 'refunded', 'cancelled'],
  completed: ['refunded'],
  refunded: [],
  cancelled: [],
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
  const total = subtotal; // taxes/shipping would be added here

  await tx(async () => {
    await run(`INSERT INTO orders
          (id, number, user_id, email, status, currency, subtotal, total, billing, created_at, updated_at)
         VALUES (@id, @num, @uid, @email, 'pending', @cur, @sub, @tot, @bill, @at, @at)`,
        { id: orderId, num: number, uid: input.userId || null, email,
          cur: currency, sub: subtotal, tot: total,
          bill: JSON.stringify(input.billing || {}), at });
    for (const it of lineItems) {
      await run(`INSERT INTO order_items (id, order_id, product_id, name, quantity, unit_price, metadata)
           VALUES (@id, @oid, @pid, @name, @qty, @price, @meta)`,
          { id: it.id, oid: orderId, pid: it.product_id, name: it.name,
            qty: it.quantity, price: it.unit_price, meta: JSON.stringify(it.metadata) });
    }
    await appendHistory(orderId, null, 'pending', ctx.actorId || 'system', 'Order created');
  });

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

export async function transitionOrder(orderId, to, ctx = {}) {
  const order = await getOrderRow(orderId);
  if (!order) throw notFound('Order not found');
  if (order.status === to) return getOrder(orderId);
  if (!canTransition(order.status, to)) {
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
  if (to === 'completed') await postOrderEvent(updated, 'completed').catch(() => {});
  if (to === 'refunded') await postOrderEvent(updated, 'refunded').catch(() => {});
  // Grant the buyer's Discord tier (Verified vs VIP) once the order is paid.
  if (to === 'payment_received' || to === 'completed') await grantTierForOrder(updated);
  if (updated.userId) {
    await notify(updated.userId, {
      type: 'order_update',
      title: `Order ${updated.number}: ${labelFor(to)}`,
      body: statusBlurb(to),
      link: `/account/orders/${orderId}`,
    });
  }
  return updated;
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

export async function listOrders({ status, userId, email, search, limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = { limit, offset };
  if (status) { where.push('status = @status'); params.status = status; }
  if (userId) { where.push('user_id = @userId'); params.userId = userId; }
  if (email) { where.push('email = @email'); params.email = String(email).toLowerCase(); }
  if (search) { where.push('(number ILIKE @q OR email ILIKE @q)'); params.q = `%${search}%`; }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await all(`SELECT * FROM orders ${clause} ORDER BY created_at DESC
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

export async function markPaymentReceived(orderId, paymentRef, ctx = {}) {
  if (paymentRef) await run('UPDATE orders SET payment_ref=@r WHERE id=@id', { r: paymentRef, id: orderId });
  return transitionOrder(orderId, 'payment_received', { ...ctx, reason: ctx.reason || 'Payment received' });
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
