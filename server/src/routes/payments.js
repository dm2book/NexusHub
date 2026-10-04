/**
 * Stripe webhooks — the authoritative source of what happened to the money.
 *
 * ── WHAT THIS USED TO HANDLE, AND WHY THAT WAS NOT ENOUGH ─────────────────
 * One event: `checkout.session.completed`. Three things follow from that.
 *
 * 1. IT MARKED ASYNCHRONOUS PAYMENTS PAID BEFORE THE MONEY ARRIVED.
 *    `checkout.session.completed` fires when the buyer finishes the Checkout
 *    page, and for every delayed-notification method — SEPA Direct Debit,
 *    Sofort, Bancontact's debit flows, bank transfers — the session comes back
 *    with `payment_status: 'unpaid'` and settles minutes or days later. The
 *    handler did not look at that field, so it moved the order to
 *    `payment_received`, which auto-dispenses a code and emails it. For a shop
 *    selling digital goods that is a free product handed out on a promise.
 *
 * 2. A REFUND ISSUED IN THE STRIPE DASHBOARD WAS INVISIBLE HERE.
 *    Nothing listened for `charge.refunded`, so the buyer had their money back
 *    and their code, and the order still read `completed`. Mollie's webhook has
 *    handled this since it was written; Stripe's never did.
 *
 * 3. A CHARGEBACK WAS INVISIBLE TOO.
 *    There is a `chargebacks` table, the fraud score reads it, and Mollie
 *    writes to it. A card dispute wrote nothing, so the one signal that says
 *    "this buyer is a problem" never reached the thing that exists to use it.
 *
 * ── AND ONE RULE THAT APPLIES TO ALL OF THEM ──────────────────────────────
 * Providers retry until they get a 2xx and will re-deliver an event whose first
 * response was slow. Replaying "paid" is harmless. Replaying a refund or a
 * dispute is not — both write money-bearing state. So every event is recorded
 * by the provider's own id first, and a repeat is recognised as a repeat.
 */
