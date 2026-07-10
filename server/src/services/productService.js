/** Product catalog CRUD. Catalog is managed by staff / supplier sync. */
import { run, get, all, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { notFound, badRequest } from '../utils/errors.js';
import { postDropEvent } from './discordService.js';

const parse = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
const hydrate = (r) => {
  if (!r) return r;
  const metadata = parse(r.metadata);
  return {
    ...r, metadata, active: !!r.active,
    featured: !!metadata.featured,
    image: metadata.image || null,
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
