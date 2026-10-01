/**
 * Supplier Profit Center — per product, what each of the four marketplaces
 * would leave the shop, and which one wins on profit, on price and on stock.
 *
 * ── WHERE EACH PRICE COMES FROM ───────────────────────────────────────────
 * For Kinguin, G2A, Eneba and Eldorado, in this order of trust:
 *
 *   supplier   a product mapped to a supplier the shop CONNECTED for that
 *              marketplace (its connector, or a supplier named after it): the
 *              price the shop actually pays, its stock and its status.
 *   listing    otherwise, the latest offer for the matching market product
 *              observed through that marketplace's official API in the last
 *              7 days — with its URL and time. A retail listing, bought by hand;
 *              nothing is scraped.
 *   none       otherwise nothing, and the reason. Never an estimate: a price
 *              that was not observed is not shown.
 *
 * ── THE SUM, PER OFFER ────────────────────────────────────────────────────
 *   verkoopprijs  what the buyer pays, BTW included
 *   − inkoop      the supplier's price             = winst (before anything else)
 *   − BTW         at the planning rate: 21% until the shop's own registration
 *                 says otherwise
 *   − Stripe      PAYMENT_FEE_PERCENT of the full price + PAYMENT_FIXED_FEE —
 *                 charged on what the buyer paid, BTW included
 *   − other       SOURCE_COST_PERCENT and FULFILLMENT_COST_EUR, when set
 *                 = netto winst;  marge = netto winst ÷ price excl. BTW
 *
 * The same sum as marginAt(), which every other profit figure in the admin
 * uses, so this page and the loss list cannot disagree about a product.
 *
 * ── THE THREE BADGES ──────────────────────────────────────────────────────
 *   BEST PROFIT  the highest netto winst among offers IN STOCK — what a sale
 *                would actually leave today.
 *   BEST PRICE   the lowest purchase price among all offers, in stock or not.
 *                It differs from BEST PROFIT exactly when the cheapest source
 *                cannot deliver right now, which is worth seeing.
 *   BEST STOCK   the most units reported in stock. Only a connected supplier
 *                reports a quantity; a listing that is merely "in stock" ranks
 *                after any known count.
 */
import { all } from '../../db/index.js';
import { config } from '../../config/env.js';
import { planningVat } from '../vatService.js';

export const MARKETPLACES = [
  { key: 'kinguin', label: 'Kinguin' },
  { key: 'g2a', label: 'G2A' },
  { key: 'eneba', label: 'Eneba' },
  { key: 'eldorado', label: 'Eldorado' },
];
/** Marketplaces this shop has a supplier connector for. Eneba has none. */
const HAS_CONNECTOR = new Set(['kinguin', 'g2a', 'eldorado']);
export const LISTING_MAX_AGE_HOURS = 168;

/**
 * Everything between the price and what the shop keeps, in cents.
 * Pure — the page, the tests and the summary all call this one.
 */
export function breakdown(priceCents, costCents, { vatPct = planningVat().pct, cfg = config.market } = {}) {
  if (!(priceCents > 0) || costCents == null) return null;
  const price = Number(priceCents);
  const cost = Number(costCents);
  const exVat = cfg.pricesIncludeVat === false ? price : Math.round(price / (1 + vatPct / 100));
  const vat = price - exVat;
  const stripe = Math.round(price * (cfg.paymentFeePercent / 100) + cfg.paymentFixedFee * 100);
  const other = Math.round(exVat * ((cfg.sourceCostPercent || 0) / 100) + (cfg.fulfillmentCostEur || 0) * 100);
  const net = price - cost - vat - stripe - other;
  return {
    priceCents: price,
    costCents: cost,
    profitCents: price - cost,          // winst — before BTW and fees
    vatCents: vat,                      // btw impact
    stripeCents: stripe,                // Stripe kosten
    otherCostsCents: other,
    netProfitCents: net,                // netto winst
    marginPct: exVat > 0 ? Math.round((net / exVat) * 1000) / 10 : null,
  };
}

const inStockSupplier = (m) => m.supplierStatus === 'active' && m.status === 'in_stock'
  && (m.stock == null || Number(m.stock) > 0);

