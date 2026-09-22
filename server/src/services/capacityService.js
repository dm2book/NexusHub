/**
 * How many orders can this shop serve today without anybody touching it?
 *
 * ── WHY IT IS A NUMBER AND NOT A TICK ─────────────────────────────────────
 * "Can I handle ten orders a day?" was answered by measuring rather than
 * reasoning: twelve orders were placed through the real HTTP API against a
 * shop with codes loaded, paid, and every one of them delivered itself —
 * 0 needing a human, 314 ms for the twelve. The machinery is not the limit.
 *
 * Stock is. A product with four codes can serve four orders and then starts
 * queueing for a person, and nothing on any screen said so as a number. The
 * readiness panel said "0 with pre-loaded codes" for the catalogue as a whole,
 * which is true and useless: it does not say whether tomorrow is fine.
 *
 * So this reports, per product and for the shop:
 *   · how many orders it can fill by itself right now;
 *   · how many days that lasts at the rate it has actually been selling;
 *   · and which products would go to the hand-delivery queue first.
 *
 * ── WHAT COUNTS AS AUTOMATIC ──────────────────────────────────────────────
 * A code in stock, or a supplier that can buy one on demand. A supplier only
 * counts when it is active AND its connector says it can fulfil — a Kinguin row
 * with no API key is a supplier in the table and nothing at all at 3am.
 *
 * Deliberately NOT counted: a product set to manual delivery. That is an
 * owner's decision to do it by hand, and dressing it up as capacity would hide
 * the work rather than measure it.
 */
import { all, get } from '../db/index.js';

/** Products that can be delivered without a person, and how far that goes. */
export async function capacity({ target = 10, days = 14 } = {}) {
  const products = await all(
    `SELECT p.id, p.sku, p.name, p.price, p.metadata,
            (SELECT COUNT(*) FROM product_codes c
              WHERE c.product_id = p.id AND c.status = 'available') AS codes
       FROM products p
      WHERE p.active = 1 AND p.kind <> 'mystery'`).catch(() => []);

  /* Which products a supplier could buy on demand. Active suppliers only, and
     only the connectors that actually carry credentials. */
  const autoSupplied = new Set();
  const suppliers = await all(
    `SELECT id, name, connector_kind, status, config FROM suppliers WHERE status = 'active'`)
    .catch(() => []);
  const live = [];
  for (const s of suppliers) {
    let cfg = {};
    try { cfg = JSON.parse(s.config || '{}'); } catch { cfg = {}; }
    const configured = !!(cfg.apiKey || cfg.auth?.token || (cfg.apiHash && cfg.email));
    if (!configured || cfg.autoDeliver === false) continue;
    live.push({ id: s.id, name: s.name, kind: s.connector_kind });
  }
  if (live.length) {
    const rows = await all(
      `SELECT DISTINCT product_id FROM supplier_products
        WHERE product_id IS NOT NULL AND supplier_id = ANY(@ids)`,
      { ids: live.map((s) => s.id) }).catch(() => []);
    for (const r of rows) autoSupplied.add(r.product_id);
  }

  /* What has actually been selling, per product per day, over the window. A
     rate invented from nothing would make an empty shop look safe. */
  const sold = await all(
    `SELECT oi.product_id AS id, SUM(oi.quantity) AS units
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.status IN ('payment_received','processing','awaiting_fulfillment','completed')
        AND o.created_at >= @since
      GROUP BY oi.product_id`,
    { since: new Date(Date.now() - days * 86_400_000).toISOString() }).catch(() => []);
  const perDay = new Map(sold.map((r) => [r.id, Number(r.units || 0) / days]));

  const rows = products.map((p) => {
    let meta = {};
    try { meta = typeof p.metadata === 'string' ? JSON.parse(p.metadata || '{}') : (p.metadata || {}); }
    catch { meta = {}; }
    const manual = meta.deliveryMode === 'manual';
    const codes = Number(p.codes || 0);
    const supplier = autoSupplied.has(p.id);
    const rate = perDay.get(p.id) || 0;
    return {
      id: p.id, sku: p.sku, name: p.name, price: Number(p.price || 0), codes, manual, supplier,
      /* A supplier that buys on demand has no countable ceiling here — what it
         can actually supply is the supplier's stock, which this shop does not
         own and must not pretend to know. */
      automatic: manual ? 0 : (supplier ? null : codes),
      soldPerDay: Math.round(rate * 100) / 100,
      daysOfCover: manual || supplier ? null : (rate > 0 ? Math.round((codes / rate) * 10) / 10 : null),
    };
  });

  const byCodes = rows.filter((r) => !r.manual && !r.supplier);
  const ordersToday = byCodes.reduce((n, r) => n + r.codes, 0);
  const unlimited = rows.filter((r) => r.supplier && !r.manual).length;

  /* The shop-wide answer. A product with no stock and no supplier is the one
     that turns an order into work, so those are named. */
  /* Sorted by what it costs to leave unstocked: what actually sells first, and
     on a shop where nothing has sold yet, the dearest products. Sorting by a
     rate that is zero for everything makes the twelve shown an accident of row
     order, which is not a shortlist. */
  const dry = byCodes.filter((r) => r.codes === 0)
    .sort((a, b) => (b.soldPerDay - a.soldPerDay) || (b.price - a.price)
      || String(a.sku).localeCompare(String(b.sku)));
  const thin = byCodes.filter((r) => r.codes > 0 && r.codes < target)
    .sort((a, b) => a.codes - b.codes);

  return {
    target,
    windowDays: days,
    /* Orders the shop could fill by itself right now, counting only stock it
       actually holds. Not a forecast. */
    ordersToday,
    meetsTarget: ordersToday >= target || unlimited > 0,
    productsAutomatic: byCodes.filter((r) => r.codes > 0).length + unlimited,
    productsBySupplier: unlimited,
    productsManual: rows.filter((r) => r.manual).length,
    productsDry: dry.length,
    total: rows.length,
    suppliers: live,
    dry: dry.slice(0, 12),
    thin: thin.slice(0, 12),
    rows,
  };
}

/** One sentence for the readiness panel. */
export async function capacityLine({ target = 10 } = {}) {
  const c = await capacity({ target });
  if (c.productsBySupplier > 0 && c.productsDry === 0) {
    return { status: 'ok',
      detail: `${c.productsAutomatic} of ${c.total} products deliver themselves — `
        + `${c.ordersToday} order(s) from stock on hand, plus ${c.productsBySupplier} bought on demand.` };
  }
  if (c.ordersToday >= target) {
    return { status: c.productsDry ? 'warn' : 'ok',
      detail: `${c.ordersToday} order(s) can be filled from stock without you`
        + (c.productsDry
          ? ` — but ${c.productsDry} product(s) have no codes and no supplier, so those go to the hand-delivery queue: ${c.dry.slice(0, 3).map((r) => r.name).join(', ')}.`
          : '.') };
  }
  return { status: 'fail',
    detail: `Only ${c.ordersToday} order(s) could be delivered without you today, against a target of ${target}. `
      + `${c.productsDry} of ${c.total} products have no codes and no supplier — every order for one of those waits for a person. `
      + 'Load codes under Products → Codes, or connect a supplier that can buy on demand.' };
}
