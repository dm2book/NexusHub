/**
 * The canonical product model.
 *
 * "EA FC Points 1050 PS5 EU", "FC Points 1050 PlayStation EU" and
 * "EA Sports FC 1050 Points PS5 Europe" are three ways of writing one thing to
 * buy. This module turns any of them into the same six-part key, and refuses to
 * turn two different things into one.
 *
 * ── THE RULE THAT MATTERS ─────────────────────────────────────────────────
 * Platform, region and denomination NEVER merge. A key is
 *
 *     type:game:edition:platform:region:denomination:unit:quantity
 *
 * and it is stored UNIQUE, so 1050 points on PlayStation EU and 1050 points on
 * PC EU are two rows however similar their titles look. Getting this wrong does
 * not produce a slightly worse catalogue; it produces a shop selling a PC code
 * to somebody on a console, and a pricing engine averaging two markets into one
 * number that describes neither.
 *
 * Aliasing happens WITHIN a dimension, never across it: "PS5", "PS4",
 * "PlayStation" and "PSN" are all the PlayStation family, because that is how
 * publishers actually sell points — one wallet per platform family. Where a
 * title is ambiguous the parser says so (`confidence`, `unknown`) instead of
 * picking, and an unknown platform or region is a product for a human to look
 * at, not a product to price.
 *
 * ── WHY A PARSER AND NOT A LOOKUP TABLE ───────────────────────────────────
 * A table of every denomination of every game would be a list of guesses about
 * what the market sells, and this system exists precisely because we do not
 * know that. The parser reads what a source actually said and admits when it
 * cannot.
 */

/** Games this parser recognises, with the ways the market writes them. */
export const GAMES = [
  { key: 'ea-fc', label: 'EA Sports FC', unit: 'points',
    patterns: [/\bea\s*(sports\s*)?fc\b/i, /\bfc\s*points?\b/i, /\bfifa\b/i, /\bfut\b/i] },
  { key: 'roblox', label: 'Roblox', unit: 'robux',
    patterns: [/\broblox\b/i, /\brobux\b/i] },
  { key: 'fortnite', label: 'Fortnite', unit: 'v-bucks',
    patterns: [/\bfortnite\b/i, /\bv-?bucks\b/i] },
  { key: 'minecraft', label: 'Minecraft', unit: 'minecoins',
    patterns: [/\bminecraft\b/i, /\bminecoins?\b/i] },
  { key: 'pokemon-go', label: 'Pokémon GO', unit: 'pokecoins',
    patterns: [/\bpok[eé]mon\s*go\b/i, /\bpok[eé]coins?\b/i] },
  { key: 'valorant', label: 'Valorant', unit: 'vp',
    patterns: [/\bvalorant\b/i, /\bvalorant\s*points?\b/i, /\bvp\b/i] },
  { key: 'call-of-duty', label: 'Call of Duty', unit: 'cod-points',
    patterns: [/\bcall\s*of\s*duty\b/i, /\bcod\s*points?\b/i, /\bmw[23]\b/i] },
  { key: 'brawl-stars', label: 'Brawl Stars', unit: 'gems',
    patterns: [/\bbrawl\s*stars\b/i] },
  { key: 'clash-of-clans', label: 'Clash of Clans', unit: 'gems',
    patterns: [/\bclash\s*of\s*clans\b/i] },
  { key: 'discord', label: 'Discord', unit: 'months',
    patterns: [/\bdiscord\s*nitro\b/i] },
  { key: 'steam', label: 'Steam', unit: 'EUR', patterns: [/\bsteam\b/i] },
  { key: 'playstation-store', label: 'PlayStation Store', unit: 'EUR',
    patterns: [/\bpsn\b.*\b(card|wallet|gift)/i, /\bplaystation\s*(store|network)\s*(card|gift)/i] },
  { key: 'xbox-store', label: 'Xbox', unit: 'EUR',
    patterns: [/\bxbox\b.*\b(card|gift|live)/i] },
  { key: 'nintendo-store', label: 'Nintendo eShop', unit: 'EUR',
    patterns: [/\bnintendo\b/i, /\beshop\b/i] },
  { key: 'spotify', label: 'Spotify', unit: 'months', patterns: [/\bspotify\b/i] },
  { key: 'netflix', label: 'Netflix', unit: 'EUR', patterns: [/\bnetflix\b/i] },
];

/**
 * Platform FAMILIES. The generation ("PS4" vs "PS5") is kept as `platformRaw`
 * for a reviewer to read, but it does not split the canonical key: publishers
 * sell one points wallet per family, and splitting on generation would produce
 * two half-populated price sets for one real market.
 */
