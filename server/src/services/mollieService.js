/**
 * Mollie — hosted checkout for iDEAL, Bancontact, Apple Pay, card and PayPal.
 *
 * Two things about Mollie shape everything here:
 *
 * 1. The webhook body is NOT the payment. Mollie POSTs a single field, `id`,
 *    and expects you to fetch the payment yourself. There is no signature to
 *    verify, so the id in that body is a hint, never evidence — anyone can POST
 *    an id. The fetch against the API is what makes it true, and that is why
 *    nothing in this module trusts a caller-supplied status.
 *
 * 2. Amounts are decimal strings, not minor units. "10.00", not 1000. Getting
 *    that wrong charges a hundredth of the price, so the conversion is done in
 *    exactly one place and tested.
 *
 * The webhook can fire several times for one payment (paid, then again on a
 * refund, plus retries when a call fails), so every consumer of this module has
 * to be idempotent. `markPaymentReceived` already is: the order state machine
 * refuses a transition out of a status that has moved on.
 */
import { config } from '../config/env.js';

const API = 'https://api.mollie.com/v2';

/** The methods this shop offers, in the order a Dutch buyer expects them. */
export const SUPPORTED_METHODS = ['ideal', 'bancontact', 'applepay', 'creditcard', 'paypal'];

export const isEnabled = () => !!config.payments.mollie.apiKey;

/** True when a live deployment is pointed at Mollie's test environment. */
export const isTestKey = () => /^test_/.test(config.payments.mollie.apiKey || '');

/**
 * Cents to Mollie's decimal string. Mollie rejects anything that is not exactly
 * two decimals for EUR, and silently means something different if you pass
 * minor units — 1000 becomes ten euro's worth of nothing at all.
 */
export function toAmount(cents, currency = 'EUR') {
  const n = Math.round(Number(cents) || 0);
  if (n <= 0) throw new Error('Mollie needs a positive amount');
  return { currency: String(currency || 'EUR').toUpperCase(), value: (n / 100).toFixed(2) };
}

/** Mollie's decimal string back to cents, for refund and reconciliation checks. */
export const fromAmount = (amount) => Math.round(parseFloat(amount?.value || '0') * 100);

