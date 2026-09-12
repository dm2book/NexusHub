/**
 * The supply side of the shop, per product and per supplier.
 *
 * ── WHY THE EXISTING PAGE COULD NOT ANSWER THIS ───────────────────────────
 * `supplierMetricsService` answers "how is each supplier doing" — margin,
 * reliability, fulfilment speed. Useful, and the wrong direction for the
 * question an owner actually asks before a launch: *which of my products can I
 * actually deliver, what do they cost me, and what runs out first?* That is a
 * PRODUCT-shaped question, and the only way to get near it was to open the
 * "Map products" modal on every supplier in turn and hold the union in your
 * head. A product with no supplier at all appears in no modal, which is exactly
 * the product you needed to see.
 *
 * ── THREE THINGS ARE CALLED "STOCK" AND THEY ARE NOT THE SAME ─────────────
 *   product_codes (available)      the shelf. The ONLY one auto-delivery draws
 *                                  from — orderService claims codes from here.
 *   supplier_products.available_stock  what the supplier last SAID it had. It
 *                                  gates routing (null = unknown = allowed).
 *   products.stock                 a column nothing enforces, nothing decrements
 *                                  and nothing sells from. The admin product
 *                                  table renders it as "∞" when it is null,
 *                                  which is how a shop with zero codes reads as
 *                                  infinitely in stock.
 *
 * This service reports the first two side by side and never adds them together.
 * "Low stock" means the shelf, because that is the number that decides whether
 * a paid order is delivered in ten seconds or sits in the manual queue — and it
 * is measured with `stockTierFor`, the same function that decides when Discord
 * gets woken up, so the dashboard and the alert can never disagree.
 *
 * ── UNKNOWN IS NOT ZERO ───────────────────────────────────────────────────
 * The rule the profit dashboard is built on holds here too. A supplier that has
 * never reported its stock has stock `null`, and stock VALUE is summed only
 * over the mappings where both the count and the cost are known — with the
 * coverage stated next to it. A shop with one costed mapping out of forty must
 * not be shown a confident total inventory value.
 */
import { all } from '../../db/index.js';
import { config } from '../../config/env.js';
import { costCentsFromMetadata, pickCostMapping } from '../costService.js';
import { stockTierFor } from '../codeStockService.js';

/** The tier "low stock" warns at: the lowest non-zero alert tier. 0 is "out". */
export function lowStockTier(tiers = config.stock.alertTiers) {
  const above = [...tiers].filter((t) => t > 0).sort((a, b) => a - b);
  return above.length ? above[above.length - 1] : null;
}

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const newest = (a, b) => {
  if (!a) return b || null;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
};

/**
 * A product's supply row.
 *
 * `supplier` is the mapping the shop would BUY FROM — the same pick that sets
 * the cost, so the name on screen and the number beside it always come from one
 * supplier rather than two. When a different mapping would actually FULFIL the
 * order (a cheaper supplier that is out of stock, a mapping whose supplier is
 * paused) that is said out loud rather than silently resolved, because the two
 * being different is itself the thing worth knowing.
 */
