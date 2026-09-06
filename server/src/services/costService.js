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
import { get } from '../db/index.js';

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
 * Cost in cents for a product id, supplier mapping first.
 *
 * Returns null when there is none — never 0. A missing cost and a free product
 * are different answers, and returning 0 for the first is how "revenue minus
 * nothing" ends up on a screen labelled profit.
 */
export async function costCentsFor(productId) {
  if (!productId) return null;
  const mapped = await get(
    `SELECT sp.cost FROM supplier_products sp
       JOIN suppliers s ON s.id = sp.supplier_id
      WHERE sp.product_id = @p AND sp.cost IS NOT NULL AND s.status = 'active'
      ORDER BY sp.priority ASC, sp.last_synced_at DESC NULLS LAST LIMIT 1`, { p: productId })
    .catch(() => null);
  if (mapped?.cost != null && Number.isFinite(Number(mapped.cost))) return Math.round(Number(mapped.cost));

  const row = await get('SELECT metadata FROM products WHERE id = @p', { p: productId }).catch(() => null);
  try { return costCentsFromMetadata(JSON.parse(row?.metadata || '{}')); } catch { return null; }
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
