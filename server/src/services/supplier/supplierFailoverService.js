/**
 * Smart restock & supplier failover: when the supplier a product is bought from
 * stops being a good place to buy it, move the product to the best one that is.
 *
 * ── WHAT ROUTING DID BEFORE ───────────────────────────────────────────────
 * resolveFulfillmentSupplier walked a product's mappings in `priority` order —
 * a number somebody typed once — and skipped one that reported no stock. A
 * supplier that was offline, that had failed its last orders, or that had
 * become dearer than another kept getting the orders, and a delivery that
 * failed went straight to the owner without trying anybody else.
 *
 * ── THE FOUR REASONS TO LEAVE A SUPPLIER ──────────────────────────────────
 * Checked in this order, because the first one that applies is the one worth
 * saying:
 *
 *   offline        the supplier is paused, or its last catalogue sync failed
 *   errors         its last ERROR_STREAK deliveries (within a day) failed
 *   out_of_stock   it reports this SKU out of stock, or zero units
 *   too_expensive  at its price this product sells at a loss after BTW and
 *                  fees — or another usable supplier is at least SAVING_PCT
 *                  cheaper. The margin of SAVING_PCT is what keeps the shop
 *                  from flapping between two suppliers a few cents apart.
 *
 * Nothing else moves a product. A supplier that is fine stays the supplier.
 *
 * ── WHO IT MOVES TO ───────────────────────────────────────────────────────
 * Among the suppliers that are themselves fine: one that sells at a profit
 * before one whose cost is unknown; one at or above MIN_RELIABILITY before one
 * below it; then the cheapest; then the higher fulfilment rate. Reliability is
 * fulfilled ÷ (fulfilled + failed) across the supplier's history, and a
 * supplier with no history is unproven — neither trusted nor excluded.
 *
 * ── HOW A SWITCH IS MADE AND KEPT ─────────────────────────────────────────
 * By swapping priorities: the new supplier takes the old one's place at the top
 * of the list, so the next order goes there too, and the old one keeps its
 * mapping for when it recovers. Every switch is one row in supplier_switches
 * with the old supplier, the new one and why — and nothing is logged when
 * nothing changed, so the log stays a list of decisions rather than of orders.
 */
import { all, get, run, nowIso } from '../../db/index.js';
import { newId } from '../../utils/ids.js';
import { config } from '../../config/env.js';
import { marginAt } from '../market/pricing.js';
import { planningVat } from '../vatService.js';

export const REASON = {
  OFFLINE: 'offline',
  ERRORS: 'errors',
  OUT_OF_STOCK: 'out_of_stock',
  TOO_EXPENSIVE: 'too_expensive',
};

export const FAILOVER = {
  /** Consecutive failed deliveries, within ERROR_WINDOW_HOURS, that count as "erroring". */
  ERROR_STREAK: 2,
  ERROR_WINDOW_HOURS: 24,
  /** Below this fulfilment rate a supplier is only used when nothing else can. */
  MIN_RELIABILITY: 70,
  /** How much cheaper another supplier must be before "dearer" becomes a reason. */
  SAVING_PCT: 10,
};

const money = (c) => `€${(Number(c) / 100).toFixed(2)}`;

/** Profit in cents on one sale, after BTW and the payment fee; null when unknowable. */
export function profitOf(priceCents, costCents, { vatPct = planningVat().pct, cfg = config.market } = {}) {
  if (costCents == null || !(Number(priceCents) > 0)) return null;
  const m = marginAt(Number(priceCents) / 100, Number(costCents) / 100, { ...cfg, vatPercent: vatPct });
  return Math.round(m.profitEur * 100);
}

/**
 * Is this mapping a place the product can be bought right now?
 * `m` carries the mapping, its supplier's state and its history (see mappingsFor).
 * Returns { ok, code, reason } — the first reason that applies.
 */
