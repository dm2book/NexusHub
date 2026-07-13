/**
 * Payment verification queue for manual payments (Tikkie / Revolut / PayPal).
 *
 * Flow:  order placed (pending) → customer submits proof (transaction id +
 * optional screenshot) → proof sits in the verification queue → an admin
 * confirms (→ markPaymentReceived, the normal pipeline takes over) or rejects.
 *
 * Defends against fake "I paid" claims: duplicate transaction ids and proofs
 * for already-paid/rapid-fire orders are flagged for the admin.
 */
import { run, get, all, nowIso } from '../db/index.js';
import { config } from '../config/env.js';
import { newId } from '../utils/ids.js';
import { getOrder, markPaymentReceived } from './orderService.js';
import { notify } from './notificationService.js';
import { audit } from './auditService.js';
import { sendEmailAsync } from './emailService.js';
import { badRequest, notFound } from '../utils/errors.js';

const PAID = ['payment_received', 'processing', 'awaiting_fulfillment', 'completed'];

/** Customer submits proof of payment for their order. */
export async function submitProof(orderId, input = {}, ctx = {}) {
  const order = await getOrder(orderId);
  if (!order) throw notFound('Order not found');
  if (PAID.includes(order.status)) throw badRequest('This order is already paid.');
  if (['refunded', 'cancelled'].includes(order.status)) throw badRequest('This order is closed.');

  const transactionId = String(input.transactionId || '').trim().slice(0, 120) || null;
  const screenshotUrl = String(input.screenshotUrl || '').trim().slice(0, 500) || null;
  if (!transactionId && !screenshotUrl) {
    throw badRequest('Add a transaction ID or a screenshot link as proof.');
  }

  // Fraud signals for the reviewer.
  const flags = [];
  if (transactionId) {
    const dup = await get(
      `SELECT p.id, p.order_id FROM payment_proofs p
        WHERE p.transaction_id = @t AND p.order_id <> @o LIMIT 1`,
      { t: transactionId, o: orderId });
    if (dup) flags.push('duplicate_transaction_id');
  }
  const prior = await get(`SELECT COUNT(*) AS n FROM payment_proofs WHERE order_id=@o`, { o: orderId });
  if (Number(prior?.n || 0) >= 2) flags.push('multiple_submissions');

  const id = newId('ppf');
  const at = nowIso();
  await run(
    `INSERT INTO payment_proofs (id, order_id, method, transaction_id, screenshot_url, note, amount, status, fraud_flags, ip, created_at)
     VALUES (@id, @o, @m, @t, @s, @n, @amt, 'pending', @flags, @ip, @at)`,
    { id, o: orderId, m: input.method || order.billing?.paymentMethod || null,
      t: transactionId, s: screenshotUrl, n: String(input.note || '').slice(0, 300) || null,
      amt: order.total, flags: JSON.stringify(flags), ip: ctx.ip || null, at });

  await audit({ action: 'payment.proof_submit', actor: ctx.user || { email: order.email },
    targetType: 'order', targetId: orderId, metadata: { transactionId, flags }, req: ctx.req });

  return { id, status: 'pending', flags };
}

/** Latest proof for an order (for the customer's status view). */
export async function getOrderProof(orderId) {
  return get(
    `SELECT id, method, transaction_id AS "transactionId", status, reject_reason AS "rejectReason", created_at AS "createdAt"
       FROM payment_proofs WHERE order_id = @o ORDER BY created_at DESC LIMIT 1`, { o: orderId });
}

/** Admin: the verification queue — pending proofs with their order context. */
export async function listPendingProofs() {
  return all(
    `SELECT p.id, p.order_id AS "orderId", p.method, p.transaction_id AS "transactionId",
            p.screenshot_url AS "screenshotUrl", p.note, p.amount, p.fraud_flags AS "fraudFlags",
            p.created_at AS "createdAt", o.number AS "orderNumber", o.email, o.currency, o.status AS "orderStatus"
       FROM payment_proofs p JOIN orders o ON o.id = p.order_id
      WHERE p.status = 'pending'
      ORDER BY p.created_at ASC`)
    .then((rows) => rows.map((r) => ({ ...r, fraudFlags: safeArr(r.fraudFlags) })));
}

/** Admin confirms a proof → mark the order paid (normal pipeline continues). */
export async function confirmProof(proofId, ctx = {}) {
  const proof = await get('SELECT * FROM payment_proofs WHERE id=@id', { id: proofId });
  if (!proof) throw notFound('Proof not found');
  if (proof.status !== 'pending') throw badRequest('This proof was already reviewed.');

  await run(`UPDATE payment_proofs SET status='confirmed', reviewed_by=@by, reviewed_at=@at WHERE id=@id`,
    { by: ctx.user?.id || 'admin', at: nowIso(), id: proofId });

  const updated = await markPaymentReceived(proof.order_id, proof.transaction_id || `proof_${proofId}`,
    { actorId: ctx.user?.id || 'admin', reason: 'Payment proof verified' });

  await audit({ action: 'payment.proof_confirm', actor: ctx.user, targetType: 'order',
    targetId: proof.order_id, metadata: { proofId }, req: ctx.req });
  const order = await getOrder(proof.order_id);
  if (order?.userId) await notify(order.userId, { type: 'order', title: 'Payment confirmed ✅',
    body: `We verified your payment for ${order.number}. Your order is being processed.`, link: `/account/orders/${order.id}` });
  return updated;
}

/** Admin rejects a proof — order stays pending so the customer can resubmit. */
export async function rejectProof(proofId, reason = '', ctx = {}) {
  const proof = await get('SELECT * FROM payment_proofs WHERE id=@id', { id: proofId });
  if (!proof) throw notFound('Proof not found');
  if (proof.status !== 'pending') throw badRequest('This proof was already reviewed.');

  await run(`UPDATE payment_proofs SET status='rejected', reject_reason=@r, reviewed_by=@by, reviewed_at=@at WHERE id=@id`,
    { r: String(reason).slice(0, 300) || 'Could not verify payment', by: ctx.user?.id || 'admin', at: nowIso(), id: proofId });

  await audit({ action: 'payment.proof_reject', actor: ctx.user, targetType: 'order',
    targetId: proof.order_id, metadata: { proofId, reason }, req: ctx.req });

  const order = await getOrder(proof.order_id);
  if (order) {
    sendEmailAsync('custom_message', order.email, {
      subject: `Payment not verified for ${order.number}`,
      message: `We couldn't verify your payment yet${reason ? `: ${reason}` : ''}. Please double-check the amount and reference and resubmit your proof.`,
      order: { number: order.number, url: `${config.appUrl}/track` },
    });
    if (order.userId) await notify(order.userId, { type: 'order', title: 'Payment needs attention',
      body: reason || 'We couldn’t verify your payment. Please resubmit.', link: `/account/orders/${order.id}` });
  }
  return { ok: true };
}

function safeArr(s) { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
