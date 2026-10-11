/**
 * The trust layer: what a buyer can check about a product before paying —
 * measured from this shop's own orders, never typed in.
 *
 * ── WHAT IT SHOWS, AND WHEN ───────────────────────────────────────────────
 *   stock             from the code stock and the delivery mode: in stock
 *                     (auto-delivered codes on the shelf), bought in per order
 *                     (delivered by hand), or out of stock
 *   lastDelivery      when an order with this product was last delivered
 *   successfulOrders  delivered and not refunded
 *   fulfillmentRate   delivered ÷ settled paid orders           (≥ MIN_SAMPLE)
 *   refundRate        refunded ÷ settled paid orders            (≥ MIN_SAMPLE)
 *   medianDelivery    paid → delivered, the median — what the   (≥ MIN_TIMED)
 *                     product page shows, saying it is a median
 *   avgDelivery       the same orders' mean, for the owner's table
 *   score             0–100, only once the rates exist
 * A field without data is absent — not zero, not "—", not an estimate. A
 * percentage over two orders says more about chance than about the shop, so
 * the rates and the score wait for MIN_SAMPLE settled orders.
 *
 * ── WHICH ORDERS COUNT ────────────────────────────────────────────────────
 * Paid ones (money changed hands: a total above zero or store credit spent —
 * a 100% coupon or a giveaway is not a sale), not paid on a provider's test
 * key or by the demo self-payment, not placed by the shop's own staff (see
 * socialProofService), and settled: completed, refunded, cancelled or failed
 * after payment. An order still being worked on counts for nothing yet. An
 * order with several products counts for each of them.
 *
 * Delivery time runs from when the BUYER paid — the first proof of payment
 * they sent, or our confirmation if that came first — to delivery. Timing from
 * our confirmation alone left out the wait for a person to check a Tikkie.
 *
 * ── THE SCORE ─────────────────────────────────────────────────────────────
 *   fulfilment   40  × the fulfilment rate
 *   refunds      20  × (1 − the refund rate)
 *   track record 20  grows with successful orders, full at 50
 *   orderable    10  in stock or bought in per order; 0 when out of stock
 *   recent       10  last delivery within 30 days (5 within 90)
 * and the total is multiplied by the fulfilment rate, so a product that mostly
 * did not deliver cannot score well on stock and recency.
 * No reviews go into it and none are shown here: reviews have their own,
 * verified-buyer-only system (reviewsService).
 */
import { all } from '../db/index.js';
import { isTestKey as stripeTestKey } from './stripeService.js';
import { isTestKey as mollieTestKey } from './mollieService.js';
import { PAID_AT, DEMO_ORDER, STAFF_ORDER } from './socialProofService.js';

export const MIN_SAMPLE = 5;
export const MIN_TIMED = 3;
const SETTLED = ['completed', 'refunded', 'cancelled', 'failed'];
const DAY = 86_400_000;

/* The orders behind one product (or all of them), with the moments that matter.
   paid_at is our confirmation (was it paid at all?); buyer_paid_at is when the
   buyer paid, which is where a delivery time starts. */
const ORDERS_SQL = (where) => `
  SELECT oi.product_id, o.id, o.status, o.payment_status, o.psp_provider, o.total, o.billing, o.updated_at,
         (SELECT MIN(h.created_at) FROM order_status_history h WHERE h.order_id = o.id AND h.to_status = 'payment_received') AS paid_at,
         ${PAID_AT} AS buyer_paid_at,
         (SELECT MAX(h.created_at) FROM order_status_history h WHERE h.order_id = o.id AND h.to_status = 'completed') AS completed_at,
         EXISTS (SELECT 1 FROM refund_requests r WHERE r.order_id = o.id AND r.status IN ('approved', 'processed')) AS refund_granted,
         EXISTS (SELECT 1 FROM social_events s WHERE s.order_id = o.id AND s.test = 1) AS test_event,
         ${DEMO_ORDER} AS demo, ${STAFF_ORDER} AS staff
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
   WHERE ${where}`;

const parse = (s) => { try { return typeof s === 'string' ? JSON.parse(s || '{}') : (s || {}); } catch { return {}; } };
const truthy = (v) => v === true || v === 1 || v === 't' || v === '1';

