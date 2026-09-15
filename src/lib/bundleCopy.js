/**
 * Bundle names and descriptions, in every language the shop is read in.
 *
 * A bundle is a set of products the owner named and priced together, so unlike
 * a product it has no category to generate copy from. What it does have is its
 * members and its discount, and that is enough for a sentence that is true in
 * any language: "Apex Coins + Valorant Points — 10% cheaper together."
 *
 * The NAME is left alone unless the owner translated it. "FPS Duo Pack" is a
 * name somebody invented, not a sentence, and machine-translating a name is
 * how you end up with a shop that calls its own promotion something nobody
 * recognises.
 *
 * Typed copy always wins, per language: a bundle with a hand-written German
 * description keeps it and still gets generated French.
 */

const JOINED = {
  en: (parts, pct) => `${parts} — ${pct}% cheaper together.`,
  nl: (parts, pct) => `${parts} — samen ${pct}% goedkoper.`,
  de: (parts, pct) => `${parts} — zusammen ${pct}% günstiger.`,
  fr: (parts, pct) => `${parts} — ${pct}% moins cher ensemble.`,
};
/* No discount set is a real state — a bundle can exist purely to group things
   — and "0% cheaper together" is a worse sentence than none. */
const PLAIN = {
  en: (parts) => `${parts} — together in one order.`,
  nl: (parts) => `${parts} — samen in één bestelling.`,
  de: (parts) => `${parts} — zusammen in einer Bestellung.`,
  fr: (parts) => `${parts} — ensemble en une seule commande.`,
};

export const BUNDLE_LANGS = ['en', 'nl', 'de', 'fr'];

/** Where a typed translation for `lang` is kept on a bundle's copy object. */
const field = (base, lang) => (lang === 'en' ? base : `${base}${lang[0].toUpperCase()}${lang.slice(1)}`);

/**
 * What to call this bundle, and what to say about it, in one language.
 *
 * `copy` is the owner's own translations, if any. Product names carry
 * themselves — "1,000 Robux" is the same in every language — so the generated
 * sentence needs no catalogue lookup beyond the names already on the bundle.
 */
export function bundleCopy(bundle, lang = 'en') {
  const code = BUNDLE_LANGS.includes(lang) ? lang : 'en';
  const copy = bundle?.copy || {};
  const typedName = copy[field('name', code)];
  const typedDesc = copy[field('description', code)]
    ?? (code === 'en' ? bundle?.description : null);

  const parts = (bundle?.products || []).map((p) => p.name).filter(Boolean).join(' + ');
  const pct = Number(bundle?.discountPercent || 0);
  const generated = parts
    ? (pct > 0 ? JOINED[code] : PLAIN[code])(parts, pct)
    : '';

  return {
    name: (typedName && String(typedName).trim()) || bundle?.name || '',
    description: (typedDesc && String(typedDesc).trim()) || generated,
  };
}

/** Every language at once, for an API response the client filters by itself. */
export function bundleCopyAll(bundle) {
  const out = {};
  for (const lang of BUNDLE_LANGS) {
    const { name, description } = bundleCopy(bundle, lang);
    out[field('name', lang)] = name;
    out[field('description', lang)] = description;
  }
  return out;
}
