/**
 * Mollie: start a payment, and receive the webhook that confirms it.
 *
 * The webhook is the only thing that may move an order to paid. A buyer landing
 * back on the redirect URL proves nothing — they can reach that URL by typing
 * it, and a real payment often confirms AFTER they have closed the tab (iDEAL
 * out of a banking app frequently does). Everything the storefront shows on
 * return is read back from the order the webhook already updated.
 */
import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { config } from '../config/env.js';
import { asyncHandler } from '../middleware/error.js';
import { publicCache } from '../utils/httpCache.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { ApiError } from '../utils/errors.js';
import {
  isEnabled, createPayment, getPayment, orderEffect, availableMethods, SUPPORTED_METHODS,
} from '../services/mollieService.js';
import { getOrder, markPaymentReceived, transitionOrder, setPspPayment } from '../services/orderService.js';
import { audit } from '../services/auditService.js';
import { recordChargeback } from '../services/chargebackService.js';
import { get } from '../db/index.js';

const router = Router();

/** Where Mollie must call us back. Reachable from the public internet, always. */
const webhookUrl = () => {
  const base = config.payments.mollie.webhookBase || config.apiUrl;
  return `${String(base).replace(/\/+$/, '')}/api/payments/mollie/webhook`;
};

/**
 * Move an order to `refunded`, retrying if it loses a race.
 *
 * `transitionOrder` guards its UPDATE on the status it observed, so a caller
 * that loses a race gets the order back unchanged rather than an error. That is
 * the right behaviour — it is what stops an order being dispensed or emailed
 * twice — but for a refund it is dangerous to ignore: the money really has gone
 * back, and this is the only thing that records it.
 *
 * A refund webhook arriving while auto-dispense is still completing the order is
 * exactly that race, and it is not hypothetical: it fires whenever a payment is
 * refunded seconds after it settled. Every status that can still reach
 * `refunded` is re-read and retried, so the loser of one race wins the next.
 */
const REFUND_BACKOFF_MS = [0, 120, 350, 900];

async function settleAsRefunded(orderId, reason) {
  for (const wait of REFUND_BACKOFF_MS) {
    // Retrying instantly loses to the same background step every time — the
    // fulfilment pipeline is mid-flight, not finished. A short, widening pause
    // lets it land so the refund can be applied on top of a settled order.
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const result = await transitionOrder(orderId, 'refunded', { actorId: 'mollie', reason })
      .catch((e) => { console.warn(`[mollie] refund transition: ${e.message}`); return null; });
    if (result?.status === 'refunded') return true;
    // A terminal status that can never reach refunded — retrying is pointless.
    if (result && ['cancelled', 'failed'].includes(result.status)) return false;
  }
  return false;
}

/**
 * The single place a payment's state is applied to an order.
 *
 * Shared by the webhook and by the return-from-Mollie poll, because Mollie's
 * webhook can be slower than the buyer's browser — and a buyer staring at
 * "pending" on an order they just paid for is how support tickets are made.
 * Both paths are safe to run repeatedly.
 */
