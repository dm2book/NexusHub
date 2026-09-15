/**
 * Product descriptions, in every language the shop is read in.
 *
 * Every description in the catalogue was written in English and stored that
 * way, so a reader in any other language met the largest single block of
 * untranslated text on the site — and the one a buyer reads most.
 *
 * Rather than four columns and 70 hand-written strings that drift apart, the
 * copy is generated per category from the product's own name. A new product
 * gets correct copy in four languages for free, and there is one place to fix
 * a wording mistake.
 *
 * THIS FILE IS THAT ONE PLACE. It used to be two: the server generated Dutch
 * for the API and the storefront kept its own copy of the same table for the
 * fallback catalogue. They had already drifted — the client's table had no
 * `gta` entry, so a Shark Card served from the fallback catalogue described
 * itself as "an official top-up delivered to the account you give us" while
 * the same product from the API said what it actually was. Both sides import
 * this now; the server does the same for brandMarks.js.
 *
 * These also replace descriptions that promised "instant delivery" — the claim
 * the rest of the product stopped making.
 */

const COPY = {
  robux: {
    en: (n) => `${n} topped up straight onto your Roblox account.`,
    nl: (n) => `${n} rechtstreeks op je Roblox-account.`,
    de: (n) => `${n} direkt auf dein Roblox-Konto aufgeladen.`,
    fr: (n) => `${n} crédités directement sur ton compte Roblox.`,
  },
  'v-bucks': {
    en: (n) => `${n} for skins, emotes and the Battle Pass.`,
    nl: (n) => `${n} voor skins, emotes en de Battle Pass.`,
    de: (n) => `${n} für Skins, Emotes und den Battle Pass.`,
    fr: (n) => `${n} pour les skins, les emotes et le Battle Pass.`,
  },
  valorant: {
    en: (n) => `${n} for agents, skins and the Battle Pass.`,
    nl: (n) => `${n} voor agents, skins en de Battle Pass.`,
    de: (n) => `${n} für Agents, Skins und den Battle Pass.`,
    fr: (n) => `${n} pour les agents, les skins et le Battle Pass.`,
  },
  cod: {
    en: (n) => `${n} for operators, blueprints and the Battle Pass.`,
    nl: (n) => `${n} voor operators, blueprints en de Battle Pass.`,
    de: (n) => `${n} für Operator, Blaupausen und den Battle Pass.`,
    fr: (n) => `${n} pour les opérateurs, les plans et le Battle Pass.`,
  },
  apex: {
    en: (n) => `${n} for legends, skins and Apex packs.`,
    nl: (n) => `${n} voor legends, skins en Apex-packs.`,
    de: (n) => `${n} für Legenden, Skins und Apex-Packs.`,
    fr: (n) => `${n} pour les légendes, les skins et les packs Apex.`,
  },
  genshin: {
    en: (n) => `${n} for wishes and the Battle Pass.`,
    nl: (n) => `${n} voor wishes en de Battle Pass.`,
    de: (n) => `${n} für Wishes und den Battle Pass.`,
    fr: (n) => `${n} pour les vœux et le Battle Pass.`,
  },
  brawl: {
    en: (n) => `${n} for brawlers, skins and the Brawl Pass.`,
    nl: (n) => `${n} voor brawlers, skins en de Brawl Pass.`,
    de: (n) => `${n} für Brawler, Skins und den Brawl Pass.`,
    fr: (n) => `${n} pour les brawlers, les skins et le Brawl Pass.`,
  },
  clash: {
    en: (n) => `${n} for builders, boosts and chests.`,
    nl: (n) => `${n} voor bouwers, boosts en kisten.`,
    de: (n) => `${n} für Bauarbeiter, Boosts und Truhen.`,
    fr: (n) => `${n} pour les ouvriers, les boosts et les coffres.`,
  },
  clashroyale: {
    en: (n) => `${n} for chests, cards and the Pass Royale.`,
    nl: (n) => `${n} voor kisten, kaarten en de Pass Royale.`,
    de: (n) => `${n} für Truhen, Karten und den Pass Royale.`,
    fr: (n) => `${n} pour les coffres, les cartes et le Pass Royale.`,
  },
  league: {
    en: (n) => `${n} for champions, skins and the Battle Pass.`,
    nl: (n) => `${n} voor champions, skins en de Battle Pass.`,
    de: (n) => `${n} für Champions, Skins und den Battle Pass.`,
    fr: (n) => `${n} pour les champions, les skins et le Battle Pass.`,
  },
  pubg: {
    en: (n) => `${n} for crates, skins and the Royale Pass.`,
    nl: (n) => `${n} voor crates, skins en de Royale Pass.`,
    de: (n) => `${n} für Kisten, Skins und den Royale Pass.`,
    fr: (n) => `${n} pour les caisses, les skins et le Royale Pass.`,
  },
  freefire: {
    en: (n) => `${n} for characters, skins and the Elite Pass.`,
    nl: (n) => `${n} voor characters, skins en de Elite Pass.`,
    de: (n) => `${n} für Charaktere, Skins und den Elite Pass.`,
    fr: (n) => `${n} pour les personnages, les skins et l’Elite Pass.`,
  },
  mlbb: {
    en: (n) => `${n} for heroes, skins and the Starlight Pass.`,
    nl: (n) => `${n} voor heroes, skins en de Starlight Pass.`,
    de: (n) => `${n} für Helden, Skins und den Starlight Pass.`,
    fr: (n) => `${n} pour les héros, les skins et le Starlight Pass.`,
  },
  pokemongo: {
    en: (n) => `${n} for items, storage upgrades and raid passes.`,
    nl: (n) => `${n} voor items, meer opslag en raid passes.`,
    de: (n) => `${n} für Items, mehr Speicherplatz und Raid-Pässe.`,
    fr: (n) => `${n} pour les objets, plus de stockage et les pass de raid.`,
  },
  eafc: {
    en: (n) => `${n} for Ultimate Team packs and drafts.`,
    nl: (n) => `${n} voor Ultimate Team-packs en drafts.`,
    de: (n) => `${n} für Ultimate-Team-Packs und Drafts.`,
    fr: (n) => `${n} pour les packs Ultimate Team et les drafts.`,
  },
  gta: {
    en: (n) => `${n} for cars, properties and businesses in GTA Online.`,
    nl: (n) => `${n} voor auto's, panden en bedrijven in GTA Online.`,
    de: (n) => `${n} für Autos, Immobilien und Unternehmen in GTA Online.`,
    fr: (n) => `${n} pour les voitures, les propriétés et les entreprises dans GTA Online.`,
  },
  minecraft: {
    en: (n) => `${n} for skins, worlds and texture packs.`,
    nl: (n) => `${n} voor skins, werelden en texture packs.`,
    de: (n) => `${n} für Skins, Welten und Texture Packs.`,
    fr: (n) => `${n} pour les skins, les mondes et les packs de textures.`,
  },
  gamepass: {
    en: (n) => `${n} — hundreds of games on console, PC and cloud.`,
    nl: (n) => `${n} — honderden games op console, pc en cloud.`,
    de: (n) => `${n} — hunderte Spiele auf Konsole, PC und in der Cloud.`,
    fr: (n) => `${n} — des centaines de jeux sur console, PC et cloud.`,
  },
  spotify: {
    en: (n) => `${n} — ad-free music, offline listening and better quality.`,
    nl: (n) => `${n} — muziek zonder reclame, offline luisteren en betere kwaliteit.`,
    de: (n) => `${n} — Musik ohne Werbung, offline hören und in besserer Qualität.`,
    fr: (n) => `${n} — musique sans publicité, écoute hors ligne et meilleure qualité.`,
  },
  'discord-nitro': {
    en: (n) => `${n} — better emoji, bigger uploads and a boost for your server.`,
    nl: (n) => `${n} — betere emoji, grotere uploads en een boost voor je server.`,
    de: (n) => `${n} — bessere Emojis, größere Uploads und ein Boost für deinen Server.`,
    fr: (n) => `${n} — de meilleurs emojis, des envois plus lourds et un boost pour ton serveur.`,
  },
  giftcard: {
    en: (n) => `${n} — official code, redeemed on your own account.`,
    nl: (n) => `${n} — officiële code, wissel je in op je eigen account.`,
    de: (n) => `${n} — offizieller Code, den du auf deinem eigenen Konto einlöst.`,
    fr: (n) => `${n} — code officiel, à utiliser sur ton propre compte.`,
  },
  mystery: {
    en: (n) => `${n} — every box pays out real store credit.`,
    nl: (n) => `${n} — elke box keert echt winkeltegoed uit.`,
    de: (n) => `${n} — jede Box zahlt echtes Shop-Guthaben aus.`,
    fr: (n) => `${n} — chaque boîte verse un vrai crédit boutique.`,
  },
};