/** The middle value (the mean of the middle two for an even count). */
export function median(values) {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Money changed hands, for real. */
export function isRealSale(o) {
  const credit = Number(parse(o.billing).creditApplied || 0);
  if (!(Number(o.total) > 0 || credit > 0)) return false;
  if (truthy(o.test_event)) return false;
  // A demo payment moved no money; the shop's own order is the shop testing itself.
  if (truthy(o.demo) || truthy(o.staff)) return false;
  if (o.psp_provider === 'stripe' && stripeTestKey()) return false;
  if (o.psp_provider === 'mollie' && mollieTestKey()) return false;
  const paid = !!o.paid_at || ['paid', 'refunded'].includes(o.payment_status) || ['completed', 'refunded'].includes(o.status);
  return paid;
}

/** Stock as the storefront can honestly state it. */
export function stockState(product, count) {
  if (!product) return null;
  if (product.deliveryMode === 'auto' && count > 0) return { state: 'in_stock', ...(count <= 6 ? { left: count } : {}) };
  /* No codes on the shelf is not "sold out": the order is taken and bought in
     by hand, which is exactly what the product page's delivery box says.
     Reading "Uitverkocht" under "Op bestelling leverbaar" told buyers both. */
  return { state: 'on_order' };
}

/** The trust facts for one product, from its orders. Only what exists. */
export function computeTrust(orders, { stock = null, now = Date.now() } = {}) {
  const real = orders.filter(isRealSale).filter((o) => SETTLED.includes(o.status));
  const delivered = real.filter((o) => o.status === 'completed' || (o.status === 'refunded' && o.completed_at));
  const refunded = real.filter((o) => o.status === 'refunded' || truthy(o.refund_granted));
  const successful = delivered.filter((o) => !refunded.includes(o));
  const out = {};
  if (stock) out.stock = stock;

  const deliveredAt = delivered.map((o) => Date.parse(o.completed_at || (o.status === 'completed' ? o.updated_at : ''))).filter(Number.isFinite);
  if (deliveredAt.length) out.lastDelivery = new Date(Math.max(...deliveredAt)).toISOString();
  if (successful.length) out.successfulOrders = successful.length;

  if (real.length >= MIN_SAMPLE) {
    out.sample = real.length;
    out.fulfillmentRate = Math.round((delivered.length / real.length) * 1000) / 10;
    out.refundRate = Math.round((refunded.length / real.length) * 1000) / 10;
  }
  /* Only orders with both moments on record: paid, then delivered. created_at
     would also count the time a buyer took to pay. */
  const timed = delivered.map((o) => Date.parse(o.completed_at) - Date.parse(o.buyer_paid_at ?? o.paid_at))
    .filter((ms) => Number.isFinite(ms) && ms >= 0);
  if (timed.length >= MIN_TIMED) {
    /* The median is what a buyer is told: one order stuck over a weekend moves
       a mean far from what a typical buyer waits, and barely moves a median.
       The mean stays for the owner, whose table says "average". */
    out.medianDelivery = { seconds: Math.round(median(timed) / 1000), orders: timed.length };
    out.avgDelivery = { seconds: Math.round(timed.reduce((a, b) => a + b, 0) / timed.length / 1000), orders: timed.length };
  }

  if (out.fulfillmentRate != null) {
    const track = Math.min(1, Math.log10(1 + successful.length) / Math.log10(51));
    const orderable = !stock || stock.state !== 'out_of_stock' ? 10 : 0;
    const age = out.lastDelivery ? now - Date.parse(out.lastDelivery) : Infinity;
    const recent = age <= 30 * DAY ? 10 : age <= 90 * DAY ? 5 : 0;
    /* × the fulfilment rate: stock and recency cannot lift a product that
       mostly did not deliver. */
    const base = 40 * (out.fulfillmentRate / 100) + 20 * (1 - out.refundRate / 100) + 20 * track + orderable + recent;
    out.score = Math.max(0, Math.min(100, Math.round(base * (out.fulfillmentRate / 100))));
  }
  return out;
}

/** One product's trust facts. */
export async function productTrust(product, count) {
  const orders = await all(ORDERS_SQL('oi.product_id = @id'), { id: product.id });
  return computeTrust(orders, { stock: stockState(product, count) });
}

/** Every active product with its trust facts, for the admin. */
export async function trustReport() {
  const { listProducts } = await import('./productService.js');
  const { availableCounts } = await import('./codeStockService.js');
  const products = (await listProducts({ activeOnly: true })) || [];
  const counts = await availableCounts(products.map((p) => p.id)).catch(() => ({}));
  const rows = await all(ORDERS_SQL('oi.product_id IS NOT NULL'));
  const by = new Map();
  for (const r of rows) { if (!by.has(r.product_id)) by.set(r.product_id, []); by.get(r.product_id).push(r); }
  const items = products.map((p) => {
    const count = Number(counts?.[p.id] || 0);
    return { id: p.id, name: p.name, category: p.category, ...computeTrust(by.get(p.id) || [], { stock: stockState(p, count) }) };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (b.successfulOrders || 0) - (a.successfulOrders || 0) || a.name.localeCompare(b.name));
  return { minSample: MIN_SAMPLE, minTimed: MIN_TIMED, total: items.length, scored: items.filter((i) => i.score != null).length, items };
}