import { Router } from 'express';
import { constructEvent, isTestKey, paymentRisk } from '../services/stripeService.js';
import { getOrder, markPaymentReceived, setPspPayment } from '../services/orderService.js';
import { settleAsRefunded } from '../services/refundSettlement.js';
import { recordChargeback } from '../services/chargebackService.js';
import { audit } from '../services/auditService.js';
import { run, get, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { alertOwner } from '../services/notifyService.js';
import { config } from '../config/env.js';

const router = Router();

/**
 * Claim an event, or discover somebody already has.
 *
 * The row is written BEFORE the work, so two concurrent deliveries of the same
 * event cannot both pass the check and then both apply it. The unique index is
 * what actually enforces it; this is just the read that turns a constraint
 * violation into a quiet "already done".
 */
async function claim(provider, event) {
  const existing = await get(
    `SELECT id, outcome, received_at FROM webhook_events WHERE provider=@p AND event_id=@e`,
    { p: provider, e: event.id });
  if (existing) {
    /* A claim is only final once the work behind it finished. An event whose
       handler failed, or whose run was killed half-way (a function timeout
       leaves the outcome empty), is taken again by the provider's retry —
       answering "duplicate" there is how a paid order stays pending forever. */
    const stale = !existing.outcome && Date.now() - new Date(existing.received_at).getTime() > 60_000;
    if (stale || /^error/.test(existing.outcome || '')) {
      await run(`UPDATE webhook_events SET outcome=NULL, received_at=@at WHERE id=@id`, { id: existing.id, at: nowIso() });
      return { fresh: true };
    }
    return { fresh: false, outcome: existing.outcome };
  }
  try {
    await run(
      `INSERT INTO webhook_events (id, provider, event_id, event_type, received_at)
       VALUES (@id, @p, @e, @t, @at)`,
      { id: newId('whe'), p: provider, e: event.id, t: event.type, at: nowIso() });
    return { fresh: true };
  } catch {
    return { fresh: false, outcome: 'raced' };     // the unique index won
  }
}

const finish = (provider, event, outcome, orderId = null) =>
  run(`UPDATE webhook_events SET outcome=@o, order_id=@oid WHERE provider=@p AND event_id=@e`,
    { o: outcome, oid: orderId, p: provider, e: event.id }).catch(() => {});

/** The order behind a Stripe object, by whichever handle it carries. */
async function orderFor({ metadata, client_reference_id: ref, payment_intent: pi }) {
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
async function markPaid(order, session, why, event) {
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

router.post('/stripe/webhook', async (req, res) => {
  let event;
  try {
    event = await constructEvent(req.body, req.get('stripe-signature'));
  } catch (err) {
    console.error('[stripe] signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const seen = await claim('stripe', event).catch(() => ({ fresh: true }));
  if (!seen.fresh) {
    console.log(`[stripe] ${event.type} ${event.id} already handled (${seen.outcome})`);
    return res.json({ received: true, duplicate: true });
  }

  let outcome = 'ignored';
  let orderId = null;
  try {
    const obj = event.data.object;

    switch (event.type) {
      case 'checkout.session.completed': {
        const order = await orderFor(obj);
        orderId = order?.id ?? null;
        /* The field the old handler did not read. For an asynchronous method
           this is 'unpaid' here and becomes 'paid' minutes to days later, on
           checkout.session.async_payment_succeeded. */
        if (obj.payment_status === 'paid') {
          outcome = await markPaid(order, obj, 'Stripe payment confirmed', event);
        } else {
          outcome = `awaiting settlement (${obj.payment_status})`;
          if (order) {
            await setPspPayment(order.id, { provider: 'stripe',
              paymentId: obj.payment_intent || obj.id, status: obj.payment_status });
          }
        }
        break;
      }

      case 'checkout.session.async_payment_succeeded': {
        const order = await orderFor(obj);
        orderId = order?.id ?? null;
        outcome = await markPaid(order, obj, 'Stripe payment settled', event);
        break;
      }

      case 'checkout.session.async_payment_failed': {
        /* Deliberately NOT cancelled here. The buyer may retry the same order,
           and an order cancelled out from under them is worse than one left
           pending — the unpaid-order sweep already cancels these on its own
           schedule, with the reason recorded. */
        const order = await orderFor(obj);
        orderId = order?.id ?? null;
        if (order) {
          await setPspPayment(order.id, { provider: 'stripe', status: 'failed' });
        }
        outcome = 'payment failed, order left pending';
        break;
      }

      case 'charge.refunded': {
        const order = await orderFor(obj);
        orderId = order?.id ?? null;
        if (!order) { outcome = 'refund for an unknown order'; break; }
        /* Partial refunds do not make an order `refunded`. Saying they do would
           tell the shop it gave everything back when it gave part of it. */
        const full = obj.amount_refunded != null && obj.amount != null
          && Number(obj.amount_refunded) >= Number(obj.amount);
        if (!full) {
          await audit({ actor: { id: 'stripe', email: 'stripe' }, action: 'order.partial_refund',
            targetType: 'order', targetId: order.id,
            metadata: { provider: 'stripe', refunded: obj.amount_refunded, of: obj.amount } });
          outcome = `partial refund ${obj.amount_refunded}/${obj.amount}`;
          break;
        }
        const done = await settleAsRefunded(order.id, 'Refunded in Stripe', { actorId: 'stripe' });
        outcome = done ? 'refunded' : 'refund could not be applied';
        break;
      }

      case 'charge.dispute.created': {
        const order = await orderFor(obj);
        orderId = order?.id ?? null;
        if (!order) { outcome = 'dispute for an unknown order'; break; }
        /* Written before the status moves, and whatever the status is: a
           dispute on an order this shop already refunded is precisely the case
           worth recording. */
        await recordChargeback({
          order, amount: obj.amount, currency: (obj.currency || 'eur').toUpperCase(),
          provider: 'stripe', paymentId: obj.payment_intent || obj.charge || obj.id,
          reason: obj.reason || null, source: 'psp',
        }).catch((e) => console.error('[stripe] chargeback ledger:', e.message));
        const done = await settleAsRefunded(order.id, `Chargeback: ${obj.reason || 'disputed'}`,
          { actorId: 'stripe', silent: true });
        outcome = done ? 'chargeback recorded and order refunded' : 'chargeback recorded';
        break;
      }

      default:
        outcome = 'ignored';
    }
  } catch (err) {
    console.error('[stripe] handler error:', err.message);
    /* Recorded as an error, which claim() hands back to the next delivery,
       and answered 500 so Stripe makes that delivery. Answering 200 here left
       a paid order pending with the retry dismissed as a duplicate. */
    await finish('stripe', event, `error: ${String(err.message).slice(0, 200)}`, orderId);
    alertOwner('webhook.failed', {
      title: `Stripe webhook failed: ${event.type}`,
      lines: [`Error: ${String(err.message || 'unknown').slice(0, 200)}`, 'Stripe will retry; we answered 500 so that it does.'],
      url: `${config.appUrl}/admin/payments`, key: event.id,
    }).catch(() => {});
    return res.status(500).json({ received: false });
  }

  await finish('stripe', event, outcome, orderId);
  res.json({ received: true });
});

export default router;