export function productRow(product, mappings = [], codes = 0) {
  let meta = {};
  try { meta = JSON.parse(product.metadata || '{}'); } catch { meta = {}; }

  const active = mappings.filter((m) => m.supplier_status === 'active');
  const costPick = pickCostMapping(mappings);
  const metaCost = costCentsFromMetadata(meta);

  /* Routing repeats resolveFulfillmentSupplier's gate: active supplier, a
     status that is not "out", and either unknown stock or some of it. */
  const deliverable = active.filter((m) =>
    (!m.sku_status || m.sku_status === 'in_stock')
    && (m.available_stock == null || Number(m.available_stock) > 0));
  const fulfil = deliverable.length
    ? [...deliverable].sort((a, b) => Number(a.priority ?? 100) - Number(b.priority ?? 100))[0]
    : null;

  const src = costPick || fulfil || active[0] || mappings[0] || null;
  const supplierStock = active.reduce(
    (acc, m) => (m.available_stock == null ? acc : (acc || 0) + Number(m.available_stock)), null);
  const lastSyncAt = mappings.reduce((acc, m) => newest(acc, m.last_synced_at), null);

  return {
    productId: product.id,
    name: product.name,
    sku: product.sku || null,
    active: !!product.active,
    priceCents: num(product.price),

    supplier: src ? {
      id: src.supplier_id, name: src.supplier_name,
      kind: src.connector_kind, status: src.supplier_status,
    } : null,
    supplierCount: mappings.length,
    activeSupplierCount: active.length,
    /* Every mapping is active-but-unusable, or every supplier is paused: there
       is a supplier on paper and none in practice. */
    pausedOnly: mappings.length > 0 && active.length === 0,
    fulfilSupplierId: fulfil ? fulfil.supplier_id : null,
    /* The cost comes from one supplier and the delivery from another. Legal,
       and it means the margin on screen is not the margin on the order. */
    costFulfilSplit: !!(costPick && fulfil && costPick.supplier_id !== fulfil.supplier_id),

    costCents: costPick ? Math.round(Number(costPick.cost)) : metaCost,
    costSource: costPick ? 'supplier' : (metaCost != null ? 'manual' : null),

    codeStock: codes,
    supplierStock,
    /* Reported, never summed with the other two — see the file header. */
    declaredStock: num(product.stock),

    lastSyncAt,
    updatedAt: product.updated_at || null,
  };
}

/** Per-supplier rollup. Stock value covers only mappings with BOTH numbers. */
export function supplierRow(supplier, mappings = []) {
  const mapped = mappings.filter((m) => m.product_id);
  const withCost = mapped.filter((m) => m.cost != null);
  const withStock = mapped.filter((m) => m.available_stock != null);
  const valued = mapped.filter((m) => m.cost != null && m.available_stock != null);

  const stockUnits = withStock.reduce((a, m) => a + Number(m.available_stock), 0);
  const stockValueCents = valued.reduce(
    (a, m) => a + Number(m.cost) * Number(m.available_stock), 0);

  return {
    id: supplier.id,
    name: supplier.name,
    kind: supplier.connector_kind,
    status: supplier.status,
    products: mapped.length,
    /* A SKU the supplier sells that is mapped to no product of ours. It costs
       nothing and it is not stock — it is a row waiting to be pointed at
       something. */
    unmappedSkus: mappings.length - mapped.length,
    productsWithCost: withCost.length,
    productsWithStock: withStock.length,
    avgCostCents: withCost.length
      ? Math.round(withCost.reduce((a, m) => a + Number(m.cost), 0) / withCost.length)
      : null,
    stockUnits: withStock.length ? stockUnits : null,
    stockValueCents: valued.length ? Math.round(stockValueCents) : null,
    stockValueCoverage: { counted: valued.length, total: mapped.length },
    lastSyncAt: supplier.last_sync_at || null,
    lastSyncStatus: supplier.last_sync_status || null,
  };
}

/**
 * The three warnings the owner asked for, plus the two that are the same
 * question wearing a different hat (a supplier that exists but is paused, a
 * mapping the supplier says is out).
 *
 * At most one warning per concern per product — a product with no supplier, no
 * cost and no codes is three facts, not nine — and INACTIVE PRODUCTS ARE
 * SKIPPED. Warning about the stock of something nobody can buy is how a list
 * long enough to be ignored gets built.
 */
