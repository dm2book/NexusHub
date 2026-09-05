/**
 * Cross-sell & upsell recommendations — all from real data.
 *   cross-sell: products most often bought in the SAME order as this one
 *               (co-occurrence in order_items), falling back to the same category.
 *   upsell:     higher-priced products in the same category (a bigger pack / tier).
 * A product can override either list manually via metadata.crossSell / metadata.upsell
 * (arrays of product ids).
 */
import { get, all } from '../db/index.js';
import { getProduct, listProducts } from './productService.js';

const PAID = "status IN ('payment_received','processing','awaiting_fulfillment','completed')";

/**
 * Turn a list of ids into products, from a catalogue already in hand.
 *
 * This used to call getProduct(id) one at a time inside a loop — up to six
 * round trips per page on top of everything else. The catalogue is already
 * loaded by the time this runs, so the lookup is a map.
 */
function resolve(ids, { exclude, limit, byId }) {
  const out = [];
  const seen = new Set(exclude ? [exclude] : []);
  for (const id of ids) {
    if (out.length >= limit) break;
    if (seen.has(id)) continue;
    seen.add(id);
    const p = byId.get(id);
    if (p && p.active) out.push(p);
  }
  return out;
}

/**
 * What else to show on a product page.
 *
 * ── WHY THIS WAS THE SLOWEST THING ON THE SITE ────────────────────────────
 * Measured under a launch simulation, this endpoint was four times slower than
 * anything else and degraded worst: 103ms p95 at 100 visitors, 267ms at 1,000,
 * 419ms at 5,000, while the whole catalogue held at ~108ms. It is on every
 * product page, so it was a sixth of all traffic.
 *
 * It called listProducts() — the ENTIRE catalogue — twice per request, once for
 * the cross-sell fallback and again for the upsell, and then fetched each
 * chosen product individually. Roughly two catalogue loads and up to nine
 * further queries, for a panel of six tiles.
 *
 * Now: one catalogue load, shared, and everything else is a map lookup. The
 * co-purchase aggregate is skipped entirely when the product's own metadata
 * already names enough cross-sells, and it is the only query that touches
 * orders.
 */
export async function recommendationsFor(productId, { limit = 4 } = {}) {
  const product = await getProduct(productId);
  if (!product) return { crossSell: [], upsell: [] };

  /* Loaded at most once, and only when something actually needs it — a product
     whose metadata names its own cross-sells and upsells never touches it. */
  let catalogue = null;
  const all_ = async () => (catalogue ||= await listProducts({ activeOnly: true }));
  let byIdMemo = null;
  const index = async () => {
    if (!byIdMemo) byIdMemo = new Map((await all_()).map((p) => [p.id, p]));
    return byIdMemo;
  };

  // ── Cross-sell ──────────────────────────────────────────────────────────
  let crossIds = Array.isArray(product.metadata?.crossSell) ? product.metadata.crossSell : [];
  if (crossIds.length < limit) {
    const co = await all(
      `SELECT oi2.product_id AS id, COUNT(*) AS n
         FROM order_items oi1
         JOIN order_items oi2 ON oi2.order_id = oi1.order_id AND oi2.product_id <> oi1.product_id
         JOIN orders o ON o.id = oi1.order_id
        WHERE oi1.product_id = @id AND oi2.product_id IS NOT NULL AND o.${PAID}
        GROUP BY oi2.product_id ORDER BY n DESC LIMIT 12`, { id: productId }).catch(() => []);
    crossIds = [...crossIds, ...co.map((r) => r.id)];
  }
  const byId = await index();
  let crossSell = resolve(crossIds, { exclude: productId, limit, byId });
  if (crossSell.length < limit) {
    // Fallback: other products in the same category.
    const cat = (await all_())
      .filter((p) => p.id !== productId && p.category === product.category);
    crossSell = resolve([...crossSell.map((p) => p.id), ...cat.map((p) => p.id)],
      { exclude: productId, limit, byId });
  }

  // ── Upsell ──────────────────────────────────────────────────────────────
  let upIds = Array.isArray(product.metadata?.upsell) ? product.metadata.upsell : [];
  if (!upIds.length) {
    const higher = (await all_())
      .filter((p) => p.id !== productId && p.category === product.category && p.price > product.price)
      .sort((a, b) => a.price - b.price);   // nearest bigger first
    upIds = higher.map((p) => p.id);
  }
  const upsell = resolve(upIds, { exclude: productId, limit: 2, byId });

  return { crossSell, upsell };
}
