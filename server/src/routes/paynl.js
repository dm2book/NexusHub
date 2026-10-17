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

/**
 * Every Pay. payment started for an order, newest first — the attempts table
 * plus the order's own slot (a payment started before attempts were kept).
 * Bounded: a buyer who starts six payments has the newest six checked.
 */
async function attemptsFor(orderId) {
  const rows = await all(
    `SELECT payment_id, status FROM psp_attempts
      WHERE order_id = @o AND provider = 'paynl' ORDER BY created_at DESC LIMIT 6`, { o: orderId });
  const slot = await get('SELECT psp_provider, psp_payment_id, psp_status FROM orders WHERE id=@id', { id: orderId });
  if (slot?.psp_provider === 'paynl' && slot.psp_payment_id && !rows.some((r) => r.payment_id === slot.psp_payment_id)) {
    rows.unshift({ payment_id: slot.psp_payment_id, status: slot.psp_status, slotOnly: true });
  }
  return { rows, current: slot?.psp_provider === 'paynl' ? slot.psp_payment_id : null };
}

/**
 * The single place Pay.'s view of an order's payments is applied to it.
 *
 * Shared by the exchange call, the return-page sync and the maintenance
 * reconciliation. It asks Pay. about the payments WE started for this order —
 * an id from a callback is never used to fetch, only to find the order. Every
 * attempt is checked, not just the newest: a payment the buyer abandoned and
 * then finished after all is still money, and still has to settle the order
 * (or, if another payment already did, reach the owner as a refund to make).
 */
export async function applyPaynl(orderId, ctx = {}) {
  let order = await getOrder(orderId);
  if (!order) return { ok: false, reason: `unknown order ${orderId}` };
  const { rows, current } = await attemptsFor(order.id);
  if (!rows.length) return { ok: false, reason: 'no Pay. payment on this order' };

  let outcome = null;
  for (const attempt of rows) {
    let res;
    try {
      res = await applyAttempt(order, attempt, attempt.payment_id === current, ctx);
    } catch (err) {
      // Pay. saying "no such order" about an OLD attempt is final; anything
      // else (the API down, a timeout) must surface so the caller can retry.
      const permanent = err.status >= 400 && err.status < 500 && err.status !== 429;
      if (permanent && attempt.payment_id !== current) continue;
      throw err;
    }
    if (res.settled) order = await getOrder(order.id);
    // The order's answer is the payment that settled it, else the newest.
    if (!outcome || res.settled || (outcome.effect !== 'paid' && attempt.payment_id === current)) outcome = res;
  }
  return outcome || { ok: false, reason: 'no Pay. payment could be checked' };
}

