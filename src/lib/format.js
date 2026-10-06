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

/* A refund sends real money back through Stripe or Mollie and cannot be
   undone — so it takes the order number, typed, not one stray click. */
export const confirmRefund = (o) => (window.prompt(
  `Terugbetalen: ${money(o.total, o.currency)} voor ${o.number}.\nDit stuurt het geld echt terug en kan niet ongedaan worden.\n\nTyp het bestelnummer om te bevestigen:`,
) || '').trim().toUpperCase() === String(o.number).toUpperCase();
