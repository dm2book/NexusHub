/**
 * Pay. (pay.nl) — hosted checkout for iDEAL and Bancontact.
 *
 * Why Pay.: Stripe refused this shop's category outright ("stored value or
 * credits … issued by anyone other than the seller"), and Pay. lists
 * "Giftcards / Gamecards" as an accepted, high-risk merchant category.
 *
 * What is built on Pay.'s own documentation (developer.pay.nl), and what is
 * not, matters here, because a guessed field in a payment API is a wrong
 * payment:
 *
 *   - Order:Create is POST https://connect.pay.nl/v1/orders, HTTP Basic with
 *     the sales location's SL-code and secret. Amounts are integer cents.
 *     The buyer is sent to `links.redirect` from the response.
 *   - Order:Status is GET https://connect.pay.nl/v1/orders/{id}/status.
 *   - Only status code 100 is PAID. 85 (VERIFY: Pay. holds a suspicious
 *     payment for the merchant to approve within 72 hours), 95 (AUTHORIZE) and
 *     the pending codes are NOT paid and must not release a code.
 *   - The exchange call (Pay.'s webhook) is a hint, never evidence. Pay. itself
 *     says to verify the status with the order id and not to act on the action
 *     parameter. So every decision here comes from Order:Status, asked with our
 *     own credentials — the same rule as the Mollie webhook.
 *   - Sandbox: `integration: { test: true }` on Order:Create.
 *   - iDEAL is payment option 10, Bancontact 436 (see config PAYNL_METHOD_IDS).
 *
 * Deliberately NOT done here: refunds through the API. The refund endpoint's
 * request shape is not confirmed in Pay.'s documentation, and a guessed
 * money-moving call is worse than an honest instruction. Refunds are made in
 * my.pay.nl and recorded in the admin; refund and chargeback statuses that
 * arrive from Pay. alert the owner instead of moving the order on their own.
 */
import { config, paynlConfigured, paynlTestMode, PAYNL_METHOD_IDS } from '../config/env.js';

const CONNECT = 'https://connect.pay.nl';

export const isEnabled = () => paynlConfigured();
export const isTestMode = () => paynlTestMode();

/** Pay. ids we will put in a URL: letters, digits and dashes, nothing else. */
export const PAY_ID = /^[A-Za-z0-9-]{6,64}$/;

/** Integer cents, refusing anything that is not a positive amount. */
export function toCents(cents) {
  const n = Math.round(Number(cents));
  if (!Number.isFinite(n) || n <= 0) throw new Error('Pay. needs a positive amount');
  return n;
}

/**
 * The reference we give Pay. and read back: the order number, letters and
 * digits only (FM-2026-AB7K9XQ2 → FM2026AB7K9XQ2). It is what binds a Pay.
 * order to ours — read back from Pay.'s API, never from a callback.
 */
export const referenceFor = (orderNumber) => String(orderNumber || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 64);

