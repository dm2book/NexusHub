/**
 * Analytics aggregations computed directly from live order data (no mock data).
 * Revenue counts only paid, non-refunded orders.
 */
import { get, all } from '../db/index.js';
import { formatMoney } from '../utils/money.js';
import { visitorStats } from './trackingService.js';

const PAID = "status IN ('payment_received','processing','awaiting_fulfillment','completed')";

export async function overview({ days = 30 } = {}) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const revenue = await get(
    `SELECT COALESCE(SUM(total),0) AS cents, COUNT(*) AS orders
       FROM orders WHERE ${PAID} AND created_at > @since`, { since });
  const allOrders = (await get(
    `SELECT COUNT(*) AS n FROM orders WHERE created_at > @since`, { since })).n;
  const completed = (await get(
    `SELECT COUNT(*) AS n FROM orders WHERE status='completed' AND created_at > @since`,
    { since })).n;
  const refunded = (await get(
    `SELECT COALESCE(SUM(total),0) AS cents FROM orders
      WHERE status='refunded' AND created_at > @since`, { since })).cents;

  // True conversion = paid orders ÷ real unique visitors. Until we have visitor
  // data in the window, fall back to paid ÷ total orders (clearly labelled).
  const { uniqueVisitors, pageViews } = await visitorStats({ days });
  const conversionBasis = uniqueVisitors > 0 ? 'visitors' : 'orders';
  const conversionDenom = uniqueVisitors > 0 ? uniqueVisitors : allOrders;
  const conversionRate = conversionDenom ? Math.round((revenue.orders / conversionDenom) * 1000) / 10 : 0;
  const aov = revenue.orders ? Math.round(revenue.cents / revenue.orders) : 0;

  // Gross profit = paid revenue − supplier cost. Each product's unit cost is
  // stored in metadata.cost (cents); items without a cost contribute 0.
  const cost = await supplierCost(since);
  const profit = Math.max(0, revenue.cents - cost);
  const margin = revenue.cents ? Math.round((profit / revenue.cents) * 1000) / 10 : 0;

  return {
    rangeDays: days,
    revenue: revenue.cents,
    revenueFormatted: formatMoney(revenue.cents),
    cost,
    costFormatted: formatMoney(cost),
    profit,
    profitFormatted: formatMoney(profit),
    margin,
    paidOrders: revenue.orders,
    totalOrders: allOrders,
    completedOrders: completed,
    refundedAmount: refunded,
    refundedFormatted: formatMoney(refunded),
    uniqueVisitors,
    pageViews,
    conversionRate,
    conversionBasis,
    averageOrderValue: aov,
    averageOrderValueFormatted: formatMoney(aov),
  };
}

/** Total supplier cost of paid order items since `since` (from product metadata.cost). */
async function supplierCost(since) {
  const items = await all(
    `SELECT oi.product_id AS pid, oi.quantity AS qty
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE ${PAID} AND o.created_at > @since`, { since });
  if (!items.length) return 0;
  const costMap = {};
  for (const id of [...new Set(items.map((i) => i.pid).filter(Boolean))]) {
    const p = await get(`SELECT metadata FROM products WHERE id=@id`, { id });
    try { costMap[id] = Number(JSON.parse(p?.metadata || '{}').cost) || 0; } catch { costMap[id] = 0; }
  }
  return items.reduce((s, i) => s + (costMap[i.pid] || 0) * (i.qty || 1), 0);
}

export async function revenueSeries({ days = 30 } = {}) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await all(
    `SELECT substr(created_at,1,10) AS day,
            COALESCE(SUM(total),0) AS cents, COUNT(*) AS orders
       FROM orders WHERE ${PAID} AND created_at > @since
      GROUP BY day ORDER BY day ASC`, { since });
  return rows.map((r) => ({ day: r.day, revenue: r.cents, orders: r.orders }));
}

