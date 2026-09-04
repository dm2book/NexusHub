/**
 * The ForgeMarket product-art system.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * Measured on the real catalogue in a real browser, before this file: 62
 * products shipped 480x300 pack art and 10 shipped square brand logos, into a
 * card whose media box is aspect-[7/6] = 1.167. Nothing matched, so nothing
 * filled the tile — and because the logo path also carries `p-4 sm:p-7`, the
 * two groups painted wildly different amounts of the same card:
 *
 *     pack art     73.1% of the tile on mobile, 72.5% on desktop
 *     brand logos  47.7% on mobile, 36.3% on desktop
 *
 * A shopper scrolling one grid saw some products at twice the visual weight of
 * others, for no reason connected to the products.
 *
 * ── THE FIX IS GEOMETRY, NOT DECORATION ───────────────────────────────────
 * Every artboard here is authored at EXACTLY the ratio it will be displayed at:
 * 700x600 (7:6) for the card, 1600x900 (16:9) for social. Art that matches its
 * container needs no letterboxing, so every product paints 100% of the tile and
 * the grid is even by construction rather than by tuning.
 *
 * The art also carries its own background, which puts it on the photo side of
 * carriesOwnBackground() — so the plinth padding never applies to it. That is
 * why the file lives under /products/art/ rather than /products/icons/.
 *
 * ── SVG, NOT RASTER ───────────────────────────────────────────────────────
 * Vector is resolution-independent, so "check the resolution" stops being a
 * recurring question: the same file is sharp on a 1x laptop and a 3x phone, at
 * 184px in a grid and 745px on a product page. It is also ~3-6 KB rather than
 * the 10-14 KB the WebP icons cost.
 *
 * ── THIRD-PARTY MARKS ARE COMPOSITED, NEVER REDRAWN ───────────────────────
 * The Roblox hexagon, the PlayStation logo, the Netflix N — these are other
 * companies' trademarks. This generator INLINES the official file already in
 * the repo; it does not ask a model to draw one. That keeps every mark exactly
 * as the rights-holder published it, and keeps 72 products visually identical
 * to each other rather than 72 separate hallucinations of a logo.
 */

/** ForgeMarket's own colours. Everything else is derived from these. */
export const BRAND = {
  indigo: '#6366f1',
  purple: '#a855f7',
  pink: '#ec4899',
  ink0: '#07060f',      // deepest background
  ink1: '#0e0b1e',      // card base
  ink2: '#171236',      // lifted panel
  text: '#f5f3ff',
  muted: '#a9a3c9',
};

/**
 * A per-category accent, so a grid has rhythm without 22 different design
 * languages. The accent only ever appears as a bloom and a hairline — the base
 * is the same near-black everywhere, which is what makes the set feel like one
 * shop rather than twenty-two.
 */
export const ACCENT = {
  robux: '#22c55e', 'v-bucks': '#38bdf8', eafc: '#4ade80', valorant: '#fb7185',
  cod: '#f97316', apex: '#ef4444', clash: '#facc15', clashroyale: '#60a5fa',
  brawl: '#fbbf24', genshin: '#22d3ee', gta: '#f472b6', league: '#38bdf8',
  mlbb: '#818cf8', pubg: '#fb923c', freefire: '#f87171', minecraft: '#84cc16',
  pokemongo: '#facc15', 'discord-nitro': '#818cf8', giftcard: '#c084fc',
  gamepass: '#4ade80', spotify: '#22c55e', mystery: '#a855f7',
};
export const accentFor = (category) => ACCENT[category] || BRAND.purple;

