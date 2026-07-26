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
 * @returns { id, label, url, kind, prefilled, note }
 *          `prefilled` is what the storefront uses to tell the buyer whether
 *          they still have to type the amount — never guess that in the UI.
 */
export function payMethodUrl(method, order) {
  const amount = decimal(order?.total);
  const reference = String(order?.number || '');
  const base = ensureHttps(method?.target).replace(/\/+$/, '');

  // A PayPal handle can also be an email address, which has no link form at all.
  if (method?.kind === 'email') {
    return { id: method.id, label: method.label, kind: 'email', url: null,
      target: method.target, amount, prefilled: false };
  }

  let url = base;
  let prefilled = false;

  if (/paypal\.me/i.test(base)) {
    url = `${base}/${amount}EUR`;
    prefilled = true;
  } else if (/revolut\.me/i.test(base)) {
    url = `${base}/${amount}`;
    prefilled = true;
  } else if (/bunq\.me/i.test(base)) {
    // bunq takes a description too, so even the reference is filled in.
    url = `${base}/${amount}/${encodeURIComponent(reference)}`;
    prefilled = true;
  }
  // Tikkie and anything unrecognised: the plain link. The buyer types the
  // amount, unless the owner attached a per-order request.

  return { id: method.id, label: method.label, kind: 'link', url, amount, prefilled };
}

/** Every configured method, resolved for this order. */
export function payMethodsFor(methods, order) {
  return (methods || []).map((m) => payMethodUrl(m, order));
}
