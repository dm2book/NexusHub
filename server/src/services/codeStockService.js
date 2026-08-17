/**
 * Pre-loaded code stock per product. Admins paste a list of codes; when an order
 * is paid we auto-claim the right number and deliver them to the customer.
 * Stock movements also drive the Discord automations: restocks are announced in
 * #drops-and-deals and staff get one low-stock alert when supply runs short.
 */
import { run, get, all, nowIso, tx } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { config } from '../config/env.js';
import { postDropEvent, postStockAlert } from './discordService.js';

/** Add a batch of codes (array of strings) to a product's stock. Returns count added. */
export async function addProductCodes(productId, codes = []) {
  const clean = [...new Set(codes.map((c) => String(c).trim()).filter(Boolean))];
  const at = nowIso();
  let added = 0;
  await tx(async () => {
    for (const code of clean) {
      await run(`INSERT INTO product_codes (id, product_id, code, status, created_at)
           VALUES (@id, @p, @c, 'available', @at)`,
          { id: newId('pcd'), p: productId, c: code, at });
      added++;
    }
  });
  if (added > 0) {
    // Restock: re-arm the low-stock alert and announce it to the community.
    await run(`UPDATE products SET low_stock_alerted_at = NULL WHERE id = @p`, { p: productId })
      .catch(() => {});
    const product = await get(`SELECT id, name, price, currency, active FROM products WHERE id = @p`, { p: productId });
    if (product?.active) {
      await postDropEvent('restock', { ...product, added }).catch(() => {});
    }
  }
  return added;
}

/**
 * After codes are claimed, alert staff once when a product's remaining stock
 * falls below the threshold. The products.low_stock_alerted_at stamp keeps it
 * to a single alert per stock cycle (cleared again on restock). Best-effort.
 */
export async function checkLowStock(productId) {
  try {
    // No webhook does NOT mean nowhere to alert. postStockAlert delivers through
    // deliver(), which queues to the relay outbox when no webhook is set — and
    // relay-only ("run the bot, put no Discord secrets on the host") is the setup
    // this project documents. So this guard silently disabled low-stock alerts on
    // exactly the configuration most owners run: the shop sold out quietly and
    // the first sign was an order nobody could fill.
    const remaining = await availableCount(productId);
    if (remaining >= config.discord.lowStockThreshold) return;
    // Claim the alert atomically so concurrent orders produce only one ping.
    const r = await run(
      `UPDATE products SET low_stock_alerted_at = @at
        WHERE id = @p AND low_stock_alerted_at IS NULL`,
      { at: nowIso(), p: productId });
    if (!r?.changes) return;
    const product = await get(`SELECT id, name FROM products WHERE id = @p`, { p: productId });
    if (product) await postStockAlert(product, remaining);
  } catch (err) {
    console.error('[stock] low-stock check failed:', err.message);
  }
}

export async function availableCount(productId) {
  const r = await get(`SELECT COUNT(*) AS n FROM product_codes WHERE product_id=@p AND status='available'`, { p: productId });
  return Number(r?.n || 0);
}

/**
 * Available counts for several products → { productId: n }.
 *
 * ONE grouped query, not one per product. This was a `for` loop with an `await`
 * inside it, so /api/products issued 1 + 72 queries — and 1 + N for whatever the
 * catalogue grows to. Each individual count is a fast index scan
 * (idx_product_codes_avail), so this was never slow locally; the cost is 72
 * sequential ROUND TRIPS, and on a managed Postgres in another region at ~25ms
 * each that is roughly 1.8 seconds of pure waiting before the response starts.
 *
 * Promise.all would not have fixed it either: the pool caps at 5 connections,
 * so 72 parallel counts just become 15 waves instead of 72.
 *
 * Products with no rows are absent from the GROUP BY, so they are filled in as
 * 0 — a missing key here would render as "out of stock" instead of "unlimited",
 * which are opposite claims.
 */
export async function availableCounts(productIds = []) {
  const out = {};
  if (!productIds.length) return out;
  for (const id of productIds) out[id] = 0;
  const rows = await all(
    `SELECT product_id, COUNT(*)::int AS n
       FROM product_codes
      WHERE status = 'available' AND product_id = ANY(@ids)
      GROUP BY product_id`, { ids: productIds });
  for (const r of rows) out[r.product_id] = Number(r.n || 0);
  return out;
}

/** Claim up to `n` available codes for a product, marking them used by an order.
 *  Returns the claimed code strings (may be fewer than n if stock is low).
 *
 *  Race-safe: rows are selected with `FOR UPDATE SKIP LOCKED` inside a
 *  transaction, so two concurrent orders can never grab the same code (no
 *  double-delivery / duplicate assignment). Idempotent per order — if this order
 *  already holds codes for the product they're returned instead of claiming more. */
export async function claimCodes(productId, n, orderId) {
  let claimed = [];
  await tx(async () => {
    // Already claimed by THIS order? Return them (idempotent re-delivery).
    const existing = await all(
      `SELECT code FROM product_codes WHERE product_id=@p AND order_id=@o AND status='used'
        ORDER BY used_at ASC`, { p: productId, o: orderId });
    if (existing.length >= n) { claimed = existing.slice(0, n).map((r) => r.code); return; }

    const need = n - existing.length;
    const rows = await all(
      `SELECT id, code FROM product_codes
        WHERE product_id=@p AND status='available'
        ORDER BY created_at ASC LIMIT @n
        FOR UPDATE SKIP LOCKED`, { p: productId, n: need });
    const at = nowIso();
    const fresh = [];
    for (const row of rows) {
      await run(`UPDATE product_codes SET status='used', order_id=@o, used_at=@at WHERE id=@id`,
          { o: orderId, at, id: row.id });
      fresh.push(row.code);
    }
    claimed = [...existing.map((r) => r.code), ...fresh];
  });
  return claimed;
}

/**
 * Put codes claimed for an order back on the shelf.
 *
 * Claiming happens before delivery, so a delivery that is then refused — an
 * order refunded or cancelled in the same instant it was being auto-dispensed —
 * would otherwise leave those codes marked `used` against an order nobody ever
 * received. Silent, permanent stock loss that only shows up as a product that
 * mysteriously sells out early.
 *
 * Only codes that were never handed over are released: anything already written
 * into `deliveries` has reached the buyer and must stay claimed.
 */
export async function releaseCodes(orderId) {
  const rows = await all(
    `SELECT id, code FROM product_codes WHERE order_id=@o AND status='used'`, { o: orderId });
  if (!rows.length) return 0;
  const delivered = new Set((await all(
    'SELECT content FROM deliveries WHERE order_id=@o', { o: orderId })).map((d) => d.content));
  let freed = 0;
  for (const row of rows) {
    if (delivered.has(row.code)) continue;
    await run(`UPDATE product_codes SET status='available', order_id=NULL, used_at=NULL WHERE id=@id`,
        { id: row.id });
    freed++;
  }
  return freed;
}
