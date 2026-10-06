/**
 * Settling a Stripe payment on an order — shared by the webhook and by the
 * reconciliation sweep that catches a webhook that never arrived.
 *
 * Moved out of routes/payments.js unchanged, so both paths apply exactly the
 * same checks: amount, currency and live mode must match the order, and a risky
 * payment (Radar, a foreign card, a guest's large first order) is held for a
 * person before anything is delivered.
 */
import { isTestKey, paymentRisk } from './stripeService.js';
import { getOrder, markPaymentReceived } from './orderService.js';
import { audit } from './auditService.js';
import { run, get } from '../db/index.js';
import { alertOwner } from './notifyService.js';
import { config } from '../config/env.js';

/** The order behind a Stripe object, by whichever handle it carries. */
export async function orderFor({ metadata, client_reference_id: ref, payment_intent: pi }) {
  const id = metadata?.orderId || ref;
  if (id) {
    const byId = await getOrder(id).catch(() => null);
    if (byId) return byId;
  }
  /* A refund or a dispute arrives against the PAYMENT, not the checkout
     session, so it carries no order id of ours. This is why the payment intent
     is written onto the order when the session is created. */
  if (pi) {
    const row = await get(
      `SELECT id FROM orders WHERE psp_payment_id=@p OR payment_ref=@p LIMIT 1`, { p: pi })
      .catch(() => null);
    if (row) return getOrder(row.id).catch(() => null);
  }
  return null;
}

/**
 * Paid — but only for the amount, the currency and the mode this order was
 * sold in. A session paid in another currency, for another amount, or a test
 * payment arriving at a live shop is not this order's payment.
 */
export async function markPaid(order, session, why, event) {
  if (!order) return 'order not found';
  const mismatch = [];
  if (session.amount_total != null && Number(session.amount_total) !== Number(order.total)) mismatch.push(`amount ${session.amount_total} ≠ ${order.total}`);
  if (session.currency && String(session.currency).toUpperCase() !== String(order.currency || 'EUR').toUpperCase()) mismatch.push(`currency ${session.currency} ≠ ${order.currency}`);
  if (event && typeof event.livemode === 'boolean' && event.livemode === isTestKey()) mismatch.push(`livemode ${event.livemode} with a ${isTestKey() ? 'test' : 'live'} key`);
  if (mismatch.length) {
    alertOwner('webhook.failed', {
      title: `Stripe payment does not match order ${order.number}`,
      lines: [...mismatch, 'The order was NOT marked paid. Check the payment in Stripe.'],
      url: `${config.appUrl}/admin/orders`, key: `mismatch-${session.id}`,
    }).catch(() => {});
    return `not paid: ${mismatch.join('; ')}`;
  }
  if (order.status !== 'pending') {
    /* A second payment for an order that is already settled — a second
       checkout session, or one that settled after the order was cancelled.
       The money arrived; someone has to give it back. */
    const ref = session.payment_intent || session.id;
    if (ref && order.paymentRef && ref !== order.paymentRef) {
      alertOwner('webhook.failed', {
        title: `Second payment for order ${order.number}`,
        lines: [`Order status: ${order.status}`, `Payment ${ref} is not the one on the order (${order.paymentRef}).`, 'Refund it in Stripe.'],
        url: `${config.appUrl}/admin/orders`, key: `double-${ref}`,
      }).catch(() => {});
      return 'extra payment on a settled order — owner alerted';
    }
    return 'already settled';
  }
  /* A code cannot be taken back once it is redeemed, so a payment Stripe
     itself finds risky — or paid with a card from another country than the
     order, or a guest's first big order — waits for a human before anything
     is delivered. The money is taken; only delivery waits. */
  const reasons = await riskReasons(order, session);
  if (reasons.length) {
    await run(`UPDATE orders SET fraud_hold=1, fraud_status='review', fraud_hold_reason=@r WHERE id=@id`,
      { id: order.id, r: reasons.join(' · ').slice(0, 500) });
  }
  await markPaymentReceived(order.id, session.payment_intent || session.id,
    { actorId: 'stripe', reason: why });
  await audit({ actor: { id: 'stripe', email: 'stripe' }, action: 'order.payment_received',
    targetType: 'order', targetId: order.id, metadata: { provider: 'stripe' } });
  return 'paid';
}

const FIRST_ORDER_REVIEW_CENTS = Number(process.env.STRIPE_REVIEW_FIRST_ORDER_CENTS || 10_000);
async function riskReasons(order, session) {
  const out = [];
  const risk = await paymentRisk(session.payment_intent).catch(() => null);
  if (risk?.level === 'elevated' || risk?.level === 'highest') out.push(`Stripe Radar: ${risk.level} risk${risk.score != null ? ` (${risk.score})` : ''}`);
  if (risk?.cardCountry && order.country && risk.cardCountry !== order.country) out.push(`card from ${risk.cardCountry}, order from ${order.country}`);
  if (!order.userId && Number(order.total) >= FIRST_ORDER_REVIEW_CENTS) {
    const before = await get(`SELECT 1 FROM orders WHERE lower(email)=lower(@e) AND id<>@id
                                AND status IN ('payment_received','processing','awaiting_fulfillment','completed') LIMIT 1`,
      { e: order.email, id: order.id }).catch(() => null);
    if (!before) out.push(`first order from a guest, ${(order.total / 100).toFixed(2)} EUR`);
  }
  return out;
}

/**
 * Stripe payments whose webhook never arrived.
 *
 * Stripe retries a failed webhook for three days, which is the right safety
 * net when OUR side failed — but a webhook that Stripe never sent, or sent to a
 * URL that was wrong at the time, leaves a paid order pending for good, and the
 * buyer's money is taken while nothing is delivered. So maintenance asks Stripe
 * directly about recent orders that are still pending with a Checkout session:
 * paid there means paid here, through the same markPaid the webhook uses.
 *
 * Only sessions 10 minutes to 48 hours old (younger ones are usually still on
 * the payment page; Checkout sessions expire after 30 minutes anyway), a
 * bounded number per run, and a deadline.
 */
export async function reconcileStripeSessions({ limit = 20, deadline = Date.now() + 6_000 } = {}) {
  const { isEnabled, retrieveSession } = await import('./stripeService.js');
  if (!isEnabled()) return { checked: 0, paid: 0 };
  const now = Date.now();
  const { all } = await import('../db/index.js');
  const rows = await all(
    `SELECT id, psp_payment_id FROM orders
      WHERE status = 'pending' AND psp_provider = 'stripe' AND psp_payment_id LIKE 'cs_%'
        AND created_at < @young AND created_at > @old
      ORDER BY created_at DESC LIMIT @l`,
    { young: new Date(now - 10 * 60_000).toISOString(), old: new Date(now - 48 * 3_600_000).toISOString(), l: limit });
  let checked = 0, paid = 0;
  for (const r of rows) {
    if (Date.now() >= deadline) break;
    const session = await retrieveSession(r.psp_payment_id).catch(() => null);
    checked++;
    if (session?.payment_status !== 'paid') continue;
    const order = await getOrder(r.id).catch(() => null);
    const outcome = await markPaid(order, session, 'Stripe payment found by reconciliation (no webhook arrived)', null)
      .catch((e) => `error: ${e.message}`);
    if (outcome === 'paid') paid++;
  }
  return { checked, paid };
}
