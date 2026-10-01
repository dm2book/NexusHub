/**
 * Customer Lifetime Value engine.
 *
 * Per customer, from paid orders only: revenue, profit, order count, average
 * order value, last purchase and the revenue their referrals brought in. From
 * those, three scores:
 *
 *   Lifetime Value   what the customer has spent, plus — only when there is a
 *                    rhythm to extrapolate — what the next twelve months look
 *                    like at that rhythm, discounted by how likely they still
 *                    are to come back. One order is no rhythm, so a one-order
 *                    customer's projection is null, not a guess.
 *   Retention Score  0–100: how likely they still buy here. Recency measured
 *                    against THEIR OWN gap between orders where they have one,
 *                    and the shop's typical gap where they do not, plus credit
 *                    for having come back at all.
 *   VIP Score        0–100: spend, profit, repeat orders, retention and
 *                    referrals on fixed scales — absolute, not ranked, so the
 *                    only customer of a new shop is not "100% VIP" for a €5
 *                    order.
 *
 * ── THE SAME RULES AS THE PROFIT DASHBOARD ─────────────────────────────────
 * A refunded, cancelled or unpaid order is not revenue. An unknown cost is
 * unknown, never zero: an order with an item whose cost was never entered has
 * an unknown profit, and the customer's profit says how many of their orders it
 * covers. Profit is after BTW at the planning rate (21% until the shop's own
 * registration says otherwise) and after the referral commission the order
 * paid out — that 5% left the shop because of this customer.
 *
 * Who is "a customer": the account, when there is one. A guest order with the
 * same e-mail as an account belongs to that account; a guest with no account is
 * their e-mail address.
 */
import { all } from '../db/index.js';
import { costCentsForMany } from './costService.js';
import { netCents, planningVat } from './vatService.js';
import { formatMoney } from '../utils/money.js';

const PAID = "o.status IN ('payment_received','processing','awaiting_fulfillment','completed')";
const DAY = 86_400_000;

/** Every tunable in one place, so a test (and the owner) can read what a score means. */
export const CLV = {
  /* The gap assumed between orders for a customer who has only ordered once,
     until the shop has enough repeat customers to measure its own. */
  DEFAULT_GAP_DAYS: 30,
  MIN_REPEATERS_FOR_SHOP_GAP: 5,
  PROJECTION_DAYS: 365,
  RETENTION: { recency: 60, frequency: 40 },
  /* Where each VIP component is full marks. */
  VIP_FULL: { revenueCents: 100_000, profitCents: 25_000, orders: 10, referralCents: 50_000 },
  VIP_WEIGHTS: { revenue: 35, profit: 20, orders: 15, retention: 20, referrals: 10 },
  SEGMENTS: { vip: 70, loyal: 45, regular: 20 },
};

const round1 = (x) => Math.round(x * 10) / 10;
/* Square root, not log: a log scale gave a single €5 order a quarter of the
   spend marks (log 6 / log 1001), which with a fresh first visit added up to
   a "regular". The root keeps €5 at 7% of the way to €1,000 and €250 at half. */
const sqrt01 = (cents, full) => Math.max(0, Math.min(1, Math.sqrt(Math.max(0, cents) / full)));

/**
 * Retention 0–100 from orders, days since the last one and the gap to expect.
 *
 * Recency is full marks while the customer is inside their usual gap, and
 * decays by e for every further gap they stay away. Frequency is 1 − 1/orders:
 * nothing for a single order, half for a second, approaching all of it.
 */
export function retentionScore({ orders, daysSinceLast, gapDays }, cfg = CLV) {
  if (!orders) return 0;
  const gap = Math.max(1, gapDays);
  const overdue = Math.max(0, daysSinceLast - gap);
  const recency = Math.exp(-overdue / gap);
  const frequency = 1 - 1 / orders;
  return Math.round(cfg.RETENTION.recency * recency + cfg.RETENTION.frequency * frequency);
}

