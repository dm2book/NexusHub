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
    const row = await get(`SELECT o.country, o.psp_provider, ${PAID_AT} AS paid_at FROM orders o WHERE o.id=@id`,
      { id: order.id }).catch(() => null);
    const country = countryOf(billing) || countryCodeOf(row?.country);
    const test = (row?.psp_provider === 'stripe' && stripeTestKey())
      || (row?.psp_provider === 'mollie' && mollieTestKey()) ? 1 : 0;
    /* Payment to delivery, as every public delivery time is measured — not
       from when the order was placed, and not capped at a day. No payment on
       record (a free order): no time, rather than one counted from the order. */
    const paidMs = Date.parse(row?.paid_at);
    const deliverySeconds = Number.isFinite(paidMs) ? Math.max(1, Math.round((Date.now() - paidMs) / 1000)) : null;

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

// ── What counts as a real sale ──────────────────────────────────────────────
/* Every public number — the Trust page, the feeds, the product page — is made
   of the same orders, defined here once. Each piece is SQL over `orders o`. */

/* Money changed hands: a total above zero, or store credit spent on it. A 100%
   coupon or a giveaway delivers something, but nothing was sold. */
export const PAID = `(o.total > 0 OR COALESCE((o.billing::jsonb ->> 'creditApplied')::numeric, 0) > 0)`;

/* A demo self-payment (POST /orders/:id/pay writes payment_ref 'demo_…') marks
   an order paid without any money arriving. */
export const DEMO_ORDER = `(COALESCE(LEFT(o.payment_ref, 5), '') = 'demo_')`;

/* Placed by the shop itself: from an account holding any role beyond customer,
   or from such an account's address as a guest. That is the owner trying the
   checkout, and their own orders said nothing about how the shop serves
   anyone else — they were counted all the same. */
export const STAFF_ORDER = `EXISTS (
  SELECT 1 FROM user_roles ur JOIN users su ON su.id = ur.user_id
   WHERE ur.role_id <> 'customer'
     AND (ur.user_id = o.user_id OR LOWER(su.email) = LOWER(o.email)))`;

/**
 * Not the shop rehearsing: no demo payment, no staff order, and no payment on a
 * provider's test key — flagged on the feed row at delivery, or a provider whose
 * key is a test key right now. A function because the key can change at
 * runtime; the provider names are our own constants, never input.
 */
export function notHouseOrder() {
  const test = [stripeTestKey() && `'stripe'`, mollieTestKey() && `'mollie'`].filter(Boolean);
  return `NOT ${DEMO_ORDER} AND NOT ${STAFF_ORDER}
    AND NOT EXISTS (SELECT 1 FROM social_events te WHERE te.order_id = o.id AND te.test = 1)
    ${test.length ? `AND COALESCE(o.psp_provider, '') NOT IN (${test.join(', ')})` : ''}`;
}

/**
 * When the buyer paid: the first proof of payment they sent that was not
 * rejected, or the moment the payment was confirmed — whichever came first.
 * With Tikkie, Revolut or PayPal the money has left their account before
 * anyone here looks; timing from our confirmation would leave out exactly the
 * wait a buyer feels most. Text ISO timestamps, so LEAST compares them as
 * written.
 */
export const PAID_AT = `LEAST(
  (SELECT MIN(h.created_at) FROM order_status_history h WHERE h.order_id = o.id AND h.to_status = 'payment_received'),
  (SELECT MIN(pp.created_at) FROM payment_proofs pp WHERE pp.order_id = o.id AND pp.status <> 'rejected'))`;

/* When it was delivered: the order's own transition to completed. updated_at,
   which this used to read, moves with every later edit to the order. */
export const DELIVERED_AT = `(SELECT MAX(h.created_at) FROM order_status_history h
  WHERE h.order_id = o.id AND h.to_status = 'completed')`;

