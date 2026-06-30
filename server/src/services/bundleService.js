/**
 * Bundle discounts. A bundle is a named set of products that earns a % discount
 * when all of them are in the same order. Used both to render bundle offers on
 * the storefront and to apply the discount server-side at checkout.
 */
import { run, get, all, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { getProduct } from './productService.js';
import { badRequest, notFound } from '../utils/errors.js';

const parseIds = (s) => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const shape = (r) => r && ({
  id: r.id, name: r.name, description: r.description,
  productIds: parseIds(r.product_ids), discountPercent: Number(r.discount_percent),
  active: !!r.active, createdAt: r.created_at,
});

export async function listBundles({ activeOnly = false } = {}) {
  const clause = activeOnly ? 'WHERE active = 1' : '';
  return (await all(`SELECT * FROM bundles ${clause} ORDER BY created_at DESC`)).map(shape);
}

/** Bundles with resolved products + pricing, for storefront display (active only). */
export async function pricedBundles() {
  const bundles = await listBundles({ activeOnly: true });
  const out = [];
  for (const b of bundles) {
    const products = (await Promise.all(b.productIds.map((id) => getProduct(id)))).filter((p) => p && p.active);
    if (products.length < 2 || products.length !== b.productIds.length) continue; // need the full set
    const subtotal = products.reduce((s, p) => s + p.price, 0);
    const discount = Math.round(subtotal * b.discountPercent / 100);
    out.push({
      id: b.id, name: b.name, description: b.description, discountPercent: b.discountPercent,
      products: products.map((p) => ({ id: p.id, name: p.name, category: p.category, price: p.price, image: p.image })),
      subtotal, discount, total: subtotal - discount, currency: products[0].currency || 'EUR',
    });
  }
  return out;
}

/**
 * Best bundle discount for a set of order line items.
 * `items`: [{ product_id, unit_price, quantity }]. Returns the single best-matching
 * bundle's discount (cents) so bundles never stack confusingly.
 */
export async function bestBundleDiscount(items) {
  if (!items?.length) return { discount: 0, bundle: null };
  const present = new Map();
  for (const it of items) if (it.product_id) present.set(it.product_id, (present.get(it.product_id) || 0) + it.unit_price * it.quantity);
  const bundles = await listBundles({ activeOnly: true });
  let best = { discount: 0, bundle: null };
  for (const b of bundles) {
    if (b.discountPercent <= 0 || b.productIds.length < 2) continue;
    if (!b.productIds.every((id) => present.has(id))) continue;
    const base = b.productIds.reduce((s, id) => s + (present.get(id) || 0), 0);
    const discount = Math.round(base * b.discountPercent / 100);
    if (discount > best.discount) best = { discount, bundle: { id: b.id, name: b.name, percent: b.discountPercent } };
  }
  return best;
}

// ── Admin CRUD ───────────────────────────────────────────────────────────────
export async function createBundle(input, _actorId) {
  const name = String(input.name || '').trim();
  const productIds = Array.isArray(input.productIds) ? input.productIds.slice(0, 20) : [];
  if (!name) throw badRequest('Name is required');
  if (productIds.length < 2) throw badRequest('A bundle needs at least 2 products');
  const id = newId('bnd');
  await run(
    `INSERT INTO bundles (id, name, description, product_ids, discount_percent, active, created_at)
     VALUES (@id, @name, @desc, @pids, @disc, @active, @at)`,
    { id, name, desc: input.description || null, pids: JSON.stringify(productIds),
      disc: Math.max(1, Math.min(90, Math.round(input.discountPercent || 0))), active: input.active === false ? 0 : 1, at: nowIso() });
  return getBundle(id);
}

export async function updateBundle(id, patch) {
  const b = await get('SELECT id FROM bundles WHERE id=@id', { id });
  if (!b) throw notFound('Bundle not found');
  const fields = {};
  if (patch.name != null) fields.name = String(patch.name).trim();
  if ('description' in patch) fields.description = patch.description || null;
  if (patch.productIds) fields.product_ids = JSON.stringify(patch.productIds.slice(0, 20));
  if (patch.discountPercent != null) fields.discount_percent = Math.max(1, Math.min(90, Math.round(patch.discountPercent)));
  if (patch.active != null) fields.active = patch.active ? 1 : 0;
  const keys = Object.keys(fields);
  if (keys.length) await run(`UPDATE bundles SET ${keys.map((k) => `${k}=@${k}`).join(', ')} WHERE id=@id`, { ...fields, id });
  return getBundle(id);
}

export async function deleteBundle(id) {
  const r = await run('DELETE FROM bundles WHERE id=@id', { id });
  return (r?.changes || 0) > 0;
}

export async function getBundle(id) { return shape(await get('SELECT * FROM bundles WHERE id=@id', { id })); }
