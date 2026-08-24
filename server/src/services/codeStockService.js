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
import { notifyOwner, discordTarget } from './notifyService.js';

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
    await run(`UPDATE products SET low_stock_alerted_at = NULL, low_stock_alert_level = NULL
                WHERE id = @p`, { p: productId }).catch(() => {});
    // `category` rides along so the community bot can ping the game role for
    // this product rather than everyone who opted into any drop at all.
    const product = await get(
      `SELECT id, name, price, currency, active, category FROM products WHERE id = @p`,
      { p: productId });
    if (product?.active) {
      await postDropEvent('restock', { ...product, added }).catch(() => {});
    }
  }
  return added;
}

/**
 * Which alert tier a remaining count falls into, or null for "plenty".
 *
 * The most SEVERE matching tier wins, so a product that drops from 12 to 3 in
 * one order announces "critical", not "low" and then "critical" — the owner
 * wants to know where the stock is now, not to be walked down the ladder.
 *
 * 0 is exact rather than "below": `remaining < 0` is impossible, and "out of
 * stock" is a different statement from "nearly out".
 */
export function stockTierFor(remaining, tiers = config.stock.alertTiers) {
  const ascending = [...tiers].sort((a, b) => a - b);
  for (const t of ascending) {
    if (t === 0 ? remaining === 0 : remaining < t) return t;
  }
  return null;
}

/** The event name and wording that belong to a tier. */
function tierMessage(tier, product, remaining) {
  if (tier === 0) {
    return {
      event: 'stock.out',
      title: `Out of stock: ${product.name}`,
      lines: [
        'No codes left. New orders for this product cannot be delivered automatically.',
        'Load codes now, or take the product offline until you can.',
      ],
    };
  }
  const critical = tier <= 5;
  return {
    event: critical ? 'stock.critical' : 'stock.low',
    title: `${critical ? 'Stock critical' : 'Low stock'}: ${product.name}`,
    lines: [
      `${remaining} code${remaining === 1 ? '' : 's'} left — below the ${tier} mark.`,
      critical
        ? 'This runs out in the next few orders. Load more today.'
        : 'Worth topping up before it becomes urgent.',
    ],
  };
}

/**
 * After codes are claimed, walk the stock-alert ladder.
 *
 * One alert per tier per stock cycle: crossing 10 says so, crossing 5 says so
 * again, hitting 0 says so once more, and none of them repeats while the stock
 * stays there. Restocking clears the ladder and re-arms every rung.
 *
 * The gate is a single conditional UPDATE, so this is safe under concurrency:
 * two orders that cross the same tier at the same moment race on one row, and
 * only the one that changes it sends. Best-effort throughout — a stock alert
 * must never be the reason an order fails.
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
    const tier = stockTierFor(remaining);
    if (tier === null) return;

    /* Claim this rung atomically.

       `low_stock_alert_level` holds the lowest tier already announced for the
       current stock cycle, so the condition below answers three questions at
       once: has anything been announced yet, is this rung more severe than the
       last one, and did a concurrent order just claim it. Exactly one caller
       gets changes > 0. */
    const claimed = await run(
      `UPDATE products SET low_stock_alert_level = @tier, low_stock_alerted_at = @at
        WHERE id = @p AND (low_stock_alert_level IS NULL OR low_stock_alert_level > @tier)`,
      { tier, at: nowIso(), p: productId });
    if (!claimed?.changes) return;

    const product = await get(`SELECT id, name FROM products WHERE id = @p`, { p: productId });
    if (!product) return;
    const { event, title, lines: body } = tierMessage(tier, product, remaining);

    /* Two Discord paths exist, and they can be the same channel.

       postStockAlert is the staff one: it has its own webhook and, with none
       set, queues to the relay outbox for the community bot — the setup this
       project documents, and the only path that works with no Discord secrets
       on the host. notifyOwner is the owner's direct one, and its fallback is
       the order webhook. When the staff alert would land exactly where the owner
       alert already goes, sending both means every stock warning arrives twice
       in one channel. Skip the duplicate and keep the richer message, which is
       also the one carrying Telegram. */
    const staffUrl = config.discord.stockWebhookUrl || config.discord.orderWebhookUrl;
    const ownerUrl = discordTarget();
    if (!(staffUrl && staffUrl === ownerUrl)) {
      await postStockAlert(product, remaining, tier).catch(() => {});
    }
    await notifyOwner(event, {
      title,
      lines: body,
      url: `${config.appUrl}/admin/products`,
    }).catch(() => {});
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