export async function applyPayment(paymentId, ctx = {}) {
  const payment = await getPayment(paymentId);
  const orderId = payment.orderId;
  if (!orderId) return { ok: false, reason: 'payment has no orderId in metadata' };

  const order = await getOrder(orderId);
  if (!order) return { ok: false, reason: `unknown order ${orderId}` };

  // The amount is checked against OUR record, not Mollie's description. A
  // payment for the wrong amount must never mark an order paid.
  if (payment.amountCents !== order.total) {
    console.error(`[mollie] amount mismatch on ${order.number}: paid ${payment.amountCents}, owed ${order.total}`);
    await audit({
      actor: { id: 'mollie', email: 'mollie' }, action: 'order.payment_mismatch',
      targetType: 'order', targetId: order.id,
      metadata: { paymentId, paid: payment.amountCents, owed: order.total },
    }).catch(() => {});
    return { ok: false, reason: 'amount mismatch' };
  }

  await setPspPayment(order.id, {
    provider: 'mollie', paymentId: payment.id, status: payment.status,
  }).catch(() => {});

  const { effect, reason } = orderEffect(payment);

  if (effect === 'paid') {
    // Idempotent by construction: the state machine refuses to move an order
    // that has already left `pending`, so a replayed webhook is a no-op.
    if (order.status !== 'pending') return { ok: true, effect, skipped: 'already settled' };
    await markPaymentReceived(order.id, payment.id, { actorId: 'mollie', reason, ...ctx });
    await audit({
      actor: { id: 'mollie', email: 'mollie' }, action: 'order.payment_received',
      targetType: 'order', targetId: order.id,
      metadata: { provider: 'mollie', method: payment.method, paymentId: payment.id },
    }).catch(() => {});
    return { ok: true, effect };
  }

  if (effect === 'refunded' || effect === 'chargeback') {
    // Written before the status changes, and outside the already-refunded
    // shortcut below: a chargeback can land on an order we already refunded, and
    // that is precisely the case worth recording. It is also idempotent per
    // payment id, so Mollie repeating the webhook cannot double someone's
    // apparent history and push their next order into a block.
    if (effect === 'chargeback') {
      await recordChargeback({
        order, amount: payment.chargedBackCents, currency: payment.currency,
        provider: 'mollie', paymentId: payment.id,
        reason: payment.failureReason || 'Charged back via Mollie', source: 'psp',
      }).catch((e) => console.error('[mollie] chargeback ledger:', e.message));
    }
    if (order.status === 'refunded') return { ok: true, effect, skipped: 'already refunded' };
    const refunded = await settleAsRefunded(order.id, reason);
    if (!refunded) {
      // Reported rather than swallowed: an order that Mollie has refunded but we
      // still show as live is a code we hand out for money we no longer have.
      console.error(`[mollie] could not refund ${order.number} — status did not move`);
      await audit({
        actor: { id: 'mollie', email: 'mollie' }, action: 'order.refund_stuck',
        targetType: 'order', targetId: order.id, metadata: { paymentId: payment.id, effect },
      }).catch(() => {});
      return { ok: false, effect, reason: 'order status would not move to refunded' };
    }
    await audit({
      actor: { id: 'mollie', email: 'mollie' }, action: 'order.refunded',
      targetType: 'order', targetId: order.id,
      metadata: { provider: 'mollie', paymentId: payment.id, effect },
    }).catch(() => {});
    return { ok: true, effect };
  }

  // partial_refund and retryable both leave the order where it is on purpose:
  // a partial refund is not a cancelled order, and a declined card is a buyer
  // who may simply pick another method. See orderEffect() for the reasoning.
  return { ok: true, effect, note: reason };
}

/**
 * The webhook.
 *
 * Mollie sends `id=tr_xxx` as form data and nothing else — no signature, no
 * status. That id is a hint from an unauthenticated caller, so the only thing
 * this route does with it is ask Mollie's API what the payment really is.
 *
 * Mounted with its own urlencoded parser so it works regardless of where the
 * global JSON parser sits.
 */
router.post('/mollie/webhook',
  express.urlencoded({ extended: false, limit: '16kb' }),
  // Generous, because Mollie retries: this must not be the reason a real
  // confirmation is dropped. Tight enough that a flood cannot spin up API calls.
  rateLimit({ bucket: 'mollie_webhook', windowMs: 60_000, max: 240 }),
  async (req, res) => {
    const id = String(req.body?.id || '').trim();
    // Mollie retries on any non-2xx. A malformed call is not going to improve on
    // a retry, so it is accepted and dropped rather than looped forever.
    if (!/^tr_[A-Za-z0-9]+$/.test(id)) {
      console.warn('[mollie] webhook without a usable payment id');
      return res.status(200).send('ignored');
    }
    try {
      const result = await applyPayment(id);
      if (!result.ok) console.warn(`[mollie] webhook ${id}: ${result.reason}`);
      return res.status(200).send('ok');
    } catch (err) {
      // A 500 asks Mollie to try again, which is what we want for a transient
      // failure — their API being down, or ours losing the database for a
      // moment. Missing this confirmation entirely is the worse outcome.
      console.error('[mollie] webhook failed:', err.message);
      return res.status(500).send('retry');
    }
  });

export default router;

/** Routes that need the normal JSON parser — mounted under /api. */
export const mollieApi = Router();

/**
 * Which methods to offer, priced for THIS order.
 *
 * Asked live because the answer depends on the amount and the country: iDEAL
 * has a ceiling, Bancontact is Belgian, and Apple Pay only exists on hardware
 * that can use it. Offering a method the buyer then cannot pick is a dead end at
 * the last step of the funnel.
 */
mollieApi.get('/mollie/methods', asyncHandler(async (req, res) => {
  /* Public, and identical for everyone who asks the same question: the answer
     depends only on `amount` and `locale`, both of which are in the query string
     and therefore part of the cache key. Without a header this was a round trip
     to Mollie's API on every checkout view, with no edge cache and no
     per-instance cache either. Which methods a shop offers changes on the order
     of never, so five minutes is conservative. */
  publicCache(res, 300);
  if (!isEnabled()) return res.json({ methods: [] });
  const cents = Number(req.query.amount) || 0;
  const methods = await availableMethods({
    cents: cents > 0 ? cents : undefined,
    locale: req.query.locale === 'en' ? 'en_US' : 'nl_NL',
  }).catch((e) => { console.error('[mollie] methods:', e.message); return []; });
  res.json({ methods });
}));

