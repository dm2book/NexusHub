/**
 * The launch command centre: ten numbers about right now, in one snapshot.
 *
 * ── WHAT "REALTIME" MEANS HERE, HONESTLY ──────────────────────────────────
 * There is no push. This shop is one serverless function on Vercel, where a
 * held-open SSE stream is an invocation billed by the second and killed at the
 * function's max duration — so a stream would drop on a timer and the page
 * would show a frozen number while looking live. Polling a cheap endpoint and
 * SAYING HOW OLD THE ANSWER IS is the honest version of the same thing.
 *
 * Which is why every payload carries `generatedAt` and `tookMs`, and why the
 * page renders the age rather than the word "live". A dashboard that claims
 * freshness it does not have is the same failure as one that claims a margin it
 * cannot compute.
 *
 * The endpoint is therefore built to be CHEAP: nine grouped queries for the
 * whole board, no per-product round trips, nothing that scans a table without a
 * date bound. Polling something expensive is how a live page takes the shop
 * down on its busiest day.
 *
 * ── THE RULES IT INHERITS ─────────────────────────────────────────────────
 *  · An unknown cost is unknown, never zero — so profit carries its coverage.
 *  · New + returning must PARTITION the day's buyers exactly. Anything else is
 *    two numbers that do not add up, on a screen where they sit side by side.
 *  · A buyer is an EMAIL, not a user row. Most orders here are guest checkouts
 *    with `user_id` NULL; counting user ids would report every guest as new,
 *    forever, and returning customers as zero.
 *  · A refund and a chargeback are opposite facts about the same money and are
 *    never summed.
 *  · Low stock is measured with `stockTierFor`, the function that already
 *    decides when Discord gets woken up.
 */
import { all, get } from '../db/index.js';
import { config } from '../config/env.js';
import { periodBounds, rollUp } from './profitService.js';
import { costCentsForMany } from './costService.js';
import { stockTierFor } from './codeStockService.js';

/* The same set profitService and analyticsService call money in. Kept as one
   string so a status added in one place cannot quietly mean revenue on one
   screen and not on another. */
const PAID = "('payment_received','processing','awaiting_fulfillment','completed')";

/** How long before the page should stop calling its own numbers current. */
export const STALE_AFTER_SECONDS = 60;

/**
 * A paid order that has not been delivered and is old enough to be a problem.
 *
 * Not a config knob by accident: below this, an order in flight looks identical
 * to an order that failed, and a command centre that cries about every order in
 * its first minute trains you to ignore it.
 */
export const UNDELIVERED_AFTER_MINUTES = 15;

const n = (v) => Number(v || 0);

/**
 * New versus returning, over the day's buyers.
 *
 * Both halves come from ONE query so they cannot disagree: a buyer is new when
 * the earliest paid order under their email is itself from today. Anyone
 * ordering twice today is one buyer, counted once, in whichever half they
 * belong to — which is what makes new + returning = buyers.
 */
export async function customersToday(since) {
  const rows = await all(
    `WITH first_order AS (
       SELECT LOWER(email) AS who, MIN(created_at) AS first_at
         FROM orders WHERE status IN ${PAID}
        GROUP BY LOWER(email)
     )
     SELECT f.first_at >= @since AS is_new, COUNT(*)::int AS n
       FROM (SELECT DISTINCT LOWER(email) AS who FROM orders
              WHERE status IN ${PAID} AND created_at >= @since) t
       JOIN first_order f ON f.who = t.who
      GROUP BY 1`, { since }).catch(() => []);

  let isNew = 0; let returning = 0;
  for (const r of rows) (r.is_new ? (isNew = n(r.n)) : (returning = n(r.n)));
  return { new: isNew, returning, buyers: isNew + returning };
}

/**
 * Deliveries that did not happen — in both of the ways they can fail.
 *
 * A failed `fulfillment_requests` row is the loud one. The expensive one is
 * silent: an order that was PAID and never got as far as a fulfilment row at
 * all — no supplier mapped, no codes on the shelf, nothing to raise a failure
 * against. Nothing anywhere counts those, and they are the ones the customer
 * emails you about.
 */
export async function failedDeliveries(since, { now = Date.now() } = {}) {
  const cutoff = new Date(now - UNDELIVERED_AFTER_MINUTES * 60_000).toISOString();
  const [fr, stuck] = await Promise.all([
    get(`SELECT COUNT(*) FILTER (WHERE status = 'failed' AND updated_at >= @since)::int AS today,
                COUNT(*) FILTER (WHERE status = 'failed')::int                        AS open
           FROM fulfillment_requests`, { since }).catch(() => null),
    get(`SELECT COUNT(*)::int AS n, MIN(created_at) AS oldest
           FROM orders o
          WHERE o.status IN ('payment_received','processing','awaiting_fulfillment')
            AND o.created_at <= @cutoff`, { cutoff }).catch(() => null),
  ]);

  const oldest = stuck?.oldest ? Math.floor((now - Date.parse(stuck.oldest)) / 60_000) : null;
  return {
    failedToday: n(fr?.today),
    openFailures: n(fr?.open),
    undeliveredPaidOrders: n(stuck?.n),
    oldestUndeliveredMinutes: Number.isFinite(oldest) ? oldest : null,
    thresholdMinutes: UNDELIVERED_AFTER_MINUTES,
  };
}