export const PLATFORMS = [
  { key: 'playstation', patterns: [/\bps[45]\b/i, /\bplaystation\b/i, /\bpsn\b/i, /\bps\s*store\b/i] },
  { key: 'xbox', patterns: [/\bxbox\b/i, /\bseries\s*[xs]\b/i, /\bxbl\b/i] },
  { key: 'pc', patterns: [/\bpc\b/i, /\borigin\b/i, /\bea\s*app\b/i, /\bsteam\b/i, /\bwindows\b/i] },
  { key: 'nintendo', patterns: [/\bnintendo\b/i, /\bswitch\b/i, /\beshop\b/i] },
  { key: 'ios', patterns: [/\bios\b/i, /\biphone\b/i, /\bapple\b/i, /\bapp\s*store\b/i] },
  { key: 'android', patterns: [/\bandroid\b/i, /\bgoogle\s*play\b/i] },
  { key: 'mobile', patterns: [/\bmobile\b/i] },
];

/** Regions, as marketplaces write them. */
export const REGIONS = [
  { key: 'eu', patterns: [/\b(eu|europe|european)\b/i, /\beuropa\b/i] },
  { key: 'us', patterns: [/\b(us|usa|united\s*states|north\s*america|na)\b/i] },
  { key: 'uk', patterns: [/\b(uk|united\s*kingdom|gb|great\s*britain)\b/i] },
  { key: 'global', patterns: [/\b(global|worldwide|ww|region\s*free)\b/i] },
  { key: 'tr', patterns: [/\b(tr|turkey|t[uü]rkiye)\b/i] },
  { key: 'br', patterns: [/\b(br|brazil|brasil)\b/i] },
  { key: 'ar', patterns: [/\b(ar|argentina)\b/i] },
  { key: 'asia', patterns: [/\b(asia|apac)\b/i] },
];

export const PRODUCT_TYPES = [
  { key: 'points', patterns: [/\bpoints?\b/i, /\brobux\b/i, /\bv-?bucks\b/i, /\bcoins?\b/i, /\bgems?\b/i, /\bvp\b/i] },
  { key: 'giftcard', patterns: [/\bgift\s*card\b/i, /\bwallet\b/i, /\btop-?up\b/i, /\bcard\b/i] },
  { key: 'subscription', patterns: [/\bnitro\b/i, /\bpremium\b/i, /\bsubscription\b/i, /\bmonths?\b/i, /\bgame\s*pass\b/i] },
  { key: 'key', patterns: [/\b(cd-?)?key\b/i, /\blicen[cs]e\b/i, /\bactivation\b/i] },
];

const first = (table, text) => table.find((e) => e.patterns.some((re) => re.test(text)))?.key || null;

/**
 * Pull the denomination out of a title.
 *
 * "1,050", "1050", "1.050" and "12k" all mean a number; "€25" and "25 EUR" mean
 * a money amount, which is a different unit. Returns null rather than a guess
 * when the title carries no number at all — a product without a denomination is
 * not a product this system can price against another one.
 */
