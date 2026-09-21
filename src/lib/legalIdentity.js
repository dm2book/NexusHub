/**
 * Who is selling. Dutch and EU consumer law require a webshop to state this
 * before someone buys (Art. 6:230m BW / Consumer Rights Directive): a name, a
 * geographic address, a contact address, and — once registered — a KvK and VAT
 * number.
 *
 * Every field renders only when it is filled in, so an unset value is left out
 * rather than printed as an empty row or a placeholder. That means the page is
 * never *wrong*; it is only incomplete, and INCOMPLETE_NOTICE below says so
 * plainly for as long as the required fields are missing.
 *
 * Fill KVK and VAT in after registering with the Kamer van Koophandel. Until
 * then the page states honestly that ForgeMarket is run by a private individual
 * and not a registered company — claiming otherwise would be the one thing on
 * this page that could actually get the owner in trouble.
 *
 * ── WHY THESE COME FROM THE ENVIRONMENT ───────────────────────────────────
 * They were constants in this file, which meant that the day the KvK paperwork
 * came back, publishing it needed a code change, a commit and a deploy by
 * somebody who can do all three. That is a bad shape for the one piece of
 * information the law requires before a consumer may buy: it puts a developer
 * between a legal obligation and the shop complying with it.
 *
 * Set them in the hosting environment and redeploy. Both readers below matter:
 * Vite bakes VITE_* into the browser bundle at build time, and prerender.mjs
 * imports this same file in plain Node to render the legal pages — so without
 * the process.env half, the pre-rendered pages and the live app would disagree
 * about who is selling, which is worse than neither of them knowing.
 *
 * The accesses are written out one by one on purpose: Vite only substitutes a
 * LITERAL `import.meta.env.VITE_X`, so a loop over key names would silently
 * come back empty in the browser and work everywhere it was tested.
 */

/* eslint-disable prefer-template */
const viteEnv = typeof import.meta !== 'undefined' ? (import.meta.env || {}) : {};
const nodeEnv = typeof process !== 'undefined' && process.env ? process.env : {};
const pick = (viteValue, name, fallback = '') =>
  String(viteValue || nodeEnv[name] || fallback).trim();

export const LEGAL = {
  /** Trading name shown to buyers. */
  tradeName: pick(viteEnv.VITE_LEGAL_TRADE_NAME, 'VITE_LEGAL_TRADE_NAME', 'ForgeMarket'),
  /** Legal name of the person or company responsible. REQUIRED before launch. */
  legalName: pick(viteEnv.VITE_LEGAL_NAME, 'VITE_LEGAL_NAME'),
  /** Street address. Required by law; a PO box is not enough. */
  address: pick(viteEnv.VITE_LEGAL_ADDRESS, 'VITE_LEGAL_ADDRESS'),
  postcode: pick(viteEnv.VITE_LEGAL_POSTCODE, 'VITE_LEGAL_POSTCODE'),
  city: pick(viteEnv.VITE_LEGAL_CITY, 'VITE_LEGAL_CITY'),
  country: pick(viteEnv.VITE_LEGAL_COUNTRY, 'VITE_LEGAL_COUNTRY', 'Nederland'),
  /** Kamer van Koophandel number — only after registering. */
  kvk: pick(viteEnv.VITE_LEGAL_KVK, 'VITE_LEGAL_KVK'),
  /** BTW-identificatienummer — only after registering. */
  vat: pick(viteEnv.VITE_LEGAL_VAT, 'VITE_LEGAL_VAT'),
};

/**
 * Take the values the server holds.
 *
 * The environment half above is what this BUILD was made with; the owner can
 * now type the same fields into the admin, and the server sends them with
 * /api/config on every page load. This merges those over the built-in ones, in
 * place, because LEGAL is the single object that the legal pages, the SEO
 * metadata, the refund page and the terms' VAT sentence all read — handing
 * each of them a second source is how an invoice and a terms page end up
 * naming different sellers.
 *
 * Only non-empty strings are taken: an absent field means "the server has
 * nothing to say about this", not "blank it".
 */
export function applyLegal(patch) {
  if (!patch || typeof patch !== 'object') return LEGAL;
  for (const [k, v] of Object.entries(patch)) {
    if (k in LEGAL && typeof v === 'string' && v.trim()) LEGAL[k] = v.trim();
  }
  return LEGAL;
}

/** The environment variables that fill the block above, for the launch check. */
export const LEGAL_ENV = {
  legalName: 'VITE_LEGAL_NAME',
  address: 'VITE_LEGAL_ADDRESS',
  postcode: 'VITE_LEGAL_POSTCODE',
  city: 'VITE_LEGAL_CITY',
  kvk: 'VITE_LEGAL_KVK',
  vat: 'VITE_LEGAL_VAT',
};

/** True once the law's minimum set is present. */
export const legalComplete = () =>
  !!(LEGAL.legalName && LEGAL.address && LEGAL.postcode && LEGAL.city);

/** Address as a single readable line, skipping anything unset. */
export const legalAddressLine = () =>
  [LEGAL.address, [LEGAL.postcode, LEGAL.city].filter(Boolean).join(' '), LEGAL.country]
    .filter(Boolean).join(', ');

/**
 * What the terms may truthfully say about VAT.
 *
 * The terms used to state, flatly and in both languages, that "all prices
 * include VAT". Nothing in this system backed that up: there is no VAT rate,
 * no order carries a VAT amount, and the invoice shows no VAT line. If the
 * seller is not VAT-registered the sentence was simply untrue; if they are, the
 * paperwork did not match it either way.
 *
 * So the claim is now derived from the one fact the shop actually publishes —
 * a BTW-identificatienummer — and when that is absent the sentence about VAT is
 * not made at all. What remains is the part this system CAN keep: the price you
 * see is the price you pay, because nothing is added at checkout.
 *
 * Note what this deliberately does not do. It does not say "no VAT is charged",
 * because an unset field is not evidence of a tax position; it is an unset
 * field. Stating the seller's VAT status is the seller's job, and getting it
 * wrong in either direction is worse than staying quiet.
 */
export const vatStatement = (nl) => (LEGAL.vat
  ? (nl
    ? 'Alle prijzen zijn in euro\u2019s en inclusief btw. De prijs die op het moment van bestellen wordt getoond, is de prijs die geldt. Wij rekenen geen toeslagen af bij de kassa: het bedrag dat je ziet, is het bedrag dat je betaalt.'
    : 'All prices are in euros and include VAT. The price shown at the moment you order is the price that applies. We add no fees at checkout: the amount you see is the amount you pay.')
  : (nl
    ? 'Alle prijzen zijn in euro\u2019s. De prijs die op het moment van bestellen wordt getoond, is de prijs die geldt. Wij rekenen geen toeslagen af bij de kassa: het bedrag dat je ziet, is het bedrag dat je betaalt.'
    : 'All prices are in euros. The price shown at the moment you order is the price that applies. We add no fees at checkout: the amount you see is the amount you pay.'));
