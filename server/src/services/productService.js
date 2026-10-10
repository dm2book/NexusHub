/** Product catalog CRUD. Catalog is managed by staff / supplier sync. */
import { run, get, all, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { notFound, badRequest } from '../utils/errors.js';
import { postDropEvent } from './discordService.js';

const parse = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
const hydrate = (r) => {
  if (!r) return r;
  const metadata = parse(r.metadata);
  // A sale "was" price (in cents) lives in metadata.compareAt. Only surface it
  // when it is genuinely higher than the current price, so a stale/invalid value
  // can never render a fake discount.
  const compareAt = Number(metadata.compareAt) || 0;
  return {
    ...r, metadata, active: !!r.active,
    featured: !!metadata.featured,
    image: metadata.image || null,
    /* How this product's artwork should be framed in a tile.
       A composition belongs to the picture, not to the brand — so this is a
       product field the owner can set, not a rule in CSS that says "Robux is
       different". Absent means the default (whole picture, centred), which is
       right for almost everything; a banner that should fill the tile sets
       imageFit:'cover' and, if its subject is off-centre, a focal point. */
    imagePosition: (() => {
      const p = metadata.imagePosition;
      if (!p || typeof p !== 'object') return null;
      const num = (v) => (Number.isFinite(Number(v)) ? Math.min(100, Math.max(0, Number(v))) : null);
      const x = num(p.x), y = num(p.y);
      return x === null && y === null ? null : { x: x ?? 50, y: y ?? 50 };
    })(),
    imageFit: ['cover', 'contain'].includes(metadata.imageFit) ? metadata.imageFit : null,
    /* Whether this photo has already been placed on the 7:6 artboard. The admin
       needs it to know what is left to do, and to stop offering an action that
       has nothing to act on. */
    imageNormalized: metadata.imageNormalized === true,
    /* The grouped form, for owners who would rather write one object than three
       fields. Validated to the same values — an unknown fit or a position that
       is neither a CSS keyword nor a pair of numbers is dropped rather than
       handed to the browser to interpret. */
    imageDisplay: (() => {
      const d = metadata.imageDisplay;
      if (!d || typeof d !== 'object') return null;
      const out = {};
      if (['cover', 'contain'].includes(d.fit)) out.fit = d.fit;
      const WORDS = ['center', 'top', 'bottom', 'left', 'right',
        'top left', 'top right', 'bottom left', 'bottom right'];
      if (typeof d.position === 'string' && WORDS.includes(d.position.trim().toLowerCase())) {
        out.position = d.position.trim().toLowerCase();
      } else if (d.position && typeof d.position === 'object') {
        const num = (v) => (Number.isFinite(Number(v)) ? Math.min(100, Math.max(0, Number(v))) : null);
        const x = num(d.position.x), y = num(d.position.y);
        if (x !== null || y !== null) out.position = { x: x ?? 50, y: y ?? 50 };
      }
      return Object.keys(out).length ? out : null;
    })(),
    imageScale: Number.isFinite(Number(metadata.imageScale))
      ? Math.min(2, Math.max(0.5, Number(metadata.imageScale))) : null,
    compareAtPrice: compareAt > r.price ? compareAt : null,
    // How paid orders for this product are delivered: 'auto' pulls a code from
    // stock instantly; 'manual' always waits for staff to deliver by hand.
    deliveryMode: metadata.deliveryMode === 'manual' ? 'manual' : 'auto',
    // Optional label for a delivery target the buyer must supply at checkout
    // (e.g. "Roblox username" for a Robux top-up). Empty = nothing extra asked.
    deliveryField: typeof metadata.deliveryField === 'string' && metadata.deliveryField.trim()
      ? metadata.deliveryField.trim().slice(0, 60) : null,
    // When true, the buyer CHOOSES at checkout between a gift code (emailed) and
    // a direct top-up to their account (they supply deliveryField). Requires a
    // deliveryField label. When false but deliveryField is set, the account
    // target is always required (pure top-up product, no choice).
    deliveryChoice: metadata.deliveryChoice === true
      && typeof metadata.deliveryField === 'string' && !!metadata.deliveryField.trim(),
  };
};

/**
 * Kinds of product the shop no longer sells, whatever a row's `active` says.
 *
 * Mystery boxes are retired. A paid box that pays out prizes of different
 * value by chance is very likely a game of chance under the Dutch Wet op de
 * kansspelen, which needs a licence this shop does not have. Migration 065
 * switched every box off and the admin refuses to switch one back on; this is
 * the lock behind both, for a row written straight into the database.
 */
export const RETIRED_KINDS = Object.freeze(['mystery']);
export const MYSTERY_RETIRED = 'Mystery boxes are switched off: paid random prizes are a game of chance '
  + 'under the Dutch Wet op de kansspelen';

/** May a customer see and buy this product? Active, and not a retired kind. */
export function isSellable(p) {
  return !!p && !!p.active && !RETIRED_KINDS.includes(p.kind);
}

/**
 * Would this write put a retired kind back on sale? Creating one (no
 * `current`), turning another product into one, or switching one on. A box
 * that stays off may still be edited — renamed, given another picture — so the
 * owner can tidy the old row; the admin form sends its kind on every save,
 * which is why an unchanged kind on its own is not refused.
 */
export function revivesRetired(current, patch = {}) {
  const kind = patch.kind ?? current?.kind;
  if (!RETIRED_KINDS.includes(kind)) return false;
  return !current || kind !== current.kind || (patch.active != null && !!patch.active);
}

/**
 * `activeOnly` is the shop's shelf: what a customer may see and buy. A retired
 * kind stays off it even when its row says active — so the storefront, the
 * sitemap, recommendations, the SEO pages and the assistant never show a
 * mystery box, without each of them having to remember to ask.
 */
export async function listProducts({ activeOnly = false } = {}) {
  const clause = activeOnly ? 'WHERE active = 1 AND kind <> ALL(@retired)' : '';
  const rows = await all(`SELECT * FROM products ${clause} ORDER BY created_at DESC`,
    { retired: [...RETIRED_KINDS] });
  return rows.map(hydrate);
}

export async function getProduct(id) {
  return hydrate(await get('SELECT * FROM products WHERE id = @id', { id }));
}

export async function createProduct(p = {}) {
  if (!p.name) throw badRequest('Product name is required');
  // No new boxes, not even switched off — see RETIRED_KINDS.
  if (revivesRetired(null, p)) throw badRequest(MYSTERY_RETIRED);
  const id = newId('prd');
  const at = nowIso();
  await run(`INSERT INTO products (id, sku, name, category, description, price, currency, kind, stock, active, metadata, created_at, updated_at)
       VALUES (@id, @sku, @name, @cat, @desc, @price, @cur, @kind, @stock, @active, @meta, @at, @at)`, {
    id, sku: p.sku || null, name: p.name, cat: p.category || null, desc: p.description || null,
    price: Math.round(p.price || 0), cur: p.currency || 'EUR', kind: p.kind || 'digital',
    stock: p.stock ?? null, active: p.active === false ? 0 : 1,
    meta: JSON.stringify(p.metadata || {}), at,
  });
  await recordPricePoint(id, Math.round(p.price || 0), p.currency || 'EUR', at);
  const created = await getProduct(id);
  // Announce active new products in the community #drops-and-deals channel.
  // Skipped during bulk seeding (announce=false) to avoid flooding the channel.
  if (created?.active && p.announce !== false) {
    postDropEvent('product', created).catch(() => {});
  }
  return created;
}

export async function updateProduct(id, patch = {}) {
  const cur = await getProduct(id);
  if (!cur) throw notFound('Product not found');
  // A product does not become a box, and a box is not switched back on.
  if (revivesRetired(cur, patch)) throw badRequest(MYSTERY_RETIRED);
  await run(`UPDATE products SET name=@name, sku=@sku, category=@cat, description=@desc,
        price=@price, currency=@currency, kind=@kind, stock=@stock, active=@active,
        metadata=@meta, updated_at=@at WHERE id=@id`, {
    name: patch.name ?? cur.name, sku: patch.sku ?? cur.sku,
    cat: patch.category ?? cur.category, desc: patch.description ?? cur.description,
    price: patch.price != null ? Math.round(patch.price) : cur.price,
    currency: patch.currency ?? cur.currency, kind: patch.kind ?? cur.kind,
    stock: patch.stock !== undefined ? patch.stock : cur.stock,
    active: patch.active != null ? (patch.active ? 1 : 0) : (cur.active ? 1 : 0),
    meta: JSON.stringify(patch.metadata ?? cur.metadata), at: nowIso(), id,
  });
  // Snapshot the new price whenever it actually changed.
  const newPrice = patch.price != null ? Math.round(patch.price) : cur.price;
  if (newPrice !== cur.price) await priceChanged(id, cur.price, newPrice, patch.currency ?? cur.currency);
  return getProduct(id);
}

/**
 * Everything that follows from a product's price changing, in one place.
 *
 * Two code paths write products.price — this file and the pricing engine's
 * publish — and the engine's never recorded a price point, so the chart on
 * the product page silently missed every price it set. Both now come through
 * here: the history row, and the price alerts of everybody who saved it.
 */
export async function priceChanged(productId, oldPrice, newPrice, currency = 'EUR') {
  /* The price it had until now, first, when the history does not already end
     on it. The seeded catalogue was created without a history row, so its
     first change recorded only the NEW price — and "what did it cost
     before" had no answer: the wishlist's previous price was blank and the
     chart started at the change. Stamped a millisecond before the new one. */
  const last = await get(
    `SELECT price FROM price_history WHERE product_id = @p ORDER BY created_at DESC LIMIT 1`,
    { p: productId }).catch(() => null);
  const now = Date.now();
  if (!last || Number(last.price) !== Number(oldPrice)) {
    await recordPricePoint(productId, Number(oldPrice), currency, new Date(now - 1).toISOString());
  }
  await recordPricePoint(productId, newPrice, currency, new Date(now).toISOString());
  const { onPriceChanged } = await import('./wishlistService.js');
  await onPriceChanged(productId, oldPrice, newPrice);
}

/** Append a price snapshot (best-effort; never blocks a product write). */
async function recordPricePoint(productId, price, currency = 'EUR', at = nowIso()) {
  try {
    await run(`INSERT INTO price_history (id, product_id, price, currency, created_at)
               VALUES (@id, @p, @price, @cur, @at)`,
      { id: newId('ph'), p: productId, price, cur: currency, at });
  } catch { /* history is non-critical */ }
}

/** Price history for a product (oldest → newest), for the product-page chart. */
export function priceHistory(productId, limit = 60) {
  /* The LATEST `limit` points, oldest first. ORDER BY ASC LIMIT took the
     oldest ones, so after 60 changes the chart stopped at an old price and
     "Now" on the product page was not the price on the button. */
  return all(
    `SELECT price, currency, at FROM (
       SELECT price, currency, created_at AS at FROM price_history
        WHERE product_id=@p ORDER BY created_at DESC LIMIT @l) h
      ORDER BY at ASC`, { p: productId, l: limit });
}
