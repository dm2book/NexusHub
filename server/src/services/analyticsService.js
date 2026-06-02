/**
 * Analytics aggregations computed directly from live order data (no mock data).
 * Revenue counts only paid, non-refunded orders.
 */
import { get, all } from '../db/index.js';
import { formatMoney } from '../utils/money.js';

const PAID = "status IN ('payment_received','processing','awaiting_fulfillment','completed')";

export function overview({ days = 30 } = {}) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const revenue = get(
    `SELECT COALESCE(SUM(total),0) AS cents, COUNT(*) AS orders
       FROM orders WHERE ${PAID} AND created_at > @since`, { since });

  const allOrders = get(
    `SELECT COUNT(*) AS n FROM orders WHERE created_at > @since`, { since }).n;
  const completed = get(
    `SELECT COUNT(*) AS n FROM orders WHERE status='completed' AND created_at > @since`,
    { since }).n;
  const refunded = get(
    `SELECT COALESCE(SUM(total),0) AS cents FROM orders
      WHERE status='refunded' AND created_at > @since`, { since }).cents;

  // Conversion rate = paid orders / total orders placed in window.
  const conversionRate = allOrders ? Math.round((revenue.orders / allOrders) * 1000) / 10 : 0;
  const aov = revenue.orders ? Math.round(revenue.cents / revenue.orders) : 0;

  return {
    rangeDays: days,
    revenue: revenue.cents,
    revenueFormatted: formatMoney(revenue.cents),
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

export function revenueSeries({ days = 30 } = {}) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = all(
    `SELECT substr(created_at,1,10) AS day,
            COALESCE(SUM(total),0) AS cents, COUNT(*) AS orders
       FROM orders WHERE ${PAID} AND created_at > @since
      GROUP BY day ORDER BY day ASC`, { since });
  return rows.map((r) => ({ day: r.day, revenue: r.cents, orders: r.orders }));
}

export function topProducts({ days = 90, limit = 10 } = {}) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return all(
    `SELECT oi.product_id, oi.name,
            SUM(oi.quantity) AS units,
            SUM(oi.quantity * oi.unit_price) AS revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE ${PAID.replace(/status/g, 'o.status')} AND o.created_at > @since
      GROUP BY oi.product_id, oi.name
      ORDER BY revenue DESC LIMIT @limit`, { since, limit })
    .map((r) => ({ ...r, revenueFormatted: formatMoney(r.revenue) }));
}

/** Customer Lifetime Value leaderboard + aggregate average. */
export function customerLifetimeValue({ limit = 10 } = {}) {
  const rows = all(
    `SELECT email,
            COUNT(*) AS orders,
            COALESCE(SUM(total),0) AS ltv
       FROM orders WHERE ${PAID}
      GROUP BY email ORDER BY ltv DESC LIMIT @limit`, { limit });
  const agg = get(
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
