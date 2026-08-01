/**
 * Public, unauthenticated trust stats for the storefront (orders delivered,
 * average delivery time, catalogue size, Discord members, and a feed of recent
 * deliveries for social proof).
 *
 * REAL DATA ONLY — no baseline padding or sample feed. A brand-new store reports
 * zeros and the UI degrades gracefully (the homepage hides empty counters). Every
 * query is still wrapped so a transient DB issue never breaks the page.
 */
import { get, all } from '../db/index.js';
import { config } from '../config/env.js';
import { reviewStats } from './reviewsService.js';
import { getServerInfo } from './discordService.js';

async function safe(fn, fallback) {
  try { const v = await fn(); return v == null ? fallback : v; }
  catch { return fallback; }
}

export async function publicStats() {
  const delivered = await safe(async () => {
    const r = await get(`SELECT COUNT(*) AS n FROM orders WHERE status='completed'`);
    return Number(r?.n || 0);
  }, 0);

  // Real customers = distinct people who have actually ordered (incl. guests).
  const customers = await safe(async () => {
    const r = await get(`SELECT COUNT(DISTINCT email) AS n FROM orders`);
    return Number(r?.n || 0);
  }, 0);

  const products = await safe(async () => {
    const r = await get(`SELECT COUNT(*) AS n FROM products WHERE active = 1`);
    return Number(r?.n || 0);
  }, 0);

  // Average delivery time = completed_at − created_at over recent completed orders.
  const avgDeliverySeconds = await safe(async () => {
    const rows = await all(
      `SELECT created_at, updated_at FROM orders WHERE status='completed' ORDER BY updated_at DESC LIMIT 200`);
    if (!rows?.length) return null;
    const secs = rows
      .map((r) => (new Date(r.updated_at) - new Date(r.created_at)) / 1000)
      .filter((s) => s > 0 && s < 86_400);
    if (!secs.length) return null;
    return Math.max(1, Math.round(secs.reduce((a, b) => a + b, 0) / secs.length));
  }, null);

  // Recent real deliveries for the ticker (empty when there are none).
  const recent = await safe(async () => {
    const rows = await all(
      `SELECT oi.name AS item, p.category AS cat, o.updated_at AS at
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         LEFT JOIN products p ON p.id = oi.product_id
        WHERE o.status='completed'
        ORDER BY o.updated_at DESC LIMIT 8`);
    const now = Date.now();
    return (rows || []).map((r) => ({
      item: r.item,
      cat: r.cat || '',
      secondsAgo: Math.max(3, Math.round((now - new Date(r.at)) / 1000)),
    }));
  }, []);

  // The homepage renders this with a pulsing green dot and the word "online", so
  // it had better be live. It used to read only DISCORD_MEMBER_COUNT — a number
  // typed in by hand — while the real presence count from Discord's widget was
  // already available two files away and simply unused. Live first, cached by
  // getServerInfo(); the env var stays as the fallback for a guild with its
  // widget switched off.
  const discordMembers = await safe(async () => {
    const info = await getServerInfo();
    return Number(info?.online ?? 0) || Number(config.discord?.memberCount || 0);
  }, Number(config.discord?.memberCount || 0));

  // Real fulfilment success rate = completed ÷ (completed + refunded + cancelled
  // + failed). Null until there are finished orders (so the UI can hide it).
  const successRate = await safe(async () => {
    const r = await get(
      `SELECT COUNT(*) FILTER (WHERE status='completed') AS ok,
              COUNT(*) FILTER (WHERE status IN ('completed','refunded','cancelled','failed')) AS finished
         FROM orders`);
    const finished = Number(r?.finished || 0);
    if (!finished) return null;
    return Math.round((Number(r.ok) / finished) * 1000) / 10;
  }, null);

  // Real review aggregates only.
  const rev = await safe(() => reviewStats(), { count: 0, average: 0 });

  return {
    delivered,
    customers,
    products,
    avgDeliverySeconds,                 // null when there are no completed orders yet
    successRate,                        // null until orders have finished
    rating: rev.count ? rev.average : null,
    reviews: rev.count,
    discordMembers,                     // 0 unless DISCORD_MEMBER_COUNT is set
    recent,
    realDelivered: delivered,
  };
}
