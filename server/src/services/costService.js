/**
 * What a product costs this shop, in one place.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * The same number had three names and one of them pointed at a column that
 * does not exist. Nothing failed loudly; the parts simply disagreed:
 *
 *   the admin form WRITES        metadata.cost
 *   analyticsService READS       metadata.cost          ✓ agrees
 *   market/engine costFor READS  metadata.costCents     ✗ never set by the form
 *   audit-commercial READS       metadata.costCents     ✗ same
 *   costFor's supplier lookup    supplier_products.cost_cents
 *                                — that column is called `cost`, and the query
 *                                  sat inside .catch(() => null), so a supplier
 *                                  mapping reached nobody and said nothing.
 *
 * The consequence is the expensive kind. An owner who spends a month entering
 * the purchase price of every product through the admin gets a working gross
 * margin on the analytics page and `NO_COST` on all seventy-two from the
 * pricing engine — the engine that exists to use it. Nothing errors. The form
 * saves, the number renders, and only the part that matters disagrees.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 * One reader, and it accepts every name the codebase has ever used, so nothing
 * already typed in is lost. Priority is deliberate: a supplier mapping is what
 * the shop is CURRENTLY paying, a hand-entered figure is what it paid when
 * somebody last looked.
 *
 *   1. supplier_products.cost   the live cost of the mapping we would buy from
 *   2. metadata.costCents       cents, the name the engine and the audits use
 *   3. metadata.cost            cents, the name the admin form writes
 *   4. metadata.buyPrice        EUROS, the oldest name — converted here
 *
 * Everything returns CENTS. `buyPrice` is the one historical value in euros and
 * it is multiplied here rather than in four call sites.
 */
import { all } from '../db/index.js';

/** Cost in cents from an already-parsed metadata object, or null. */
export function costCentsFromMetadata(meta = {}) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const cents = n(meta?.costCents) ?? n(meta?.cost);
  if (cents !== null && cents >= 0) return Math.round(cents);
  const euros = n(meta?.buyPrice);
  if (euros !== null && euros >= 0) return Math.round(euros * 100);
  return null;
}

/**
 * Which of a product's supplier mappings supplies its cost — the rule itself,
 * as a pure function over already-fetched rows.
 *
 * It lived only inside one query's ORDER BY, which meant any second reader of
 * the same question (the supplier dashboard needs it for all 72 products at
 * once, not one at a time) had to restate it — and a restated rule is a rule
 * that drifts. This file exists because that already happened to the COLUMN
 * NAME four times over. Stating the ordering once, here, is the cheap version
 * of that lesson.
 *
 * Rows are `supplier_products` joined to their supplier, needing only
 * `cost`, `priority`, `last_synced_at` and the supplier's `status`.
 */
export function pickCostMapping(mappings = []) {
  const usable = mappings.filter(
    (m) => m && m.supplier_status === 'active'
      && m.cost != null && Number.isFinite(Number(m.cost)));
  if (!usable.length) return null;
  const at = (m) => (m.last_synced_at ? Date.parse(m.last_synced_at) || 0 : -Infinity);
  return [...usable].sort((a, b) =>
    (Number(a.priority ?? 100) - Number(b.priority ?? 100))   // lower priority number wins
    || (at(b) - at(a)))[0];                                   // then the most recently synced
}

/** Every product's active cost mappings, keyed by product id. */
export async function costMappingsByProduct(productIds = []) {
  const out = {};
  if (!productIds.length) return out;
  const rows = await all(
    `SELECT sp.product_id, sp.cost, sp.priority, sp.last_synced_at,
            sp.available_stock, sp.supplier_status AS sku_status,
            s.id AS supplier_id, s.name AS supplier_name,
            s.connector_kind, s.status AS supplier_status
       FROM supplier_products sp
       JOIN suppliers s ON s.id = sp.supplier_id
      WHERE sp.product_id = ANY(@ids)`, { ids: productIds }).catch(() => []);
  for (const r of rows) (out[r.product_id] ||= []).push(r);
  return out;
}

/**
 * Cost in cents for many products at once → { productId: cents|null }.
 *
 * Two queries for the whole catalogue instead of two PER PRODUCT. `costCentsFor`
 * below is this function with one id, so there is exactly one implementation of
 * "what does this cost" rather than a fast one and a slow one that agree until
 * they do not.
 */
export async function costCentsForMany(productIds = []) {
  const ids = [...new Set(productIds.filter(Boolean))];
  const out = {};
  if (!ids.length) return out;
  for (const id of ids) out[id] = null;

  const byProduct = await costMappingsByProduct(ids);
  const needMeta = [];
  for (const id of ids) {
    const picked = pickCostMapping(byProduct[id]);
    if (picked) out[id] = Math.round(Number(picked.cost));
    else needMeta.push(id);
  }
  if (!needMeta.length) return out;

  const rows = await all('SELECT id, metadata FROM products WHERE id = ANY(@ids)',
    { ids: needMeta }).catch(() => []);
  for (const r of rows) {
    try { out[r.id] = costCentsFromMetadata(JSON.parse(r.metadata || '{}')); }
    catch { out[r.id] = null; }
  }
  return out;
}

/**
 * Cost in cents for a product id, supplier mapping first.
 *
 * Returns null when there is none — never 0. A missing cost and a free product
 * are different answers, and returning 0 for the first is how "revenue minus
 * nothing" ends up on a screen labelled profit.
 */
export async function costCentsFor(productId) {
  if (!productId) return null;
  return (await costCentsForMany([productId]))[productId] ?? null;
}

/** The same, in euros, for the pricing engine's arithmetic. */
export async function costEurFor(productId) {
  const cents = await costCentsFor(productId);
  return cents === null ? null : cents / 100;
}

/** How many of these products carry a cost — the number every audit reports. */
export function countWithCost(rows = []) {
  let n = 0;
  for (const r of rows) {
    let meta = {};
    try { meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : (r.metadata || {}); }
    catch { meta = {}; }
    if (costCentsFromMetadata(meta) !== null) n++;
  }
  return n;
}