/** The offer one marketplace makes for one product, or why there is none. */
export function offerFor(mp, { mappings = [], listing = null, priceCents, vatPct, cfg }) {
  const usable = mappings.filter((m) => m.cost != null);
  if (usable.length) {
    /* Several mappings at one marketplace (two regions, two SKUs): the one in
       stock at the lowest price speaks for it. */
    const pick = [...usable].sort((a, b) => (inStockSupplier(b) - inStockSupplier(a)) || (a.cost - b.cost))[0];
    const inStock = inStockSupplier(pick);
    return {
      key: mp.key, label: mp.label, basis: 'supplier', supplierName: pick.supplierName, supplierId: pick.supplierId,
      inStock, stock: pick.stock == null ? null : Number(pick.stock),
      status: pick.supplierStatus !== 'active' ? `supplier ${pick.supplierStatus}` : pick.status,
      observedAt: pick.syncedAt || null, url: pick.url || null, current: !!pick.current,
      ...breakdown(priceCents, pick.cost, { vatPct, cfg }),
      listing: listing ? { costCents: listing.cost, url: listing.url, observedAt: listing.observedAt } : null,
    };
  }
  if (listing) {
    return {
      key: mp.key, label: mp.label, basis: 'listing', supplierName: null, supplierId: null,
      inStock: listing.availability === 'in_stock', stock: null, status: listing.availability,
      observedAt: listing.observedAt, url: listing.url, current: false,
      ...breakdown(priceCents, listing.cost, { vatPct, cfg }),
      listing: null,
    };
  }
  return {
    key: mp.key, label: mp.label, basis: 'none', inStock: false, stock: null,
    reason: HAS_CONNECTOR.has(mp.key)
      ? `not connected as a supplier for this product, and no ${mp.label} listing observed in the last 7 days`
      : `ForgeMarket has no ${mp.label} supplier connection, and no ${mp.label} listing was observed in the last 7 days`,
  };
}

/** The three badges for one product's offers, each null with a reason when nothing qualifies. */
export function bestOf(offers) {
  const priced = offers.filter((o) => o.costCents != null);
  const stocked = priced.filter((o) => o.inStock);
  const top = (list, better) => list.reduce((a, b) => (a == null || better(b, a) ? b : a), null);
  const profit = top(stocked, (b, a) => b.netProfitCents > a.netProfitCents
    || (b.netProfitCents === a.netProfitCents && b.basis === 'supplier' && a.basis !== 'supplier'));
  const price = top(priced, (b, a) => b.costCents < a.costCents
    || (b.costCents === a.costCents && b.inStock && !a.inStock));
  const counted = stocked.filter((o) => o.stock != null);
  const stock = counted.length
    ? top(counted, (b, a) => b.stock > a.stock || (b.stock === a.stock && b.costCents < a.costCents))
    : top(stocked, (b, a) => b.costCents < a.costCents);
  return {
    bestProfit: profit ? profit.key : null,
    bestPrice: price ? price.key : null,
    bestStock: stock ? stock.key : null,
    reasons: {
      bestProfit: profit ? null : (priced.length ? 'no marketplace has it in stock right now' : 'no price observed at any of the four'),
      bestPrice: price ? null : 'no price observed at any of the four',
      bestStock: stock ? (counted.length ? null : 'in stock, but no marketplace reported a quantity')
        : 'no marketplace has it in stock',
    },
  };
}

/** Load once: products, mappings to the four, and the latest listing per marketplace. */
async function load(productIds = null) {
  const only = productIds ? 'AND p.id = ANY(@ids)' : '';
  const [products, mappings, listings] = await Promise.all([
    all(`SELECT p.id, p.name, p.category, p.price FROM products p
          WHERE p.active = 1 AND p.price > 0 ${only} ORDER BY p.name`, { ids: productIds }),
    all(`SELECT sp.product_id, sp.cost, sp.available_stock AS stock, sp.supplier_status AS status,
                sp.supplier_url AS url, sp.last_synced_at AS "syncedAt", sp.priority,
                s.id AS "supplierId", s.name AS "supplierName", s.status AS "supplierStatus",
                LOWER(COALESCE(NULLIF(s.connector_kind, ''), '')) AS kind, LOWER(s.name) AS lname
           FROM supplier_products sp JOIN suppliers s ON s.id = sp.supplier_id
          WHERE sp.product_id IS NOT NULL`),
    all(`SELECT DISTINCT ON (c.forge_product_id, o.source_key)
                c.forge_product_id AS product_id, o.source_key, o.price_eur_cents AS cost,
                o.availability, o.url, o.observed_at AS "observedAt"
           FROM market_candidates c
           JOIN market_observations o ON o.market_product_id = c.market_product_id
          WHERE c.forge_product_id IS NOT NULL AND o.price_eur_cents IS NOT NULL
            AND o.observed_at >= @since
          ORDER BY c.forge_product_id, o.source_key, o.observed_at DESC`,
    { since: new Date(Date.now() - LISTING_MAX_AGE_HOURS * 3600_000).toISOString() }).catch(() => []),
  ]);
  return { products, mappings, listings };
}