export async function topProducts({ days = 90, limit = 10 } = {}) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await all(
    `SELECT oi.product_id, oi.name,
            SUM(oi.quantity) AS units,
            SUM(oi.quantity * oi.unit_price) AS revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE ${PAID.replace(/status/g, 'o.status')} AND o.created_at > @since
      GROUP BY oi.product_id, oi.name
      ORDER BY revenue DESC LIMIT @limit`, { since, limit });
  return rows.map((r) => ({ ...r, revenueFormatted: formatMoney(r.revenue) }));
}

/** Customer Lifetime Value leaderboard + aggregate average. */
export async function customerLifetimeValue({ limit = 10 } = {}) {
  const rows = await all(
    `SELECT email, COUNT(*) AS orders, COALESCE(SUM(total),0) AS ltv
       FROM orders WHERE ${PAID}
      GROUP BY email ORDER BY ltv DESC LIMIT @limit`, { limit });
  const agg = await get(
    `SELECT COUNT(DISTINCT email) AS customers, COALESCE(SUM(total),0) AS revenue
       FROM orders WHERE ${PAID}`);
  const avgLtv = agg.customers ? Math.round(agg.revenue / agg.customers) : 0;
  return {
    averageLtv: avgLtv,
    averageLtvFormatted: formatMoney(avgLtv),
    customers: agg.customers,
    top: rows.map((r) => ({ ...r, ltvFormatted: formatMoney(r.ltv) })),
  };
}

export function statusBreakdown() {
  return all(`SELECT status, COUNT(*) AS n FROM orders GROUP BY status`);
}

/** Retention analytics: repeat-rate, loyalty tier mix, Forge+ members, affiliate. */
export async function retentionMetrics() {
  const now = new Date().toISOString();

  const repeat = await get(`
    SELECT COUNT(*) AS with_orders, COUNT(*) FILTER (WHERE c >= 2) AS repeat_customers
      FROM (SELECT user_id, COUNT(*) c FROM orders
             WHERE user_id IS NOT NULL AND ${PAID} GROUP BY user_id) t`);

  const tiers = await get(`
    WITH spend AS (
      SELECT user_id, COALESCE(SUM(total),0) AS s FROM orders
       WHERE user_id IS NOT NULL AND ${PAID} GROUP BY user_id)
    SELECT
      COUNT(*) FILTER (WHERE s >= 200000) AS platinum,
      COUNT(*) FILTER (WHERE s >= 50000  AND s < 200000) AS gold,
      COUNT(*) FILTER (WHERE s >= 10000  AND s < 50000)  AS silver,
      COUNT(*) FILTER (WHERE s < 10000) AS bronze
      FROM spend`);

  const members = await get(`SELECT COUNT(*) AS n FROM users WHERE membership_until > @now`, { now });
  const totalCustomers = (await get(`SELECT COUNT(*) AS n FROM users`)).n;

  let affiliate = { referrals: 0, total: 0, owed: 0 };
  try {
    const a = await get(`
      SELECT COUNT(DISTINCT referred_id) AS referrals,
             COALESCE(SUM(commission),0) AS total,
             COALESCE(SUM(commission) FILTER (WHERE status IN ('pending','approved')),0) AS owed
        FROM referral_events`);
    affiliate = { referrals: Number(a?.referrals || 0), total: Number(a?.total || 0), owed: Number(a?.owed || 0) };
  } catch { /* table may not exist on very old DBs */ }

  const withOrders = Number(repeat?.with_orders || 0);
  const repeatCustomers = Number(repeat?.repeat_customers || 0);
  return {
    totalCustomers: Number(totalCustomers || 0),
    customersWithOrders: withOrders,
    repeatCustomers,
    repeatRate: withOrders ? Math.round((repeatCustomers / withOrders) * 1000) / 10 : 0,
    activeMembers: Number(members?.n || 0),
    tiers: {
      bronze: Number(tiers?.bronze || 0), silver: Number(tiers?.silver || 0),
      gold: Number(tiers?.gold || 0), platinum: Number(tiers?.platinum || 0),
    },
    affiliate: {
      referrals: affiliate.referrals,
      commissionTotal: affiliate.total,
      commissionTotalFormatted: formatMoney(affiliate.total),
      commissionOwed: affiliate.owed,
      commissionOwedFormatted: formatMoney(affiliate.owed),
    },
  };
}
