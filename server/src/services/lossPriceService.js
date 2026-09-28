/**
 * Products that lose money on every sale, and the lowest price at which they
 * stop.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * The owner chose to charge 21% BTW. From then on the first 17.4% of every
 * price is the Belastingdienst's, and a price set against the purchase cost
 * alone — "it costs €9, I sell it for €10" — loses money on each order. A live
 * scan against Kinguin found eighteen products in that state. Nothing in the
 * shop listed them, and nothing could fix them in one go.
 *
 * ── WHAT "FIXED" MEANS ────────────────────────────────────────────────────
 * The pricing engine's own floor, minimumProfitablePrice(): after BTW and the
 * payment fee the sale must clear BOTH the minimum profit in euros and the
 * minimum margin percentage (config.market — €0.50 and 6% unless the owner set
 * others). Rounded UP to the next .49 or .99, the way the rest of the shelf is
 * priced, never down.
 *
 * Only products whose cost is actually known — a supplier mapping or a pasted
 * cost price. A product with no cost is reported as unknown, never guessed:
 * a price raised on an assumed cost is a guess dressed up as a fix.
 *
 * It never LOWERS a price. A product already profitable is left alone; this
 * is a floor, not a repricing.
 */
import { config } from '../config/env.js';
import { marginAt, minimumProfitablePrice } from './market/pricing.js';
import { planningVat } from './vatService.js';
import { costCentsForMany } from './costService.js';
import { audit } from './auditService.js';

/** Up to the next .49 or .99 — the shop's price endings — in cents. */
export function roundUpToEnding(cents) {
  const c = Math.ceil(Number(cents) || 0);
  const euros = Math.floor(c / 100);
  const rest = c - euros * 100;
  return euros * 100 + (rest <= 49 ? 49 : 99);
}

/** Profit and margin on a price, after BTW (planning rate) and the payment fee. */
export function profitAt(priceCents, costCents, { vatPct = planningVat().pct, cfg = config.market } = {}) {
  const m = marginAt(priceCents / 100, costCents / 100, { ...cfg, vatPercent: vatPct });
  return { profitCents: Math.round(m.profitEur * 100), marginPct: m.marginPct };
}

/** The lowest price, on the shop's endings, that clears the engine's floor. */
export function floorPrice(costCents, { vatPct = planningVat().pct, cfg = config.market } = {}) {
  const eur = minimumProfitablePrice(costCents / 100, { ...cfg, vatPercent: vatPct });
  return roundUpToEnding(Math.round(eur * 100));
}

/**
 * Every active product, sorted into: losing money, under the minimum margin,
 * fine, and unknown (no cost). Each problem row carries the floor price and
 * what the product would earn at it.
 */
export async function lossReport({ vatPct = planningVat().pct, cfg = config.market } = {}) {
  const { listProducts } = await import('./productService.js');
  const products = (await listProducts({ activeOnly: true })).filter((p) => Number(p.price) > 0);
  const costs = await costCentsForMany(products.map((p) => p.id));
  const floorPct = Number(cfg.minimumMarginPercent ?? 0);

  const rows = [];
  let unknown = 0;
  let fine = 0;
  for (const p of products) {
    const cost = costs[p.id];
    if (cost == null) { unknown += 1; continue; }
    const price = Number(p.price);
    const now = profitAt(price, cost, { vatPct, cfg });
    const state = now.profitCents <= 0 ? 'loss' : now.marginPct < floorPct ? 'thin' : 'ok';
    if (state === 'ok') { fine += 1; continue; }
    const proposed = Math.max(price, floorPrice(cost, { vatPct, cfg }));
    rows.push({
      id: p.id, name: p.name, sku: p.sku, state,
      price, cost, profitCents: now.profitCents, marginPct: now.marginPct,
      proposedPrice: proposed, ...(({ profitCents, marginPct }) => ({
        proposedProfitCents: profitCents, proposedMarginPct: marginPct,
      }))(profitAt(proposed, cost, { vatPct, cfg })),
      /* Said, not hidden: a big jump is a sign the product cannot be sold at
         a profit from this supplier at a price anybody pays, and the honest
         alternative is to take it off the shelf rather than reprice it. */
      increasePct: Math.round(((proposed - price) / price) * 1000) / 10,
    });
  }
  rows.sort((a, b) => a.profitCents - b.profitCents);
  return {
    vat: { pct: vatPct },
    minimumMarginPercent: floorPct,
    minimumProfitEur: Number(cfg.minimumProfitEur ?? 0),
    loss: rows.filter((r) => r.state === 'loss').length,
    thin: rows.filter((r) => r.state === 'thin').length,
    fine, unknown, rows,
  };
}

/**
 * Apply the floor to these products — or take them off the shelf.
 *
 * Prices are recomputed here from the current cost, never taken from the
 * request: the screen shows a proposal, and a stale screen must not be able
 * to write a stale number.
 */
export async function applyFloor(ids, { action = 'reprice', actor = null } = {}) {
  const { getProduct, updateProduct } = await import('./productService.js');
  const report = await lossReport();
  const byId = new Map(report.rows.map((r) => [r.id, r]));
  const done = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) continue;                          // no longer losing, or no cost
    const p = await getProduct(id);
    if (!p) continue;
    if (action === 'hide') {
      await updateProduct(id, { active: false });
      done.push({ id, name: row.name, hidden: true });
    } else {
      await updateProduct(id, { price: row.proposedPrice });
      done.push({ id, name: row.name, from: row.price, to: row.proposedPrice });
    }
  }
  if (done.length) {
    await audit({ actor, action: action === 'hide' ? 'pricing.loss_products_hidden' : 'pricing.loss_floor_applied',
      targetType: 'products', targetId: String(done.length), metadata: { done } });
  }
  return { changed: done.length, done };
}
