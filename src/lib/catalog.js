import { describeProduct, COPY_LANGS } from './productCopy.js';
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

/**
 * A category's name in the language being read.
 *
 * Thirty-three of these and only two need translating: the rest are proper
 * nouns — Robux is Robux in Berlin, Clash of Clans is Clash of Clans in Lyon —
 * and translating them would be worse than leaving them. "Gift Cards" and
 * "Subscriptions" are ordinary words, and they were the eyebrow on a third of
 * the cards in the shop, in English, on every page.
 *
 * The English label is the DEFAULT rather than a separate table, so a category
 * without a translation renders its own name instead of a missing key, and
 * adding one is a single line in each dictionary.
 */
export function categoryLabel(category, t) {
  const fallback = categoryVisual(category).label;
  return typeof t === 'function' ? t(`cat.${category}`, fallback) : fallback;
}

export function categoryVisual(category) {
  const key = String(category || '').toLowerCase();
  return MAP[key] || { icon: Package, grad: 'from-slate-500 to-slate-700', label: category || 'Other' };
}

/**
 * Money, formatted once per currency rather than once per call.
 *
 * `new Intl.NumberFormat(...)` builds a locale-aware formatter from scratch —
 * it is one of the more expensive things in the standard library, and this was
 * calling it for every price on the page. Profiled on a throttled phone: 70 ms
 * of main-thread time on the catalogue, in one function, for seventy products
 * whose formatter is byte-for-byte identical every time.
 *
 * Cached by currency. The set of currencies a shop uses is tiny and fixed, so
 * the map cannot grow in any meaningful way.
 */
const FORMATTERS = new Map();
const formatter = (cur) => {
  let f = FORMATTERS.get(cur);
  if (!f) {
    f = new Intl.NumberFormat('en-IE', { style: 'currency', currency: cur });
    FORMATTERS.set(cur, f);
  }
  return f;
};

export const money = (cents, cur = 'EUR') => formatter(cur).format((cents || 0) / 100);

// Fold a search string down to letters+digits so "vbucks", "V-Bucks" and
// "V BUCKS" all match. Used by the storefront search and the admin filter.
export const normalizeSearch = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// Owner-supplied artwork (an upload or a pasted link) vs. a built-in asset
// under /products/. Custom images may carry their own background, so we render
// them with a blurred backdrop instead of the bare logo-on-plinth treatment.
export const isCustomImage = (src) => !!src && !String(src).startsWith('/products/');

/**
 * Does this picture bring its own background?
 *
 * The tile treats those two kinds of art differently, and the useful question is
 * about the FILE, not about who supplied it. A generated icon is a transparent
 * SVG badge drawn for the plinth beneath it. A 3D render or an uploaded photo is
 * a rectangle with colour to the edge, and it needs the tile to meet it halfway.
 *
 * Keying on the path instead — "does it live under /products/?" — put the shop's
 * own renders on the wrong side of that line, so the blending written for
 * exactly this art never applied to it.
 */
export const carriesOwnBackground = (src) => {
  const s = String(src || '');
  /* The built-in icon set is LOGOS, whatever container they happen to be in.
     Ten of them ship as WebP because that was the smaller file at the time, and
     the extension test below caught exactly those ten and called them
     photographs — so xbox.webp and playstation.webp rendered edge to edge in
     the gift-card grid while netflix.svg and amazon.svg beside them sat inset
     on a plinth. Same kind of asset, same category, same row, two different
     sizes, decided by nothing but a file extension.

     The path is the honest question. /products/icons/ is a badge for a plinth,
     /products/packs/ is a card with colour to the edge, and anything outside
     /products/ is whatever the owner uploaded. */
  if (/^\/products\/icons\//.test(s)) return false;
  /* /products/art/ is the generated system: authored at 7:6, dark, colour to
     the edge. It is the tile, so it must never be inset on a plinth. */
  if (/^\/products\/(art|packs)\//.test(s)) return true;
  return isCustomImage(s) || /\.(webp|png|jpe?g|avif)(\?|$)/i.test(s);
};

/**
 * Art this shop composed itself, at the ratio of the box it goes in.
 *
 * Narrower than carriesOwnBackground(): that one answers "is this a photograph
 * or a badge on a transparent canvas". This one answers "did we author it at
 * 7:6", which is true of the generated artboards and of every owner upload,
 * because productArtboard.js composites uploads onto the same 7:6 board before
 * they reach the store.
 *
 * It matters on the product page. The hero pads its image by 32px and lays a
 * blurred copy behind it — right for a photograph with its own edges, wrong for
 * a board that already carries its ground to the edge. Measured before this
 * existed: the hero painted the artwork at 59.1% of its box while the little
 * card the visitor clicked to get there painted 97.7%. The most important
 * picture on the page showed the product smaller than the thumbnail did.
 */
export const isForgeArtboard = (src) => {
  const s = String(src || '');
  return /^\/products\/art\//.test(s) || /^\/api\/images\//.test(s);
};


export { CreditCard };

/**
 * The product description in the active language.
 *
 * The API sends both: `description` (as typed / English) and `descriptionNl`.
 * Rendering `description` directly is what left the whole shop in English after
 * switching to Dutch.
 */
/**
 * The description to show, in the language being read.
 *
 * Products served by the API arrive with one per language (see withCopy).
 * This also covers the client-side sample catalogue — used before the API
 * answers and when it cannot — which would otherwise show English on a German
 * page. Both sides call the same generator now: the table that produces these
 * sentences used to be written out twice, and the copy here had already lost
 * its `gta` entry.
 */
export function productDescription(product, lang) {
  return describeProduct(product, COPY_LANGS.includes(lang) ? lang : 'en');
}
