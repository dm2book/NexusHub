/**
 * Every supplier for a product, side by side — and which one you should be on.
 *
 * ── WHAT THIS ADDS TO WHAT WAS ALREADY HERE ───────────────────────────────
 * supplierMetricsService answers "how is each supplier doing" across the whole
 * catalogue. supplierDashboardService answers "can I deliver this product" and
 * collapses to ONE supplier per row — whichever the cost or routing rules pick.
 * Neither can answer the question this is for: for THIS product, what is each
 * of my suppliers charging, holding, and how often do they actually deliver?
 * That comparison was only obtainable by opening the mapping modal on every
 * supplier in turn and holding the answer in your head.
 *
 * ── THE THING WORTH KNOWING ───────────────────────────────────────────────
 * Fulfilment routes on `priority ASC` (supplierService.resolveFulfillmentSupplier).
 * Not on cost, not on reliability, not on stock depth — on a number somebody
 * typed once. So the supplier an order actually goes to and the supplier you
 * would pick knowing what you now know are two different questions, and nothing
 * in this system has ever shown them together.
 *
 * `best` is a RECOMMENDATION. `routed` is what will really happen tonight. When
 * they disagree the row says so and says what it would save, because that gap
 * is the whole reason to look at this page.
 *
 * ── WHAT IT REFUSES TO DO ─────────────────────────────────────────────────
 * A supplier with no fulfilment history has no reliability — not 100%. A
 * mapping with no cost has no margin — not 0%. A supplier that has never
 * reported stock is unknown, not empty. Each of those is reported as null with
 * a reason, and `best` will not rank a candidate on a number that does not
 * exist: where cost is unknown it says it cannot choose rather than choosing
 * the one that happens to sort first.
 */
import { all, get } from '../../db/index.js';
import { config } from '../../config/env.js';
import { marginAt } from '../market/pricing.js';

const num = (v) => (v == null ? null : Number(v));
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

/** Can this mapping actually take an order right now — the routing gate, repeated. */
export function isDeliverable(offer) {
  if (offer.supplierStatus !== 'active') return false;
  if (offer.skuStatus && offer.skuStatus !== 'in_stock') return false;
  return offer.stock == null || Number(offer.stock) > 0;
}

/**
 * One supplier's offer for one product, with every number the decision needs.
 *
 * `metrics` is that supplier's row from supplierMetricsService — reliability,
 * fulfilment counts and average seconds are properties of the SUPPLIER, not of
 * this SKU, and pretending otherwise would invent per-product reliability out
 * of a shop that has never ordered this product from anyone.
 */
export function offerRow(mapping, { priceCents = null, metrics = {}, cfg = config.market } = {}) {
  const cost = num(mapping.cost);
  const price = num(priceCents);

  let margin = { marginPct: null, profitEur: null };
  if (cost != null && price != null && price > 0) {
    margin = marginAt(price / 100, cost / 100, cfg);
  }

  const fulfilled = Number(metrics.fulfilled || 0);
  const failed = Number(metrics.failed || 0);
  const attempts = fulfilled + failed;

  return {
    supplierId: mapping.supplier_id,
    supplierName: mapping.supplier_name,
    kind: mapping.connector_kind,
    supplierStatus: mapping.supplier_status_row,
    supplierSku: mapping.supplier_sku,
    priority: Number(mapping.priority ?? 100),

    costCents: cost,
    stock: mapping.available_stock == null ? null : Number(mapping.available_stock),
    skuStatus: mapping.sku_status || null,

    /* Lead time is measured, never configured: the average of what this
       supplier's fulfilled requests actually took. With none, it is unknown. */
    leadSeconds: metrics.avgFulfillSeconds ?? null,
    reliabilityPct: attempts ? Math.round((fulfilled / attempts) * 100) : null,
    fulfilmentRate: attempts ? round1((fulfilled / attempts) * 100) : null,
    attempts,
    fulfilled,
    failed,

    marginPct: margin.marginPct,
    profitPerSaleEur: margin.profitEur,

    lastSyncAt: mapping.last_synced_at || null,
  };
}

/**
 * Which one to be on, and why — or an honest refusal.
 *
 * Cost decides, because it is the only one of these numbers that is a fact
 * about this SKU rather than about the supplier in general. Reliability and
 * speed break ties and veto: a supplier that fails a third of its orders is not
 * cheaper, it is cheaper-looking, and the difference shows up as refunds.
 *
 * Deliberately NOT a weighted score. A score would happily rank a supplier with
 * no cost and no history above one with both, and produce a number nobody can
 * argue with — which is the failure mode of every tool like this.
 */
