/* Same cache, same reason, as src/lib/catalog.js — this copy is the one the
   admin pages use, and a table of two hundred orders builds two hundred
   formatters without it. */
const FORMATTERS = new Map();
/* The reader's notation, same rule as src/lib/catalog.js: the language
   provider keeps <html lang> current; English and no-document keep en-IE. */
const NUMBER_LOCALE = { nl: 'nl-NL', en: 'en-IE', de: 'de-DE', fr: 'fr-FR' };
const pageLocale = () => {
  try { return NUMBER_LOCALE[document.documentElement.lang] || 'en-IE'; } catch { return 'en-IE'; }
};
const formatter = (cur) => {
  const loc = pageLocale();
  const key = `${loc}|${cur}`;
  let f = FORMATTERS.get(key);
  if (!f) {
    f = new Intl.NumberFormat(loc, { style: 'currency', currency: cur });
    FORMATTERS.set(key, f);
  }
  return f;
};

export const money = (cents, cur = 'EUR') => formatter(cur).format((cents || 0) / 100);

/* Dates in the shop's language, not the browser's: a Dutch page on an
   English-language phone showed "10/6/2026". */
const DATE_LOCALE = { nl: 'nl-NL', en: 'en-GB', de: 'de-DE', fr: 'fr-FR' };
const dateLocale = () => { try { return DATE_LOCALE[document.documentElement.lang] || undefined; } catch { return undefined; } };
export const date = (iso) => (iso ? new Date(iso).toLocaleString(dateLocale()) : '—');
export const dateShort = (iso) => (iso ? new Date(iso).toLocaleDateString(dateLocale()) : '—');

/* A refund cannot be undone — so it takes the order number, typed, not one
   stray click. Only Stripe and Mollie send the money back from here; a Pay.
   order is marked refunded and the money is returned in my.pay.nl by hand, and
   the prompt says which of the two is about to happen. */
export const confirmRefund = (o) => (window.prompt(
  `Refund ${money(o.total, o.currency)} for ${o.number}.\n`
  + (o.pspProvider === 'paynl'
    ? 'This marks the order refunded and cannot be undone. The money is NOT sent back automatically — refund it yourself in my.pay.nl afterwards.'
    : 'This really sends the money back and cannot be undone.')
  + '\n\nType the order number to confirm:',
) || '').trim().toUpperCase() === String(o.number).toUpperCase();

/**
 * What a refund actually did with the money, from the server's answer.
 *
 * "Refund done" read as finished on a Pay. order, where the server only marks
 * it refunded and the money still has to be returned in my.pay.nl — and on a
 * manual payment, where it goes back by hand. Shared by every admin page that
 * refunds, so none of them can claim more than happened.
 */
export function refundOutcome(refund, number, currency) {
  const label = number ? `Order ${number}: ` : '';
  if (refund?.via === 'paynl') {
    return `${label}marked refunded. Now refund ${money(refund.cents, currency)} in my.pay.nl (https://my.pay.nl) — Pay. refunds are not automatic.`;
  }
  if (refund?.provider === 'stripe' || refund?.provider === 'mollie') {
    return `${label}refunded through ${refund.provider === 'stripe' ? 'Stripe' : 'Mollie'}.`;
  }
  if (refund?.method === 'money' && refund.provider === 'manual' && refund.cents > 0) {
    return `${label}marked refunded. Now send ${money(refund.cents, currency)} back by hand, the way they paid.`;
  }
  return `${label}refunded.`;
}