export function fitness(m, { priceCents = null, vatPct, cfg } = {}) {
  const name = m.supplierName || m.supplier_id;
  if (m.supplierStatus !== 'active') {
    return { ok: false, code: REASON.OFFLINE, reason: `${name} is ${m.supplierStatus || 'not active'}` };
  }
  if (m.lastSyncStatus === 'error') {
    return { ok: false, code: REASON.OFFLINE, reason: `${name}'s last catalogue sync failed — it is not answering` };
  }
  if ((m.failStreak || 0) >= FAILOVER.ERROR_STREAK) {
    return { ok: false, code: REASON.ERRORS,
      reason: `${name}'s last ${m.failStreak} deliveries failed` };
  }
  if ((m.skuStatus && m.skuStatus !== 'in_stock') || (m.stock != null && Number(m.stock) <= 0)) {
    return { ok: false, code: REASON.OUT_OF_STOCK, reason: `${name} has none in stock` };
  }
  const profit = profitOf(priceCents, m.cost, { vatPct, cfg });
  if (profit != null && profit <= 0) {
    return { ok: false, code: REASON.TOO_EXPENSIVE,
      reason: `at ${money(m.cost)} from ${name} every sale loses ${money(-profit)} after BTW and fees` };
  }
  return { ok: true, code: null, reason: null, profit };
}

/** Best first. Pure; `ctx` is what fitness needs. */
export function rankCandidates(mappings, ctx = {}) {
  const usable = mappings.filter((m) => fitness(m, ctx).ok);
  const trusted = (m) => (m.reliabilityPct == null || m.reliabilityPct >= FAILOVER.MIN_RELIABILITY ? 0 : 1);
  const costed = (m) => (m.cost == null ? 1 : 0);
  return [...usable].sort((a, b) => (costed(a) - costed(b))
    || (trusted(a) - trusted(b))
    || ((a.cost ?? Infinity) - (b.cost ?? Infinity))
    || ((b.reliabilityPct ?? -1) - (a.reliabilityPct ?? -1))
    || (a.priority - b.priority));
}

/**
 * Should this product move, and where to? Pure.
 *
 * The current supplier is the mapping at the top of the priority list. It is
 * left alone unless one of the four reasons applies; when one does, the best
 * other usable supplier takes over. Returns the decision with every number it
 * was made on, so the log can show it rather than paraphrase it.
 */
export function decide(mappings, ctx = {}) {
  if (!mappings.length) return { switch: false, current: null, reason: 'no supplier is mapped' };
  const byPriority = [...mappings].sort((a, b) => a.priority - b.priority);
  const current = byPriority[0];
  const others = mappings.filter((m) => m.id !== current.id);
  const fit = fitness(current, ctx);
  const ranked = rankCandidates(others, ctx);
  const best = ranked[0] || null;

  if (fit.ok) {
    /* Fine, but is it now clearly dearer than a trustworthy alternative? */
    if (best && current.cost != null && best.cost != null
      && best.cost <= current.cost * (1 - FAILOVER.SAVING_PCT / 100)
      && (best.reliabilityPct == null || best.reliabilityPct >= FAILOVER.MIN_RELIABILITY)
      /* Not back to a supplier that failed a delivery today: after a failover
         the old supplier is usually the cheaper one, and moving back on price
         alone would bounce every order between the two. */
      && !(best.failStreak > 0)) {
      const pct = Math.round((1 - best.cost / current.cost) * 100);
      return {
        switch: true, current, to: best, code: REASON.TOO_EXPENSIVE,
        reason: `${current.supplierName} charges ${money(current.cost)}; ${best.supplierName} has it for `
          + `${money(best.cost)}, ${pct}% less`,
      };
    }
    return { switch: false, current, reason: 'the current supplier is fine' };
  }
  if (!best) {
    return { switch: false, current, unfit: fit, reason: `${fit.reason}, and no other supplier can take it` };
  }
  return { switch: true, current, to: best, code: fit.code, reason: fit.reason };
}

/* ── Against the database ──────────────────────────────────────────────── */

/**
 * Every mapping of a product, with what decide() needs: the supplier's state,
 * its delivery history (fulfilment rate, and the current run of failures).
 */
