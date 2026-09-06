/**
 * The languages this storefront speaks.
 *
 * English is not in the dictionaries: it lives at the call site — `t('cart.title',
 * 'Your cart')` — so it can never be missing and is always readable next to the
 * markup it belongs to. Everything else is a key → string map, and a key with no
 * entry falls back to English rather than rendering blank. That is what makes it
 * safe to add a language before its dictionary is complete.
 *
 * `locale` is the BCP-47 tag for Intl (dates, currency); `code` is what the
 * chooser stores and what goes into <html lang>.
 *
 * On scope, honestly: the shop is Dutch, prices are in EUR and it takes iDEAL
 * and Bancontact, so NL and EN are the languages it was written in. German is
 * the largest neighbouring market for exactly these products, and French is not
 * a guess either — the shop already declares `areaServed: ['NL', 'BE']`, and
 * half of Belgium reads French. Those four are what the payment methods and the
 * shipping region can actually support; a language beyond them would be a claim
 * about a market this shop does not serve.
 */
export const LANGUAGES = [
  { code: 'nl', label: 'Nederlands', short: 'NL', locale: 'nl-NL' },
  { code: 'en', label: 'English', short: 'EN', locale: 'en-GB' },
  { code: 'de', label: 'Deutsch', short: 'DE', locale: 'de-DE' },
  { code: 'fr', label: 'Français', short: 'FR', locale: 'fr-FR' },
];

export const LANG_CODES = LANGUAGES.map((l) => l.code);

/** The BCP-47 tag for a language code — used for dates and currency. */
export function localeOf(code) {
  return LANGUAGES.find((l) => l.code === code)?.locale || 'en-GB';
}