export function chooseBest(offers, { minReliability = 70, cfg = config.market } = {}) {
  const live = offers.filter(isDeliverable);
  if (!live.length) {
    return { bestSupplierId: null, reason: offers.length
      ? 'no mapped supplier can take an order right now'
      : 'no supplier is mapped to this product' };
  }

  const costed = live.filter((o) => o.costCents != null);
  if (!costed.length) {
    return { bestSupplierId: null,
      reason: `${live.length} supplier(s) can deliver this, but none has a cost price — `
        + 'there is nothing to choose between them yet' };
  }

  /* A known-bad supplier is set aside before price is considered, and only when
     there is something to fall back to. Being the only one that can deliver
     beats being reliable. */
  const trusted = costed.filter((o) => o.reliabilityPct == null || o.reliabilityPct >= minReliability);
  const pool = trusted.length ? trusted : costed;
  const excluded = costed.length - pool.length;

  const sorted = [...pool].sort((a, b) => (a.costCents - b.costCents)
    || ((b.reliabilityPct ?? -1) - (a.reliabilityPct ?? -1))
    || ((a.leadSeconds ?? Infinity) - (b.leadSeconds ?? Infinity)));
  const best = sorted[0];
  const runnerUp = sorted[1] || null;

  const bits = [`cheapest of ${pool.length} deliverable, costed supplier(s) at €${(best.costCents / 100).toFixed(2)}`];
  if (excluded) bits.push(`${excluded} set aside below ${minReliability}% reliability`);
  if (best.reliabilityPct == null) bits.push('no fulfilment history yet, so reliability is unproven');
  if (runnerUp) {
    const gap = runnerUp.costCents - best.costCents;
    bits.push(gap > 0
      ? `€${(gap / 100).toFixed(2)} cheaper than the next`
      : 'tied on cost with the next, decided on reliability then speed');
  }
  if (costed.length < live.length) {
    bits.push(`${live.length - costed.length} deliverable supplier(s) have no cost price and were not considered`);
  }
  return { bestSupplierId: best.supplierId, reason: bits.join('; ') };
}

/**
 * Alerts, on top of the ones supplierDashboardService already raises.
 *
 * Those cover the shelf and the route. These cover the three the shelf cannot
 * see: a margin that has quietly fallen through the floor, a supplier whose
 * connector has stopped answering, and a cost that went up while nobody was
 * looking.
 */