const FALLBACK = {
  en: (n) => `${n} — an official top-up, delivered to the account you give us.`,
  nl: (n) => `${n} — een officiële top-up, geleverd op het account dat je opgeeft.`,
  de: (n) => `${n} — eine offizielle Aufladung, geliefert auf das Konto, das du uns nennst.`,
  fr: (n) => `${n} — une recharge officielle, livrée sur le compte que tu nous indiques.`,
};

/** The languages a generated description can be written in. */
export const COPY_LANGS = ['en', 'nl', 'de', 'fr'];

/** Where a typed description for `lang` is kept on a product row. */
export const describedField = (lang) => (lang === 'en' ? 'description' : `description${lang[0].toUpperCase()}${lang.slice(1)}`);

/**
 * The description to show, in the requested language.
 *
 * A description the owner typed in the admin always wins — this only fills the
 * gap. It fills it per LANGUAGE: a product with hand-written English and no
 * German gets generated German rather than the English paragraph, because a
 * German reader can read the generated one.
 */
export function describeProduct(product, lang = 'en') {
  if (!product) return '';
  const typed = product[describedField(lang)];
  if (typed && String(typed).trim()) return String(typed).trim();
  const name = String(product.name || '').trim();
  if (!name) return '';
  const recipe = COPY[String(product.category || '').toLowerCase()] || FALLBACK;
  return (recipe[lang] || recipe.en)(name);
}