export function warningsFor(rows, { tier = lowStockTier() } = {}) {
  const out = [];
  const add = (row, code, severity, detail) =>
    out.push({ code, severity, productId: row.productId, name: row.name, detail });

  for (const row of rows) {
    if (!row.active) continue;
    const hasCodes = row.codeStock > 0;

    // ── supply route ───────────────────────────────────────────────────────
    if (row.supplierCount === 0) {
      if (hasCodes) {
        add(row, 'NO_SUPPLIER', 'info',
          `No supplier mapped — delivering from ${row.codeStock} pre-loaded code(s). `
          + 'Nothing restocks this when they run out.');
      } else {
        add(row, 'NO_SUPPLY', 'critical',
          'No supplier and no codes in stock — a paid order for this goes to the '
          + 'manual queue and waits for you.');
      }
    } else if (row.pausedOnly) {
      add(row, 'SUPPLIER_PAUSED', hasCodes ? 'warn' : 'critical',
        `Every supplier mapped to this is paused or in error${hasCodes
          ? '' : ', and there are no codes in stock'}.`);
    } else if (!row.fulfilSupplierId && !hasCodes) {
      add(row, 'SUPPLIER_OUT_OF_STOCK', 'critical',
        'Every active supplier reports this out of stock, and there are no codes here.');
    }

    // ── cost ───────────────────────────────────────────────────────────────
    if (row.costCents == null) {
      add(row, 'NO_COST', 'warn',
        'No cost price. Profit, margin and the suggested price cannot be computed for this.');
    }

    // ── shelf ──────────────────────────────────────────────────────────────
    /* Only products that deliver from codes are judged on code stock. A
       product sourced live from a supplier is SUPPOSED to hold none. */
    const sellsFromCodes = hasCodes || (row.supplierCount === 0);
    if (sellsFromCodes) {
      const t = stockTierFor(row.codeStock);
      if (t === 0) {
        // Already covered by NO_SUPPLY when there is no supplier either.
        if (row.supplierCount > 0) {
          add(row, 'OUT_OF_CODES', 'warn',
            'No codes left — orders fall through to the supplier or the manual queue.');
        }
      } else if (t != null) {
        add(row, 'LOW_STOCK', t <= 5 ? 'critical' : 'warn',
          `${row.codeStock} code(s) left — below the ${t} mark.`);
      }
    }
    if (row.supplierStock != null && tier != null && row.supplierStock > 0
        && row.supplierStock <= tier) {
      add(row, 'SUPPLIER_LOW_STOCK', 'warn',
        `Supplier reports only ${row.supplierStock} left.`);
    }
  }

  const rank = { critical: 0, warn: 1, info: 2 };
  return out.sort((a, b) => (rank[a.severity] - rank[b.severity])
    || a.name.localeCompare(b.name));
}

/**
 * The same warnings, collapsed.
 *
 * Rendered one per product this list is not a warning list, it is the
 * catalogue: a shop with no costs entered yet produces one NO_COST line per
 * product, seventy-two of them, and a page of seventy-two identical amber rows
 * is read exactly as fast as a page of none. Measured on a seeded copy of this
 * shop: 124 rows across 72 products, of which 116 were two facts repeated.
 *
 * So anything affecting more than `loose` products becomes ONE line that counts
 * them and names the first few, with the rest still in `warnings` for whoever
 * wants the full list.
 */
export function groupWarnings(warnings = [], { loose = 3, name = 4 } = {}) {
  const by = new Map();
  for (const w of warnings) {
    const g = by.get(w.code) || { code: w.code, severity: w.severity, items: [] };
    /* Worst severity in the group wins the group — a code that is critical for
       two products and informational for twenty must not be filed under
       "info". */
    const rank = { critical: 0, warn: 1, info: 2 };
    if (rank[w.severity] < rank[g.severity]) g.severity = w.severity;
    g.items.push(w);
    by.set(w.code, g);
  }
  const out = [];
  for (const g of by.values()) {
    if (g.items.length <= loose) {
      for (const w of g.items) out.push({ ...w, count: 1, names: [w.name] });
      continue;
    }
    out.push({
      code: g.code, severity: g.severity, productId: null,
      count: g.items.length,
      names: g.items.slice(0, name).map((w) => w.name),
      /* The shared half of the sentence, with the per-product numbers dropped —
         "4 codes left" is true of one product, not of nineteen. */
      detail: GROUP_DETAIL[g.code]
        ? GROUP_DETAIL[g.code](g.items.length)
        : `${g.items.length} products: ${g.items[0].detail}`,
    });
  }
  const rank = { critical: 0, warn: 1, info: 2 };
  return out.sort((a, b) => (rank[a.severity] - rank[b.severity]) || (b.count - a.count));
}