/** Which of the four a supplier row stands for: its connector, or its name. */
const marketplaceOf = (m) => MARKETPLACES.find((x) => m.kind === x.key || m.lname === x.key)?.key || null;

export async function supplierProfitCenter({ q = '', only = null, limit = 500, productIds = null } = {}) {
  const vat = planningVat();
  const cfg = config.market;
  const { products, mappings, listings } = await load(productIds);

  // The supplier each product is routed to now: the lowest priority, as the router picks.
  const currentOf = new Map();
  for (const m of mappings) {
    const c = currentOf.get(m.product_id);
    if (!c || Number(m.priority) < Number(c.priority)) currentOf.set(m.product_id, m);
  }
  const mapsBy = new Map();
  for (const m of mappings) {
    const mp = marketplaceOf(m);
    if (!mp) continue;
    const k = `${m.product_id}::${mp}`;
    if (!mapsBy.has(k)) mapsBy.set(k, []);
    mapsBy.get(k).push({ ...m, cost: m.cost == null ? null : Number(m.cost), current: currentOf.get(m.product_id) === m });
  }
  const listBy = new Map(listings.map((l) => [`${l.product_id}::${l.source_key}`, { ...l, cost: Number(l.cost) }]));

  const needle = String(q || '').trim().toLowerCase();
  const rows = products.filter((p) => !needle || p.name.toLowerCase().includes(needle)).map((p) => {
    const priceCents = Number(p.price);
    const offers = MARKETPLACES.map((mp) => offerFor(mp, {
      mappings: mapsBy.get(`${p.id}::${mp.key}`) || [], listing: listBy.get(`${p.id}::${mp.key}`) || null,
      priceCents, vatPct: vat.pct, cfg,
    }));
    const best = bestOf(offers);
    const cur = currentOf.get(p.id);
    const currentOffer = offers.find((o) => o.current) || null;
    /* The current supplier may be one outside the four (a CSV wholesaler):
       its own price still gives the number to compare against. */
    const currentNet = currentOffer ? currentOffer.netProfitCents ?? null
      : (cur ? breakdown(priceCents, cur.cost == null ? null : Number(cur.cost), { vatPct: vat.pct, cfg })?.netProfitCents ?? null : null);
    const bestOffer = offers.find((o) => o.key === best.bestProfit) || null;
    return {
      productId: p.id, name: p.name, category: p.category, priceCents,
      offers, ...best,
      current: cur ? { supplierName: cur.supplierName, marketplace: marketplaceOf(cur), netProfitCents: currentNet } : null,
      /* What moving to BEST PROFIT would add per sale — only between two
         known numbers, and only when it is a different source. */
      gainPerSaleCents: bestOffer && currentNet != null && currentOffer !== bestOffer
        ? bestOffer.netProfitCents - currentNet : null,
      sources: offers.filter((o) => o.basis !== 'none').length,
    };
  });

  const filtered = rows.filter((r) => {
    if (only === 'gain') return r.gainPerSaleCents > 0;
    if (only === 'loss') return r.bestProfit && r.offers.find((o) => o.key === r.bestProfit).netProfitCents < 0;
    if (only === 'priced') return r.sources > 0;
    return true;
  });

  return {
    vat: { pct: vat.pct, registered: vat.registered },
    fees: { stripePercent: cfg.paymentFeePercent, stripeFixedCents: Math.round(cfg.paymentFixedFee * 100),
      otherPercent: cfg.sourceCostPercent || 0, fulfilmentCents: Math.round((cfg.fulfillmentCostEur || 0) * 100) },
    marketplaces: MARKETPLACES.map((m) => ({ ...m, connector: HAS_CONNECTOR.has(m.key),
      products: rows.filter((r) => r.offers.find((o) => o.key === m.key).basis !== 'none').length })),
    summary: {
      products: rows.length,
      priced: rows.filter((r) => r.sources > 0).length,
      withGain: rows.filter((r) => r.gainPerSaleCents > 0).length,
      gainPerSaleTotalCents: rows.reduce((a, r) => a + (r.gainPerSaleCents > 0 ? r.gainPerSaleCents : 0), 0),
      lossMaking: rows.filter((r) => r.bestProfit && r.offers.find((o) => o.key === r.bestProfit).netProfitCents < 0).length,
    },
    total: filtered.length,
    products: filtered.slice(0, Math.min(1000, Math.max(1, Number(limit) || 500))),
  };
}
