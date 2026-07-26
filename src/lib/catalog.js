import {
  Gamepad2, Gift, Coins, Crown, Sparkles, Ticket, CreditCard, Package,
  Crosshair, Gem, Swords, Trophy, Music, Film, Smartphone, ShoppingBag, Diamond,
} from 'lucide-react';

// Visual treatment per category — gradient + icon used across the storefront.
const MAP = {
  // ── Game currency ──────────────────────────────────────────────
  robux: { icon: Coins, grad: 'from-emerald-500 to-teal-500', label: 'Robux' },
  'v-bucks': { icon: Sparkles, grad: 'from-purple-500 to-fuchsia-500', label: 'V-Bucks' },
  cod: { icon: Crosshair, grad: 'from-orange-500 to-red-600', label: 'Call of Duty' },
  brawl: { icon: Gem, grad: 'from-amber-400 to-yellow-500', label: 'Brawl Stars' },
  apex: { icon: Crosshair, grad: 'from-red-500 to-rose-800', label: 'Apex Legends' },
  valorant: { icon: Crosshair, grad: 'from-rose-500 to-red-600', label: 'Valorant' },
  genshin: { icon: Sparkles, grad: 'from-cyan-400 to-indigo-500', label: 'Genshin Impact' },
  clash: { icon: Gem, grad: 'from-violet-500 to-blue-600', label: 'Clash of Clans' },
  clashroyale: { icon: Crown, grad: 'from-blue-500 to-indigo-600', label: 'Clash Royale' },
  league: { icon: Swords, grad: 'from-amber-400 to-yellow-600', label: 'League of Legends' },
  freefire: { icon: Diamond, grad: 'from-orange-400 to-amber-600', label: 'Free Fire' },
  pubg: { icon: Crosshair, grad: 'from-yellow-500 to-orange-600', label: 'PUBG Mobile' },
  mlbb: { icon: Diamond, grad: 'from-sky-400 to-blue-600', label: 'Mobile Legends' },
  eafc: { icon: Trophy, grad: 'from-green-500 to-emerald-600', label: 'EA FC / FIFA' },
  gta: { icon: Coins, grad: 'from-lime-400 to-green-600', label: 'GTA Online' },
  minecraft: { icon: Package, grad: 'from-emerald-600 to-green-800', label: 'Minecraft' },
  pokemongo: { icon: Coins, grad: 'from-yellow-400 to-red-500', label: 'Pokémon GO' },
  wow: { icon: Swords, grad: 'from-amber-500 to-yellow-700', label: 'World of Warcraft' },
  // ── Subscriptions ──────────────────────────────────────────────
  'discord-nitro': { icon: Crown, grad: 'from-indigo-500 to-violet-500', label: 'Discord Nitro' },
  nitro: { icon: Crown, grad: 'from-indigo-500 to-violet-500', label: 'Nitro' },
  spotify: { icon: Music, grad: 'from-green-400 to-green-600', label: 'Spotify' },
  netflix: { icon: Film, grad: 'from-red-600 to-rose-700', label: 'Netflix' },
  gamepass: { icon: Gamepad2, grad: 'from-green-500 to-emerald-700', label: 'Xbox Game Pass' },
  // ── Gift cards & wallets ───────────────────────────────────────
  steam: { icon: Gamepad2, grad: 'from-sky-500 to-blue-600', label: 'Steam' },
  playstation: { icon: Gamepad2, grad: 'from-blue-500 to-cyan-500', label: 'PlayStation' },
  xbox: { icon: Gamepad2, grad: 'from-green-500 to-emerald-500', label: 'Xbox' },
  nintendo: { icon: Gamepad2, grad: 'from-red-500 to-rose-600', label: 'Nintendo eShop' },
  amazon: { icon: ShoppingBag, grad: 'from-amber-400 to-orange-600', label: 'Amazon' },
  googleplay: { icon: Smartphone, grad: 'from-emerald-400 to-teal-600', label: 'Google Play' },
  itunes: { icon: Smartphone, grad: 'from-pink-500 to-fuchsia-600', label: 'App Store & iTunes' },
  giftcard: { icon: Gift, grad: 'from-pink-500 to-rose-500', label: 'Gift Cards' },
  subscription: { icon: Ticket, grad: 'from-amber-500 to-orange-500', label: 'Subscriptions' },
  mystery: { icon: Gift, grad: 'from-amber-400 to-rose-500', label: 'Mystery Box' },
};

export function categoryVisual(category) {
  const key = String(category || '').toLowerCase();
  return MAP[key] || { icon: Package, grad: 'from-slate-500 to-slate-700', label: category || 'Other' };
}

export const money = (cents, cur = 'EUR') =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: cur }).format((cents || 0) / 100);

// Fold a search string down to letters+digits so "vbucks", "V-Bucks" and
// "V BUCKS" all match. Used by the storefront search and the admin filter.
export const normalizeSearch = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// Owner-supplied artwork (an upload or a pasted link) vs. a built-in asset
// under /products/. Custom images may carry their own background, so we render
// them with a blurred backdrop instead of the bare logo-on-plinth treatment.
export const isCustomImage = (src) => !!src && !String(src).startsWith('/products/');

export { CreditCard };

/**
 * The product description in the active language.
 *
 * The API sends both: `description` (as typed / English) and `descriptionNl`.
 * Rendering `description` directly is what left the whole shop in English after
 * switching to Dutch.
 */
export function productDescription(product, lang) {
  if (!product) return '';
  if (lang !== 'nl') return product.description || '';
  if (product.descriptionNl) return product.descriptionNl;
  // Products served by the API always carry descriptionNl. This covers the
  // client-side sample catalogue (used before the API answers, and as a
  // fallback when it cannot), which would otherwise show English on a Dutch
  // page. Mirrors server/src/services/productCopy.js.
  const name = String(product.name || '').trim();
  if (!name) return product.description || '';
  const tail = NL_TAIL[String(product.category || '').toLowerCase()];
  return tail ? `${name} ${tail}` : `${name} — een officiële top-up, geleverd op het account dat je opgeeft.`;
}

const NL_TAIL = {
  robux: 'rechtstreeks op je Roblox-account.',
  'v-bucks': 'voor skins, emotes en de Battle Pass.',
  valorant: 'voor agents, skins en de Battle Pass.',
  cod: 'voor operators, blueprints en de Battle Pass.',
  apex: 'voor legends, skins en Apex-packs.',
  genshin: 'voor wishes en de Battle Pass.',
  brawl: 'voor brawlers, skins en de Brawl Pass.',
  clash: 'voor bouwers, boosts en kisten.',
  clashroyale: 'voor kisten, kaarten en de Pass Royale.',
  league: 'voor champions, skins en de Battle Pass.',
  pubg: 'voor crates, skins en de Royale Pass.',
  freefire: 'voor characters, skins en de Elite Pass.',
  mlbb: 'voor heroes, skins en de Starlight Pass.',
  pokemongo: 'voor items, meer opslag en raid passes.',
  eafc: 'voor Ultimate Team-packs en drafts.',
  gta: "voor auto's, panden en bedrijven in GTA Online.",
  minecraft: 'voor skins, werelden en texture packs.',
  gamepass: '— honderden games op console, pc en cloud.',
  spotify: '— muziek zonder reclame, offline luisteren en betere kwaliteit.',
  'discord-nitro': '— betere emoji, grotere uploads en een boost voor je server.',
  giftcard: '— officiële code, wissel je in op je eigen account.',
  mystery: '— elke box keert echt winkeltegoed uit, tot een jackpot van €150.',
};
