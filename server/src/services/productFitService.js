/**
 * Making a product look like it belongs in this shop: the right picture, and
 * the right shelf.
 *
 * ── THE PROBLEM THIS SOLVES ───────────────────────────────────────────────
 * Every product the shop ships was drawn by hand, by a script, from its SKU:
 * APEX-1000 gets /products/art/apex-1000.svg. Nothing does that for a product
 * that arrives later. Discovery creates one with `category: mp.game` and no
 * image at all, so a candidate the owner approves lands on the shelf as a raw
 * game slug with a blank tile — and the storefront falls back to a category
 * icon that, for a game the shop has never sold, does not exist either.
 *
 * ── WHY A NEAR MISS IS WORSE THAN NOTHING ─────────────────────────────────
 * The tempting shortcut is to match on the game and take whatever art exists:
 * an 11,500 Apex Coins product would get apex-1000.svg. The artwork PRINTS its
 * amount, so the card would read "1,000" beside a price for 11,500 — the shop
 * advertising one thing and charging for another. That exact mismatch has been
 * caught here before (€10 artwork beside a €11.99 price), so matching requires
 * the denomination in the filename to equal the product's. Where it cannot, a
 * tile is drawn that states the product's OWN amount.
 *
 * ── AND WHY THE DRAWN TILE CARRIES NO BRAND MARK ──────────────────────────
 * The Roblox hexagon and the PlayStation logo are other companies' trademarks.
 * The shipped art composites the official file from the repo; it never asks a
 * model to draw one. A tile generated at runtime has no access to those files
 * on a serverless filesystem, so it uses the shop's own design language and the
 * product's real words instead of an approximation of somebody's logo.
 *
 * ── THE CATEGORY COMES FROM THE SHOP'S OWN CATALOGUE ──────────────────────
 * Not from a hand-written map that would rot. Every live product is put through
 * the same title parser the market uses, which yields game → category pairs the
 * shop itself already believes ("roblox" lives under "robux"). A game nobody
 * sells is reported as a NEW category rather than silently invented, because
 * adding a shelf is a decision and a raw slug on the storefront is a bug.
 */
import { all } from '../db/index.js';
import { SHIPPED_ART } from '../../../src/lib/shippedArt.js';
import { parseTitle } from './market/normalize.js';
import { BRAND, accentFor, esc, fitSize } from '../../../scripts/art/design.mjs';

/** The card's media box is 7:6; art authored at that ratio fills it exactly. */
export const ART_W = 700;
export const ART_H = 600;

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* Shipped art, indexed by its own slug. The -hover and -banner boards are the
   same artwork in other states and are never a product's main image. */
const ART_INDEX = (() => {
  const map = new Map();
  for (const path of SHIPPED_ART) {
    const m = /^\/products\/art\/([a-z0-9-]+)\.svg$/.exec(path);
    if (!m) continue;
    const name = m[1];
    if (name.endsWith('-hover') || name.endsWith('-banner')) continue;
    map.set(name, path);
  }
  return map;
})();

/** Brand icons, for products that are a thing rather than an amount. */
const ICON_INDEX = (() => {
  const map = new Map();
  for (const path of SHIPPED_ART) {
    const m = /^\/products\/icons\/([a-z0-9-]+)\.(svg|webp|png)$/.exec(path);
    if (m) map.set(m[1], path);
  }
  return map;
})();

/**
 * The number an art file is about, or null.
 *
 * `apex-11500` → 11500, `gamepass-3m` → null (a duration, not a denomination),
 * `amazon-25` → 25. Only a trailing plain integer counts: guessing at anything
 * else is how "3m" becomes "3" and a three-month pass is sold as three of
 * something.
 */
export function artDenomination(name) {
  const m = /-(\d+)$/.exec(String(name || ''));
  return m ? Number(m[1]) : null;
}

/**
 * Which picture belongs to this product.
 *
 * Returns `{ image, source, reason }`, or `{ image: null }` when nothing in the
 * repo fits — the caller then draws one. `source` is the evidence: an owner
 * looking at a tile they did not choose should be able to find out why it is
 * there.
 */
