/**
 * Pay.: start a payment, receive the exchange call that says something changed,
 * and settle the order from what Pay.'s API reports.
 *
 * The same rules as the Mollie routes, for the same reasons:
 *   - Only the API decides. The exchange call is unauthenticated input that at
 *     most tells us WHICH of our orders to re-check; its status, action and
 *     amount fields are never read for a decision.
 *   - The buyer landing on the return URL proves nothing; the return page asks
 *     the server to re-check, and the server asks Pay.
 *   - Everything is safe to run twice: the order state machine refuses to move
 *     an order that already left `pending`.
 */
import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { config, paynlMethods } from '../config/env.js';
import { asyncHandler } from '../middleware/error.js';
import { requireLaunched } from '../services/launchGateService.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { ApiError } from '../utils/errors.js';
import {
  isEnabled, createPayment, getPayment, orderEffect, mismatchReasons, PAY_ID, referenceFor,
} from '../services/paynlService.js';
import { getOrder, markPaymentReceived, setPspPayment } from '../services/orderService.js';
import { audit } from '../services/auditService.js';
import { alertOwner } from '../services/notifyService.js';
import { all, get, run, tx, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';

const router = Router();

/* Keys saved in the admin on another instance reach this one through the
   keystore refresh; these routes are mounted before the catalog router that
   normally runs it, so they run it themselves. */
const fresh = () => import('../services/secretStore.js').then((m) => m.refreshStoredSecrets()).catch(() => {});

/** Where Pay. must call us back. Reachable from the public internet, always. */
export const exchangeUrl = () => {
  const base = config.payments.paynl.exchangeBase || config.apiUrl;
  return `${String(base).replace(/\/+$/, '')}/api/payments/paynl/exchange`;
};

const ACTOR = { id: 'paynl', email: 'paynl' };

/** Attempt statuses that can no longer take money. */
const FINAL_UNPAID = ['canceled', 'expired', 'failed', 'gone'];

/**
 * The Pay. payments of an order that still matter, newest first: every attempt
 * that could still take (or has taken) money, the order's own slot, and any
 * attempt an exchange call named explicitly. Abandoned attempts that Pay. has
 * closed are not asked about again.
 */
async function attemptsFor(orderId, mustInclude = []) {
  const rows = await all(
    `SELECT payment_id, status FROM psp_attempts
      WHERE order_id = @o AND provider = 'paynl'
        AND (status IS NULL OR status <> ALL(@final) OR payment_id = ANY(@must))
      ORDER BY created_at DESC LIMIT 25`, { o: orderId, final: FINAL_UNPAID, must: mustInclude });
  const slot = await get('SELECT psp_provider, psp_payment_id, psp_status FROM orders WHERE id=@id', { id: orderId });
  if (slot?.psp_provider === 'paynl' && slot.psp_payment_id && !rows.some((r) => r.payment_id === slot.psp_payment_id)) {
    rows.unshift({ payment_id: slot.psp_payment_id, status: slot.psp_status });
  }
  return { rows, current: slot?.psp_provider === 'paynl' ? slot.psp_payment_id : null };
}

/** Recorded only once everything the status asked for has been done. */
async function saveAttempt(orderId, paymentId, status, isCurrent) {
  await run(`UPDATE psp_attempts SET status=@s, checked_at=@at WHERE provider='paynl' AND payment_id=@p`,
    { s: status, p: paymentId, at: nowIso() });
  if (isCurrent) await setPspPayment(orderId, { status });
}

/**
 * The single place Pay.'s view of an order's payments is applied to it.
 *
 * Shared by the exchange call, the return-page sync and the reconciliation.
 * It asks Pay. about the payments WE started for this order — an id from a
 * callback only ever chooses which order to look at. Every live attempt is
 * checked, not just the newest: a payment the buyer abandoned and then
 * finished after all is still money.
 *
 * One attempt failing does not stop the others being checked; the error is
 * raised afterwards so the caller (and Pay.'s retry) tries again.
 */
export async function applyPaynl(orderId, ctx = {}, { mustInclude = [] } = {}) {
  let order = await getOrder(orderId);
  if (!order) return { ok: false, reason: `unknown order ${orderId}` };
  const { rows, current } = await attemptsFor(order.id, mustInclude);
  if (!rows.length) return { ok: false, reason: 'no Pay. payment on this order' };

  let outcome = null, error = null;
  for (const attempt of rows) {
    let res;
    try {
      res = await applyAttempt(order, attempt, attempt.payment_id === current, ctx);
    } catch (err) {
      if (err.status === 404) {
        // Pay. has no such order: final for this attempt, and recorded so.
        await saveAttempt(order.id, attempt.payment_id, 'gone', false).catch(() => {});
        continue;
      }
      error = error || err;
      continue;
    }
    if (res.settled) order = await getOrder(order.id);
    if (!outcome || res.settled || (outcome.effect !== 'paid' && attempt.payment_id === current)) outcome = res;
  }
  if (error) throw error;
  return outcome || { ok: false, reason: 'no Pay. payment could be checked' };
}

/** A paid Pay. payment the order cannot take: the buyer's money, for a person. */
async function strayPayment(order, payment, why) {
  await audit({ actor: ACTOR, action: 'order.payment_stray', targetType: 'order', targetId: order.id,
    metadata: { provider: 'paynl', paymentId: payment.id, orderStatus: order.status, paymentRef: order.paymentRef, why } });
  await alertOwner('webhook.failed', {
    title: `Extra Pay. payment on order ${order.number}, which is ${order.status}`,
    lines: [`Payment ${payment.id} is not the one that settled this order (${order.paymentRef || 'none'}).`,
      why, 'Refund it in my.pay.nl, or settle the order by hand.'],
    url: `${config.appUrl}/admin/orders`, key: `paynl-stray-${payment.id}`,
  });
}

/**
 * Settle the order with this paid payment — at most one payment ever wins.
 *
 * The order is claimed first with a conditional write (still pending, and no
 * other payment named on it), so two workers holding two different paid
 * attempts cannot both "settle": the loser is told it lost and reports the
 * second payment instead of overwriting the first.
 */
async function settleWith(order, payment, reason, ctx) {
  const claim = await get(
    `UPDATE orders SET payment_ref=@r, updated_at=@at
      WHERE id=@id AND status='pending' AND (payment_ref IS NULL OR payment_ref=@r) RETURNING id`,
    { id: order.id, r: payment.id, at: nowIso() });
  if (!claim) {
    const now = await getOrder(order.id);
    if (now.paymentRef === payment.id && now.status !== 'pending' && now.status !== 'cancelled') return { settled: false, already: true };
    await strayPayment(now, payment, now.status === 'pending'
      ? 'Another payment is already being settled for this order.'
      : `The order was already ${now.status} when this payment arrived.`);
    return { settled: false, stray: true };
  }
  await setPspPayment(order.id, { provider: 'paynl', paymentId: payment.id, status: payment.status });
  try {
    await markPaymentReceived(order.id, payment.id, { actorId: 'paynl', reason, ...ctx });
  } catch (err) {
    /* Our own state machine refused (the order was cancelled between the
       claim and the move). Not Pay.'s answer, and not something a retry
       fixes — but it IS money on an order that will not deliver. */
    const now = await getOrder(order.id);
    if (now.status === 'pending') throw err;   // a real failure: let the caller retry
    if (now.status !== 'payment_received' && !['processing', 'awaiting_fulfillment', 'completed'].includes(now.status)) {
      await strayPayment(now, payment, `The order could not be settled: ${err.message}`);
      return { settled: false, stray: true };
    }
  }
  await audit({ actor: ACTOR, action: 'order.payment_received', targetType: 'order', targetId: order.id,
    metadata: { provider: 'paynl', method: payment.method, paymentId: payment.id } }).catch(() => {});
  return { settled: true };
}

async function applyAttempt(order, attempt, isCurrent, ctx) {
  const payment = await getPayment(attempt.payment_id);
  const changed = payment.status !== attempt.status;
  const done = () => saveAttempt(order.id, payment.id, payment.status, isCurrent);

  const mismatch = mismatchReasons(payment, order);
  if (mismatch.length) {
    /* A payment that is not exactly this order's never settles it. Recorded
       once per status, and the owner hears about it when it claims to be
       paid — that is money with nothing attached to it. */
    if (changed) {
      console.error(`[paynl] ${order.number} does not match Pay. payment ${payment.id}: ${mismatch.join('; ')}`);
      await audit({ actor: ACTOR, action: 'order.payment_mismatch', targetType: 'order', targetId: order.id,
        metadata: { provider: 'paynl', paymentId: payment.id, status: payment.status, mismatch } });
      if (payment.status === 'paid') {
        await alertOwner('webhook.failed', {
          title: `Pay. payment does not match order ${order.number}`,
          lines: [...mismatch, 'The order was NOT marked paid. Check the payment in my.pay.nl.'],
          url: `${config.appUrl}/admin/orders`, key: `paynl-mismatch-${payment.id}`,
        });
      }
    }
    await done();
    return { ok: false, effect: 'mismatch', reason: `mismatch: ${mismatch.join('; ')}` };
  }

  const { effect, reason } = orderEffect(payment);

  if (effect === 'paid') {
    let res = { settled: false };
    if (order.status === 'pending') {
      res = await settleWith(order, payment, reason, ctx);
    } else if (order.paymentRef !== payment.id && changed) {
      /* Paid, on an order that has moved on — a second attempt the buyer also
         finished, or a payment on an order the 14-day sweep cancelled. */
      await strayPayment(order, payment, `The order was already ${order.status} when this payment arrived.`);
      res = { stray: true };
    }
    await done();
    if (res.settled) return { ok: true, effect, settled: true };
    if (res.stray) return { ok: true, effect, skipped: 'paid on a settled order — owner alerted' };
    return { ok: true, effect, skipped: 'already settled' };
  }

  if (effect === 'attention' && order.status !== 'refunded' && changed) {
    /* A refund or chargeback Pay. reports. Not applied automatically (see
       paynlService): an order already refunded here is the expected echo of a
       refund made in my.pay.nl; anything else is for the owner to settle. */
    await audit({ actor: ACTOR, action: 'order.psp_attention', targetType: 'order', targetId: order.id,
      metadata: { provider: 'paynl', paymentId: payment.id, status: payment.status, code: payment.code } });
    await alertOwner('webhook.failed', {
      title: `Pay. reports a ${payment.status} on order ${order.number}`,
      lines: [`Status code ${payment.code}. The order is still ${order.status} here.`,
        'Check it in my.pay.nl and refund or settle the order in the admin.'],
      url: `${config.appUrl}/admin/orders`, key: `paynl-${payment.status}-${payment.id}`,
    });
  }
  if (effect === 'verify' && changed) {
    // Pay. holds it for review; nothing moves until the owner decides there.
    await alertOwner('payment.failed', {
      title: `Pay. is holding the payment for order ${order.number} for review`,
      lines: ['Approve or reject it in my.pay.nl within 72 hours, or Pay. cancels it.'],
      url: `${config.appUrl}/admin/orders`, key: `paynl-verify-${payment.id}`,
    });
  }
  if (effect === 'retryable' && changed) {
    await audit({ actor: ACTOR, action: 'order.payment_failed', targetType: 'order', targetId: order.id,
      metadata: { provider: 'paynl', paymentId: payment.id, status: payment.status, reason } });
  }
  await done();
  return { ok: true, effect, note: reason };
}

/** Every id-shaped value the exchange call carries. Hints for a lookup, nothing more. */
function exchangeHints(req) {
  const ids = new Set(), refs = new Set();
  for (const src of [req.query || {}, req.body && typeof req.body === 'object' ? req.body : {}]) {
    const obj = src.object && typeof src.object === 'object' ? src.object : {};
    for (const v of [src.id, src.orderId, src.order_id, obj.id, obj.orderId, obj.order_id]) {
      if (v != null && PAY_ID.test(String(v))) ids.add(String(v));
    }
    for (const v of [src.reference, obj.reference, src.extra1]) {
      if (v != null && /^[A-Za-z0-9]{6,64}$/.test(String(v))) refs.add(String(v));
    }
  }
  return { ids: [...ids].slice(0, 5), refs: [...refs].slice(0, 3) };
}

/**
 * Re-check the Pay. attempts that could still take money, longest-unchecked
 * first — across every order status, so a payment finished on an order the
 * 14-day sweep already cancelled still reaches the owner. Each run moves the
 * checked ones to the back of the queue, so abandoned checkouts cannot starve
 * a real payment. Bounded by count and deadline.
 */
export async function reconcilePaynl({ limit = 10, deadline = Date.now() + 6_000, olderThanMs = 10 * 60_000 } = {}) {
  if (!isEnabled()) return { checked: 0, paid: 0 };
  const now = Date.now();
  const rows = await all(
    `SELECT order_id FROM psp_attempts
      WHERE provider = 'paynl' AND (status IS NULL OR status <> ALL(@final))
        AND NOT (status = 'paid' AND checked_at IS NOT NULL)
        AND created_at < @young AND created_at > @old
      GROUP BY order_id ORDER BY MIN(COALESCE(checked_at, '')) ASC LIMIT @l`,
    { final: FINAL_UNPAID, young: new Date(now - olderThanMs).toISOString(),
      old: new Date(now - 16 * 86_400_000).toISOString(), l: limit });
  let checked = 0, paid = 0, errors = 0;
  for (const r of rows) {
    if (Date.now() >= deadline) break;
    checked++;
    try {
      const res = await applyPaynl(r.order_id, { reason: 'Pay. payment found by reconciliation' });
      if (res?.settled) paid++;
    } catch (e) {
      errors++;
      console.error('[paynl] reconcile:', e.message);
    }
  }
  return { checked, paid, errors };
}

/**
 * The exchange call. Pay. sends it as GET or POST, as a form or as JSON, and
 * wants "TRUE|…" back (or {"result": true} for JSON); anything else, or no
 * answer within five seconds, makes it retry on the sales location's schedule.
 *
 * Mounted with its own parsers, before the JSON parser, attachUser and the
 * general rate limit — and NOT behind the launch gate: money already in flight
 * must always settle.
 */
router.all('/paynl/exchange',
  express.urlencoded({ extended: false, limit: '32kb' }),
  express.json({ limit: '64kb' }),
  rateLimit({ bucket: 'paynl_exchange', windowMs: 60_000, max: 240, shared: true }),
  async (req, res) => {
    const json = req.is('application/json');
    const reply = (ok, msg, status = 200) => (json
      ? res.status(status).json({ result: ok, message: msg })
      : res.status(status).type('text/plain').send(`${ok ? 'TRUE' : 'FALSE'}|${msg}`));
    await fresh();
    if (!isEnabled()) return reply(true, 'not configured');

    const { ids, refs } = exchangeHints(req);
    // Nothing that could name a payment: not Pay., and nothing to look at.
    if (!ids.length && !refs.length) return reply(true, 'ignored');
    let key = ids[0] || refs[0];
    try {
      let row = ids.length ? await get(
        `SELECT order_id AS id, payment_id FROM psp_attempts
          WHERE provider = 'paynl' AND (payment_id = ANY(@ids) OR pay_order_id = ANY(@ids)) LIMIT 1`, { ids }) : null;
      if (!row && ids.length) {
        row = await get(`SELECT id, psp_payment_id AS payment_id FROM orders
                          WHERE psp_provider = 'paynl' AND psp_payment_id = ANY(@ids) LIMIT 1`, { ids });
      }
      if (!row && refs.length) {
        row = await get(
          `SELECT id, NULL AS payment_id FROM orders
            WHERE psp_provider = 'paynl' AND regexp_replace(number, '[^A-Za-z0-9]', '', 'g') = ANY(@refs) LIMIT 1`,
          { refs });
      }
      if (!row) {
        /* Id-shaped but unmatched — perhaps a payload format we do not know.
           Acknowledged (a retry will not match either), and the open attempts
           are re-checked — at most once every 30 seconds across all instances,
           so forged calls cannot be turned into a stream of Pay. requests. */
        const { claimInterval } = await import('../services/bootUpkeep.js');
        if (await claimInterval('paynl_exchange_sweep', 30_000).catch(() => false)) {
          await reconcilePaynl({ limit: 5, olderThanMs: 0, deadline: Date.now() + 3_500 }).catch(() => {});
        }
        return reply(true, 'checked');
      }
      if (row.payment_id) key = row.payment_id;
      const result = await applyPaynl(row.id, {}, { mustInclude: row.payment_id ? [row.payment_id] : [] });
      if (!result.ok) console.warn(`[paynl] exchange ${key}: ${result.reason}`);
      return reply(true, 'ok');
    } catch (err) {
      /* Not acknowledged: Pay. retries, and the owner hears about it. A 401 or
         403 means our credentials are wrong — a configuration problem that
         blocks every payment, not an answer about this one. */
      const auth = err.status === 401 || err.status === 403;
      console.error('[paynl] exchange failed:', err.message);
      await alertOwner('webhook.failed', {
        title: auth ? 'Pay. refuses our credentials' : `Pay. exchange failed for ${key}`,
        lines: [`Error: ${String(err.message || 'unknown').slice(0, 200)}`,
          auth ? 'Check the Pay. service id and secret in Keys and connections.'
            : 'Pay. will retry; we answered FALSE so that it does.',
          'Until this is fixed, paid orders may stay pending.'],
        url: `${config.appUrl}/admin/orders`, key: auth ? 'paynl-auth' : `paynl-${key}`,
      }).catch(() => {});
      return reply(false, 'retry', 500);
    }
  });

export default router;

/** Routes that need the normal JSON parser — mounted under /api. */
export const paynlApi = Router();

/**
 * Start (or resume) a Pay. payment for an order.
 *
 * Pay. has no idempotency key, so the order row is locked while the payment is
 * created: a double tap waits for the first, finds its payment and resumes it,
 * instead of opening a second one the buyer could also pay.
 */
paynlApi.post('/orders/:id/paynl', requireLaunched('Payment', { money: true }),
  rateLimit({ bucket: 'pay', windowMs: 60_000, max: 30, shared: true }),
  asyncHandler(async (req, res) => {
    await fresh();
    if (!isEnabled()) throw new ApiError(400, 'Pay. is not configured');
    const offered = paynlMethods().map((m) => m.id);
    const body = z.object({
      email: z.string().email().optional(),
      method: z.string().optional(),
    }).parse(req.body || {});

    const order = await getOrder(req.params.id);
    if (!order) throw new ApiError(404, 'Order not found');
    const { assertOwnsOrder } = await import('./catalog.js');
    await assertOwnsOrder(req, order, body.email);
    if (order.status !== 'pending') return res.json({ alreadySettled: true, status: order.status });

    const base = config.appUrl.replace(/\/+$/, '');
    let method = null;
    /* Pay. refusing to START a payment ("This service is blocked" while the
       account awaits activation, a disabled method, a 4xx/5xx) is not a crash
       in this shop: the buyer got "Internal server error" and the owner a "500"
       page. The buyer is now told plainly that nothing was charged, and the
       owner gets Pay.'s own reason, once per minute per reason. */
    let out;
    try {
      out = await tx(async () => {
        const row = await get(`SELECT status, psp_provider, psp_payment_id, psp_status, psp_checkout_url, psp_method
                                 FROM orders WHERE id=@id FOR UPDATE`, { id: order.id });
        if (row?.status !== 'pending') return { alreadySettled: true, status: row?.status };
        // No method named (the account page's "Pay" button): the one already started.
        method = offered.includes(body.method) ? body.method
          : offered.includes(row.psp_method) ? row.psp_method : (offered[0] || null);
        /* A payment Pay. is holding for review may already have taken the money.
           A second one now would charge the buyer twice. */
        const held = await get(`SELECT 1 FROM psp_attempts WHERE order_id=@o AND provider='paynl' AND status='verify' LIMIT 1`,
          { o: order.id });
        if (held) return { underReview: true };
        // An open payment for the same method is resumed after asking Pay. about it.
        if (row.psp_provider === 'paynl' && row.psp_payment_id && row.psp_checkout_url
            && ['open', 'pending'].includes(row.psp_status || '')) {
          const live = await getPayment(row.psp_payment_id).catch(() => null);
          if (live?.status === 'paid') return { settleNow: true };
          if (live && ['open', 'pending'].includes(live.status) && (row.psp_method || null) === method) {
            return { checkoutUrl: row.psp_checkout_url, paymentId: row.psp_payment_id, resumed: true };
          }
        }
        const payment = await createPayment(order, {
          returnUrl: `${base}/checkout/success?order=${encodeURIComponent(order.id)}&n=${encodeURIComponent(order.number)}`,
          exchangeUrl: exchangeUrl(),
          method,
      });
      await run(`INSERT INTO psp_attempts (id, order_id, provider, payment_id, pay_order_id, method, status, created_at)
                 VALUES (@id, @o, 'paynl', @p, @po, @m, @s, @at) ON CONFLICT (provider, payment_id) DO NOTHING`,
        { id: newId('psa'), o: order.id, p: payment.id, po: payment.payOrderId ? String(payment.payOrderId) : null,
          m: method, s: payment.status, at: nowIso() });
      await setPspPayment(order.id, { provider: 'paynl', paymentId: payment.id, status: payment.status,
        checkoutUrl: payment.checkoutUrl, method });
      return { checkoutUrl: payment.checkoutUrl, paymentId: payment.id, created: true };
      });
    } catch (err) {
      if (err instanceof ApiError || !Number.isInteger(err?.status)) throw err;
      const reason = String(err.message || '').replace(/^Pay\. \S+ \S+: /, '').slice(0, 160);
      console.error(`[paynl] start refused for ${order.number}: ${err.message}`);
      await alertOwner('payment.failed', {
        title: 'Pay. refused to start a payment',
        lines: [`Order ${order.number}: ${reason || `HTTP ${err.status}`}`,
          'Check the sales location and the account status in my.pay.nl.'],
        url: `${config.appUrl}/admin/orders`,
        key: `paynl-start-${reason.slice(0, 60)}:${new Date().toISOString().slice(0, 16)}`,
      }).catch(() => {});
      throw new ApiError(502, 'The payment could not be started at our payment provider. Nothing has been charged — please try again later or contact us.', 'payment_provider_refused');
    }

    if (out.settleNow) {
      await applyPaynl(order.id).catch((e) => console.error('[paynl] settle on start:', e.message));
      const now = await getOrder(order.id);
      return res.json({ alreadySettled: true, status: now.status });
    }
    if (out.alreadySettled) return res.json(out);
    if (out.underReview) {
      throw new ApiError(409, 'Your payment is being checked by our payment provider. You will hear from us by email — please do not pay again.');
    }
    if (out.created) {
      await audit({
        actor: { id: order.userId || 'guest', email: order.email }, action: 'order.payment_started',
        targetType: 'order', targetId: order.id,
        metadata: { provider: 'paynl', paymentId: out.paymentId, method: method || 'buyer-choice' }, req,
      }).catch(() => {});
    }
    res.status(out.created ? 201 : 200).json({ checkoutUrl: out.checkoutUrl, paymentId: out.paymentId,
      ...(out.resumed ? { resumed: true } : {}) });
  }));

/**
 * The return page's nudge, for every provider: re-check the payment behind the
 * order so the buyer sees "paid" without waiting for the provider's callback.
 *
 * The order id and number together are accepted as proof, exactly like the
 * Mollie sync and /api/track — the redirect from a banking app carries nothing
 * else. Only the status comes back.
 */
paynlApi.post('/orders/:id/payment/sync',
  rateLimit({ bucket: 'pay', windowMs: 60_000, max: 30, shared: true }),
  asyncHandler(async (req, res) => {
    await fresh();
    const order = await getOrder(req.params.id);
    if (!order) throw new ApiError(404, 'Order not found');
    const knowsNumber = String(req.body?.number || '').trim().toUpperCase() === order.number.toUpperCase();
    if (!knowsNumber) {
      const { assertOwnsOrder } = await import('./catalog.js');
      await assertOwnsOrder(req, order, req.body?.email);
    }
    const row = await get('SELECT psp_provider, psp_payment_id FROM orders WHERE id=@id', { id: order.id });
    if (order.status === 'pending' && row?.psp_payment_id) {
      if (row.psp_provider === 'paynl' && isEnabled()) {
        await applyPaynl(order.id).catch((e) => console.error('[paynl] sync:', e.message));
      } else if (row.psp_provider === 'mollie') {
        const m = await import('../services/mollieService.js');
        if (m.isEnabled()) {
          const { applyPayment } = await import('./mollie.js');
          await applyPayment(row.psp_payment_id).catch((e) => console.error('[mollie] sync:', e.message));
        }
      }
    }
    const now = await getOrder(order.id);
    /* A Pay. payment the buyer cancelled (or let expire) leaves the ORDER
       pending — it can still be paid — so the status alone read as "still
       confirming" forever, and a guest had no way back to the payment. Say
       when the latest Pay. attempt is over, so the page can offer a new one. */
    const psp = now.status === 'pending'
      ? await get('SELECT psp_provider, psp_status FROM orders WHERE id=@id', { id: order.id }) : null;
    const retryable = psp?.psp_provider === 'paynl' && ['canceled', 'expired', 'failed'].includes(psp.psp_status || '');
    res.json({ status: now.status, statusLabel: now.statusLabel, ...(retryable ? { paymentRetryable: true } : {}) });
  }));

export { referenceFor };