/**
 * Orders placed but not paid for — the daily job in a shop that takes bank
 * transfers.
 *
 * Nothing counted these. The sidebar badge counts payment PROOFS a buyer
 * submitted, and the orders badge counts what is already paid and waiting to be
 * delivered. An order sitting in `pending` with no proof — somebody who ordered
 * and whose transfer has not landed, or has landed and nobody matched it yet —
 * appears in neither. In a shop whose entire payment flow is "pay by transfer
 * with your order number as the reference", that is the queue the owner works
 * from every morning.
 *
 * Two numbers, not one. `orders` includes people who will never pay — an
 * abandoned checkout looks identical to an unmatched transfer from here, so
 * calling the total "money waiting" would be an invented figure. `proofsWaiting`
 * is the subset somebody has actually claimed to have paid, which is the part
 * that can be acted on right now.
 */
export async function awaitingPayment({ now = Date.now() } = {}) {
  const [orders, proofs] = await Promise.all([
    get(`SELECT COUNT(*)::int AS n, COALESCE(SUM(total), 0)::bigint AS cents,
                MIN(created_at) AS oldest
           FROM orders WHERE status = 'pending'`).catch(() => null),
    get(`SELECT COUNT(*)::int AS n FROM payment_proofs WHERE status = 'pending'`)
      .catch(() => null),
  ]);
  const oldest = orders?.oldest ? Math.floor((now - Date.parse(orders.oldest)) / 60_000) : null;
  return {
    orders: n(orders?.n),
    /* What it would be worth IF everyone paid. Named so it cannot be read as
       revenue: it is not money, it is hope. */
    ifAllPaidCents: n(orders?.cents),
    oldestMinutes: Number.isFinite(oldest) ? oldest : null,
    proofsWaiting: n(proofs?.n),
  };
}

/**
 * Low stock, over the codes the shop can actually deliver from.
 *
 * `stockTierFor` is imported rather than re-derived, so this page and the
 * Discord alert cannot end up warning at different numbers.
 *
 * Two exclusions, both learned the expensive way:
 *
 *   INACTIVE PRODUCTS. Nobody can buy them, so their empty shelf is not news.
 *
 *   PRODUCTS SOURCED LIVE. A product with a working supplier mapping is
 *   SUPPOSED to hold no codes — it is bought per order. Counting those as "out
 *   of stock" put 68 of 72 products on this alarm the first time it ran against
 *   real data, which is not a launch board, it is a catalogue listing. The gate
 *   is the same one `resolveFulfillmentSupplier` uses: an active supplier, a
 *   SKU status that is not "out", and either unknown stock or some of it.
 */
export async function lowStock({ limit = 8 } = {}) {
  const rows = await all(
    `SELECT p.id, p.name,
            COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'available')::int AS codes,
            COUNT(DISTINCT sp.id) FILTER (
              WHERE s.status = 'active'
                AND (sp.supplier_status IS NULL OR sp.supplier_status = 'in_stock')
                AND (sp.available_stock IS NULL OR sp.available_stock > 0)
            )::int AS live_suppliers
       FROM products p
       LEFT JOIN product_codes c      ON c.product_id = p.id
       LEFT JOIN supplier_products sp ON sp.product_id = p.id
       LEFT JOIN suppliers s          ON s.id = sp.supplier_id
      WHERE p.active = 1
      GROUP BY p.id, p.name`).catch(() => []);

  const flagged = [];
  let out = 0; let critical = 0; let low = 0; let sourcedLive = 0;
  for (const r of rows) {
    if (n(r.live_suppliers) > 0 && n(r.codes) === 0) { sourcedLive += 1; continue; }
    const tier = stockTierFor(n(r.codes));
    if (tier === null) continue;
    if (tier === 0) out += 1; else if (tier <= 5) critical += 1; else low += 1;
    flagged.push({ productId: r.id, name: r.name, codes: n(r.codes), tier });
  }
  flagged.sort((a, b) => a.codes - b.codes || a.name.localeCompare(b.name));
  return {
    outOfStock: out, critical, low, flagged: flagged.length,
    products: flagged.slice(0, limit),
    activeProducts: rows.length,
    /* Named rather than silently dropped: "nothing on the shelf" and "nothing
       on the shelf on purpose" look identical from the outside. */
    sourcedLive,
  };
}

/**
 * Adverts that are actually delivering traffic, which is not the same thing as
 * adverts that are switched on.
 *
 * This counts creatives with a visit in the last 24 hours. A live campaign
 * whose visitors all declined marketing cookies records nothing here, so the
 * figure is a floor, not a census — and the payload says so rather than letting
 * a zero be read as "the ads are off".
 */
