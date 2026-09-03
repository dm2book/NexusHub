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

export async function listProducts({ activeOnly = false } = {}) {
  const clause = activeOnly ? 'WHERE active = 1' : '';
  const rows = await all(`SELECT * FROM products ${clause} ORDER BY created_at DESC`);
  return rows.map(hydrate);
}

export async function getProduct(id) {
  return hydrate(await get('SELECT * FROM products WHERE id = @id', { id }));
}

/**
 * Trending = most-sold active products over the last `days`. Falls back to
 * featured (then newest) active products so the row is never empty.
 */
export async function trendingProducts({ days = 14, limit = 8 } = {}) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await all(
    `SELECT oi.product_id AS id, SUM(oi.quantity) AS sold
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.status IN ('payment_received','processing','awaiting_fulfillment','completed')
        AND o.created_at > @since AND oi.product_id IS NOT NULL
      GROUP BY oi.product_id ORDER BY sold DESC LIMIT @limit`, { since, limit });

  const out = [];
  for (const r of rows) {
    const p = await getProduct(r.id);
    if (p && p.active) out.push({ ...p, sold: Number(r.sold) });
  }
  if (out.length >= Math.min(4, limit)) return out;

  // Fallback: top up with featured, then newest, active products.
  const all2 = (await listProducts({ activeOnly: true }));
  const have = new Set(out.map((p) => p.id));
  const extras = all2.filter((p) => !have.has(p.id))
    .sort((a, b) => (b.featured === true) - (a.featured === true));
  return [...out, ...extras].slice(0, limit);
}

export async function createProduct(p = {}) {
  if (!p.name) throw badRequest('Product name is required');
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
  if (newPrice !== cur.price) await recordPricePoint(id, newPrice, patch.currency ?? cur.currency);
  return getProduct(id);
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
  return all(
    `SELECT price, currency, created_at AS at FROM price_history
      WHERE product_id=@p ORDER BY created_at ASC LIMIT @l`, { p: productId, l: limit });
}