export function intelligenceWarnings(rows, {
  minimumMarginPercent = config.market.minimumMarginPercent,
  staleSyncHours = 48,
  priceJumpPercent = 10,
  now = Date.now(),
} = {}) {
  const out = [];
  const add = (row, code, severity, detail, extra = {}) =>
    out.push({ code, severity, productId: row.productId, name: row.name, detail, ...extra });

  for (const row of rows) {
    if (!row.active) continue;

    /* ── the margin floor ──────────────────────────────────────────────────
       Judged on the supplier the order will ACTUALLY go to, not on the best
       one available: the money that leaves is the routed one's cost. */
    const routed = row.offers.find((o) => o.supplierId === row.routedSupplierId);
    if (routed && routed.marginPct != null && routed.marginPct < minimumMarginPercent) {
      add(row, 'MARGIN_BELOW_MINIMUM', routed.marginPct < 0 ? 'critical' : 'warn',
        `${routed.marginPct}% margin at ${routed.supplierName}'s cost — below the `
        + `${minimumMarginPercent}% floor.`
        + (routed.marginPct < 0 ? ' Every sale of this loses money.' : ''),
        { supplierId: routed.supplierId, marginPct: routed.marginPct });
    }

    /* ── a supplier that has stopped answering ─────────────────────────────
       Distinct from "paused", which is a decision somebody made. This is a
       connector that errored or has gone quiet past the point where its own
       numbers can still be trusted. */
    for (const o of row.offers) {
      if (o.supplierStatus === 'error') {
        add(row, 'SUPPLIER_OFFLINE', 'critical',
          `${o.supplierName} is in error — its last sync failed.`,
          { supplierId: o.supplierId });
        continue;
      }
      if (o.supplierStatus !== 'active') continue;
      const ageH = o.lastSyncAt ? (now - Date.parse(o.lastSyncAt)) / 3_600_000 : null;
      if (ageH != null && Number.isFinite(ageH) && ageH > staleSyncHours) {
        add(row, 'SUPPLIER_OFFLINE', 'warn',
          `${o.supplierName} has not synced for ${Math.round(ageH)}h — its cost and `
          + 'stock here are that old.',
          { supplierId: o.supplierId, ageHours: Math.round(ageH) });
      }
    }

    /* ── a supplier that got more expensive ───────────────────────────────
       From history, so it is a comparison with something that was recorded
       rather than with a remembered number. */
    for (const o of row.offers) {
      if (o.costChange && o.costChange.pct >= priceJumpPercent) {
        add(row, 'SUPPLIER_PRICE_UP', o.costChange.pct >= priceJumpPercent * 2 ? 'warn' : 'info',
          `${o.supplierName} went from €${(o.costChange.fromCents / 100).toFixed(2)} to `
          + `€${(o.costChange.toCents / 100).toFixed(2)} (+${o.costChange.pct}%) `
          + `since ${o.costChange.since.slice(0, 10)}.`,
          { supplierId: o.supplierId, pct: o.costChange.pct });
      }
    }

    /* ── the gap that pays for this page ──────────────────────────────────── */
    if (row.bestSupplierId && row.routedSupplierId
        && row.bestSupplierId !== row.routedSupplierId) {
      const best = row.offers.find((o) => o.supplierId === row.bestSupplierId);
      const gap = routed && best && routed.costCents != null && best.costCents != null
        ? routed.costCents - best.costCents : null;
      add(row, 'ROUTED_NOT_BEST', gap && gap > 0 ? 'warn' : 'info',
        `Orders route to ${routed?.supplierName || 'another supplier'} on priority, but `
        + `${best?.supplierName} is the better buy`
        + (gap && gap > 0 ? ` — €${(gap / 100).toFixed(2)} per sale.` : '.')
        + ' Change the priority on the mapping to move it.',
        { supplierId: row.bestSupplierId, gapCents: gap });
    }
  }

  const rank = { critical: 0, warn: 1, info: 2 };
  return out.sort((a, b) => (rank[a.severity] - rank[b.severity])
    || String(a.name).localeCompare(String(b.name)));
}

/* ── Reading it out of the database ───────────────────────────────────────── */

/**
 * The most recent cost move per (supplier, sku), from history.
 *
 * Compared against the OLDEST point inside the window rather than the previous
 * row: a supplier that crept up four percent a week for a month has not raised
 * its price by four percent, and a row-to-row diff would never say so.
 */
export async function costChanges({ days = 30 } = {}) {
  const cut = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await all(
    `SELECT supplier_id, supplier_sku,
            (ARRAY_AGG(cost ORDER BY observed_at ASC))[1]  AS first_cost,
            (ARRAY_AGG(observed_at ORDER BY observed_at ASC))[1] AS first_at,
            (ARRAY_AGG(cost ORDER BY observed_at DESC))[1] AS last_cost
       FROM supplier_offer_history
      WHERE observed_at >= @cut AND cost IS NOT NULL
      GROUP BY supplier_id, supplier_sku
     HAVING COUNT(*) > 1`, { cut }).catch(() => []);

  const out = new Map();
  for (const r of rows) {
    const from = Number(r.first_cost);
    const to = Number(r.last_cost);
    if (!(from > 0) || !Number.isFinite(to) || to === from) continue;
    out.set(`${r.supplier_id}::${r.supplier_sku}`, {
      fromCents: from, toCents: to,
      pct: round1(((to - from) / from) * 100),
      since: r.first_at,
    });
  }
  return out;
}

/** Points for the chart: what each supplier was asking for this product, over time. */
export async function offerHistory(productId, { days = 90 } = {}) {
  const cut = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await all(
    `SELECT h.supplier_id, s.name AS supplier_name, h.observed_at, h.cost, h.available_stock
       FROM supplier_offer_history h
       JOIN suppliers s ON s.id = h.supplier_id
      WHERE h.product_id = @p AND h.observed_at >= @cut
      ORDER BY h.observed_at ASC`, { p: productId, cut }).catch(() => []);

  const bySupplier = new Map();
  for (const r of rows) {
    const key = r.supplier_id;
    if (!bySupplier.has(key)) {
      bySupplier.set(key, { supplierId: key, supplierName: r.supplier_name, points: [] });
    }
    bySupplier.get(key).points.push({
      at: r.observed_at,
      costCents: r.cost == null ? null : Number(r.cost),
      stock: r.available_stock == null ? null : Number(r.available_stock),
    });
  }
  return {
    productId,
    days,
    series: [...bySupplier.values()],
    /* One point is not a line. Said here rather than drawn as a dot the reader
       has to interpret. */
    enoughToPlot: [...bySupplier.values()].some((s) => s.points.length >= 2),
  };
}