/* Below this many orders a median or a percentage describes luck, not the
   shop, so the figure is not shown at all. */
export const MIN_SAMPLE = 5;
/* The latest real sales a delivery time is taken over: recent enough to be
   today's service, wide enough not to swing on one slow evening. */
const DELIVERY_WINDOW = 200;

/**
 * How long a real buyer waited, from paying to having it: the MEDIAN over the
 * latest delivered real sales, plus the mean and the fastest for the owner's
 * screen. A median, because one order stuck for a weekend would drag a mean
 * far from what a typical buyer sees. Nothing is capped — the old figure threw
 * away every delivery slower than a day, which only ever flattered it.
 *
 * @returns {{ sample, median, mean, fastest }} seconds, null below MIN_SAMPLE
 */
export async function deliveryTimes() {
  const r = await get(
    `SELECT COUNT(*) AS n,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY d.secs) AS median,
            AVG(d.secs) AS mean, MIN(d.secs) AS fastest
       FROM (SELECT EXTRACT(EPOCH FROM (t.delivered_at::timestamptz - t.paid_at::timestamptz)) AS secs
               FROM (SELECT ${PAID_AT} AS paid_at, ${DELIVERED_AT} AS delivered_at
                       FROM orders o
                      WHERE o.status IN ('completed', 'refunded') AND ${PAID} AND ${notHouseOrder()}
                      ORDER BY o.created_at DESC
                      LIMIT ${DELIVERY_WINDOW * 2}) t
              WHERE t.paid_at IS NOT NULL AND t.delivered_at IS NOT NULL AND t.delivered_at >= t.paid_at
              ORDER BY t.delivered_at DESC
              LIMIT ${DELIVERY_WINDOW}) d`);
  const sample = Number(r?.n || 0);
  if (sample < MIN_SAMPLE) return { sample, median: null, mean: null, fastest: null };
  const secs = (v) => Math.max(1, Math.round(Number(v)));
  return { sample, median: secs(r.median), mean: secs(r.mean), fastest: secs(r.fastest) };
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
 * …and, through realFeedRow(), money changed hands and it was not the shop's
 * own order. The live feed reads "Anna bought …", and a giveaway, a demo
 * payment or the owner's own test order is no purchase by anybody.
 */
const REAL_SALE = `s.status = 'visible' AND s.test = 0 AND o.status = 'completed'`;
const realFeedRow = () => `${REAL_SALE} AND ${PAID} AND ${notHouseOrder()}`;

/** Live purchases feed (pinned first, then newest). Real visible events only. */
export async function liveFeed({ limit = 12 } = {}) {
  /* "Delivered in …" is read from the order's own history, payment to
     delivery, rather than from the number stored with the event: that one ran
     from when the order was PLACED and was capped at a day, so a code that took
     three days read "1440 min" and a slow payer's wait counted as ours. */
  const rows = await all(
    `SELECT s.id, s.first_name, s.city, s.product_label, s.category, s.created_at,
            ${PAID_AT} AS paid_at, ${DELIVERED_AT} AS delivered_at
       FROM social_events s
       JOIN orders o ON o.id = s.order_id
      WHERE ${realFeedRow()}
      ORDER BY s.pinned DESC, s.created_at DESC
      LIMIT @limit`, { limit: Math.min(50, Math.max(1, limit)) });
  return rows.map((r) => {
    const took = (Date.parse(r.delivered_at) - Date.parse(r.paid_at)) / 1000;
    return {
      id: r.id,
      // No English placeholder here: the storefront renders the fallback in the
      // reader's own language. A server-side "Someone" stayed English forever.
      name: r.first_name || null,
      city: r.city || null,
      item: r.product_label,
      category: r.category || '',
      // Null when either moment is missing: the line then says "Delivered", not a guess.
      deliverySeconds: Number.isFinite(took) && took >= 0 ? Math.max(1, Math.round(took)) : null,
      secondsAgo: secondsAgo(r.created_at),
    };
  });
}

// ── Real sales feed ─────────────────────────────────────────────────────────

export const SALES_PERIODS = { '1h': 3600, '24h': 86_400, '7d': 7 * 86_400, '30d': 30 * 86_400, all: null };

/**
 * The public sales feed: "Steam Wallet €20 sold · 4 minutes ago · NL · Gift cards".
 *
 * Only paid, still-completed, non-test orders that are not the shop's own
 * (realFeedRow). No name and no
 * city — a product, a time, a country and a category say "people buy here"
 * without saying who. Filters narrow the same rows; the filter options are
 * counted from those rows too, so a filter can only ever offer a category or a
 * country that actually sold, and never an empty choice made up to look busy.
 */
export async function salesFeed({ category = null, country = null, period = 'all', limit = 30 } = {}) {
  const span = SALES_PERIODS[period] === undefined ? null : SALES_PERIODS[period];
  const since = span ? new Date(Date.now() - span * 1000).toISOString() : null;
  const base = `FROM social_events s JOIN orders o ON o.id = s.order_id
                WHERE ${realFeedRow()} ${since ? 'AND s.created_at >= @since' : ''}`;
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

/**
 * Aggregate trust statistics — all derived from real rows, the same real sales
 * as everything above. This also feeds the advert claim gate, so a number here
 * is a number an advert may say out loud.
 *
 *   delivered / delivered30d   real sales still completed (30d: delivered in
 *                              the last 30 days, not ordered then)
 *   customers                  distinct buyers of those. It counted every
 *                              address that ever started a checkout, paid or not
 *   medianDeliverySeconds      payment → delivery, with deliverySample; the
 *                              mean and the fastest come along for the owner's
 *                              screen — all null below MIN_SAMPLE
 *   reviews / rating           verified buyers only, as reviewStats() counts
 *                              them. Discord vouches used to vote here too
 */
export async function trustStats() {
  const out = {
    delivered: 0, delivered30d: 0, customers: 0,
    medianDeliverySeconds: null, deliverySample: 0,
    avgDeliverySeconds: null, fastestDeliverySeconds: null,
    reviews: 0, rating: null, verifiedBuyers: 0,
  };
  const safe = async (fn) => { try { return await fn(); } catch { return null; } };
  const since = new Date(Date.now() - 30 * 864e5).toISOString();

  // Independent reads, so they go out together rather than one after another.
  const [sales, times, rev] = await Promise.all([
    safe(() => get(
      `SELECT COUNT(*) AS delivered,
              COUNT(*) FILTER (WHERE x.delivered_at >= @since) AS delivered30d,
              COUNT(DISTINCT LOWER(x.email)) AS customers
         FROM (SELECT o.email, ${DELIVERED_AT} AS delivered_at FROM orders o
                WHERE o.status = 'completed' AND ${PAID} AND ${notHouseOrder()}) x`, { since })),
    safe(() => deliveryTimes()),
    /* Inline rather than imported from reviewsService, which imports the
       social routes, which import this file. */
    safe(() => get(
      `SELECT COUNT(*) AS n, COALESCE(AVG(stars), 0) AS avg
         FROM reviews WHERE status = 'visible' AND verified = 1`)),
  ]);
  if (sales) {
    out.delivered = Number(sales.delivered || 0);
    out.delivered30d = Number(sales.delivered30d || 0);
    out.customers = Number(sales.customers || 0);
  }
  if (times) {
    out.deliverySample = times.sample;
    out.medianDeliverySeconds = times.median;
    out.avgDeliverySeconds = times.mean;
    out.fastestDeliverySeconds = times.fastest;
  }
  if (rev) {
    out.reviews = Number(rev.n || 0);
    out.verifiedBuyers = out.reviews;
    out.rating = out.reviews ? Math.round(Number(rev.avg) * 10) / 10 : null;
  }
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