/** Human labels for the eyebrow line. Falls back to the raw category. */
export const CATEGORY_LABEL = {
  robux: 'ROBLOX', 'v-bucks': 'FORTNITE', eafc: 'EA SPORTS FC', valorant: 'VALORANT',
  cod: 'CALL OF DUTY', apex: 'APEX LEGENDS', clash: 'CLASH OF CLANS',
  clashroyale: 'CLASH ROYALE', brawl: 'BRAWL STARS', genshin: 'GENSHIN IMPACT',
  gta: 'GTA ONLINE', league: 'LEAGUE OF LEGENDS', mlbb: 'MOBILE LEGENDS',
  pubg: 'PUBG MOBILE', freefire: 'FREE FIRE', minecraft: 'MINECRAFT',
  pokemongo: 'POKÉMON GO', 'discord-nitro': 'DISCORD NITRO', giftcard: 'GIFT CARD',
  gamepass: 'XBOX GAME PASS', spotify: 'SPOTIFY', mystery: 'MYSTERY BOX',
};

/** XML-escape. Product names come from the database and contain & and ' freely. */
export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/**
 * The headline number, pulled from the product name.
 *
 * "1,050 FC Points" -> "1,050"; "Netflix Gift Card €25" -> "€25";
 * "Xbox Game Pass Ultimate — 3 Months" -> "3 MONTHS". Returns null when the
 * name carries no quantity, and the layout then gives the whole stage to the
 * mark instead of printing a number nobody asked for.
 *
 * Three gaps found by running this against all 72 real product names and
 * looking at the tiles it produced:
 *
 *   "Discord Nitro — 1 Year"        -> null. Only Month and Maand were matched,
 *                                     so the shop's €84.99 product shipped a
 *                                     tile with no number on it at all.
 *   "1,000 VP — Valorant"           -> no unit. Four Valorant tiles printed a
 *                                     bare number while every neighbour named
 *                                     what it was selling.
 *   "Whale Shark Card — GTA"        -> null, three times. The three GTA tiles
 *                                     were visually identical in a grid, and a
 *                                     shopper could not tell a €12.99 card from
 *                                     a €54.99 one.
 *
 * The GTA amounts are not invented for this: the shop's own description field
 * already says "$3,500,000 in-game cash for GTA Online". So the fallback reads
 * the description, and only for an in-game $ amount — never €, which would put
 * a price on a tile.
 */
export function headline(name, description) {
  const s = String(name || '');
  const money = s.match(/€\s?(\d+(?:[.,]\d{1,2})?)/);
  if (money) return { big: `€${money[1]}`, small: null };
  const years = s.match(/(\d+)\s*(Year|Jaar)/i);
  if (years) return { big: years[1], small: years[1] === '1' ? 'YEAR' : 'YEARS' };
  const months = s.match(/(\d+)\s*(Month|Maand)/i);
  if (months) return { big: months[1], small: months[1] === '1' ? 'MONTH' : 'MONTHS' };
  const num = s.match(/\b(\d{1,3}(?:[.,]\d{3})+|\d{2,6})\b/);
  if (num) {
    const n = Number(num[1].replace(/[.,]/g, ''));
    const unit = /robux/i.test(s) ? 'ROBUX'
      : /v-?bucks/i.test(s) ? 'V-BUCKS'
        : /\bVP\b/.test(s) ? 'VP'
          : /gems?/i.test(s) ? 'GEMS'
            : /coins?/i.test(s) ? 'COINS'
              : /diamonds?/i.test(s) ? 'DIAMONDS'
                : /points?/i.test(s) ? 'POINTS' : null;
    return { big: n.toLocaleString('en-US'), small: unit };
  }
  /* Last resort: an in-game currency amount the owner already wrote down. Kept
     to $ on purpose — a € in a description is a price, and a price does not
     belong on the artwork. */
  const inGame = String(description || '').match(/\$\s?(\d{1,3}(?:[.,]\d{3})+)/);
  if (inGame) {
    const n = Number(inGame[1].replace(/[.,]/g, ''));
    return { big: `$${n.toLocaleString('en-US')}`, small: 'IN-GAME CASH' };
  }
  return null;
}

/** Fit a string into a box by dropping the size, never by clipping the words. */
export const fitSize = (text, maxChars, base, min) =>
  Math.max(min, Math.round(base * Math.min(1, maxChars / Math.max(1, String(text).length))));
