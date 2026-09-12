/**
 * Profit, which is a different question from revenue and a harder one.
 *
 * ── WHAT WAS WRONG WITH THE ONE NUMBER THAT EXISTED ───────────────────────
 * analyticsService.overview() already reported a profit and a margin. Both were
 * wrong in the same direction, and both were wrong in a way that looks fine:
 *
 *   costMap[id] = (await costCentsFor(id)) ?? 0
 *
 * A product with no cost entered contributed ZERO cost. This shop has a cost on
 * none of its products, so the page reported a 100% margin — a confident,
 * precise, entirely invented number. And:
 *
 *   const profit = Math.max(0, revenue - cost)
 *
 * A loss was displayed as break-even. A profit dashboard that cannot show a
 * loss is worse than no dashboard, because it is trusted.
 *
 * ── THE RULE HERE ─────────────────────────────────────────────────────────
 * An unknown cost is UNKNOWN. It is never zero.
 *
 * Revenue is counted over everything sold. Cost, profit and margin are counted
 * only over the units whose cost we actually know, and every figure carries the
 * COVERAGE it was computed from. A margin over 3 of 200 units is a real number
 * about 3 units and a fantasy about the shop, and the only way to tell the
 * difference is to publish the denominator.
 *
 * Losses are shown as losses.
 */
import { all, get } from '../db/index.js';
import { costCentsFor } from './costService.js';
import { config } from '../config/env.js';
import { formatMoney } from '../utils/money.js';

/* The same statuses analyticsService counts as money in. A pending order is not
   revenue and a refunded one is not either. */
const PAID = "status IN ('payment_received','processing','awaiting_fulfillment','completed')";

/**
 * The start of today, this week and this month — in the shop's own timezone.
 *
 * UTC is the wrong answer for a Dutch shop. Between midnight and 02:00 local in
 * summer, "today" in UTC is still yesterday, so the owner opens the dashboard
 * after a late sale and sees it counted against the wrong day. Amsterdam is
 * UTC+1/+2 depending on the season, which is exactly why this asks Intl rather
 * than adding an offset.
 *
 * The week starts on Monday, which is what a Dutch week does.
 */
export function periodBounds({ now = Date.now(), tz = config.timezone || 'Europe/Amsterdam' } = {}) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = (t) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return { y: +p.year, m: +p.month, d: +p.day, H: +p.hour % 24, M: +p.minute, S: +p.second };
  };

  /* The UTC instant of local midnight on a given local date. Found by asking
     what the offset IS at roughly that moment rather than assuming one, so the
     two days a year the clocks move do not shift the boundary by an hour. */
  const localMidnightUtc = (y, m, d) => {
    const guess = Date.UTC(y, m - 1, d, 12, 0, 0);          // midday, never ambiguous
    const p = parts(guess);
    const offsetMs = Date.UTC(p.y, p.m - 1, p.d, p.H, p.M, p.S) - guess;
    return Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMs;
  };

  const t = parts(now);
  const todayUtc = localMidnightUtc(t.y, t.m, t.d);
  // Day of the week of the local date, Monday = 0.
  const dow = (new Date(Date.UTC(t.y, t.m - 1, t.d)).getUTCDay() + 6) % 7;
  const weekDate = new Date(Date.UTC(t.y, t.m - 1, t.d - dow));
  const weekUtc = localMidnightUtc(
    weekDate.getUTCFullYear(), weekDate.getUTCMonth() + 1, weekDate.getUTCDate());
  const monthUtc = localMidnightUtc(t.y, t.m, 1);

  return {
    tz,
    today: new Date(todayUtc).toISOString(),
    week: new Date(weekUtc).toISOString(),
    month: new Date(monthUtc).toISOString(),
  };
}

/** Every paid line since a moment, with the product it was. */
async function linesSince(since) {
  return all(
    `SELECT oi.product_id AS pid, oi.name AS name, oi.quantity AS qty,
            oi.unit_price AS unit_price, o.id AS order_id
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE ${PAID.replace(/status/g, 'o.status')} AND o.created_at >= @since`, { since });
}