export async function mappingsFor(productId) {
  const rows = await all(
    `SELECT sp.id, sp.supplier_id, sp.supplier_sku, sp.supplier_url, sp.cost, sp.available_stock,
            sp.supplier_status AS sku_status, sp.priority,
            s.name AS supplier_name, s.status AS supplier_status, s.last_sync_status
       FROM supplier_products sp JOIN suppliers s ON s.id = sp.supplier_id
      WHERE sp.product_id = @p`, { p: productId });
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((r) => r.supplier_id))];
  const totals = await all(
    `SELECT supplier_id,
            COUNT(*) FILTER (WHERE status = 'fulfilled') AS ok,
            COUNT(*) FILTER (WHERE status = 'failed') AS bad
       FROM fulfillment_requests WHERE supplier_id = ANY(@ids) GROUP BY supplier_id`, { ids }).catch(() => []);
  const since = new Date(Date.now() - FAILOVER.ERROR_WINDOW_HOURS * 3_600_000).toISOString();
  const recent = await all(
    `SELECT supplier_id, status FROM fulfillment_requests
      WHERE supplier_id = ANY(@ids) AND created_at >= @since AND status IN ('fulfilled','failed')
      ORDER BY created_at DESC`, { ids, since }).catch(() => []);

  const stats = {};
  for (const t of totals) {
    const ok = Number(t.ok || 0);
    const bad = Number(t.bad || 0);
    stats[t.supplier_id] = { fulfilled: ok, failed: bad, reliabilityPct: ok + bad ? Math.round((ok / (ok + bad)) * 100) : null };
  }
  const streak = {};
  for (const r of recent) {
    if (streak[r.supplier_id]?.done) continue;
    streak[r.supplier_id] ??= { n: 0, done: false };
    if (r.status === 'failed') streak[r.supplier_id].n += 1;
    else streak[r.supplier_id].done = true;
  }

  return rows.map((r) => ({
    id: r.id, supplier_id: r.supplier_id, supplierName: r.supplier_name,
    supplierSku: r.supplier_sku, supplierUrl: r.supplier_url,
    supplierStatus: r.supplier_status, lastSyncStatus: r.last_sync_status,
    skuStatus: r.sku_status, stock: r.available_stock == null ? null : Number(r.available_stock),
    cost: r.cost == null ? null : Number(r.cost), priority: Number(r.priority),
    fulfilled: stats[r.supplier_id]?.fulfilled ?? 0,
    failed: stats[r.supplier_id]?.failed ?? 0,
    reliabilityPct: stats[r.supplier_id]?.reliabilityPct ?? null,
    failStreak: streak[r.supplier_id]?.n ?? 0,
  }));
}

const snapshot = (m) => (m ? {
  supplier: m.supplierName, cost: m.cost, stock: m.stock, skuStatus: m.skuStatus,
  reliabilityPct: m.reliabilityPct, fulfilled: m.fulfilled, failed: m.failed,
  failStreak: m.failStreak, supplierStatus: m.supplierStatus, lastSyncStatus: m.lastSyncStatus,
} : null);

/**
 * Put `to` in `from`'s place at the top of the list, and write it down.
 * Swapping, not renumbering: the old supplier keeps its mapping and its place
 * in the queue for when it recovers.
 */
async function applySwitch(productId, decision, { trigger, orderId = null }) {
  const { current: from, to } = decision;
  const top = from.priority;
  const newFrom = to.priority === top ? top + 1 : to.priority;
  await run(`UPDATE supplier_products SET priority = @p WHERE id = @id`, { p: top, id: to.id });
  await run(`UPDATE supplier_products SET priority = @p WHERE id = @id`, { p: newFrom, id: from.id });

  const id = newId('sws');
  await run(
    `INSERT INTO supplier_switches (id, product_id, from_supplier_id, to_supplier_id, from_mapping_id,
       to_mapping_id, reason_code, reason, detail, trigger, order_id, created_at)
     VALUES (@id, @p, @fs, @ts, @fm, @tm, @code, @reason, @detail, @trig, @o, @at)`,
    { id, p: productId, fs: from.supplier_id, ts: to.supplier_id, fm: from.id, tm: to.id,
      code: decision.code, reason: decision.reason,
      detail: JSON.stringify({ from: snapshot(from), to: snapshot(to) }),
      trig: trigger, o: orderId, at: nowIso() });

  const product = await get(`SELECT name FROM products WHERE id = @p`, { p: productId }).catch(() => null);
  const { audit } = await import('../auditService.js');
  await audit({ actor: null, action: 'supplier.switched', targetType: 'product', targetId: productId,
    metadata: { from: from.supplierName, to: to.supplierName, code: decision.code, trigger } }).catch(() => {});
  const { alertOwner } = await import('../notifyService.js');
  await alertOwner('supplier.switched', {
    key: `switch:${productId}:${to.supplier_id}:${nowIso().slice(0, 13)}`,
    title: `${product?.name || productId}: ${from.supplierName} → ${to.supplierName}`,
    lines: [`Why: ${decision.reason}.`, 'The next orders go to the new supplier automatically.'],
    url: `${config.appUrl}/admin/suppliers`,
  }).catch(() => {});
  return id;
}

