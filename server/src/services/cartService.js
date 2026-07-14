/**
 * Saved carts for signed-in shoppers + abandoned-cart recovery.
 *
 * The storefront mirrors a logged-in user's cart here so it follows them across
 * devices and so we can send ONE gentle "you left items behind" reminder if the
 * cart sits untouched without an order. Idempotent: reminded_at is stamped
 * before sending, and a later cart change re-arms a new reminder.
 */
import { all, get, run, nowIso } from '../db/index.js';
import { formatMoney } from '../utils/money.js';
import { sendEmailAsync } from './emailService.js';
import { notify } from './notificationService.js';
import { config } from '../config/env.js';

const parse = (s) => { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

/** Sanitise + cap the cart the client sends (never trust it verbatim). */
function clean(items = []) {
  return (Array.isArray(items) ? items : []).slice(0, 50).map((i) => ({
    id: String(i.id || '').slice(0, 80),
    name: String(i.name || '').slice(0, 160),
    price: Math.max(0, Math.round(Number(i.price) || 0)),
    currency: String(i.currency || 'EUR').slice(0, 3),
    qty: Math.max(1, Math.min(999, Math.round(Number(i.qty) || 1))),
  })).filter((i) => i.id);
}

/** Upsert the user's cart. Clearing it (empty) is allowed and clears the mirror. */
export async function saveCart(userId, items) {
  const cleaned = clean(items);
  const at = nowIso();
  await run(
    `INSERT INTO saved_carts (user_id, items, updated_at) VALUES (@u, @i, @at)
       ON CONFLICT (user_id) DO UPDATE SET items = @i, updated_at = @at`,
    { u: userId, i: JSON.stringify(cleaned), at });
  return cleaned;
}

export async function getCart(userId) {
  const row = await get('SELECT items FROM saved_carts WHERE user_id=@u', { u: userId });
  return row ? parse(row.items) : [];
}

const itemsHtml = (items, currency = 'EUR') =>
  `<table class="summary">${items.map((i) =>
    `<tr><td>${i.qty}× ${escapeHtml(i.name || 'Item')}</td>` +
    `<td class="r">${formatMoney((i.price || 0) * (i.qty || 1), i.currency || currency)}</td></tr>`).join('')}</table>`;

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Send one reminder per abandoned cart: has items, untouched for `afterHours`
 * (but not older than `maxDays`), no order placed since the cart changed, and
 * not already reminded for this cart version. Claims reminded_at atomically.
 */
export async function sendCartReminders({ afterHours = 4, maxDays = 14, limit = 25 } = {}) {
  const staleBefore = new Date(Date.now() - afterHours * 3_600_000).toISOString();
  const tooOld = new Date(Date.now() - maxDays * 86_400_000).toISOString();
  const rows = await all(
    `SELECT sc.user_id, sc.items, sc.updated_at, u.email, u.display_name
       FROM saved_carts sc JOIN users u ON u.id = sc.user_id
      WHERE sc.items <> '[]' AND u.email IS NOT NULL
        AND sc.updated_at < @staleBefore AND sc.updated_at > @tooOld
        AND (sc.reminded_at IS NULL OR sc.reminded_at < sc.updated_at)
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = sc.user_id AND o.created_at > sc.updated_at)
      ORDER BY sc.updated_at ASC LIMIT @limit`,
    { staleBefore, tooOld, limit });

  let sent = 0;
  for (const row of rows) {
    const items = parse(row.items);
    if (!items.length) continue;
    // Claim atomically so parallel maintenance runs never double-send.
    const claim = await run(
      `UPDATE saved_carts SET reminded_at = @at
        WHERE user_id = @u AND (reminded_at IS NULL OR reminded_at < updated_at)`,
      { at: nowIso(), u: row.user_id });
    if (!claim?.changes) continue;
    await sendEmailAsync('cart_reminder', row.email, {
      user: { name: row.display_name || row.email.split('@')[0] },
      cart: { itemsHtml: itemsHtml(items), url: `${config.appUrl}/cart` },
    });
    await notify(row.user_id, {
      type: 'system', title: 'You left items in your cart 🛒',
      body: `${items.reduce((n, i) => n + (i.qty || 1), 0)} item(s) are waiting — complete your order any time.`,
      link: '/cart',
    }).catch(() => {});
    sent++;
  }
  return sent;
}
