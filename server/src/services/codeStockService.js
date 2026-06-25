/**
 * Pre-loaded code stock per product. Admins paste a list of codes; when an order
 * is paid we auto-claim the right number and deliver them to the customer.
 */
import { run, get, all, nowIso, tx } from '../db/index.js';
import { newId } from '../utils/ids.js';

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
  return added;
}

export async function availableCount(productId) {
  const r = await get(`SELECT COUNT(*) AS n FROM product_codes WHERE product_id=@p AND status='available'`, { p: productId });
  return Number(r?.n || 0);
}

/** Available counts for several products → { productId: n }. */
export async function availableCounts(productIds = []) {
  const out = {};
  for (const id of productIds) out[id] = await availableCount(id);
  return out;
}

/** Claim up to `n` available codes for a product, marking them used by an order.
 *  Returns the claimed code strings (may be fewer than n if stock is low). */
export async function claimCodes(productId, n, orderId) {
  const claimed = [];
  await tx(async () => {
    const rows = await all(
      `SELECT id, code FROM product_codes WHERE product_id=@p AND status='available'
        ORDER BY created_at ASC LIMIT @n`, { p: productId, n });
    const at = nowIso();
    for (const row of rows) {
      await run(`UPDATE product_codes SET status='used', order_id=@o, used_at=@at WHERE id=@id AND status='available'`,
          { o: orderId, at, id: row.id });
      claimed.push(row.code);
    }
  });
  return claimed;
}
