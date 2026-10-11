/**
 * Public, unauthenticated trust stats for the storefront (orders delivered,
 * delivery time, delivery success rate, catalogue size, Discord presence, and a
 * feed of recent deliveries).
 *
 * REAL DATA ONLY — no baseline padding or sample feed. A brand-new store reports
 * zeros and nulls and the UI hides what it has nothing for. Every query is still
 * wrapped so a transient DB issue never breaks the page.
 *
 * Every order figure here is made of the same real sales as the feeds
 * (socialProofService): money changed hands, not a demo or test-key payment,
 * not the shop's own order. A median or a percentage waits for MIN_SAMPLE
 * orders and says how many it is over — the page shows that number with it.
 */
import { get } from '../db/index.js';
import { reviewStats } from './reviewsService.js';
import { getServerInfo } from './discordService.js';
import { RETIRED_KINDS } from './productService.js';
import { PAID, notHouseOrder, deliveryTimes, liveFeed, MIN_SAMPLE } from './socialProofService.js';

async function safe(fn, fallback) {
  try { const v = await fn(); return v == null ? fallback : v; }
  catch { return fallback; }
}

export async function publicStats() {
  /* Independent reads, issued as one wave rather than one after another.

     Nothing here depends on anything else here — they are separate aggregates
     plus one outbound call to Discord — so a sequence would cost a serialized
     round trip each, which is essentially the whole latency of this endpoint
     from a function talking to a database in another region.

     `safe()` still wraps each one individually, so a single failing aggregate
     falls back to its own default and every other number still renders. */
  const [sales, products, delivery, recent, discordOnline, success, rev] = await Promise.all([
  // Real sales still completed, and the distinct people who bought them.
  safe(() => get(
    `SELECT COUNT(*) AS delivered, COUNT(DISTINCT LOWER(o.email)) AS customers
       FROM orders o WHERE o.status = 'completed' AND ${PAID} AND ${notHouseOrder()}`),
  { delivered: 0, customers: 0 }),

  // What a customer can actually buy: a retired kind is off the shelf even when its row says active.
  safe(async () => {
    const r = await get(`SELECT COUNT(*) AS n FROM products WHERE active = 1 AND kind <> ALL(@retired)`,
      { retired: [...RETIRED_KINDS] });
    return Number(r?.n || 0);
  }, 0),

  /* Payment → delivery, the median over the latest real deliveries. This was
     the mean of updated_at − created_at over every completed order: it timed
     the buyer's own wait before paying, any later edit to the order, test and
     staff orders alike, and dropped every delivery slower than a day. */
  safe(() => deliveryTimes(), { sample: 0, median: null }),

  // Recent real deliveries: the live feed's own rows, under the same rules.
  safe(async () => (await liveFeed({ limit: 8 })).map((r) => ({
    item: r.item, cat: r.category, secondsAgo: r.secondsAgo,
  })), []),

  /* Discord's own live presence count — the number of members online now, so
     that is what it is called. It used to fall back to DISCORD_MEMBER_COUNT,
     a number typed in by hand, under the same field: one figure meaning "online
     now" or "members" depending on whether the widget answered, shown on the
     Trust page as "members". Unavailable is null, and nothing is shown. */
  safe(async () => {
    const n = Number((await getServerInfo())?.online);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, null),

  /* Delivered ÷ settled PAID orders. Cancelled-before-payment orders used to
     count against it and free, test and staff orders for it; neither says
     anything about whether a buyer who paid got what they paid for. */
  safe(() => get(
    `SELECT COUNT(*) FILTER (WHERE o.status = 'completed') AS ok, COUNT(*) AS settled
       FROM orders o
      WHERE o.status IN ('completed', 'refunded', 'cancelled', 'failed')
        AND ${PAID} AND ${notHouseOrder()}
        AND (o.payment_status IN ('paid', 'refunded')
             OR EXISTS (SELECT 1 FROM order_status_history h
                         WHERE h.order_id = o.id AND h.to_status = 'payment_received'))`),
  { ok: 0, settled: 0 }),

  // Verified buyers' reviews only (see reviewStats).
  safe(() => reviewStats(), { count: 0, average: 0 }),
  ]);

  const delivered = Number(sales.delivered || 0);
  const settled = Number(success.settled || 0);
  const rated = settled >= MIN_SAMPLE;
  return {
    delivered,
    customers: Number(sales.customers || 0),
    products,
    medianDeliverySeconds: delivery.median,   // null below MIN_SAMPLE timed orders
    deliverySample: delivery.sample,          // how many orders that median is over
    successRate: rated ? Math.round((Number(success.ok) / settled) * 1000) / 10 : null,
    successSample: rated ? settled : 0,
    rating: rev.count ? rev.average : null,
    reviews: rev.count,
    discordOnline,                            // null unless Discord's widget answered
    recent,
    realDelivered: delivered,
  };
}
