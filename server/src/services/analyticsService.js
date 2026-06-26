/**
 * Analytics aggregations computed directly from live order data (no mock data).
 * Revenue counts only paid, non-refunded orders.
 */
import { get, all } from '../db/index.js';
import { formatMoney } from '../utils/money.js';

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

  const conversionRate = allOrders ? Math.round((revenue.orders / allOrders) * 1000) / 10 : 0;
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
    conversionRate,
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
