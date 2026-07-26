/**
 * Product descriptions in both languages.
 *
 * Every description in the catalog was written in English and stored that way,
 * so switching the site to Dutch left the shop cards, the product page and the
 * cart in English — the largest single block of untranslated text on the site,
 * and the one a buyer reads most.
 *
 * Rather than a second column and 70 hand-written strings that drift apart, the
 * copy is generated per category from the product's own name. New products get
 * correct Dutch for free, and there is one place to fix a wording mistake.
 *
 * These also replace descriptions that promised "instant delivery" — the claim
 * the rest of the product stopped making.
 */

const COPY = {
  robux: {
    en: (n) => `${n} topped up straight onto your Roblox account.`,
    nl: (n) => `${n} rechtstreeks op je Roblox-account.`,
  },
  'v-bucks': {
    en: (n) => `${n} for skins, emotes and the Battle Pass.`,
    nl: (n) => `${n} voor skins, emotes en de Battle Pass.`,
  },
  valorant: {
    en: (n) => `${n} for agents, skins and the Battle Pass.`,
    nl: (n) => `${n} voor agents, skins en de Battle Pass.`,
  },
  cod: {
    en: (n) => `${n} for operators, blueprints and the Battle Pass.`,
    nl: (n) => `${n} voor operators, blueprints en de Battle Pass.`,
  },
  apex: {
    en: (n) => `${n} for legends, skins and Apex packs.`,
    nl: (n) => `${n} voor legends, skins en Apex-packs.`,
  },
  genshin: {
    en: (n) => `${n} for wishes and the Battle Pass.`,
    nl: (n) => `${n} voor wishes en de Battle Pass.`,
  },
  brawl: {
    en: (n) => `${n} for brawlers, skins and the Brawl Pass.`,
    nl: (n) => `${n} voor brawlers, skins en de Brawl Pass.`,
  },
  clash: {
    en: (n) => `${n} for builders, boosts and chests.`,
    nl: (n) => `${n} voor bouwers, boosts en kisten.`,
  },
  clashroyale: {
    en: (n) => `${n} for chests, cards and the Pass Royale.`,
    nl: (n) => `${n} voor kisten, kaarten en de Pass Royale.`,
  },
  league: {
    en: (n) => `${n} for champions, skins and the Battle Pass.`,
    nl: (n) => `${n} voor champions, skins en de Battle Pass.`,
  },
  pubg: {
    en: (n) => `${n} for crates, skins and the Royale Pass.`,
    nl: (n) => `${n} voor crates, skins en de Royale Pass.`,
  },
  freefire: {
    en: (n) => `${n} for characters, skins and the Elite Pass.`,
    nl: (n) => `${n} voor characters, skins en de Elite Pass.`,
  },
  mlbb: {
    en: (n) => `${n} for heroes, skins and the Starlight Pass.`,
    nl: (n) => `${n} voor heroes, skins en de Starlight Pass.`,
  },
  pokemongo: {
    en: (n) => `${n} for items, storage upgrades and raid passes.`,
    nl: (n) => `${n} voor items, meer opslag en raid passes.`,
  },
  eafc: {
    en: (n) => `${n} for Ultimate Team packs and drafts.`,
    nl: (n) => `${n} voor Ultimate Team-packs en drafts.`,
  },
  gta: {
    en: (n) => `${n} for cars, properties and businesses in GTA Online.`,
    nl: (n) => `${n} voor auto's, panden en bedrijven in GTA Online.`,
  },
  minecraft: {
    en: (n) => `${n} for skins, worlds and texture packs.`,
    nl: (n) => `${n} voor skins, werelden en texture packs.`,
  },
  gamepass: {
    en: (n) => `${n} — hundreds of games on console, PC and cloud.`,
    nl: (n) => `${n} — honderden games op console, pc en cloud.`,
  },
  spotify: {
    en: (n) => `${n} — ad-free music, offline listening and better quality.`,
    nl: (n) => `${n} — muziek zonder reclame, offline luisteren en betere kwaliteit.`,
  },
  'discord-nitro': {
    en: (n) => `${n} — better emoji, bigger uploads and a boost for your server.`,
    nl: (n) => `${n} — betere emoji, grotere uploads en een boost voor je server.`,
  },
  giftcard: {
    en: (n) => `${n} — official code, redeemed on your own account.`,
    nl: (n) => `${n} — officiële code, wissel je in op je eigen account.`,
  },
  mystery: {
    en: (n) => `${n} — every box pays out real store credit.`,
    nl: (n) => `${n} — elke box keert echt winkeltegoed uit.`,
  },
};

const FALLBACK = {
  en: (n) => `${n} — an official top-up, delivered to the account you give us.`,
  nl: (n) => `${n} — een officiële top-up, geleverd op het account dat je opgeeft.`,
};

/**
 * The description to show, in the requested language.
 *
 * An explicit description the owner typed in the admin always wins — this only
 * fills the gap, and only in the language it can actually write.
 */
export function describeProduct(product, lang = 'en') {
  if (!product) return '';
  const custom = lang === 'nl' ? product.descriptionNl : product.description;
  if (custom && String(custom).trim()) return String(custom);
  const name = String(product.name || '').trim();
  if (!name) return '';
  const recipe = COPY[String(product.category || '').toLowerCase()] || FALLBACK;
  return (recipe[lang] || recipe.en)(name);
}

/** Attach a Dutch description to a catalog row for the API. */
export function withCopy(product) {
  const meta = product?.metadata || {};
  return {
    ...product,
    // A description typed in the admin stays authoritative; the generated Dutch
    // one only fills in where nothing was written.
    descriptionNl: meta.descriptionNl || describeProduct({ ...product, descriptionNl: null }, 'nl'),
  };
}
