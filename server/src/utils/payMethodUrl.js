/**
 * Turning a configured payment handle into a link for ONE order.
 *
 * Some providers accept the amount — and sometimes the reference — inside the
 * URL. Where they do, the buyer taps once and their bank app opens with
 * everything filled in: nothing to type, nothing to get wrong. Where they do
 * not, the buyer has to copy the amount and the order number by hand, which is
 * the single most error-prone step in this whole shop.
 *
 * That difference decides which provider is worth using, so it is worth being
 * explicit about it rather than treating every method the same:
 *
 *   paypal.me   amount            → https://paypal.me/name/14.38EUR
 *   revolut.me  amount            → https://revolut.me/name/14.38
 *   bunq.me     amount + note     → https://bunq.me/name/14.38/FM-2026-ABCD
 *   tikkie      neither           → the owner pastes a per-order request
 *                                   (see setOrderPayLink)
 *
 * This ran in three copies before — the checkout, the track page and the email
 * each built the URL themselves, and only the email-and-checkout pair happened
 * to agree. One place now; the storefront renders what the server sends.
 */

/** Amount as the providers want it: plain decimal, dot separator, 2 places. */
const decimal = (cents) => (Math.max(0, Number(cents) || 0) / 100).toFixed(2);

const ensureHttps = (raw) => {
  const t = String(raw || '').trim();
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t.replace(/^http:\/\//i, 'https://') : `https://${t}`;
};

/**
 * @param method  { id, label, target, kind } from manualPayMethods()
 * @param order   { total, currency, number }
 * @returns { id, label, url, kind, prefilled, reference }
 *
 * TWO separate facts, because they are separately true and the shop was only
 * reporting one of them.
 *
 * `prefilled` — does the link carry the AMOUNT.
 * `reference` — does the link carry the ORDER NUMBER.
 *
 * Only bunq.me carries both. paypal.me and revolut.me take the amount and
 * nothing else, and this whole shop reconciles a payment by its reference: the
 * order number in the description is the only thing tying money to an order.
 * While Tikkie was the only method that did not matter — the owner attaches a
 * payment request per order, so the request IS the reference. The moment a
 * buyer can tap a PayPal link instead, "the amount is already in the link, you
 * only have to confirm" is an instruction to pay with no reference at all, and
 * two buyers paying the same amount on the same day become indistinguishable.
 */
export function payMethodUrl(method, order) {
  const amount = decimal(order?.total);
  const reference = String(order?.number || '');
  const base = ensureHttps(method?.target).replace(/\/+$/, '');

  // A PayPal handle can also be an email address, which has no link form at all.
  if (method?.kind === 'email') {
    return { id: method.id, label: method.label, kind: 'email', url: null,
      target: method.target, amount, prefilled: false, reference: false };
  }

  let url = base;
  let prefilled = false;
  let carriesReference = false;

  if (/paypal\.me/i.test(base)) {
    url = `${base}/${amount}EUR`;
    prefilled = true;              // the amount only — PayPal.me has no note field
  } else if (/revolut\.me/i.test(base)) {
    url = `${base}/${amount}`;
    prefilled = true;              // likewise
  } else if (/bunq\.me/i.test(base)) {
    // bunq takes a description too, so even the reference is filled in.
    url = `${base}/${amount}/${encodeURIComponent(reference)}`;
    prefilled = true;
    carriesReference = true;
  }
  // Tikkie and anything unrecognised: the plain link. The buyer types the
  // amount, unless the owner attached a per-order request.

  return { id: method.id, label: method.label, kind: 'link', url, amount, prefilled,
    reference: carriesReference };
}

/** Every configured method, resolved for this order. */
export function payMethodsFor(methods, order) {
  return (methods || []).map((m) => payMethodUrl(m, order));
}