/** Unit cost per product id, in cents. NULL where we do not know it. */
async function costMapFor(lines) {
  const ids = [...new Set(lines.map((l) => l.pid).filter(Boolean))];
  const out = {};
  for (const id of ids) out[id] = await costCentsFor(id);   // null stays null
  return out;
}

/**
 * Roll a set of lines into one period's figures.
 *
 * Revenue covers everything. Cost, profit and margin cover only what we can
 * price, and `coverage` says how much of the revenue that was.
 */
export function rollUp(lines, costMap) {
  let revenue = 0; let units = 0;
  let costedRevenue = 0; let cost = 0; let costedUnits = 0;
  const orders = new Set();

  for (const l of lines) {
    const qty = Number(l.qty) || 0;
    const line = (Number(l.unit_price) || 0) * qty;
    revenue += line;
    units += qty;
    if (l.order_id) orders.add(l.order_id);
    const unitCost = costMap[l.pid];
    // null and undefined are unknown. Zero is a real, free product.
    if (unitCost != null) {
      costedRevenue += line;
      cost += unitCost * qty;
      costedUnits += qty;
    }
  }

  const profit = costedRevenue - cost;
  return {
    revenue,
    orders: orders.size,
    units,
    /* Cost and profit describe the COSTED part of the period only. Reported
       beside the revenue they came from, so a margin can never be read against
       a revenue it was not computed over. */
    cost,
    costedRevenue,
    profit,
    marginPct: costedRevenue > 0 ? Math.round((profit / costedRevenue) * 1000) / 10 : null,
    coverage: {
      units: costedUnits,
      unitsTotal: units,
      revenue: costedRevenue,
      revenueTotal: revenue,
      pct: revenue > 0 ? Math.round((costedRevenue / revenue) * 1000) / 10 : null,
      complete: units > 0 && costedUnits === units,
    },
  };
}

/**
 * Per product: what it sold, what it cost, and what it left behind.
 *
 * A product with no cost gets `null` for cost, profit and margin — never a
 * zero. Its revenue is still counted, because it really was earned.
 */
export function perProduct(lines, costMap) {
  const by = new Map();
  for (const l of lines) {
    const key = l.pid || `name:${l.name}`;
    const qty = Number(l.qty) || 0;
    const cur = by.get(key) || {
      productId: l.pid || null, name: l.name, units: 0, revenue: 0,
      unitCostCents: l.pid ? costMap[l.pid] ?? null : null,
    };
    cur.units += qty;
    cur.revenue += (Number(l.unit_price) || 0) * qty;
    by.set(key, cur);
  }

  return [...by.values()].map((p) => {
    const known = p.unitCostCents != null;
    const cost = known ? p.unitCostCents * p.units : null;
    const profit = known ? p.revenue - cost : null;
    return {
      ...p,
      cost,
      profit,
      marginPct: known && p.revenue > 0 ? Math.round((profit / p.revenue) * 1000) / 10 : null,
      revenueFormatted: formatMoney(p.revenue),
      costFormatted: known ? formatMoney(cost) : null,
      profitFormatted: known ? formatMoney(profit) : null,
    };
  });
}

/**
 * What is wrong, per product.
 *
 * Three different problems, and they are not the same severity:
 *
 *   LOSS                 sold below what it cost. Every unit sold loses money.
 *   BELOW_MINIMUM_MARGIN profitable, but under the floor the pricing engine
 *                        refuses to price below — the same number, so the two
 *                        cannot disagree about what "too thin" means.
 *   NO_COST              not a pricing problem: an unknown. It is listed
 *                        because a shop that cannot see it has no idea whether
 *                        the first two apply.
 */