export function matchArt(product) {
  const parsed = parseTitle(product.name || '', {});
  const denom = product.denomination ?? parsed.denomination ?? null;

  /* 1. The SKU, which is how every shipped board is named. An exact filename
        match is the shop's own art for this exact product. */
  const bySku = ART_INDEX.get(slug(product.sku));
  if (bySku) return { image: bySku, source: 'sku', reason: `art named for ${product.sku}` };

  /* 2. Category (or game) plus the amount. The convention is <shelf>-<amount>,
        and the amount has to be the product's own. */
  const shelves = [product.category, parsed.game, parsed.denomUnit].filter(Boolean).map(slug);
  if (denom != null) {
    for (const shelf of shelves) {
      const hit = ART_INDEX.get(`${shelf}-${denom}`);
      if (hit) return { image: hit, source: 'denomination', reason: `${shelf} art for ${denom}` };
    }
  }

  /* 3. A brand icon, but ONLY for a product that is not an amount. A pass, a
        subscription or a service is a thing; "11,500 Apex Coins" is a number,
        and a bare logo under it tells a buyer nothing about what they get. */
  if (denom == null) {
    for (const shelf of shelves) {
      const icon = ICON_INDEX.get(shelf);
      if (icon) return { image: icon, source: 'icon', reason: `brand icon for ${shelf}` };
    }
  }

  /* Deliberately no fallback to "some art from the same game". The boards print
     their amount, so the near miss would put 1,000 on an 11,500 product. */
  return {
    image: null,
    source: null,
    reason: denom == null
      ? 'no art or icon is named for this product'
      : `no art carries ${denom}, and art for another amount prints the wrong number`,
  };
}

/**
 * The unit, read off the product's own title.
 *
 * The parser knows "robux" and "v-bucks" but returns nothing for "Gold",
 * "Crystals" or "Coins", and the shipped boards print a unit under the number —
 * "1,000 / ROBUX". Without one the tile repeated the whole product name, which
 * the card already prints directly underneath it.
 *
 * So it takes the last real word of the title. Not a guess about what the
 * product is: literally a word the owner wrote. Region and platform tags are
 * skipped, because "(EU)" under a number reads as a unit and is not one.
 */
const NOT_A_UNIT = new Set([
  'eu', 'us', 'uk', 'global', 'row', 'na', 'pc', 'xbox', 'playstation', 'ps4', 'ps5',
  'nintendo', 'switch', 'mobile', 'android', 'ios', 'key', 'code', 'card', 'edition',
]);
export function unitFrom(name) {
  const words = String(name || '')
    .replace(/[()[\]{}]/g, ' ')
    .split(/[\s—–-]+/)
    .map((w) => w.replace(/[^a-zA-Z]/g, ''))
    .filter((w) => w.length >= 3 && !NOT_A_UNIT.has(w.toLowerCase()));
  return words.length ? words[words.length - 1] : '';
}

/**
 * Draw a tile for a product the repo has no art for.
 *
 * Authored at exactly 700x600 so it fills the card the way every shipped board
 * does, in the shop's own colours, carrying the product's real name and — when
 * it has one — its real amount. Nothing here is invented: every string on the
 * tile comes off the product row.
 */
export function renderTile(product) {
  const parsed = parseTitle(product.name || '', {});
  const denom = product.denomination ?? parsed.denomination ?? null;
  const unit = String(product.denomUnit || parsed.denomUnit || '').trim();
  const accent = accentFor(slug(product.category));
  const name = String(product.name || '').trim();

  /* The amount is the headline when there is one, because that is what a buyer
     scans for in a grid. Otherwise the name carries the tile. */
  const big = denom == null ? name : denom.toLocaleString('en-US');
  /* A unit under the number, the way every shipped board does it — never the
     whole product name, which the card prints again immediately below. */
  const small = (denom == null
    ? (product.category || '')
    : (unit || unitFrom(name) || product.category || '')).toUpperCase();

  const bigSize = fitSize(big, 12, 128, 52);
  const smallSize = fitSize(small, 14, 34, 20);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ART_W} ${ART_H}" width="${ART_W}" height="${ART_H}" role="img" aria-label="${esc(name)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BRAND.ink1}"/>
      <stop offset="1" stop-color="${BRAND.ink0}"/>
    </linearGradient>
    <radialGradient id="bloom" cx="0.78" cy="0.18" r="0.72">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.38"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${ART_W}" height="${ART_H}" fill="url(#bg)"/>
  <rect width="${ART_W}" height="${ART_H}" fill="url(#bloom)"/>
  <rect x="0" y="${ART_H - 4}" width="${ART_W}" height="4" fill="${accent}" opacity="0.85"/>
  <text x="${ART_W / 2}" y="${ART_H / 2 - 6}" text-anchor="middle" fill="${BRAND.text}"
        font-family="Inter, Segoe UI, system-ui, sans-serif" font-weight="800"
        font-size="${bigSize}">${esc(big)}</text>
  <text x="${ART_W / 2}" y="${ART_H / 2 + 58}" text-anchor="middle" fill="${BRAND.muted}"
        font-family="Inter, Segoe UI, system-ui, sans-serif" font-weight="600"
        font-size="${smallSize}" letter-spacing="${Math.round(smallSize * 0.22)}">${esc(small)}</text>