/**
 * Start (or resume) a payment for an order.
 *
 * Resuming matters: a buyer who bounced off the bank app and came back should
 * land on the same payment rather than a second one. Mollie's idempotency key
 * covers the create, and an open payment we already stored short-circuits it
 * entirely.
 */
mollieApi.post('/orders/:id/mollie',
  rateLimit({ bucket: 'pay', windowMs: 60_000, max: 30, shared: true }),
  asyncHandler(async (req, res) => {
    if (!isEnabled()) throw new ApiError(400, 'Mollie is not configured');

    const body = z.object({
      email: z.string().email().optional(),
      method: z.enum(SUPPORTED_METHODS).optional(),
      locale: z.enum(['nl', 'en']).optional(),
    }).parse(req.body || {});

    const order = await getOrder(req.params.id);
    if (!order) throw new ApiError(404, 'Order not found');
    const { assertOwnsOrder } = await import('./catalog.js');
    await assertOwnsOrder(req, order, body.email);

    if (order.status !== 'pending') {
      // Not an error: the buyer came back to a link for an order that has since
      // been paid. Say so instead of starting a second payment.
      return res.json({ alreadySettled: true, status: order.status });
    }

    // An existing open payment is reused rather than replaced.
    const row = await get('SELECT psp_provider, psp_payment_id, psp_status, psp_checkout_url FROM orders WHERE id=@id',
      { id: order.id });
    if (row?.psp_provider === 'mollie' && row.psp_payment_id && row.psp_checkout_url
        && ['open', 'pending'].includes(row.psp_status || '')) {
      // Confirm with Mollie before handing the buyer a URL that may have expired.
      const live = await getPayment(row.psp_payment_id).catch(() => null);
      if (live && ['open', 'pending'].includes(live.status)) {
        return res.json({ checkoutUrl: row.psp_checkout_url, paymentId: row.psp_payment_id, resumed: true });
      }
    }

    const payment = await createPayment(order, {
      redirectUrl: `${config.appUrl.replace(/\/+$/, '')}/checkout/success?order=${encodeURIComponent(order.id)}&n=${encodeURIComponent(order.number)}`,
      webhookUrl: webhookUrl(),
      method: body.method || null,
      locale: body.locale === 'en' ? 'en_US' : 'nl_NL',
    });

    await setPspPayment(order.id, {
      provider: 'mollie', paymentId: payment.id, status: payment.status,
      checkoutUrl: payment.checkoutUrl,
    });

    await audit({
      actor: { id: order.userId || 'guest', email: order.email }, action: 'order.payment_started',
      targetType: 'order', targetId: order.id,
      metadata: { provider: 'mollie', paymentId: payment.id, method: body.method || 'buyer-choice' }, req,
    }).catch(() => {});

    res.status(201).json({ checkoutUrl: payment.checkoutUrl, paymentId: payment.id });
  }));

/**
 * Called by the storefront when the buyer returns from Mollie.
 *
 * Purely a nudge: it applies whatever Mollie already knows so the status page is
 * right immediately, instead of showing "awaiting payment" to someone who just
 * paid while the webhook is still in flight. The webhook remains the thing that
 * guarantees the order settles even if nobody ever comes back.
 *
 * A guest coming back from a banking app has no session and no email to hand —
 * the redirect only carries the order id and number. Those two together are
 * accepted as proof here, exactly as /api/track already treats the order number
 * as the public handle for a status. Nothing beyond that status is returned.
 */
mollieApi.post('/orders/:id/mollie/sync',
  rateLimit({ bucket: 'pay', windowMs: 60_000, max: 30, shared: true }),
  asyncHandler(async (req, res) => {
    if (!isEnabled()) throw new ApiError(400, 'Mollie is not configured');
    const order = await getOrder(req.params.id);
    if (!order) throw new ApiError(404, 'Order not found');
    const knowsNumber = String(req.body?.number || '').trim().toUpperCase() === order.number.toUpperCase();
    if (!knowsNumber) {
      const { assertOwnsOrder } = await import('./catalog.js');
      await assertOwnsOrder(req, order, req.body?.email);
    }

    const row = await get('SELECT psp_payment_id FROM orders WHERE id=@id', { id: order.id });
    if (!row?.psp_payment_id) return res.json({ status: order.status });

    await applyPayment(row.psp_payment_id).catch((e) => console.error('[mollie] sync:', e.message));
    const fresh = await getOrder(order.id);
    res.json({ status: fresh.status, statusLabel: fresh.statusLabel });
  }));