export function warningsFor(products, { minimumMarginPercent = config.market.minimumMarginPercent } = {}) {
  const out = [];
  for (const p of products) {
    if (p.unitCostCents == null) {
      out.push({
        code: 'NO_COST', productId: p.productId, name: p.name, severity: 'unknown',
        detail: `${p.name} sold ${p.units} unit(s) for ${formatMoney(p.revenue)} and has no cost `
          + 'entered — its profit is unknown, not zero.',
      });
      continue;
    }
    if (p.profit < 0) {
      out.push({
        code: 'LOSS', productId: p.productId, name: p.name, severity: 'loss',
        detail: `${p.name} lost ${formatMoney(Math.abs(p.profit))} over ${p.units} unit(s) — `
          + `it sells for ${formatMoney(Math.round(p.revenue / Math.max(p.units, 1)))} and costs `
          + `${formatMoney(p.unitCostCents)}.`,
      });
    } else if (p.marginPct != null && p.marginPct < minimumMarginPercent) {
      out.push({
        code: 'BELOW_MINIMUM_MARGIN', productId: p.productId, name: p.name, severity: 'thin',
        detail: `${p.name} is at ${p.marginPct}%, under the ${minimumMarginPercent}% minimum — `
          + `${formatMoney(p.profit)} on ${formatMoney(p.revenue)}.`,
      });
    }
  }
  /* Losses first: one product sold below cost costs money on every sale, and a
     thin margin merely earns less than it should. */
  const rank = { loss: 0, thin: 1, unknown: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]
    || Math.abs(b.profit ?? 0) - Math.abs(a.profit ?? 0));
}

/** The three leaderboards, each over the products that can populate it. */
export function leaderboards(products, { limit = 10 } = {}) {
  const costed = products.filter((p) => p.profit != null);
  return {
    profit: [...costed].sort((a, b) => b.profit - a.profit).slice(0, limit),
    revenue: [...products].sort((a, b) => b.revenue - a.revenue).slice(0, limit),
    /* Margin is ranked over costed products only, and a product that sold
       nothing has no margin to rank — an empty leaderboard is the honest
       answer to "which products have the best margin" in a shop that has not
       sold anything. */
    margin: costed.filter((p) => p.marginPct != null)
      .sort((a, b) => b.marginPct - a.marginPct).slice(0, limit),
  };
}

/**
 * The dashboard: three periods, every product, three leaderboards, and what is
 * wrong.
 */
export async function profitDashboard({ now = Date.now(), tz, limit = 10 } = {}) {
  const bounds = periodBounds({ now, tz });
  // One query for the longest window; the shorter ones are filtered from it.
  const monthLines = await linesSince(bounds.month);
  const costMap = await costMapFor(monthLines);

  /* `created_at` is not on the line, so the period split is done by re-reading
     the orders in range rather than by guessing. One extra query, and it is the
     difference between "this week" meaning this week and meaning something
     close to it. */
  const inRange = async (since) => {
    if (since === bounds.month) return monthLines;
    const ids = await all(
      `SELECT id FROM orders WHERE ${PAID} AND created_at >= @since`, { since });
    const keep = new Set(ids.map((r) => r.id));
    return monthLines.filter((l) => keep.has(l.order_id));
  };

  const [todayLines, weekLines] = await Promise.all([inRange(bounds.today), inRange(bounds.week)]);
  const products = perProduct(monthLines, costMap);

  const periods = {
    today: rollUp(todayLines, costMap),
    week: rollUp(weekLines, costMap),
    month: rollUp(monthLines, costMap),
  };

  /* Catalogue coverage is a different question from sales coverage: how much of
     what we SELL has a cost, versus how much of what we STOCK does. A shop can
     have one costed product that happens to be the only thing selling. */
  const cat = await get(
    `SELECT COUNT(*) AS n FROM products WHERE active = 1`).catch(() => ({ n: 0 }));
  const catalogueCosted = await (async () => {
    const rows = await all(`SELECT id FROM products WHERE active = 1`).catch(() => []);
    let n = 0;
    for (const r of rows) if ((await costCentsFor(r.id)) != null) n += 1;
    return n;
  })();

  return {
    generatedAt: new Date(now).toISOString(),
    bounds,
    periods,
    /* The headline margin, over the month and over costed revenue only. Null
       rather than 0 when nothing costed has sold: no margin is a different
       answer from a margin of zero. */
    averageMarginPct: periods.month.marginPct,
    products: products.sort((a, b) => b.revenue - a.revenue),
    top: leaderboards(products, { limit }),
    warnings: warningsFor(products),
    catalogue: {
      active: Number(cat?.n || 0),
      withCost: catalogueCosted,
      pct: Number(cat?.n) ? Math.round((catalogueCosted / Number(cat.n)) * 1000) / 10 : null,
    },
    minimumMarginPercent: config.market.minimumMarginPercent,
  };
}