async function call(path, { method = 'GET', body, idempotencyKey } = {}) {
  if (!isEnabled()) throw new Error('Mollie is not configured');
  const headers = {
    authorization: `Bearer ${config.payments.mollie.apiKey}`,
    'content-type': 'application/json',
  };
  // Mollie honours this on POST: a retried create returns the FIRST payment
  // instead of making a second one. Without it, a double-tap or a retried
  // request bills the buyer twice.
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

  /* A deadline on every call to Mollie.

     These run inside request handlers — the checkout starting a payment, the
     webhook confirming one, the method list the payment step renders. An
     endpoint that accepts the connection and then never answers does not fail;
     it hangs, and holds the request until the platform kills the function at
     maxDuration, at which point the caller gets a platform error page rather
     than JSON. Fifteen seconds is generous for a payment API and still half the
     function's budget, so there is room left to answer properly.

     The abort surfaces as an ordinary Error, which every caller here already
     handles: the webhook path is idempotent and Mollie retries it, and the
     checkout path reports a failure the buyer can retry. */
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method, headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError'
      ? `Mollie ${method} ${path}: timed out after 15s`
      : `Mollie ${method} ${path}: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const detail = data?.detail || data?.title || text.slice(0, 200) || `HTTP ${res.status}`;
    const err = new Error(`Mollie ${method} ${path}: ${detail}`);
    err.status = res.status;
    err.mollie = data;
    throw err;
  }
  return data;
}

/**
 * Create a hosted payment for an order.
 *
 * `metadata.orderId` is how the webhook finds its way back — Mollie returns it
 * verbatim on every later fetch of this payment, so we never have to trust a
 * redirect parameter or keep our own lookup in sync.
 */
export async function createPayment(order, { redirectUrl, webhookUrl, method = null, locale = 'nl_NL' } = {}) {
  const payment = await call('/payments', {
    method: 'POST',
    // Keyed to the order, not to the request: two clicks on "pay" for the same
    // order return the same Mollie payment rather than opening two.
    idempotencyKey: `order-${order.id}`,
    body: {
      amount: toAmount(order.total, order.currency),
      // Shown on the buyer's bank statement, so it has to be recognisable and
      // carry the reference they will quote if they contact us.
      description: `${config.email.fromName} ${order.number}`,
      redirectUrl,
      webhookUrl,
      // Null means "let the buyer choose on Mollie's page". A concrete method
      // skips that step, which is one tap fewer for someone who already picked.
      ...(method && SUPPORTED_METHODS.includes(method) ? { method } : {}),
      locale,
      metadata: { orderId: order.id, orderNumber: order.number },
    },
  });
  return {
    id: payment.id,
    status: payment.status,
    checkoutUrl: payment._links?.checkout?.href || null,
    expiresAt: payment.expiresAt || null,
  };
}

/** The authoritative record. Never infer a payment's state from anything else. */
export async function getPayment(paymentId) {
  const p = await call(`/payments/${encodeURIComponent(paymentId)}`);
  return {
    id: p.id,
    status: p.status,                       // open|pending|authorized|paid|canceled|expired|failed
    method: p.method || null,
    paidAt: p.paidAt || null,
    amountCents: fromAmount(p.amount),
    currency: p.amount?.currency || 'EUR',
    // Present only once something has been sent back. Mollie fires the same
    // webhook for a refund, so this is how a refund is detected.
    refundedCents: p.amountRefunded ? fromAmount(p.amountRefunded) : 0,
    chargedBackCents: p.amountChargedBack ? fromAmount(p.amountChargedBack) : 0,
    orderId: p.metadata?.orderId || null,
    orderNumber: p.metadata?.orderNumber || null,
    failureReason: p.details?.failureMessage || p.details?.failureReason || null,
  };
}

/**
 * Refund, in whole or in part.
 *
 * Mollie refuses a refund larger than what is left, so the ceiling is enforced
 * there as well as here — but a clear error beats a 422 from an API the owner
 * has never seen.
 */
export async function refundPayment(paymentId, { cents, currency = 'EUR', description } = {}) {
  const r = await call(`/payments/${encodeURIComponent(paymentId)}/refunds`, {
    method: 'POST',
    idempotencyKey: `refund-${paymentId}-${cents}`,
    body: {
      amount: toAmount(cents, currency),
      ...(description ? { description: description.slice(0, 140) } : {}),
    },
  });
  return { id: r.id, status: r.status, cents: fromAmount(r.amount) };
}

/**
 * Which methods Mollie will actually accept for this amount, live from the API.
 *
 * Worth asking rather than hard-coding: iDEAL has a maximum, Bancontact is
 * Belgium-only, and Apple Pay only appears on a device that can use it. Showing
 * a method the buyer then cannot select is a dead end at the last step.
 */
export async function availableMethods({ cents, currency = 'EUR', locale = 'nl_NL' } = {}) {
  const qs = new URLSearchParams({ locale });
  if (cents) {
    const a = toAmount(cents, currency);
    qs.set('amount[value]', a.value);
    qs.set('amount[currency]', a.currency);
  }
  const data = await call(`/methods?${qs}`);
  return (data?._embedded?.methods || [])
    .filter((m) => SUPPORTED_METHODS.includes(m.id))
    .map((m) => ({ id: m.id, label: m.description, image: m.image?.svg || null }));
}

/**
 * Mollie's payment status → what it means for the order.
 *
 * `canceled`, `expired` and `failed` deliberately do NOT fail the order. The
 * buyer backed out, timed out, or their bank declined — all recoverable, and
 * all cases where they may simply pick another method. Failing the order would
 * close a sale that is still very much alive; it stays `pending`, the buyer can
 * pay again, and the existing 14-day auto-cancel sweeps up what never happens.
 */
export function orderEffect(payment) {
  if (payment.chargedBackCents > 0) return { effect: 'chargeback', reason: 'Charged back' };
  if (payment.refundedCents > 0) {
    return payment.refundedCents >= payment.amountCents
      ? { effect: 'refunded', reason: 'Refunded in full via Mollie' }
      : { effect: 'partial_refund', reason: `Partially refunded (${payment.refundedCents} of ${payment.amountCents})` };
  }
  if (payment.status === 'paid' || payment.status === 'authorized') {
    return { effect: 'paid', reason: `Paid via Mollie${payment.method ? ` (${payment.method})` : ''}` };
  }
  if (['failed', 'canceled', 'expired'].includes(payment.status)) {
    return { effect: 'retryable', reason: payment.failureReason || `Payment ${payment.status}` };
  }
  return { effect: 'none', reason: `Payment ${payment.status}` };
}
