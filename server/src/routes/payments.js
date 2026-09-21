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
import { constructEvent } from '../services/stripeService.js';
import { getOrder, markPaymentReceived, setPspPayment } from '../services/orderService.js';
import { settleAsRefunded } from '../services/refundSettlement.js';
import { recordChargeback } from '../services/chargebackService.js';
import { audit } from '../services/auditService.js';
import { run, get, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';

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
    `SELECT id, outcome FROM webhook_events WHERE provider=@p AND event_id=@e`,
    { p: provider, e: event.id });
  if (existing) return { fresh: false, outcome: existing.outcome };
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

async function markPaid(order, session, why) {
  if (!order) return 'order not found';
  if (order.status !== 'pending') return 'already settled';
  await markPaymentReceived(order.id, session.payment_intent || session.id,
    { actorId: 'stripe', reason: why });
  await audit({ actor: { id: 'stripe', email: 'stripe' }, action: 'order.payment_received',
    targetType: 'order', targetId: order.id, metadata: { provider: 'stripe' } });
  return 'paid';
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
          outcome = await markPaid(order, obj, 'Stripe payment confirmed');
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
        outcome = await markPaid(order, obj, 'Stripe payment settled');
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
          { actorId: 'stripe' });
        outcome = done ? 'chargeback recorded and order refunded' : 'chargeback recorded';
        break;
      }

      default:
        outcome = 'ignored';
    }
  } catch (err) {
    console.error('[stripe] handler error:', err.message);
    outcome = `error: ${err.message}`;
    // 200 anyway so Stripe doesn't retry a non-retryable app error indefinitely.
  }

  await finish('stripe', event, outcome, orderId);
  res.json({ received: true });
});

export default router;
