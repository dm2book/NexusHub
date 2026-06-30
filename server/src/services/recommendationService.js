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

async function resolve(ids, { exclude, limit }) {
  const out = [];
  const seen = new Set(exclude ? [exclude] : []);
  for (const id of ids) {
    if (out.length >= limit) break;
    if (seen.has(id)) continue;
    seen.add(id);
    const p = await getProduct(id);
    if (p && p.active) out.push(p);
  }
  return out;
}

export async function recommendationsFor(productId, { limit = 4 } = {}) {
  const product = await getProduct(productId);
  if (!product) return { crossSell: [], upsell: [] };

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
  let crossSell = await resolve(crossIds, { exclude: productId, limit });
  if (crossSell.length < limit) {
    // Fallback: other products in the same category.
    const cat = (await listProducts({ activeOnly: true }))
      .filter((p) => p.id !== productId && p.category === product.category);
    crossSell = await resolve([...crossSell.map((p) => p.id), ...cat.map((p) => p.id)], { exclude: productId, limit });
  }

  // ── Upsell ──────────────────────────────────────────────────────────────
  let upIds = Array.isArray(product.metadata?.upsell) ? product.metadata.upsell : [];
  if (!upIds.length) {
    const higher = (await listProducts({ activeOnly: true }))
      .filter((p) => p.id !== productId && p.category === product.category && p.price > product.price)
      .sort((a, b) => a.price - b.price);   // nearest bigger first
    upIds = higher.map((p) => p.id);
  }
  const upsell = await resolve(upIds, { exclude: productId, limit: 2 });

  return { crossSell, upsell };
}