/** The whole comparison: every product that has at least one supplier mapped. */
export async function supplierIntelligence({ limit = 500 } = {}) {
  const { supplierMetrics } = await import('./supplierMetricsService.js');
  const metrics = await supplierMetrics();
  const byId = Object.fromEntries(metrics.map((m) => [m.id, m]));

  const mappings = await all(
    `SELECT sp.*, s.name AS supplier_name, s.connector_kind,
            s.status AS supplier_status_row, s.last_sync_at, s.last_sync_status,
            sp.supplier_status AS sku_status,
            p.name AS product_name, p.price AS product_price, p.active AS product_active
       FROM supplier_products sp
       JOIN suppliers s ON s.id = sp.supplier_id
       JOIN products p ON p.id = sp.product_id
      ORDER BY p.name ASC, sp.priority ASC`);

  const changes = await costChanges();

  const byProduct = new Map();
  for (const m of mappings) {
    if (!byProduct.has(m.product_id)) {
      byProduct.set(m.product_id, {
        productId: m.product_id, name: m.product_name,
        priceCents: m.product_price == null ? null : Number(m.product_price),
        active: !!m.product_active, offers: [],
      });
    }
    const row = byProduct.get(m.product_id);
    const offer = offerRow(
      { ...m, supplier_status_row: m.supplier_status_row, last_synced_at: m.last_sync_at },
      { priceCents: row.priceCents, metrics: byId[m.supplier_id] || {} });
    offer.costChange = changes.get(`${m.supplier_id}::${m.supplier_sku}`) || null;
    offer.deliverable = isDeliverable({
      supplierStatus: offer.supplierStatus, skuStatus: offer.skuStatus, stock: offer.stock });
    row.offers.push(offer);
  }

  const rows = [...byProduct.values()].slice(0, limit);
  for (const row of rows) {
    const { bestSupplierId, reason } = chooseBest(row.offers);
    row.bestSupplierId = bestSupplierId;
    row.bestReason = reason;
    /* What will really happen: routing takes the lowest priority number among
       the mappings that can deliver. Same rule as resolveFulfillmentSupplier. */
    const routable = row.offers.filter((o) => o.deliverable)
      .sort((a, b) => a.priority - b.priority);
    row.routedSupplierId = routable.length ? routable[0].supplierId : null;
    row.supplierCount = row.offers.length;
  }

  return {
    products: rows,
    suppliers: metrics,
    warnings: intelligenceWarnings(rows),
    coverage: await coverage(),
  };
}

/** Why the page looks the way it does — the same courtesy the market report pays. */
export async function coverage() {
  const s = await get(`SELECT COUNT(*) AS n FROM suppliers`).catch(() => ({ n: 0 }));
  const m = await get(`SELECT COUNT(*) AS n FROM supplier_products WHERE product_id IS NOT NULL`)
    .catch(() => ({ n: 0 }));
  const costed = await get(
    `SELECT COUNT(*) AS n FROM supplier_products WHERE product_id IS NOT NULL AND cost IS NOT NULL`)
    .catch(() => ({ n: 0 }));
  const hist = await get(`SELECT COUNT(*) AS n FROM supplier_offer_history`).catch(() => ({ n: 0 }));
  const products = await get(`SELECT COUNT(*) AS n FROM products WHERE active = 1`)
    .catch(() => ({ n: 0 }));

  const blockers = [];
  if (Number(s.n) === 0) {
    blockers.push('No suppliers are configured. Kinguin, G2A and Eldorado each need their own '
      + 'API credentials; a manual supplier needs none and can be added straight away.');
  } else if (Number(m.n) === 0) {
    blockers.push('No supplier is mapped to any product, so there is nothing to compare — '
      + 'map a supplier SKU to a product first.');
  }
  if (Number(m.n) > 0 && Number(costed.n) === 0) {
    blockers.push('No mapping has a cost price, so margin, profit per sale and the best-supplier '
      + 'choice cannot be computed.');
  }
  if (Number(hist.n) === 0) {
    blockers.push('No price history yet — the charts and the "got more expensive" alert need at '
      + 'least two syncs that changed something.');
  }
  return {
    suppliers: Number(s.n), mappings: Number(m.n), costedMappings: Number(costed.n),
    historyPoints: Number(hist.n), activeProducts: Number(products.n), blockers,
  };
}