export async function activeAds({ now = Date.now(), hours = 24 } = {}) {
  const since = new Date(now - hours * 3_600_000).toISOString();
  const rows = await all(
    `SELECT COALESCE(creative_id, content, '—') AS creative,
            COALESCE(campaign, campaign_id, '—') AS campaign,
            network,
            COUNT(*)::int AS visits,
            MAX(created_at) AS last_seen
       FROM ad_visits
      WHERE created_at >= @since
      GROUP BY 1, 2, 3
      ORDER BY visits DESC`, { since }).catch(() => []);

  return {
    windowHours: hours,
    activeCreatives: rows.length,
    activeCampaigns: new Set(rows.map((r) => r.campaign)).size,
    visits: rows.reduce((a, r) => a + n(r.visits), 0),
    networks: [...new Set(rows.map((r) => r.network).filter(Boolean))],
    top: rows.slice(0, 5).map((r) => ({
      creative: r.creative, campaign: r.campaign,
      network: r.network || null, visits: n(r.visits), lastSeen: r.last_seen,
    })),
    /* Consent-gated: this is a floor. Stated in the payload so the page can say
       it rather than implying a census. */
    consentLimited: true,
  };
}

/** The whole board, as of one instant. */
export async function launchCenter({ now = Date.now(), tz } = {}) {
  const t0 = Date.now();
  const bounds = periodBounds({ now, tz });
  const since = bounds.today;

  const [orderAgg, lines, charge, refundReq, refundedOrders, customers, deliveries, waiting, stock, ads] =
    await Promise.all([
      get(`SELECT COUNT(*)::int AS orders, COALESCE(SUM(total), 0)::bigint AS revenue
             FROM orders WHERE status IN ${PAID} AND created_at >= @since`, { since })
        .catch(() => null),
      all(`SELECT oi.product_id AS pid, oi.quantity AS qty, oi.unit_price AS unit_price,
                  o.id AS order_id
             FROM order_items oi JOIN orders o ON o.id = oi.order_id
            WHERE o.status IN ${PAID} AND o.created_at >= @since`, { since })
        .catch(() => []),
      get(`SELECT COUNT(*) FILTER (WHERE created_at >= @since)::int  AS today,
                  COUNT(*) FILTER (WHERE created_at >= @m30)::int    AS last30,
                  COUNT(*)::int                                      AS total,
                  COALESCE(SUM(amount) FILTER (WHERE created_at >= @m30), 0)::bigint AS cents30
             FROM chargebacks`,
      { since, m30: new Date(now - 30 * 86_400_000).toISOString() }).catch(() => null),
      get(`SELECT COUNT(*) FILTER (WHERE status = 'requested')::int AS pending,
                  COUNT(*) FILTER (WHERE created_at >= @since)::int AS today
             FROM refund_requests`, { since }).catch(() => null),
      get(`SELECT COUNT(*)::int AS n, COALESCE(SUM(total), 0)::bigint AS cents
             FROM orders WHERE status = 'refunded' AND updated_at >= @since`, { since })
        .catch(() => null),
      customersToday(since),
      failedDeliveries(since, { now }),
      awaitingPayment({ now }),
      lowStock(),
      activeAds({ now }),
    ]);

  const costMap = await costCentsForMany(lines.map((l) => l.pid).filter(Boolean));
  const roll = rollUp(lines, costMap);

  /* Revenue comes from the ORDER TOTALS, not from the sum of the lines, because
     they are different numbers: totals carry discounts, coupons and shipping,
     and the line sum is what the products cost before any of that. The profit
     figure is a line-level question and stays line-level; the headline revenue
     is what actually arrived. */
  const revenue = n(orderAgg?.revenue);

  return {
    generatedAt: new Date(now).toISOString(),
    tookMs: Date.now() - t0,
    staleAfterSeconds: STALE_AFTER_SECONDS,
    bounds: { tz: bounds.tz, today: bounds.today },

    today: {
      revenueCents: revenue,
      orders: n(orderAgg?.orders),
      units: roll.units,
      /* Null, not zero, when nothing sold today has a known cost. The whole
         point of the profit round: a shop with no costs entered must not be
         shown a profit equal to its revenue. */
      profitCents: roll.coverage.units === 0 ? null : roll.profit,
      marginPct: roll.marginPct,
      coverage: roll.coverage,
    },

    chargebacks: {
      today: n(charge?.today), last30Days: n(charge?.last30),
      total: n(charge?.total), last30DaysCents: n(charge?.cents30),
    },
    /* Two facts, never added: money we chose to give back, and money taken back
       from us. The schema learned this the hard way — a chargeback used to be
       indistinguishable from a refund because both left the order 'refunded'. */
    refunds: {
      requestedToday: n(refundReq?.today),
      pendingRequests: n(refundReq?.pending),
      refundedOrdersToday: n(refundedOrders?.n),
      refundedCentsToday: n(refundedOrders?.cents),
    },
    failedDeliveries: deliveries,
    awaitingPayment: waiting,
    lowStock: stock,
    customers,
    ads,
  };
}