async function call(path, { method = 'GET', body, timeoutMs = 10_000 } = {}) {
  if (!isEnabled()) throw new Error('Pay. is not configured');
  const { serviceId, serviceSecret } = config.payments.paynl;
  const auth = Buffer.from(`${serviceId}:${serviceSecret}`).toString('base64');
  /* A deadline on every call, as for Mollie: these run inside request handlers
     and an API that accepts the connection and never answers would hold the
     function until the platform kills it. */
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${CONNECT}${path}`, {
      method,
      headers: {
        authorization: `Basic ${auth}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError'
      ? `Pay. ${method} ${path}: timed out after ${Math.round(timeoutMs / 1000)}s`
      : `Pay. ${method} ${path}: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const detail = data?.detail || data?.message || data?.title || data?.error?.message
      || text.slice(0, 200) || `HTTP ${res.status}`;
    const err = new Error(`Pay. ${method} ${path}: ${detail}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Pay.'s numeric status → our word for it.
 *
 * Mapped by the number, never by the action text: Pay.'s own pages label the
 * same code differently (20 is "PENDING" in one place and "CREATED" in
 * another). Only 100 becomes 'paid'.
 */
export function statusFromCode(code) {
  const c = Number(code);
  if (!Number.isFinite(c)) return 'unknown';
  if (c === 100) return 'paid';
  if (c === 20 || c === 50) return 'open';
  if (c === 85) return 'verify';
  if (c > 0) return 'pending';
  if (c === -90) return 'canceled';
  if (c === -80) return 'expired';
  if (c === -60 || c === -63 || c === -64) return 'failed';
  if (c === -81 || c === -82 || c === -72) return 'refund';
  if (c === -70 || c === -71) return 'chargeback';
  return `code_${c}`;
}

/**
 * The status id to ask Order:Status about. Pay.'s create response carries a
 * full `links.status` URL; the id in that URL is by definition the one its
 * status endpoint expects, so it wins over guessing between `id` and `orderId`.
 */
export function statusIdFrom(data) {
  const link = String(data?.links?.status || '');
  const m = link.match(/^https:\/\/connect\.pay\.nl\/v1\/orders\/([A-Za-z0-9-]{6,64})\/status(?:[?#].*)?$/);
  if (m) return m[1];
  const id = String(data?.id || '');
  return PAY_ID.test(id) ? id : null;
}

/**
 * Create a hosted Pay. payment for an order.
 *
 * `method` preselects iDEAL or Bancontact (one step fewer for the buyer).
 * Pay. has no idempotency header, so the route that calls this holds a lock on
 * the order row while it does — two clicks cannot open two payments.
 */
export async function createPayment(order, { returnUrl, exchangeUrl, method = null } = {}) {
  const m = method && PAYNL_METHOD_IDS[method] ? method : null;
  const body = {
    serviceId: config.payments.paynl.serviceId,
    amount: { value: toCents(order.total), currency: String(order.currency || 'EUR').toUpperCase() },
    // On the buyer's bank statement: recognisable, with the number they quote.
    description: `${config.email.fromName || 'ForgeMarket'} ${order.number}`.slice(0, 32),
    reference: referenceFor(order.number),
    returnUrl,
    exchangeUrl,
    ...(m ? { paymentMethod: { id: PAYNL_METHOD_IDS[m].payId } } : {}),
    ...(isTestMode() ? { integration: { test: true } } : {}),
  };
  const data = await call('/v1/orders', { method: 'POST', body });
  const id = statusIdFrom(data);
  const checkoutUrl = String(data?.links?.redirect || '');
  if (!id || !/^https:\/\//i.test(checkoutUrl)) {
    // A payment we cannot check, or cannot send the buyer to, is not started.
    throw new Error('Pay. answered without a usable order id or checkout link');
  }
  return {
    id,
    payOrderId: data?.orderId || null,
    status: statusFromCode(data?.status?.code),
    checkoutUrl,
  };
}

/**
 * The authoritative record of a Pay. order. Never infer a payment's state from
 * anything else — not the exchange call, not the return URL.
 */
export async function getPayment(id) {
  if (!PAY_ID.test(String(id || ''))) {
    const err = new Error('Not a Pay. order id');
    err.status = 400;
    throw err;
  }
  const d = await call(`/v1/orders/${encodeURIComponent(id)}/status`);
  const value = Number(d?.amount?.value);
  const payments = Array.isArray(d?.payments) ? d.payments : [];
  const last = payments[payments.length - 1] || null;
  const code = d?.status?.code;
  return {
    id,
    code: Number.isFinite(Number(code)) ? Number(code) : null,
    status: statusFromCode(code),
    amountCents: Number.isInteger(value) ? value : null,
    currency: d?.amount?.currency ? String(d.amount.currency).toUpperCase() : null,
    reference: d?.reference != null ? String(d.reference) : null,
    serviceId: d?.serviceId != null ? String(d.serviceId) : null,
    // Only a boolean Pay. actually sent counts; absent means "not reported".
    test: typeof d?.integration?.test === 'boolean' ? d.integration.test : null,
    method: last?.paymentMethod?.id != null ? String(last.paymentMethod.id) : null,
  };
}

/**
 * Why a Pay. order may NOT settle ours, or null when it may.
 *
 * Every field is read back from Pay.'s API. The reference binds it to this
 * order; the amount and currency must be exactly what we charge; the service
 * must be ours; and a sandbox payment never settles a shop that is not in
 * sandbox mode — that would hand out a real code for test money.
 */
export function mismatchReasons(payment, order) {
  const out = [];
  if (payment.reference !== referenceFor(order.number)) out.push(`reference ${payment.reference ?? 'missing'} is not ${referenceFor(order.number)}`);
  if (payment.amountCents !== order.total) out.push(`amount ${payment.amountCents ?? 'missing'} is not ${order.total}`);
  const want = String(order.currency || 'EUR').toUpperCase();
  if (payment.currency !== want) out.push(`currency ${payment.currency ?? 'missing'} is not ${want}`);
  if (payment.serviceId && payment.serviceId !== config.payments.paynl.serviceId) out.push(`service ${payment.serviceId} is not ours`);
  if (payment.test === true && !isTestMode()) out.push('a sandbox payment on a shop that is not in sandbox mode');
  return out;
}

/**
 * Pay.'s status → what it means for the order.
 *
 * Cancelled, expired and failed leave the order pending, as with Mollie: the
 * buyer may simply try again. Refunds and chargebacks reported by Pay. do not
 * move the order by themselves (see the header) — they ask for the owner.
 */
export function orderEffect(payment) {
  if (payment.status === 'paid') return { effect: 'paid', reason: `Paid via Pay.${payment.method ? ` (method ${payment.method})` : ''}` };
  if (['canceled', 'expired', 'failed'].includes(payment.status)) return { effect: 'retryable', reason: `Payment ${payment.status}` };
  if (payment.status === 'refund' || payment.status === 'chargeback') {
    return { effect: 'attention', reason: `Pay. reports ${payment.status} (code ${payment.code})` };
  }
  if (payment.status === 'verify') return { effect: 'verify', reason: 'Pay. is holding this payment for review (VERIFY)' };
  return { effect: 'none', reason: `Payment ${payment.status}` };
}
