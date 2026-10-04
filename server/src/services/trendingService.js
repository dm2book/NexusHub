/**
 * The trending engine: which products are Hot, Trending, Popular or New —
 * computed from sales, revenue, conversion and age, never picked by hand.
 *
 * ── THE SIGNALS (per active product) ──────────────────────────────────────
 *   sales24h    units in real paid orders placed in the last 24 hours
 *   sales7d     units in real paid orders placed in the last 7 days
 *   revenue7d   what those units brought in (cents)
 *   views7d     product-page views in the last 7 days (an anonymous daily
 *               counter: no cookie, no visitor id — see recordView)
 *   conversion  orders ÷ views over 7 days, once there are MIN_VIEWS views
 *   ageDays     days since the product was added
 * A real paid order: paid or further along (not refunded, cancelled or failed),
 * money changed hands (a total above zero or store credit spent), and not paid
 * on a provider's test key.
 *
 * ── THE LABELS ────────────────────────────────────────────────────────────
 *   hot       a spike: at least HOT_MIN sold in 24 h, and at least twice the
 *             daily rate of the six days before
 *   trending  rising: sold in the last 24 h at or above its 7-day daily rate;
 *             ranked by momentum (24 h weighs triple, then 7 d, revenue and
 *             conversion)
 *   popular   volume: at least POPULAR_MIN sold in 7 days; ranked by units,
 *             then revenue
 *   new       added in the last NEW_DAYS days
 * A product carries its strongest label (hot > trending > popular > new).
 * Nothing qualifies → no label. There is no featured flag, no pinning and no
 * override: the only way onto a list is the numbers.
 *
 * ── UPDATING ──────────────────────────────────────────────────────────────
 * Computed from the database on request and cached for CACHE_MS, so a sale
 * moves the lists within a minute without anyone pressing anything.
 */
import { all, run, nowIso } from '../db/index.js';
import { isTestKey as stripeTestKey } from './stripeService.js';
import { isTestKey as mollieTestKey } from './mollieService.js';

export const HOT_MIN = 2;
export const POPULAR_MIN = 3;
export const NEW_DAYS = 14;
export const MIN_VIEWS = 20;
export const CACHE_MS = 60_000;
export const LABELS = ['hot', 'trending', 'popular', 'new'];
const HOUR = 3_600_000, DAY = 24 * HOUR;
const LIVE = ['payment_received', 'processing', 'awaiting_fulfillment', 'completed'];

const parse = (s) => { try { return typeof s === 'string' ? JSON.parse(s || '{}') : (s || {}); } catch { return {}; } };
const truthy = (v) => v === true || v === 1 || v === 't' || v === '1';

/** Is this order row a real sale? */
export function isRealOrder(o) {
  if (!LIVE.includes(o.status)) return false;
  if (!(Number(o.total) > 0 || Number(parse(o.billing).creditApplied || 0) > 0)) return false;
  if (truthy(o.test_event)) return false;
  if (o.psp_provider === 'stripe' && stripeTestKey()) return false;
  if (o.psp_provider === 'mollie' && mollieTestKey()) return false;
  return true;
}

/** The signals for every product, from order-item rows, view rows and products. */
export function signalsFrom({ products, items, views = [], now = Date.now() }) {
  const s = new Map(products.map((p) => [p.id, {
    id: p.id, sales24h: 0, sales7d: 0, revenue7d: 0, orders7d: 0, views7d: 0,
    ageDays: Math.max(0, Math.floor((now - Date.parse(p.created_at || p.createdAt || now)) / DAY)),
  }]));
  const counted = new Map();
  for (const r of items) {
    const x = s.get(r.product_id);
    if (!x || !isRealOrder(r)) continue;
    const age = now - Date.parse(r.created_at);
    if (!(age >= 0 && age <= 7 * DAY)) continue;
    const q = Math.max(1, Number(r.quantity) || 1);
    x.sales7d += q;
    x.revenue7d += q * (Number(r.unit_price) || 0);
    if (age <= DAY) x.sales24h += q;
    const key = `${r.product_id}:${r.order_id}`;
    if (!counted.has(key)) { counted.set(key, 1); x.orders7d += 1; }
  }
  for (const v of views) { const x = s.get(v.product_id); if (x) x.views7d += Number(v.views) || 0; }
  for (const x of s.values()) {
    x.conversion = x.views7d >= MIN_VIEWS ? Math.round((x.orders7d / x.views7d) * 1000) / 10 : null;
  }
  return s;
}