const GROUP_DETAIL = {
  NO_SUPPLY: (n) => `${n} active products have neither a supplier nor codes in stock. `
    + 'Every paid order for these lands in the manual queue.',
  NO_SUPPLIER: (n) => `${n} products deliver from pre-loaded codes with no supplier behind them. `
    + 'Nothing restocks them.',
  SUPPLIER_PAUSED: (n) => `${n} products are mapped only to suppliers that are paused or in error.`,
  SUPPLIER_OUT_OF_STOCK: (n) => `${n} products are reported out of stock by every active supplier.`,
  NO_COST: (n) => `${n} active products have no cost price. `
    + 'Profit, margin and suggested prices cannot be computed for any of them.',
  OUT_OF_CODES: (n) => `${n} products have run out of codes and fall through to the supplier or the manual queue.`,
  LOW_STOCK: (n) => `${n} products are low on codes.`,
  SUPPLIER_LOW_STOCK: (n) => `${n} products are nearly out at the supplier.`,
};

/** Everything the admin supplier dashboard renders, in three queries. */
export async function supplierDashboard() {
  const [products, suppliers, mappings, codeRows] = await Promise.all([
    all('SELECT id, sku, name, price, active, stock, metadata, updated_at FROM products'),
    all('SELECT * FROM suppliers ORDER BY name ASC'),
    all(`SELECT sp.id, sp.supplier_id, sp.product_id, sp.supplier_sku, sp.cost,
                sp.available_stock, sp.priority, sp.last_synced_at,
                sp.supplier_status AS sku_status,
                s.name AS supplier_name, s.connector_kind,
                s.status AS supplier_status
           FROM supplier_products sp
           JOIN suppliers s ON s.id = sp.supplier_id`),
    all(`SELECT product_id, COUNT(*)::int AS n FROM product_codes
          WHERE status = 'available' GROUP BY product_id`),
  ]);

  const byProduct = {};
  const bySupplier = {};
  for (const m of mappings) {
    if (m.product_id) (byProduct[m.product_id] ||= []).push(m);
    (bySupplier[m.supplier_id] ||= []).push(m);
  }
  const codes = Object.fromEntries(codeRows.map((r) => [r.product_id, Number(r.n || 0)]));

  const rows = products
    .map((p) => productRow(p, byProduct[p.id] || [], codes[p.id] || 0))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const supplierRows = suppliers.map((s) => supplierRow(s, bySupplier[s.id] || []));

  const warnings = warningsFor(rows);
  const live = rows.filter((r) => r.active);
  const valued = supplierRows.filter((s) => s.stockValueCents != null);

  return {
    products: rows,
    suppliers: supplierRows,
    warnings,
    warningGroups: groupWarnings(warnings),
    lowStockTier: lowStockTier(),
    totals: {
      products: rows.length,
      activeProducts: live.length,
      withSupplier: live.filter((r) => r.supplierCount > 0).length,
      withCost: live.filter((r) => r.costCents != null).length,
      withCodes: live.filter((r) => r.codeStock > 0).length,
      codeUnits: live.reduce((a, r) => a + r.codeStock, 0),
      suppliers: supplierRows.length,
      activeSuppliers: supplierRows.filter((s) => s.status === 'active').length,
      /* null, not 0, when nothing can be valued at all: "we hold no stock" and
         "we have never been told what we hold" are different sentences. */
      stockValueCents: valued.length
        ? valued.reduce((a, s) => a + s.stockValueCents, 0) : null,
      stockValueCoverage: {
        counted: supplierRows.reduce((a, s) => a + s.stockValueCoverage.counted, 0),
        total: supplierRows.reduce((a, s) => a + s.stockValueCoverage.total, 0),
      },
    },
  };
}