export function retentionStatus(score, orders, daysSinceLast, gapDays) {
  if (orders === 1 && daysSinceLast <= gapDays) return 'new';
  if (score >= 60) return 'active';
  if (score >= 30) return 'at_risk';
  return 'lapsed';
}

/**
 * VIP 0–100. A component with no data (profit unknown) is left out and the
 * others are weighed up to fill it, rather than scoring it zero — not knowing
 * the cost is the shop's gap, not the customer's.
 */
export function vipScore({ revenue, profit, orders, retention, referralRevenue }, cfg = CLV) {
  const W = cfg.VIP_WEIGHTS; const F = cfg.VIP_FULL;
  const parts = [
    [W.revenue, sqrt01(revenue, F.revenueCents)],
    [W.orders, Math.max(0, Math.min(1, (orders - 1) / (F.orders - 1)))],
    /* Retention counts from the second order. After one, the score is only
       "bought recently" — true of every first-time buyer, and no sign of
       loyalty yet. */
    [W.retention, orders >= 2 ? retention / 100 : 0],
    [W.referrals, sqrt01(referralRevenue, F.referralCents)],
  ];
  if (profit != null) parts.push([W.profit, sqrt01(profit, F.profitCents)]);
  const weight = parts.reduce((s, [w]) => s + w, 0);
  return Math.round((parts.reduce((s, [w, v]) => s + w * v, 0) / weight) * 100);
}

export function segmentFor(vip, cfg = CLV) {
  if (vip >= cfg.SEGMENTS.vip) return 'vip';
  if (vip >= cfg.SEGMENTS.loyal) return 'loyal';
  if (vip >= cfg.SEGMENTS.regular) return 'regular';
  return 'new';
}

/**
 * The next twelve months at the customer's own pace, discounted by retention.
 * Needs two orders on two different days: one order is no pace, and two on the
 * same afternoon are one visit.
 */
export function projectRevenue({ orders, firstAt, lastAt, aov, retention }, cfg = CLV) {
  const spanDays = (new Date(lastAt) - new Date(firstAt)) / DAY;
  if (orders < 2 || spanDays < 1) return null;
  const perYear = ((orders - 1) / spanDays) * cfg.PROJECTION_DAYS;
  return Math.round(aov * perYear * (retention / 100));
}

/** The gap between orders this shop's repeat customers actually show, or the default. */
export function shopGapDays(customers, cfg = CLV) {
  const gaps = customers.filter((c) => c.orders >= 2 && c.spanDays >= 1)
    .map((c) => c.spanDays / (c.orders - 1)).sort((a, b) => a - b);
  if (gaps.length < cfg.MIN_REPEATERS_FOR_SHOP_GAP) return { days: cfg.DEFAULT_GAP_DAYS, measured: false, from: gaps.length };
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  return { days: round1(Math.max(1, median)), measured: true, from: gaps.length };
}

/** Load everything once: paid orders, their lines, commissions and referral links. */
async function load() {
  const [orders, lines, commissions, users, referred] = await Promise.all([
    all(`SELECT o.id, o.user_id, LOWER(o.email) AS email, o.total, o.created_at
           FROM orders o WHERE ${PAID}`),
    all(`SELECT oi.order_id, oi.product_id AS pid, oi.quantity AS qty
           FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE ${PAID}`),
    all(`SELECT order_id, commission FROM referral_events
          WHERE kind = 'order' AND status <> 'reversed' AND order_id IS NOT NULL`).catch(() => []),
    all(`SELECT id, LOWER(email) AS email, display_name, created_at FROM users`),
    /* Who referred whom. referred_by holds the CODE; the code belongs to a user. */
    all(`SELECT u.id AS referred_id, r.user_id AS referrer_id
           FROM users u JOIN referrals r ON r.code = UPPER(u.referred_by)
          WHERE u.referred_by IS NOT NULL AND r.user_id <> u.id`).catch(() => []),
  ]);
  return { orders, lines, commissions, users, referred };
}

/**
 * Every customer with at least one paid order, scored.
 * `now` is injectable so the tests can age a customer without waiting.
 */
