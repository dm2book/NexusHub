/** Product catalog CRUD. Catalog is managed by staff / supplier sync. */
import { run, get, all, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { notFound, badRequest } from '../utils/errors.js';

const parse = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
const hydrate = (r) => (r ? { ...r, metadata: parse(r.metadata), active: !!r.active } : r);

export async function listProducts({ activeOnly = false } = {}) {
  const clause = activeOnly ? 'WHERE active = 1' : '';
  const rows = await all(`SELECT * FROM products ${clause} ORDER BY created_at DESC`);
  return rows.map(hydrate);
}

export async function getProduct(id) {
  return hydrate(await get('SELECT * FROM products WHERE id = @id', { id }));
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
  return getProduct(id);
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
  return getProduct(id);
}
