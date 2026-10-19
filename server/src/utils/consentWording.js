/**
 * The withdrawal-waiver sentence the checkout shows, per language.
 *
 * The order used to store whatever `consentText` the request carried — any
 * string up to 400 characters — and the confirmation mail quotes it back as
 * "On … you confirmed: “…”" in a branded ForgeMarket mail, to whatever address
 * a guest typed. A direct API call could put its own text (a link, a warning)
 * into a mail signed by the shop, and as dispute evidence a client-chosen
 * sentence proves nothing about what was shown.
 *
 * Now only these sentences are stored: the client's text when it is exactly one
 * of them (the language the buyer actually read), otherwise the sentence for
 * the order's language. Must stay identical to `checkout.consent` in
 * src/lib/i18n.jsx (nl), src/lib/i18n/de.js, src/lib/i18n/fr.js and the English
 * fallback in src/pages/Checkout.jsx — a test compares them.
 */
export const CONSENT_SENTENCES = Object.freeze({
  nl: 'Ik wil mijn bestelling meteen geleverd krijgen en begrijp dat ik daarmee mijn 14 dagen bedenktijd verlies zodra hij geleverd is.',
  en: 'I want my order delivered immediately and I understand I lose my 14-day right of withdrawal once it has been delivered.',
  de: 'Ich möchte meine Bestellung sofort geliefert bekommen und verstehe, dass mein 14-tägiges Widerrufsrecht damit erlischt, sobald sie geliefert ist.',
  fr: 'Je veux que ma commande soit livrée immédiatement et je comprends que je perds mon droit de rétractation de 14 jours dès qu’elle est livrée.',
});

/** The sentence to store for this order: the shown one, never free text. */
export function canonicalConsent(clientText, lang) {
  const text = String(clientText || '').trim();
  const known = Object.values(CONSENT_SENTENCES);
  if (known.includes(text)) return text;
  return CONSENT_SENTENCES[lang] || CONSENT_SENTENCES.nl;
}