export async function customerValues({ now = Date.now(), cfg = CLV } = {}) {
  const { orders, lines, commissions, users, referred } = await load();
  const vat = planningVat();

  const userById = new Map(users.map((u) => [u.id, u]));
  const userByEmail = new Map(users.filter((u) => u.email).map((u) => [u.email, u]));
  const keyOf = (o) => o.user_id || userByEmail.get(o.email)?.id || `guest:${o.email}`;

  const costMap = await costCentsForMany([...new Set(lines.map((l) => l.pid).filter(Boolean))]);
  const costOf = new Map();          // order id → cost cents, or null when any line is unknown
  for (const l of lines) {
    if (costOf.has(l.order_id) && costOf.get(l.order_id) === null) continue;
    const unit = costMap[l.pid];
    costOf.set(l.order_id, unit == null ? null : (costOf.get(l.order_id) || 0) + unit * (Number(l.qty) || 0));
  }
  const commissionOf = new Map();
  for (const c of commissions) commissionOf.set(c.order_id, (commissionOf.get(c.order_id) || 0) + Number(c.commission || 0));

  const by = new Map();
  for (const o of orders) {
    const key = keyOf(o);
    const c = by.get(key) || { key, userId: key.startsWith('guest:') ? null : key, email: o.email,
      revenue: 0, profit: 0, costedOrders: 0, orders: 0, firstAt: o.created_at, lastAt: o.created_at, orderIds: [] };
    const total = Number(o.total) || 0;
    c.revenue += total;
    c.orders += 1;
    c.orderIds.push(o.id);
    if (o.created_at < c.firstAt) c.firstAt = o.created_at;
    if (o.created_at > c.lastAt) c.lastAt = o.created_at;
    const cost = costOf.has(o.id) ? costOf.get(o.id) : null;
    if (cost != null) {
      c.profit += netCents(total, vat.rate) - cost - (commissionOf.get(o.id) || 0);
      c.costedOrders += 1;
    }
    by.set(key, c);
  }

  // Referral revenue: what the people a customer referred have paid, in total.
  const revenueByUser = new Map();
  for (const c of by.values()) if (c.userId) revenueByUser.set(c.userId, c.revenue);
  const referralRevenue = new Map(); const referralCount = new Map();
  for (const r of referred) {
    const rev = revenueByUser.get(r.referred_id) || 0;
    referralCount.set(r.referrer_id, (referralCount.get(r.referrer_id) || 0) + 1);
    if (rev) referralRevenue.set(r.referrer_id, (referralRevenue.get(r.referrer_id) || 0) + rev);
  }

  const list = [...by.values()].map((c) => ({ ...c, spanDays: (new Date(c.lastAt) - new Date(c.firstAt)) / DAY }));
  const gap = shopGapDays(list, cfg);

  const customers = list.map((c) => {
    const u = c.userId ? userById.get(c.userId) : null;
    const aov = Math.round(c.revenue / c.orders);
    const daysSinceLast = Math.max(0, (now - new Date(c.lastAt)) / DAY);
    const ownGap = c.orders >= 2 && c.spanDays >= 1 ? c.spanDays / (c.orders - 1) : null;
    const gapDays = ownGap ?? gap.days;
    const retention = retentionScore({ orders: c.orders, daysSinceLast, gapDays }, cfg);
    const profit = c.costedOrders ? c.profit : null;
    const refRev = c.userId ? referralRevenue.get(c.userId) || 0 : 0;
    const projected = projectRevenue({ orders: c.orders, firstAt: c.firstAt, lastAt: c.lastAt, aov, retention }, cfg);
    const vip = vipScore({ revenue: c.revenue, profit, orders: c.orders, retention, referralRevenue: refRev }, cfg);
    return {
      id: c.key,
      userId: c.userId,
      email: u?.email || c.email,
      name: u?.display_name || null,
      revenue: c.revenue,
      profit,
      profitCoverage: { orders: c.costedOrders, of: c.orders, complete: c.costedOrders === c.orders },
      orders: c.orders,
      averageOrderValue: aov,
      firstPurchaseAt: c.firstAt,
      lastPurchaseAt: c.lastAt,
      daysSinceLastPurchase: Math.floor(daysSinceLast),
      referralRevenue: refRev,
      referredCustomers: c.userId ? referralCount.get(c.userId) || 0 : 0,
      lifetimeValue: {
        value: c.revenue + (projected || 0),
        realized: c.revenue,
        projected12m: projected,
        basis: projected == null
          ? 'realized only — one visit is not a buying rhythm to project'
          : `realized + 12 months at ${round1(ownGap)}-day gaps × ${retention}% retention`,
      },
      retention: { score: retention, status: retentionStatus(retention, c.orders, daysSinceLast, gapDays),
        gapDays: round1(gapDays), gapSource: ownGap != null ? 'own' : (gap.measured ? 'shop' : 'default') },
      vip: { score: vip, segment: segmentFor(vip, cfg) },
    };
  });

  return { customers, gap, vat: { pct: vat.pct, registered: vat.registered } };
}

