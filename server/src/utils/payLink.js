/**
 * Validating a per-order payment link.
 *
 * This URL is rendered as a button on the buyer's public status page and in the
 * payment-reminder email, so it is the one field where a mistake turns our own
 * site into the delivery vehicle for someone else's payment page. A typo sends
 * a customer's money to the wrong place; a hostile value would be a phishing
 * link wearing our branding.
 *
 * So: https only, and only hosts that actually belong to a payment provider.
 * An allowlist is the right shape here — the set of ways a small Dutch shop can
 * be paid is short and known, and "anything that parses as a URL" is not a rule.
 */

/** Payment providers a Dutch shop realistically uses. Subdomains included. */
const ALLOWED_HOSTS = [
  'tikkie.me',
  'betaalverzoek.rabobank.nl',
  'betaalverzoek.abnamro.nl',
  'ideal.rabobank.nl',
  'revolut.me',
  'paypal.me',
  'paypal.com',
  'bunq.me',
  'buy.stripe.com',
  'checkout.stripe.com',
  'link.stripe.com',
  'pay.sumup.com',
  'payment-link.mollie.com',
];

export class PayLinkError extends Error {}

/**
 * @returns the normalised URL string
 * @throws  PayLinkError with a message meant for the owner, not a stack trace
 */
export function validatePayLink(raw) {
  const value = String(raw ?? '').trim();
  if (!value) throw new PayLinkError('Paste a payment link first.');
  if (value.length > 500) throw new PayLinkError('That link is suspiciously long — double-check it.');

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new PayLinkError('That is not a valid link. It should start with https://');
  }

  // http:// would be downgraded in transit; every provider serves https.
  if (url.protocol !== 'https:') {
    throw new PayLinkError('Payment links must start with https:// — never http, javascript or data.');
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const allowed = ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  if (!allowed) {
    throw new PayLinkError(
      `"${host}" is not a payment provider we recognise. Allowed: ${ALLOWED_HOSTS.join(', ')}. ` +
      'If you use another provider, add it to ALLOWED_HOSTS first — this list is what stops a wrong ' +
      'link ending up in front of a customer.');
  }

  // Credentials in a URL (https://user:pass@host) are a classic way to make a
  // link look like it points somewhere it does not.
  if (url.username || url.password) throw new PayLinkError('Remove the username/password part from the link.');

  return url.toString();
}

/** Is this a link we would accept? Never throws — for display logic. */
export function isValidPayLink(raw) {
  try { validatePayLink(raw); return true; } catch { return false; }
}

export const PAY_LINK_HOSTS = ALLOWED_HOSTS;
