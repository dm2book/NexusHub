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
import { getOrder, markPaymentReceived, orderUrlFor } from './orderService.js';
import { notify } from './notificationService.js';
import { postPaymentProofAlert } from './discordService.js';
import { audit } from './auditService.js';
import { sendEmailAsync } from './emailService.js';
import { badRequest, notFound } from '../utils/errors.js';
import { isSafeImageValue } from '../utils/imageUrl.js';

const PAID = ['payment_received', 'processing', 'awaiting_fulfillment', 'completed'];

/** Customer submits proof of payment for their order. */
export async function submitProof(orderId, input = {}, ctx = {}) {
  const order = await getOrder(orderId);
  if (!order) throw notFound('Order not found');
  if (PAID.includes(order.status)) throw badRequest('This order is already paid.');
  if (['refunded', 'cancelled'].includes(order.status)) throw badRequest('This order is closed.');

  const transactionId = String(input.transactionId || '').trim().slice(0, 120) || null;
  const rawShot = String(input.screenshotUrl || '').trim();
  // Buyers pay on a phone and have the receipt in their camera roll, so an
  // uploaded image is accepted as well as a link. isSafeImageValue permits only
  // http(s) links and RASTER data URIs — never svg/html/javascript, which would
  // otherwise become a stored-XSS payload in the admin verification queue.
  // A pasted link stays short; an upload is a data URI, so don't truncate it.
  let screenshotUrl = rawShot
    ? (rawShot.startsWith('data:') ? rawShot : rawShot.slice(0, 500))
    : null;
  if (screenshotUrl && !isSafeImageValue(screenshotUrl)) {
    throw badRequest('Add a http(s) link or upload an image (PNG/JPG) as proof.');
  }
  if (!transactionId && !screenshotUrl) {
    throw badRequest('Add a transaction ID or a screenshot as proof.');
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
  if (Number(prior?.n || 0) >= 1) flags.push('multiple_submissions'); // this is the 2nd+ proof for the order
  /* Three waiting at once is plenty for a buyer correcting a mistake; more was
     a way to store megabytes of images per order, ten times a minute. */
  const waiting = await get(`SELECT COUNT(*)::int AS n FROM payment_proofs WHERE order_id=@o AND status='pending'`, { o: orderId });
  if (Number(waiting?.n || 0) >= 3) {
    throw badRequest('We already have your proof and are checking it — you will hear from us shortly.');
  }

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

  // Instant staff heads-up in Discord: manual payments deliver only as fast as
  // the owner confirms them. Best-effort — never blocks the submission.
  postPaymentProofAlert(order, { method: input.method, transactionId, flags })
    .catch((e) => console.error('[proof-alert]', e.message));

  return { id, status: 'pending', flags };
}

/** Latest proof for an order (for the customer's status view). */
export async function getOrderProof(orderId) {
  return get(
    `SELECT id, method, transaction_id AS "transactionId", status, reject_reason AS "rejectReason", created_at AS "createdAt"
       FROM payment_proofs WHERE order_id = @o ORDER BY created_at DESC LIMIT 1`, { o: orderId });
}

/** Admin: the verification queue — pending proofs with their order context.
 *
 *  Without the uploaded images. Every screenshot rode along inline (up to 1.3 MB
 *  each), so a handful of them — four from one visitor, or an ordinary busy day
 *  — took the response past Vercel's 4.5 MB limit; the request failed and the
 *  page read "Queue is empty". With manual payment the only way paid orders get
 *  delivered, that stopped every delivery without a word. A linked screenshot
 *  is still sent (it is a short URL); an uploaded one is fetched on demand
 *  (proofScreenshot). The oldest MAX_QUEUE are shown, with the full count. */
const MAX_QUEUE = 100;
export async function listPendingProofs() {
  const rows = await all(
    `SELECT p.id, p.order_id AS "orderId", p.method, p.transaction_id AS "transactionId",
            CASE WHEN p.screenshot_url LIKE 'data:%' THEN NULL ELSE p.screenshot_url END AS "screenshotUrl",
            (p.screenshot_url LIKE 'data:%') AS "screenshotUploaded",
            p.note, p.amount, p.fraud_flags AS "fraudFlags",
            p.created_at AS "createdAt", o.number AS "orderNumber", o.email, o.currency, o.status AS "orderStatus"
       FROM payment_proofs p JOIN orders o ON o.id = p.order_id
      WHERE p.status = 'pending'
      ORDER BY p.created_at ASC
      LIMIT @max`, { max: MAX_QUEUE });
  return rows.map((r) => ({ ...r, screenshotUploaded: !!r.screenshotUploaded, fraudFlags: safeArr(r.fraudFlags) }));
}

/** Admin: how many proofs are waiting in all (the queue shows the oldest MAX_QUEUE). */
export async function pendingProofCount() {
  return Number((await get(`SELECT COUNT(*)::int AS n FROM payment_proofs WHERE status = 'pending'`))?.n || 0);
}

/** Admin: one proof's uploaded screenshot, loaded when the reviewer opens it. */
export async function proofScreenshot(proofId) {
  const row = await get('SELECT screenshot_url AS "screenshotUrl" FROM payment_proofs WHERE id=@id', { id: proofId });
  if (!row) throw notFound('Proof not found');
  return row.screenshotUrl || null;
}

/** Admin confirms a proof → mark the order paid (normal pipeline continues). */
export async function confirmProof(proofId, ctx = {}) {
  const proof = await get('SELECT * FROM payment_proofs WHERE id=@id', { id: proofId });
  if (!proof) throw notFound('Proof not found');
  if (proof.status !== 'pending') throw badRequest('This proof was already reviewed.');
  /* Only an order still waiting for its money can be confirmed. Confirming a
     leftover second proof of an order that was already paid (or cancelled)
     marked that proof "confirmed", deleted its screenshot and then failed —
     the proof gone from the queue and nothing recorded. */
  const before = await getOrder(proof.order_id);
  if (!before || before.status !== 'pending') {
    throw badRequest(`This order is ${before?.status || 'gone'} — there is no payment left to confirm.`);
  }

  // Atomically claim the proof: only the caller whose UPDATE actually flips the
  // row from 'pending' proceeds to mark the order paid. A second click / second
  // admin gets changes=0 and stops here — no double markPaymentReceived, and
  // (with the atomic order transition) no double delivery.
  const claim = await run(
    `UPDATE payment_proofs SET status='confirmed', reviewed_by=@by, reviewed_at=@at WHERE id=@id AND status='pending'`,
    { by: ctx.user?.id || 'admin', at: nowIso(), id: proofId });
  if (!claim?.changes) throw badRequest('This proof was already reviewed.');

  let updated;
  try {
    updated = await markPaymentReceived(proof.order_id, proof.transaction_id || `proof_${proofId}`,
      { actorId: ctx.user?.id || 'admin', reason: 'Payment proof verified' });
  } catch (e) {
    /* The order moved underneath (cancelled in the same moment): the proof goes
       back in the queue with its screenshot, and the owner hears about it —
       money may have arrived for an order that is no longer open. */
    await run(`UPDATE payment_proofs SET status='pending', reviewed_by=NULL, reviewed_at=NULL WHERE id=@id`, { id: proofId });
    const { alertOwner } = await import('./notifyService.js');
    await alertOwner('payment.failed',
      `Confirming the payment proof for ${before.number} failed: ${e.message}. Check whether the money arrived and refund it if the order stays closed.`).catch(() => {});
    throw e;
  }
  await dropScreenshot(proof);
  /* Its other waiting proofs are settled by this one: closed without a mail,
     so nobody later rejects a leftover and tells a paid buyer "not verified". */
  const leftovers = await all(`SELECT * FROM payment_proofs WHERE order_id=@o AND status='pending' AND id<>@id`,
    { o: proof.order_id, id: proofId });
  for (const p of leftovers) {
    await run(`UPDATE payment_proofs SET status='superseded', reviewed_by=@by, reviewed_at=@at WHERE id=@id AND status='pending'`,
      { by: ctx.user?.id || 'admin', at: nowIso(), id: p.id });
    await dropScreenshot(p);
  }

  await audit({ action: 'payment.proof_confirm', actor: ctx.user, targetType: 'order',
    targetId: proof.order_id, metadata: { proofId }, req: ctx.req });
  const order = await getOrder(proof.order_id);
  if (order?.userId) await notify(order.userId, { type: 'order', title: 'Payment confirmed ✅',
    body: `We verified your payment for ${order.number}. Your order is being processed.`, link: `/account/orders/${order.id}` });
  return updated;
}

/**
 * Delete a proof's screenshot once it has been reviewed. A banking-app
 * screenshot shows a name and an IBAN; the privacy policy promises it is
 * deleted after the check, and nothing ever did. The decision, the amount and
 * the transaction id stay on the proof as the record.
 */
async function dropScreenshot(proof) {
  const id = /\/api\/images\/([0-9a-f]{32})/.exec(String(proof.screenshot_url || ''))?.[1];
  await run(`UPDATE payment_proofs SET screenshot_url=NULL WHERE id=@id`, { id: proof.id }).catch(() => {});
  /* Only an image that was uploaded AS a proof, that no product uses and no
     other proof points at. Screenshots arrive inline (data URI), so an
     /api/images/ id here is usually a pasted link to one of the shop's own
     pictures — a category logo has product_id NULL too, and rejecting a proof
     must never delete it. */
  if (id) {
    await run(`DELETE FROM product_images WHERE id=@img AND product_id IS NULL AND source = 'proof'
                 AND NOT EXISTS (SELECT 1 FROM payment_proofs WHERE screenshot_url LIKE @like)`,
      { img: id, like: `%${id}%` }).catch((e) => console.error('[proof] screenshot delete:', e.message));
  }
}

/**
 * Screenshots nobody is going to review any more.
 *
 * Confirming or rejecting a proof drops its picture. But an order can stop
 * waiting on its proof without either: staff marked it paid by hand, it was
 * cancelled for not being paid, or the buyer paid some other way. Those
 * pictures — name, IBAN, balance — stayed for good, while the privacy policy
 * says they go once the payment has been checked. Run by maintenance.
 */
export async function forgetStaleScreenshots({ days = 30, limit = 200 } = {}) {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const stale = await all(
    `SELECT p.id, p.screenshot_url FROM payment_proofs p
       LEFT JOIN orders o ON o.id = p.order_id
      WHERE p.screenshot_url IS NOT NULL
        AND (p.status <> 'pending' OR o.id IS NULL OR o.status NOT IN ('pending', 'failed') OR p.created_at < @cutoff)
      LIMIT @limit`, { cutoff, limit });
  for (const proof of stale) await dropScreenshot(proof);
  return stale.length;
}

/** Admin rejects a proof — order stays pending so the customer can resubmit. */
export async function rejectProof(proofId, reason = '', ctx = {}) {
  const proof = await get('SELECT * FROM payment_proofs WHERE id=@id', { id: proofId });
  if (!proof) throw notFound('Proof not found');
  if (proof.status !== 'pending') throw badRequest('This proof was already reviewed.');

  // Claimed atomically, like a confirm: a reject racing a confirm on the same
  // proof must not both win.
  const claim = await run(`UPDATE payment_proofs SET status='rejected', reject_reason=@r, reviewed_by=@by, reviewed_at=@at
                            WHERE id=@id AND status='pending'`,
    { r: String(reason).slice(0, 300) || 'Could not verify payment', by: ctx.user?.id || 'admin', at: nowIso(), id: proofId });
  if (!claim?.changes) throw badRequest('This proof was already reviewed.');
  await dropScreenshot(proof);

  await audit({ action: 'payment.proof_reject', actor: ctx.user, targetType: 'order',
    targetId: proof.order_id, metadata: { proofId, reason }, req: ctx.req });

  const order = await getOrder(proof.order_id);
  /* "Resubmit your proof" only to a buyer whose order still waits for payment
     — never to one whose order was already paid through another proof. */
  if (order && order.status === 'pending') {
    sendEmailAsync('custom_message', order.email, {
      lang: order.billing?.lang || undefined,
      subject: `Payment not verified for ${order.number}`,
      message: `We couldn't verify your payment yet${reason ? `: ${reason}` : ''}. Please double-check the amount and reference and resubmit your proof.`,
      // Pre-filled track link: a rejected proof is exactly the moment the buyer
      // must not have to hunt for their own order number.
      order: { number: order.number, url: orderUrlFor(order) },
    });
    if (order.userId) await notify(order.userId, { type: 'order', title: 'Payment needs attention',
      body: reason || 'We couldn’t verify your payment. Please resubmit.', link: `/account/orders/${order.id}` });
  }
  return { ok: true };
}

function safeArr(s) { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