/** Which label the numbers earn, and the momentum score used for ranking. */
export function classify(x) {
  const before = Math.max(0, x.sales7d - x.sales24h) / 6; // daily rate over the six days before today
  const hot = x.sales24h >= HOT_MIN && x.sales24h >= 2 * Math.max(before, 0.5);
  const trending = x.sales24h >= 1 && x.sales24h * 7 >= x.sales7d;
  const popular = x.sales7d >= POPULAR_MIN;
  const fresh = x.ageDays <= NEW_DAYS;
  const momentum = Math.round((3 * x.sales24h + x.sales7d + x.revenue7d / 10_000 + (x.conversion || 0) / 2) * 100) / 100;
  const label = hot ? 'hot' : trending ? 'trending' : popular ? 'popular' : fresh ? 'new' : null;
  return { label, momentum, is: { hot, trending, popular, new: fresh } };
}

/** The four lists, each ranked by its own rule. A product may appear on several. */
export function rank(signals, { limit = 12 } = {}) {
  const rows = [...signals.values()].map((x) => ({ ...x, ...classify(x) }));
  const by = (f, cmp) => rows.filter((r) => r.is[f]).sort(cmp).slice(0, limit).map((r) => r.id);
  const lists = {
    hot: by('hot', (a, b) => b.sales24h - a.sales24h || b.revenue7d - a.revenue7d),
    trending: by('trending', (a, b) => b.momentum - a.momentum),
    popular: by('popular', (a, b) => b.sales7d - a.sales7d || b.revenue7d - a.revenue7d),
    new: by('new', (a, b) => a.ageDays - b.ageDays || b.momentum - a.momentum),
  };
  return { lists, rows };
}

/* ── Views: an anonymous daily counter ─────────────────────────────────── */

/** Count one product-page view. No visitor id is stored — just the day's total. */
export async function recordView(productId) {
  const day = nowIso().slice(0, 10);
  await run(`INSERT INTO product_view_counts (product_id, day, views) VALUES (@p, @d, 1)
             ON CONFLICT (product_id, day) DO UPDATE SET views = product_view_counts.views + 1`, { p: productId, d: day });
}

/* ── From the database ─────────────────────────────────────────────────── */

let cache = { at: 0, data: null };
export const clearTrendingCache = () => { cache = { at: 0, data: null }; };

/** Everything the storefront and the admin need, cached for a minute. */
export async function trendingSnapshot({ now = Date.now(), fresh = false } = {}) {
  if (!fresh && cache.data && now - cache.at < CACHE_MS) return cache.data;
  const since = new Date(now - 7 * DAY).toISOString();
  const [products, items, views] = await Promise.all([
    all(`SELECT id, name, category, created_at FROM products WHERE active = 1`),
    all(`SELECT oi.product_id, oi.order_id, oi.quantity, oi.unit_price, o.status, o.total, o.billing, o.psp_provider, o.created_at,
                EXISTS (SELECT 1 FROM social_events s WHERE s.order_id = o.id AND s.test = 1) AS test_event
           FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE o.created_at >= @since AND oi.product_id IS NOT NULL`, { since }),
    all(`SELECT product_id, SUM(views) AS views FROM product_view_counts WHERE day >= @d GROUP BY product_id`, { d: since.slice(0, 10) }),
  ]);
  const { lists, rows } = rank(signalsFrom({ products, items, views, now }));
  const names = new Map(products.map((p) => [p.id, p]));
  const data = {
    updatedAt: new Date(now).toISOString(),
    lists,
    rows: rows.map((r) => ({ id: r.id, name: names.get(r.id)?.name, category: names.get(r.id)?.category,
      sales24h: r.sales24h, sales7d: r.sales7d, revenue7d: r.revenue7d, views7d: r.views7d, conversion: r.conversion,
      ageDays: r.ageDays, label: r.label, momentum: r.momentum }))
      .sort((a, b) => LABELS.indexOf(a.label ?? 'x') - LABELS.indexOf(b.label ?? 'x') || b.momentum - a.momentum),
  };
  cache = { at: now, data };
  return data;
}

/**
 * The storefront rail: hot, then trending, popular and new — each product once,
 * carrying the label it earned. Empty when nothing qualifies.
 */
export async function trendingRail({ limit = 8 } = {}) {
  const snap = await trendingSnapshot();
  const label = new Map(snap.rows.map((r) => [r.id, r.label]));
  const ids = [...new Set(LABELS.flatMap((l) => snap.lists[l]))].slice(0, limit);
  return ids.map((id) => ({ id, label: label.get(id) }));
}