export function parseDenomination(rawTitle) {
  const t = String(rawTitle || '');

  // Money first: a gift card's "25" is euros, not points.
  const money = t.match(/(?:€|EUR\s*)\s*(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s*(?:€|EUR)\b/i);
  if (money) {
    const n = Number(String(money[1] || money[2]).replace(',', '.'));
    if (Number.isFinite(n)) return { value: n, unit: 'EUR', source: 'money' };
  }

  // "12k" / "12K points"
  const k = t.match(/\b(\d+(?:[.,]\d+)?)\s*k\b/i);
  if (k) {
    const n = Number(String(k[1]).replace(',', '.')) * 1000;
    if (Number.isFinite(n)) return { value: Math.round(n), unit: '', source: 'k-suffix' };
  }

  /* Plain numbers, thousands separated either way. The largest number in the
     title wins: "EA FC 25 — 1050 Points" carries the edition year AND the
     denomination, and 1050 is the one being sold. */
  const nums = [...t.matchAll(/\b(\d{1,3}(?:[.,]\d{3})+|\d+)\b/g)]
    .map((m) => Number(String(m[1]).replace(/[.,](?=\d{3}\b)/g, '')))
    .filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  return { value: Math.max(...nums), unit: '', source: 'digits' };
}

/** The edition year, when a title carries one ("FC 25", "FIFA 23"). */
export function parseEdition(rawTitle) {
  const m = String(rawTitle || '').match(/\b(?:fc|fifa|nba|nhl|madden)\s*(\d{2})\b/i);
  if (m) return `fc${m[1]}`;
  const y = String(rawTitle || '').match(/\b(20\d{2})\b/);
  return y ? y[1] : '';
}

/**
 * Parse one marketplace title into the canonical model.
 *
 * `hints` lets a source pass structured fields it already knows (platform,
 * region, denomination), which are trusted over anything guessed from prose —
 * an API that states its platform is better evidence than a regex over a title
 * somebody typed.
 */
export function parseTitle(rawTitle, hints = {}) {
  const t = String(rawTitle || '').trim();
  const unknown = [];

  const game = hints.game || first(GAMES, t);
  if (!game) unknown.push('game');

  const platformRaw = hints.platformRaw || (t.match(/\bps[45]\b|\bseries\s*[xs]\b/i)?.[0] || '');
  const platform = hints.platform || first(PLATFORMS, t);
  if (!platform) unknown.push('platform');

  const region = hints.region || first(REGIONS, t);
  if (!region) unknown.push('region');

  let productType = hints.productType || first(PRODUCT_TYPES, t);
  if (!productType) unknown.push('productType');

  const denom = hints.denomination != null
    ? { value: Number(hints.denomination), unit: hints.denomUnit || '', source: 'hint' }
    : parseDenomination(t);
  if (!denom) unknown.push('denomination');

  const gameDef = GAMES.find((g) => g.key === game);
  const denomUnit = hints.denomUnit
    || (denom?.unit === 'EUR' ? 'EUR' : (gameDef?.unit || ''));
  const edition = hints.edition ?? parseEdition(t);
  const quantity = Number(hints.quantity) > 0 ? Math.round(Number(hints.quantity)) : 1;

  /* Confidence is the share of the six dimensions we actually read, not a
     feeling. It is what the safety gate uses to refuse to price something we
     only half understand. */
  const confidence = Number(((6 - unknown.length) / 6).toFixed(3));

  const model = {
    productType: productType || 'unknown',
    game: game || 'unknown',
    edition: edition || '',
    platform: platform || 'unknown',
    platformRaw,
    region: region || 'unknown',
    denomination: denom ? denom.value : null,
    denomUnit,
    quantity,
    confidence,
    unknown,
    rawTitle: t,
  };
  model.canonicalKey = canonicalKey(model);
  model.title = readableTitle(model);
  return model;
}

/**
 * The six-part identity, as a string.
 *
 * Any dimension that could not be read becomes "unknown" rather than being
 * dropped, so two half-parsed titles do not become the same key by both missing
 * the same field. An unknown is a difference, not a wildcard.
 */
export function canonicalKey(m) {
  return [
    m.productType || 'unknown',
    m.game || 'unknown',
    m.edition || '-',
    m.platform || 'unknown',
    m.region || 'unknown',
    m.denomination == null ? 'unknown' : String(m.denomination),
    m.denomUnit || '-',
    String(m.quantity || 1),
  ].join(':');
}

/** A name a human would recognise, built from the model rather than the title. */
export function readableTitle(m) {
  const gameLabel = GAMES.find((g) => g.key === m.game)?.label || m.game;
  const unit = m.denomUnit && m.denomUnit !== 'EUR' ? ` ${m.denomUnit}` : '';
  const amount = m.denomination == null ? ''
    : m.denomUnit === 'EUR' ? `€${m.denomination}` : `${m.denomination.toLocaleString('en-US')}${unit}`;
  const bits = [gameLabel, m.edition ? m.edition.toUpperCase() : '', amount,
    m.platform !== 'unknown' ? m.platform.toUpperCase() : '',
    m.region !== 'unknown' ? m.region.toUpperCase() : ''];
  return bits.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Do these two models describe the same thing to buy?
 *
 * Equality of the key, and nothing looser. There is deliberately no fuzzy
 * variant: "close enough" between two denominations is a mispriced product, and
 * between two platforms it is an undeliverable one.
 */
export function sameProduct(a, b) {
  return canonicalKey(a) === canonicalKey(b);
}

/**
 * Products that are NOT the same but are close enough that a human should look:
 * every dimension matches except one, and that one is not the denomination.
 *
 * Used to surface POSSIBLE DUPLICATE rather than to merge anything.
 */
export function nearMiss(a, b) {
  const ka = canonicalKey(a).split(':');
  const kb = canonicalKey(b).split(':');
  const diff = ka.map((v, i) => (v === kb[i] ? null : i)).filter((i) => i !== null);
  if (diff.length !== 1) return null;
  const field = ['productType', 'game', 'edition', 'platform', 'region', 'denomination', 'denomUnit', 'quantity'][diff[0]];
  // A different denomination is a different product, full stop — never a
  // near-miss worth reviewing as a duplicate.
  if (field === 'denomination') return null;
  return { field, a: ka[diff[0]], b: kb[diff[0]] };
}