</svg>`;
}

/**
 * Where a drawn tile is served from.
 *
 * NOT a data: URI in the product row, which is what this did first and what
 * looking at the stored row caught. Two things are wrong with that. The image
 * store refuses SVG on purpose — an SVG can carry script, and serving an
 * uploaded one from your own origin is an XSS hole — so `isSafeImageValue`
 * rejects it and the value should never have been written. And an inline
 * base64 picture rides along in every catalogue response, uncacheable per
 * image: exactly the mistake that made /api/config 1.3 MB of category logos.
 *
 * A path is cheap, cacheable, and re-rendered from the live row — so a product
 * that gets renamed gets a corrected tile instead of keeping a frozen picture
 * of its old name.
 */
/**
 * The tile a product gets when nobody has a picture of it — drawn by the SAME
 * renderer as the shop's shipped artwork.
 *
 * renderTile() above draws a number on a gradient, because at runtime it could
 * not reach the mark files the build composites. scripts/gen-art-assets.mjs
 * now bundles those files into the server, so a product added next month gets
 * the same stage every shipped board has: its category's mark in the ring,
 * the amount, the unit. The mark is the repo's own file, inlined byte for byte
 * — nothing is redrawn or approximated, which is the rule renderTile kept by
 * drawing none at all.
 *
 * Loaded on first use rather than at import: the bundled marks are a few
 * hundred KB, and the storefront's other routes should not pay for them on a
 * cold start. Any failure falls back to renderTile, so a tile is never a 500.
 */
export async function renderTileArt(product) {
  try {
    const { mainSvg } = await import('../../../scripts/art/render.mjs');
    /* Without its image. A product that gets this tile HAS the tile as its
       image, and markFor() takes a product's own picture as the mark first —
       so the tile would try to draw itself inside its own ring, find nothing,
       and leave the ring empty. */
    return mainSvg({ ...product, image: null, imageLegacy: null },
      { unit: unitFrom(product?.name) });
  } catch (e) {
    console.error('[tile] art renderer failed, drawing the plain tile:', e.message);
    return renderTile(product);
  }
}

export const tilePath = (productId) => `/api/products/${productId}/tile.svg`;

/** The tile as a data URI — for previewing one, never for storing one. */
export const tileDataUri = (product) =>
  `data:image/svg+xml;base64,${Buffer.from(renderTile(product), 'utf8').toString('base64')}`;

/**
 * A picture for this product, whatever it takes.
 *
 * `drawn` says which of the two happened, because they mean different things to
 * an owner: matched art is the shop's own artwork for that exact product, and a
 * drawn tile is a placeholder that is honest rather than pretty.
 */
export function artFor(product) {
  const matched = matchArt(product);
  if (matched.image) return { ...matched, drawn: false };
  return {
    /* The tile is served from the product's own path. `null` when there is no
       id yet, so a caller that has not saved the product cannot store a URL
       that resolves to nothing. */
    image: product.id ? tilePath(product.id) : null,
    source: 'generated',
    reason: `${matched.reason} — drew a tile carrying the product's own name and amount`,
    drawn: true,
  };
}

/* ── Shelves ─────────────────────────────────────────────────────────────── */

/**
 * game → category, learned from what the shop already sells.
 *
 * A hand-written map would be wrong the first time a category is renamed. This
 * reads the live catalogue and puts every product's NAME through the same
 * parser the market uses, so the pairs are the shop's own: "roblox" resolves to
 * whatever shelf the Robux products are actually on.
 */