async function applyAttempt(order, attempt, isCurrent, ctx) {
  const payment = await getPayment(attempt.payment_id);
  const changed = payment.status !== attempt.status;
  if (changed) {
    await run(`UPDATE psp_attempts SET status=@s WHERE provider='paynl' AND payment_id=@p`,
      { s: payment.status, p: payment.id }).catch(() => {});
    if (isCurrent) await setPspPayment(order.id, { status: payment.status }).catch(() => {});
  }

  const mismatch = mismatchReasons(payment, order);
  if (mismatch.length) {
    /* A payment that is not exactly this order's never settles it. Recorded
       once per status, and the owner hears about it when it claims to be
       paid — that is money with nothing attached to it. */
    if (changed) {
      console.error(`[paynl] ${order.number} does not match Pay. payment ${payment.id}: ${mismatch.join('; ')}`);
      await audit({ actor: ACTOR, action: 'order.payment_mismatch', targetType: 'order', targetId: order.id,
        metadata: { provider: 'paynl', paymentId: payment.id, status: payment.status, mismatch } }).catch(() => {});
      if (payment.status === 'paid') {
        alertOwner('webhook.failed', {
          title: `Pay. payment does not match order ${order.number}`,
          lines: [...mismatch, 'The order was NOT marked paid. Check the payment in my.pay.nl.'],
          url: `${config.appUrl}/admin/orders`, key: `paynl-mismatch-${payment.id}`,
        }).catch(() => {});
      }
    }
    return { ok: false, effect: 'mismatch', reason: `mismatch: ${mismatch.join('; ')}` };
  }

  const { effect, reason } = orderEffect(payment);

  if (effect === 'paid') {
    if (order.status !== 'pending') {
      /* Paid, on an order that has moved on. The same payment arriving again is
         normal (Pay. retries); a DIFFERENT one — a second attempt the buyer
         also finished, or any payment on an order the 14-day sweep cancelled —
         is the buyer's money with nothing to show for it, and has to reach a
         person. Once per payment. */
      if (order.paymentRef !== payment.id) {
        if (changed) {
          await audit({ actor: ACTOR, action: 'order.payment_stray', targetType: 'order', targetId: order.id,
            metadata: { provider: 'paynl', paymentId: payment.id, orderStatus: order.status, paymentRef: order.paymentRef } }).catch(() => {});
          alertOwner('webhook.failed', {
            title: `Extra Pay. payment on order ${order.number}, which is ${order.status}`,
            lines: [`Payment ${payment.id} is not the one on the order (${order.paymentRef || 'none'}).`,
              'Refund it in my.pay.nl, or settle the order by hand.'],
            url: `${config.appUrl}/admin/orders`, key: `paynl-stray-${payment.id}`,
          }).catch(() => {});
        }
        return { ok: true, effect, skipped: 'paid on a settled order — owner alerted' };
      }
      return { ok: true, effect, skipped: 'already settled' };
    }
    // The order's slot follows the payment that actually paid.
    await setPspPayment(order.id, { provider: 'paynl', paymentId: payment.id, status: payment.status }).catch(() => {});
    await markPaymentReceived(order.id, payment.id, { actorId: 'paynl', reason, ...ctx });
    await audit({ actor: ACTOR, action: 'order.payment_received', targetType: 'order', targetId: order.id,
      metadata: { provider: 'paynl', method: payment.method, paymentId: payment.id } }).catch(() => {});
    return { ok: true, effect, settled: true };
  }

  if (effect === 'attention') {
    /* A refund or chargeback Pay. reports. Not applied automatically (see
       paynlService): an order already refunded here is the expected echo of a
       refund made in my.pay.nl; anything else is for the owner to settle. */
    if (order.status !== 'refunded' && changed) {
      await audit({ actor: ACTOR, action: 'order.psp_attention', targetType: 'order', targetId: order.id,
        metadata: { provider: 'paynl', paymentId: payment.id, status: payment.status, code: payment.code } }).catch(() => {});
      alertOwner('webhook.failed', {
        title: `Pay. reports a ${payment.status} on order ${order.number}`,
        lines: [`Status code ${payment.code}. The order is still ${order.status} here.`,
          'Check it in my.pay.nl and refund or settle the order in the admin.'],
        url: `${config.appUrl}/admin/orders`, key: `paynl-${payment.status}-${payment.id}`,
      }).catch(() => {});
    }
    return { ok: true, effect, note: reason };
  }

  if (effect === 'verify' && changed) {
    // Pay. holds it for review; nothing moves until the owner decides there.
    alertOwner('payment.failed', {
      title: `Pay. is holding the payment for order ${order.number} for review`,
      lines: ['Approve or reject it in my.pay.nl within 72 hours, or Pay. cancels it.'],
      url: `${config.appUrl}/admin/orders`, key: `paynl-verify-${payment.id}`,
    }).catch(() => {});
  }
  if (effect === 'retryable' && changed) {
    await audit({ actor: ACTOR, action: 'order.payment_failed', targetType: 'order', targetId: order.id,
      metadata: { provider: 'paynl', paymentId: payment.id, status: payment.status, reason } }).catch(() => {});
  }
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
 * Re-check the most recent unpaid Pay. orders. The safety net for an exchange
 * we could not match to an order (Pay.'s payload has more than one format), for
 * an exchange that never came, and for the maintenance run. Bounded: few
 * orders, a deadline, so it cannot be turned into a flood of API calls.
 */
export async function reconcilePaynl({ limit = 10, deadline = Date.now() + 6_000, olderThanMs = 10 * 60_000 } = {}) {
  if (!isEnabled()) return { checked: 0, paid: 0 };
  const now = Date.now();
  const rows = await all(
    `SELECT id FROM orders
      WHERE status = 'pending' AND psp_provider = 'paynl' AND psp_payment_id IS NOT NULL
        AND created_at < @young AND created_at > @old
      ORDER BY created_at DESC LIMIT @l`,
    { young: new Date(now - olderThanMs).toISOString(), old: new Date(now - 48 * 3_600_000).toISOString(), l: limit });
  let checked = 0, paid = 0;
  for (const r of rows) {
    if (Date.now() >= deadline) break;
    checked++;
    const res = await applyPaynl(r.id, { reason: 'Pay. payment found by reconciliation' }).catch(() => null);
    if (res?.effect === 'paid' && !res.skipped) paid++;
  }
  return { checked, paid };
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
  rateLimit({ bucket: 'paynl_exchange', windowMs: 60_000, max: 240 }),
  async (req, res) => {
    const json = req.is('application/json');
    const reply = (ok, msg, status = 200) => (json
      ? res.status(status).json({ result: ok, message: msg })
      : res.status(status).type('text/plain').send(`${ok ? 'TRUE' : 'FALSE'}|${msg}`));
    await fresh();
    if (!isEnabled()) return reply(true, 'not configured');

    const { ids, refs } = exchangeHints(req);
    let key = ids[0] || refs[0] || 'none';
    try {
      let row = ids.length ? await get(
        `SELECT order_id AS id, payment_id AS psp_payment_id FROM psp_attempts
          WHERE provider = 'paynl' AND payment_id = ANY(@ids) LIMIT 1`, { ids }) : null;
      if (!row && ids.length) {
        row = await get(
          `SELECT id, psp_payment_id FROM orders WHERE psp_provider = 'paynl' AND psp_payment_id = ANY(@ids) LIMIT 1`,
          { ids });
      }
      if (!row && refs.length) {
        row = await get(
          `SELECT id, psp_payment_id FROM orders
            WHERE psp_provider = 'paynl' AND regexp_replace(number, '[^A-Za-z0-9]', '', 'g') = ANY(@refs) LIMIT 1`,
          { refs });
      }
      if (!row) {
        /* Not matched — a format we did not recognise, or nothing real. Either
           way Pay. retrying will not help, so it is acknowledged; and the
           newest unpaid Pay. orders are re-checked so a real payment in an
           unfamiliar envelope still settles. */
        const swept = await reconcilePaynl({ limit: 5, olderThanMs: 0, deadline: Date.now() + 3_500 });
        if (!swept.checked) console.warn('[paynl] exchange without a matching order');
        return reply(true, 'checked');
      }
      key = row.psp_payment_id;
      const result = await applyPaynl(row.id);
      if (!result.ok) console.warn(`[paynl] exchange ${key}: ${result.reason}`);
      return reply(true, 'ok');
    } catch (err) {
      /* Retry only what a retry could fix: Pay. answering 4xx about an order
         is its final word (429 excepted). Anything else — the API down, the
         database gone for a moment — asks Pay. to call again, and tells the
         owner, because money may be waiting with nothing attached to it. */
      const permanent = err.status >= 400 && err.status < 500 && err.status !== 429;
      if (permanent) {
        console.warn(`[paynl] exchange ${key}: ${err.message} — not retryable`);
        return reply(true, 'ignored');
      }
      console.error('[paynl] exchange failed:', err.message);
      alertOwner('webhook.failed', {
        title: `Pay. exchange failed for ${key}`,
        lines: [`Error: ${String(err.message || 'unknown').slice(0, 200)}`,
          'Pay. will retry; we answered FALSE so that it does.',
          'If this repeats, a payment may be settled with no order to match it.'],
        url: `${config.appUrl}/admin/orders`, key: `paynl-${key}`,
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
    const method = offered.includes(body.method) ? body.method : (offered[0] || null);

    const order = await getOrder(req.params.id);
    if (!order) throw new ApiError(404, 'Order not found');
    const { assertOwnsOrder } = await import('./catalog.js');
    await assertOwnsOrder(req, order, body.email);
    if (order.status !== 'pending') return res.json({ alreadySettled: true, status: order.status });

    const base = config.appUrl.replace(/\/+$/, '');
    const out = await tx(async () => {
      const row = await get(`SELECT status, psp_provider, psp_payment_id, psp_status, psp_checkout_url, psp_method
                               FROM orders WHERE id=@id FOR UPDATE`, { id: order.id });
      if (row?.status !== 'pending') return { alreadySettled: true, status: row?.status };
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
      await run(`INSERT INTO psp_attempts (id, order_id, provider, payment_id, method, status, created_at)
                 VALUES (@id, @o, 'paynl', @p, @m, @s, @at) ON CONFLICT (provider, payment_id) DO NOTHING`,
        { id: newId('psa'), o: order.id, p: payment.id, m: method, s: payment.status, at: nowIso() });
      await setPspPayment(order.id, { provider: 'paynl', paymentId: payment.id, status: payment.status,
        checkoutUrl: payment.checkoutUrl, method });
      return { checkoutUrl: payment.checkoutUrl, paymentId: payment.id, created: true };
    });

    if (out.settleNow) {
      await applyPaynl(order.id).catch((e) => console.error('[paynl] settle on start:', e.message));
      const now = await getOrder(order.id);
      return res.json({ alreadySettled: true, status: now.status });
    }
    if (out.alreadySettled) return res.json(out);
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
    res.json({ status: now.status, statusLabel: now.statusLabel });
  }));

export { referenceFor };
