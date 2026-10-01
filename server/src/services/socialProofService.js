/**
 * Social proof — REAL data only, no fabrication.
 *
 * The live "John from Amsterdam purchased 1,700 Robux" feed and the trust
 * statistics are built strictly from delivered orders and verified reviews. When
 * the store has had no real activity yet the feed is simply empty — we never
 * invent a purchase.
 *
 * Privacy: a feed event stores only a FIRST NAME and (optionally) a city —
 * never the email, surname, or address. The snapshot is taken once, at delivery.
 */
import { run, get, all, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { isTestKey as stripeTestKey } from './stripeService.js';
import { isTestKey as mollieTestKey } from './mollieService.js';

// ── Privacy-safe display helpers ────────────────────────────────────────────

/** First name only: first token, letters/marks, title-cased, ≤20 chars. */
export function firstNameOf(fullName) {
  const tok = String(fullName || '').trim().split(/\s+/)[0] || '';
  const clean = tok.replace(/[^\p{L}'’-]/gu, '').slice(0, 20);
  if (clean.length < 2) return null;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/** City: letters/spaces/hyphens only, ≤40 chars (no fabrication). */
export function cityOf(billing = {}) {
  const raw = billing.city || billing.town || '';
  const clean = String(raw).trim().replace(/[^\p{L}\s'’.-]/gu, '').replace(/\s+/g, ' ').slice(0, 40);
  return clean.length >= 2 ? clean : null;
}

/**
 * A two-letter country code, or null. Anything else — a typed "Nederland", a
 * placeholder, "XX" for unknown — is no country at all, so a filter and a flag
 * never have to guess what a free-text value meant.
 */
export function countryCodeOf(raw) {
  const code = String(raw || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code !== 'XX' ? code : null;
}

function countryOf(billing = {}) {
  return countryCodeOf(billing.country || billing.country_code);
}

/** A compact, human product label for a feed line: "1,700 Robux (+2 more)". */
function labelForOrder(order) {
  const items = order.items || [];
  if (!items.length) return 'an order';
  const first = items[0];
  const base = first.quantity > 1 ? `${first.quantity}× ${first.name}` : first.name;
  return items.length > 1 ? `${base} +${items.length - 1} more` : base;
}

// ── Capture (called when an order completes) ────────────────────────────────

/**
 * Snapshot a delivered order into the public feed. Idempotent per order (a
 * unique index on order_id makes re-delivery a no-op). Best-effort — never
 * throws into the order pipeline.
 */
export async function recordPurchaseEvent(order) {
  try {
    if (!order || order.status !== 'completed') return null;
    const exists = await get('SELECT id FROM social_events WHERE order_id = @id', { id: order.id });
    if (exists) return { id: exists.id, deduped: true };

    const billing = order.billing || {};
    const firstName = firstNameOf(billing.full_name || billing.name);
    // Snapshot the first item's category (for the feed icon) — best-effort.
    let category = order.items?.[0]?.metadata?.category || null;
    if (!category && order.items?.[0]?.product_id) {
      const p = await get('SELECT category FROM products WHERE id=@id', { id: order.items[0].product_id }).catch(() => null);
      category = p?.category || null;
    }
    /* The country the checkout came from, when the buyer typed none; and
       whether the money was real. A payment taken on a provider's test key
       is a rehearsal — kept for the owner, never shown as a sale. */
    const row = await get('SELECT country, psp_provider FROM orders WHERE id=@id', { id: order.id })
      .catch(() => null);
    const country = countryOf(billing) || countryCodeOf(row?.country);
    const test = (row?.psp_provider === 'stripe' && stripeTestKey())
      || (row?.psp_provider === 'mollie' && mollieTestKey()) ? 1 : 0;
    const created = new Date(order.createdAt || order.created_at || Date.now());
    const deliverySeconds = Math.max(1, Math.min(86_400, Math.round((Date.now() - created.getTime()) / 1000)));

    const id = newId('soc');
    await run(
      `INSERT INTO social_events
         (id, type, order_id, first_name, city, country, product_label, category, delivery_seconds, status, pinned, test, created_at)
       VALUES (@id, 'purchase', @oid, @first, @city, @country, @label, @cat, @secs, 'visible', 0, @test, @at)
       ON CONFLICT (order_id) DO NOTHING`,
      { id, oid: order.id, first: firstName, city: cityOf(billing), country,
        label: labelForOrder(order), cat: category, secs: deliverySeconds, test, at: nowIso() });
    return { id, deduped: false };
  } catch (e) {
    console.error('[social] recordPurchaseEvent', e.message);
    return null;
  }
}

// ── Public reads ────────────────────────────────────────────────────────────

const secondsAgo = (at) => Math.max(1, Math.round((Date.now() - new Date(at).getTime()) / 1000));

/**
 * What makes a feed row a real sale, in one place for both feeds.
 *
 *   the order is STILL completed   a refund, cancellation or chargeback later
 *                                  takes it out — the snapshot alone would have
 *                                  kept announcing a sale that was undone
 *   it was not paid on a test key  a rehearsal is not a sale
 *   moderation left it visible
 */
const REAL_SALE = `s.status = 'visible' AND s.test = 0 AND o.status = 'completed'`;

/* Money changed hands: a total above zero, or store credit spent on it. A 100%
   coupon or a giveaway delivers something, but nothing was sold. */
const PAID = `(o.total > 0 OR COALESCE((o.billing::jsonb ->> 'creditApplied')::numeric, 0) > 0)`;

/** Live purchases feed (pinned first, then newest). Real visible events only. */
export async function liveFeed({ limit = 12 } = {}) {
  const rows = await all(
    `SELECT s.id, s.first_name, s.city, s.product_label, s.category, s.delivery_seconds, s.created_at
       FROM social_events s
       JOIN orders o ON o.id = s.order_id
      WHERE ${REAL_SALE}
      ORDER BY s.pinned DESC, s.created_at DESC
      LIMIT @limit`, { limit: Math.min(50, Math.max(1, limit)) });
  return rows.map((r) => ({
    id: r.id,
    // No English placeholder here: the storefront renders the fallback in the
    // reader's own language. A server-side "Someone" stayed English forever.
    name: r.first_name || null,
    city: r.city || null,
    item: r.product_label,
    category: r.category || '',
    deliverySeconds: r.delivery_seconds || null,
    secondsAgo: secondsAgo(r.created_at),
  }));
}

// ── Real sales feed ─────────────────────────────────────────────────────────

export const SALES_PERIODS = { '1h': 3600, '24h': 86_400, '7d': 7 * 86_400, '30d': 30 * 86_400, all: null };

/**
 * The public sales feed: "Steam Wallet €20 sold · 4 minutes ago · NL · Gift cards".
 *
 * Only paid, still-completed, non-test orders (REAL_SALE + PAID). No name and no
 * city — a product, a time, a country and a category say "people buy here"
 * without saying who. Filters narrow the same rows; the filter options are
 * counted from those rows too, so a filter can only ever offer a category or a
 * country that actually sold, and never an empty choice made up to look busy.
 */
export async function salesFeed({ category = null, country = null, period = 'all', limit = 30 } = {}) {
  const span = SALES_PERIODS[period] === undefined ? null : SALES_PERIODS[period];
  const since = span ? new Date(Date.now() - span * 1000).toISOString() : null;
  const base = `FROM social_events s JOIN orders o ON o.id = s.order_id
                WHERE ${REAL_SALE} AND ${PAID} ${since ? 'AND s.created_at >= @since' : ''}`;
  const where = [
    category ? 'AND s.category = @category' : '',
    country ? 'AND COALESCE(s.country, o.country) = @country' : '',
  ].join(' ');
  const params = { since, category, country, limit: Math.min(50, Math.max(1, Number(limit) || 30)) };

  const [rows, cats, countries, total] = await Promise.all([
    all(`SELECT s.id, s.product_label, s.category, COALESCE(s.country, o.country) AS country, s.created_at
           ${base} ${where} ORDER BY s.created_at DESC LIMIT @limit`, params),
    all(`SELECT s.category AS key, COUNT(*) AS n ${base} AND s.category IS NOT NULL
          ${country ? 'AND COALESCE(s.country, o.country) = @country' : ''}
          GROUP BY s.category ORDER BY n DESC, key`, params),
    all(`SELECT COALESCE(s.country, o.country) AS key, COUNT(*) AS n ${base}
          AND COALESCE(s.country, o.country) IS NOT NULL ${category ? 'AND s.category = @category' : ''}
          GROUP BY 1 ORDER BY n DESC, key`, params),
    get(`SELECT COUNT(*) AS n ${base} ${where}`, params),
  ]);

  return {
    period: span === null && period !== 'all' ? 'all' : period,
    total: Number(total?.n || 0),
    sales: rows.map((r) => ({
      id: r.id,
      product: r.product_label,
      category: r.category || null,
      country: countryCodeOf(r.country),
      secondsAgo: secondsAgo(r.created_at),
      at: r.created_at,
    })),
    filters: {
      categories: cats.map((c) => ({ key: c.key, count: Number(c.n) })),
      countries: countries.filter((c) => countryCodeOf(c.key)).map((c) => ({ code: c.key, count: Number(c.n) })),
    },
  };
}

/** Aggregate trust statistics — all derived from real rows. */
export async function trustStats() {
  const out = {
    delivered: 0, delivered30d: 0, customers: 0,
    avgDeliverySeconds: null, fastestDeliverySeconds: null,
    reviews: 0, rating: null, verifiedBuyers: 0,
  };
  const safe = async (fn) => { try { return await fn(); } catch { return null; } };

  await safe(async () => {
    const r = await get(`SELECT COUNT(*) AS n FROM orders WHERE status='completed'`);
    out.delivered = Number(r?.n || 0);
  });
  await safe(async () => {
    const r = await get(
      `SELECT COUNT(*) AS n FROM orders
        WHERE status='completed' AND created_at >= @since`,
      { since: new Date(Date.now() - 30 * 864e5).toISOString() });
    out.delivered30d = Number(r?.n || 0);
  });
  await safe(async () => {
    const r = await get(`SELECT COUNT(DISTINCT email) AS n FROM orders`);
    out.customers = Number(r?.n || 0);
  });
  // Delivery-time stats straight from captured feed events (precise & cheap).
  await safe(async () => {
    const r = await get(
      `SELECT AVG(delivery_seconds) AS avg, MIN(delivery_seconds) AS min
         FROM social_events WHERE delivery_seconds IS NOT NULL`);
    if (r?.avg != null) out.avgDeliverySeconds = Math.max(1, Math.round(Number(r.avg)));
    if (r?.min != null) out.fastestDeliverySeconds = Math.max(1, Math.round(Number(r.min)));
  });
  await safe(async () => {
    const r = await get(
      `SELECT COUNT(*) AS n, COALESCE(AVG(stars),0) AS avg FROM reviews WHERE status='visible'`);
    out.reviews = Number(r?.n || 0);
    out.rating = out.reviews ? Math.round(Number(r.avg) * 10) / 10 : null;
  });
  await safe(async () => {
    const r = await get(`SELECT COUNT(*) AS n FROM reviews WHERE status='visible' AND verified=1`);
    out.verifiedBuyers = Number(r?.n || 0);
  });
  return out;
}

// ── Admin moderation ────────────────────────────────────────────────────────

export async function listEventsAdmin({ limit = 100 } = {}) {
  const rows = await all(
    `SELECT s.*, o.number AS order_number, o.email AS order_email
       FROM social_events s
       LEFT JOIN orders o ON o.id = s.order_id
      ORDER BY s.pinned DESC, s.created_at DESC
      LIMIT @limit`, { limit: Math.min(300, Math.max(1, limit)) });
  return rows.map((r) => ({
    id: r.id, type: r.type, orderId: r.order_id, orderNumber: r.order_number,
    name: r.first_name, city: r.city, item: r.product_label, category: r.category,
    deliverySeconds: r.delivery_seconds, status: r.status, pinned: !!r.pinned,
    createdAt: r.created_at,
  }));
}

export async function setEventStatus(id, status) {
  if (!['visible', 'hidden'].includes(status)) throw new Error('Bad status');
  const r = await run('UPDATE social_events SET status=@s WHERE id=@id', { s: status, id });
  return (r?.changes || 0) > 0;
}

export async function setEventPinned(id, pinned) {
  const r = await run('UPDATE social_events SET pinned=@p WHERE id=@id', { p: pinned ? 1 : 0, id });
  return (r?.changes || 0) > 0;
}

export async function deleteEvent(id) {
  const r = await run('DELETE FROM social_events WHERE id=@id', { id });
  return (r?.changes || 0) > 0;
}