/**
 * Look at one product, switch it if one of the four reasons applies, and say
 * which mapping should take the next order (or null when none can).
 *
 * `exclude` marks suppliers that just failed THIS delivery, so a failover never
 * hands the order straight back to the supplier that refused it.
 */
export async function evaluateProduct(productId, { trigger = 'sweep', orderId = null, exclude = [] } = {}) {
  let mappings = await mappingsFor(productId);
  if (!mappings.length) return { route: null, switched: null };
  if (exclude.length) {
    /* A supplier that just failed this delivery counts as erroring for this
       decision, whatever its history says. */
    mappings = mappings.map((m) => (exclude.includes(m.supplier_id)
      ? { ...m, failStreak: Math.max(m.failStreak, FAILOVER.ERROR_STREAK) } : m));
  }
  const product = await get(`SELECT price FROM products WHERE id = @p`, { p: productId });
  const ctx = { priceCents: product ? Number(product.price) : null };
  const decision = decide(mappings, ctx);

  let switched = null;
  let route = decision.current;
  if (decision.switch) {
    switched = await applySwitch(productId, decision, { trigger, orderId });
    route = decision.to;
  } else if (decision.unfit) {
    /* Nothing better. Too dear alone still routes to it — the margin guard at
       purchase time decides what happens to a loss — anything else does not. */
    route = decision.unfit.code === REASON.TOO_EXPENSIVE ? decision.current : null;
  }
  return { route, switched, decision: { code: decision.code || null, reason: decision.reason } };
}

/** Every product with at least one mapping, looked at once. For the sweep and after a sync. */
export async function sweepFailover({ limit = 500 } = {}) {
  const rows = await all(
    `SELECT DISTINCT product_id FROM supplier_products WHERE product_id IS NOT NULL LIMIT @l`, { l: limit });
  let switched = 0;
  for (const r of rows) {
    // eslint-disable-next-line no-await-in-loop -- one product at a time; each may write
    const out = await evaluateProduct(r.product_id, { trigger: 'sweep' }).catch(() => null);
    if (out?.switched) switched += 1;
  }
  return { checked: rows.length, switched };
}

/** The log, newest first, with names for the admin. */
export async function listSwitches({ limit = 100 } = {}) {
  const rows = await all(
    `SELECT w.*, p.name AS product_name, fs.name AS from_name, ts.name AS to_name
       FROM supplier_switches w
       LEFT JOIN products p ON p.id = w.product_id
       LEFT JOIN suppliers fs ON fs.id = w.from_supplier_id
       LEFT JOIN suppliers ts ON ts.id = w.to_supplier_id
      ORDER BY w.created_at DESC LIMIT @l`, { l: limit }).catch(() => []);
  return rows.map((r) => {
    let detail = {};
    try { detail = JSON.parse(r.detail || '{}'); } catch { detail = {}; }
    return {
      id: r.id, at: r.created_at, productId: r.product_id, productName: r.product_name,
      from: { id: r.from_supplier_id, name: r.from_name }, to: { id: r.to_supplier_id, name: r.to_name },
      code: r.reason_code, reason: r.reason, trigger: r.trigger, orderId: r.order_id, detail,
    };
  });
}
