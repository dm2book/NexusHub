/**
 * The nine numbers that are money, and nothing else.
 *
 * ── WHY THIS IS NOT THE ANALYTICS PAGE ────────────────────────────────────
 * analyticsService already computes conversion rate, repeat-purchase rate,
 * customer counts, cart-recovery funnels and referral reach. All useful, none
 * of it cash. Mixed into one screen they compete: a good conversion rate reads
 * as good news next to a refund that took the day's profit, and the eye goes to
 * the green number. This is the other screen — every figure here is euros in or
 * euros out, and there is nothing on it to feel good about that is not.
 *
 * ── WHAT COUNTS AS REVENUE ────────────────────────────────────────────────
 * The same definition the rest of the shop uses: an order that has been paid
 * and not refunded. `payment_received` onward, `refunded` excluded — a refunded
 * order is not revenue that later went away, it is revenue that never was, and
 * counting it and then subtracting it twice is how a dashboard flatters itself.
 *
 * ── WHAT IS DELIBERATELY ABSENT ───────────────────────────────────────────
 * Margin and profit. 0 of 72 products carry a purchase cost, so gross profit
 * would be revenue minus zero — a number that looks like profit and is not.
 * The one place a real bound exists (face-value cards) is reported as a
 * ceiling, in the commercial audit, where it can be explained.
 */
import { all, get } from '../db/index.js';
import { formatMoney } from '../utils/money.js';
import { chargebackSummary } from './chargebackService.js';

const PAID = "status IN ('payment_received','processing','awaiting_fulfillment','completed')";

/* Day boundaries in the shop's own timezone, not UTC.
   A dashboard that rolls over at 02:00 local time tells the owner yesterday was
   worse than it was and today better, every single day. */
const TZ = process.env.SHOP_TIMEZONE || 'Europe/Amsterdam';
function startOf(period, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).reduce((a, p) => (p.type !== 'literal' ? { ...a, [p.type]: p.value } : a), {});
  const local = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  if (period === 'today') return local;
  if (period === 'month') return new Date(`${parts.year}-${parts.month}-01T00:00:00Z`);
  // Week starts Monday: a shop's week is not a calendar convenience.
  const dow = (local.getUTCDay() + 6) % 7;
  return new Date(local.getTime() - dow * 86_400_000);
}

const money = (cents) => ({ cents: Number(cents || 0), formatted: formatMoney(Number(cents || 0)) });

/** Revenue and order count since a moment. */
async function since(iso) {
  const r = await get(
    `SELECT COALESCE(SUM(total), 0) AS cents, COUNT(*) AS orders
       FROM orders WHERE ${PAID} AND created_at >= @since`, { since: iso });
  return { ...money(r?.cents), orders: Number(r?.orders || 0) };
}

export async function moneyDashboard({ topLimit = 8, stockLimit = 12 } = {}) {
  const now = new Date();
  const t = startOf('today', now).toISOString();
  const w = startOf('week', now).toISOString();
  const m = startOf('month', now).toISOString();

  const [today, week, month] = await Promise.all([since(t), since(w), since(m)]);

  /* Top products BY REVENUE, not by units. Twelve €8.49 PokéCoins outsell one
     €174.99 Robux pack and are worth a sixth as much, and a list ranked by
     units puts the wrong one first every time. */
  const top = await all(
    `SELECT oi.product_id AS id, oi.name,
            SUM(oi.quantity) AS units,
            SUM(oi.unit_price * oi.quantity) AS cents
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.${PAID} AND o.created_at >= @since
      GROUP BY oi.product_id, oi.name
      ORDER BY cents DESC LIMIT @l`, { since: m, l: topLimit });

  /* Refunds are counted on the day the money went back, which is when it left
     the account — not on the day the order was placed. */
  const refunds = await get(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS cents,
            COUNT(*) FILTER (WHERE updated_at >= @month) AS monthCount,
            COALESCE(SUM(total) FILTER (WHERE updated_at >= @month), 0) AS monthCents
       FROM orders WHERE status = 'refunded'`, { month: m });

  const chargebacks = await chargebackSummary();

  /* Stock problems, in the order they cost money: something sold out that the
     shop is still advertising as automatic is worse than something running low. */
  const stock = await all(
    `SELECT p.id, p.sku, p.name, p.price,
            (SELECT COUNT(*) FROM product_codes c
              WHERE c.product_id = p.id AND c.status = 'available') AS codes
       FROM products p
      WHERE p.active = 1 AND p.kind <> 'mystery'
      ORDER BY codes ASC, p.price DESC LIMIT @l`, { l: stockLimit });

  /* Affiliate money is a LIABILITY, not revenue. Paid is gone; owed is a bill
     that has not arrived yet, and reversed is what came back off a sale that
     stopped being one. */
  const aff = await get(
    `SELECT COALESCE(SUM(commission) FILTER (WHERE status = 'paid'), 0) AS paid,
            COALESCE(SUM(commission) FILTER (WHERE status IN ('pending','approved')), 0) AS owed,
            COALESCE(SUM(commission) FILTER (WHERE status = 'reversed'), 0) AS reversed,
            COUNT(*) FILTER (WHERE kind = 'order') AS orders
       FROM referral_events`).catch(() => null);

  /* Money that is promised but not yet in the account: placed orders waiting on
     a transfer. On a shop paid by hand this is the most actionable number on
     the page — it is revenue already won that is still winnable. */
  const unpaid = await get(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS cents
       FROM orders WHERE status = 'pending'`);

  return {
    generatedAt: now.toISOString(),
    timezone: TZ,
    revenue: { today, week, month },
    orders: { today: today.orders, week: week.orders, month: month.orders },
    awaitingPayment: { count: Number(unpaid?.n || 0), ...money(unpaid?.cents) },
    topProducts: top.map((r) => ({
      id: r.id, name: r.name, units: Number(r.units || 0), ...money(r.cents),
    })),
    refunds: {
      allTime: { count: Number(refunds?.n || 0), ...money(refunds?.cents) },
      thisMonth: { count: Number(refunds?.monthcount ?? refunds?.monthCount ?? 0),
        ...money(refunds?.monthcents ?? refunds?.monthCents) },
    },
    chargebacks: { count: chargebacks.count, last90Days: chargebacks.last90Days,
      ...money(chargebacks.totalCents) },
    stockProblems: stock
      .map((r) => ({ id: r.id, sku: r.sku, name: r.name, codes: Number(r.codes || 0),
        ...money(r.price) }))
      // Only the ones that are actually a problem: nothing left, or nearly.
      .filter((r) => r.codes <= 5),
    affiliate: {
      orders: Number(aff?.orders || 0),
      paid: money(aff?.paid), owed: money(aff?.owed), reversed: money(aff?.reversed),
    },
  };
}