export async function shelvesFromCatalogue() {
  const rows = await all(
    `SELECT name, category FROM products WHERE active = 1 AND category IS NOT NULL`).catch(() => []);
  const counts = new Map();
  for (const r of rows) {
    const game = parseTitle(r.name || '', {}).game;
    if (!game || game === 'unknown' || !r.category) continue;
    const key = `${game}\u0000${r.category}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  /* Most-used wins: one mis-shelved product must not redirect a whole game. */
  const best = new Map();
  for (const [key, n] of counts) {
    const [game, category] = key.split('\u0000');
    const prev = best.get(game);
    if (!prev || n > prev.n) best.set(game, { category, n });
  }
  return new Map([...best].map(([game, v]) => [game, v.category]));
}

/**
 * Where a discovered product belongs.
 *
 * `status` is the point: `existing` is a shelf the shop already has, `new` is a
 * proposal. Creating a shelf silently is how a storefront ends up with a
 * category called "counter-strike-2" next to one called "CS2".
 */
export async function categoryFor({ name = '', game = '', category = '' } = {}) {
  const shelves = await shelvesFromCatalogue();
  const known = new Set((await all(
    `SELECT DISTINCT category FROM products WHERE active = 1 AND category IS NOT NULL`)
    .catch(() => [])).map((r) => r.category));

  const parsedGame = game || parseTitle(name, {}).game;

  /* An explicit category that the shop already has is the owner's decision. */
  if (category && known.has(category)) {
    return { category, status: 'existing', reason: 'the category given already exists' };
  }
  const learned = shelves.get(parsedGame);
  if (learned) {
    return { category: learned, status: 'existing',
      reason: `${parsedGame} products are already shelved under "${learned}"` };
  }
  if (parsedGame && known.has(parsedGame)) {
    return { category: parsedGame, status: 'existing', reason: 'a shelf of that name exists' };
  }

  const proposed = slug(category || parsedGame);
  return {
    category: proposed || null,
    status: proposed ? 'new' : 'unknown',
    reason: proposed
      ? `nothing on the shelves parses as "${parsedGame || category}" — this would be a new category`
      : 'the title could not be read well enough to place it',
  };
}

/* ── Catching up with what is already on the shelves ─────────────────────── */

/**
 * Give every product that has no picture one.
 *
 * Dry by default, because repointing live products is a decision and generating
 * a report is not. A product that already carries an image is never touched:
 * an owner's own photograph of the thing being sold outranks anything this can
 * draw or match, and that rule is older than this file.
 *
 * A drawn tile goes through the image store, which is addressed by content —
 * so running this twice produces the same URL rather than a second copy, and
 * the tile is cached immutably at the edge instead of re-sent as base64 in
 * every catalogue response.
 */
export async function backfillArt({ apply = false, actor = null } = {}) {
  const { listProducts, updateProduct } = await import('./productService.js');
  const { normalizeImageValue } = await import('./imageStoreService.js');
  const products = await listProducts({ activeOnly: true });
  const rows = [];

  for (const p of products) {
    if (p.image) continue;
    const art = artFor(p);
    let value = art.image;
    /* A matched board is a file in the repo; a drawn tile is a path this shop
       renders. Neither goes through the image store: that store is for uploads,
       it refuses SVG for a good reason, and a picture in a product row would be
       sent inline with every catalogue response. */
    if (!art.drawn) {
      const stored = await normalizeImageValue(value, { productId: p.id, source: 'matched-art' })
        .catch(() => null);
      if (stored?.stored && stored.value) value = stored.value;
    }
    if (apply) {
      await updateProduct(p.id, {
        metadata: { ...p.metadata, image: value, imageSource: art.source, imageReason: art.reason },
      });
    }
    rows.push({ id: p.id, sku: p.sku, name: p.name, category: p.category,
      source: art.source, drawn: art.drawn, reason: art.reason,
      image: art.drawn ? '(drawn tile)' : value });
  }

  if (apply && rows.length) {
    const { audit } = await import('./auditService.js');
    await audit({ actor, action: 'catalog.art_backfilled', targetType: 'products',
      targetId: String(rows.length),
      metadata: { matched: rows.filter((r) => !r.drawn).length,
        drawn: rows.filter((r) => r.drawn).length } });
  }

  return {
    applied: apply,
    considered: products.length,
    missing: rows.length,
    matched: rows.filter((r) => !r.drawn).length,
    drawn: rows.filter((r) => r.drawn).length,
    rows,
  };
}

/**
 * Shelves a discovered candidate would need that the shop does not have.
 *
 * The answer to "search for categories too": not an invented taxonomy, but the
 * gap between what the market has proposed and what the storefront can already
 * display. Each row says how many candidates are waiting on it, because one
 * stray title is not a reason to add a shelf and eleven is.
 */
export async function proposedCategories({ limit = 25 } = {}) {
  const rows = await all(
    `SELECT mp.title, mp.game, COUNT(*) AS n
       FROM market_candidates c JOIN market_products mp ON mp.id = c.market_product_id
      WHERE c.status IN ('normalized', 'approved', 'discovered')
      GROUP BY mp.title, mp.game`).catch(() => []);
  const shelves = await shelvesFromCatalogue();
  const known = new Set((await all(
    `SELECT DISTINCT category FROM products WHERE active = 1 AND category IS NOT NULL`)
    .catch(() => [])).map((r) => r.category));

  const gaps = new Map();
  for (const r of rows) {
    const game = r.game && r.game !== 'unknown' ? r.game : parseTitle(r.title || '', {}).game;
    if (!game || game === 'unknown') continue;
    if (shelves.has(game) || known.has(game)) continue;
    const prev = gaps.get(game) || { category: slug(game), game, candidates: 0, examples: [] };
    prev.candidates += Number(r.n || 1);
    if (prev.examples.length < 3) prev.examples.push(r.title);
    gaps.set(game, prev);
  }
  return [...gaps.values()]
    .sort((a, b) => b.candidates - a.candidates)
    .slice(0, limit);
}