const SORTS = {
  ltv: (c) => c.lifetimeValue.value,
  vip: (c) => c.vip.score,
  revenue: (c) => c.revenue,
  profit: (c) => (c.profit == null ? -Infinity : c.profit),
  orders: (c) => c.orders,
  retention: (c) => c.retention.score,
  recent: (c) => new Date(c.lastPurchaseAt).getTime(),
  referrals: (c) => c.referralRevenue,
};
export const SORT_KEYS = Object.keys(SORTS);
export const SEGMENT_KEYS = ['vip', 'loyal', 'regular', 'new'];
export const STATUS_KEYS = ['new', 'active', 'at_risk', 'lapsed'];

/** Admin → Top Customers: ranked, filtered, with the totals the page heads with. */
export async function topCustomers({ sort = 'ltv', segment = null, status = null, q = '', limit = 50, now } = {}) {
  const { customers, gap, vat } = await customerValues({ now });
  const key = SORTS[sort] ? sort : 'ltv';
  const needle = String(q || '').trim().toLowerCase();
  const rows = customers
    .filter((c) => !segment || c.vip.segment === segment)
    .filter((c) => !status || c.retention.status === status)
    .filter((c) => !needle || c.email.includes(needle) || (c.name || '').toLowerCase().includes(needle))
    .sort((a, b) => SORTS[key](b) - SORTS[key](a) || b.revenue - a.revenue);

  const n = customers.length;
  const revenue = customers.reduce((s, c) => s + c.revenue, 0);
  const costed = customers.filter((c) => c.profit != null);
  const atRisk = customers.filter((c) => c.retention.status === 'at_risk');
  return {
    sort: key,
    summary: {
      customers: n,
      revenue,
      averageLifetimeValue: n ? Math.round(customers.reduce((s, c) => s + c.lifetimeValue.value, 0) / n) : null,
      averageOrderValue: n ? Math.round(revenue / customers.reduce((s, c) => s + c.orders, 0)) : null,
      repeatRate: n ? round1((customers.filter((c) => c.orders >= 2).length / n) * 100) : null,
      profit: costed.length ? costed.reduce((s, c) => s + c.profit, 0) : null,
      profitCoverage: { customers: costed.length, of: n },
      segments: Object.fromEntries(SEGMENT_KEYS.map((s) => [s, customers.filter((c) => c.vip.segment === s).length])),
      statuses: Object.fromEntries(STATUS_KEYS.map((s) => [s, customers.filter((c) => c.retention.status === s).length])),
      revenueAtRisk: atRisk.reduce((s, c) => s + c.averageOrderValue, 0),
      referralRevenue: customers.reduce((s, c) => s + c.referralRevenue, 0),
      averageLifetimeValueFormatted: n ? formatMoney(Math.round(customers.reduce((s, c) => s + c.lifetimeValue.value, 0) / n)) : null,
    },
    gap,
    vat,
    total: rows.length,
    customers: rows.slice(0, Math.min(200, Math.max(1, Number(limit) || 50))),
  };
}
