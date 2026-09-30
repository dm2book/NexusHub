/**
 * The wishlist on the account, and the price alerts that make it worth having.
 *
 * ── WHAT A "PRICE DROP" IS HERE ───────────────────────────────────────────
 * Not "the price moved down". A product saved at €10 that went to €12 and then
 * to €11 has dropped, and it is still more expensive than when the shopper
 * saved it; announcing that as a deal is the kind of email that gets a shop
 * marked as spam. So an alert fires only when the new price is BELOW the
 * shopper's reference: the price they saved it at, or the price the last alert
 * already told them about. And, if they set one, at or below their target.
 *
 * ── WHY ALERTS ARE ARMED AND THEN SENT ────────────────────────────────────
 * The price changes inside an admin request (an edit, a bulk reprice, the
 * pricing engine publishing). Emailing every watcher inside that request makes
 * a product with a thousand watchers a request that times out half way. So a
 * price change only MARKS the rows (pending_from/pending_at); sendPendingAlerts
 * sends a bounded batch straight away and the maintenance sweep sends the rest.
 * At send time the CURRENT price is what is announced, so a price that went
 * back up in between is not announced at all.
 *
 * ── WHERE IT GOES ─────────────────────────────────────────────────────────
 * Email, in the shopper's own language, with a link that turns alerts off; and
 * a Discord DM through the bot relay when the account is linked. The DM is a
 * second channel, not a second opinion: both say the same three numbers.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { run, get, all, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { config } from '../config/env.js';
import { sendEmailAsync } from './emailService.js';

/** Two alerts for one saved product are at least this far apart. */
export const ALERT_COOLDOWN_HOURS = 6;
/** How many alerts a price change sends immediately; the sweep sends the rest. */
export const SEND_NOW_LIMIT = 25;

const LOCALE = { nl: 'nl-NL', en: 'en-IE', de: 'de-DE', fr: 'fr-FR' };
const langOf = (prefs) => {
  const l = String(prefs?.locale || '').slice(0, 2).toLowerCase();
  return LOCALE[l] ? l : 'nl';
};
export const formatPrice = (cents, lang = 'nl') =>
  new Intl.NumberFormat(LOCALE[lang] || LOCALE.nl, { style: 'currency', currency: 'EUR' })
    .format((Number(cents) || 0) / 100);

const appUrl = () => String(config.appUrl || '').replace(/\/+$/, '');

/* ── The list ──────────────────────────────────────────────────────────── */

/**
 * Save a product. Saving it again is not an error and does not reset the
 * price it was saved at — that price is the shopper's reference point.
 */
export async function addItem(userId, productId) {
  const p = await get(`SELECT id, price FROM products WHERE id = @p`, { p: productId });
  if (!p) return null;
  const at = nowIso();
  await run(`INSERT INTO wishlist_items (id, user_id, product_id, saved_price, created_at, updated_at)
             VALUES (@id, @u, @p, @price, @at, @at)
             ON CONFLICT (user_id, product_id) DO NOTHING`,
  { id: newId('wsh'), u: userId, p: productId, price: Number(p.price), at });
  return get(`SELECT * FROM wishlist_items WHERE user_id = @u AND product_id = @p`, { u: userId, p: productId });
}

export async function removeItem(userId, productId) {
  const r = await run(`DELETE FROM wishlist_items WHERE user_id = @u AND product_id = @p`, { u: userId, p: productId });
  return (r?.changes || 0) > 0;
}

/**
 * Bring a browser wishlist onto the account at sign-in. Unknown ids are
 * skipped; ids already saved keep their original saved price.
 */
export async function importItems(userId, productIds = []) {
  let added = 0;
  for (const id of [...new Set(productIds)].slice(0, 200)) {
    const before = await get(`SELECT id FROM wishlist_items WHERE user_id = @u AND product_id = @p`, { u: userId, p: id });
    if (before) continue;
    if (await addItem(userId, id)) added += 1;
  }
  return added;
}

/**
 * Turn an alert on or off, optionally with a target price. Saving the product
 * first when it is not on the list yet: a bell on a product page is a save.
 */
export async function setAlert(userId, productId, { enabled = true, targetPrice = null } = {}) {
  const item = await addItem(userId, productId);
  if (!item) return null;
  const target = targetPrice == null ? null : Math.max(0, Math.round(Number(targetPrice)));
  await run(`UPDATE wishlist_items SET alert_enabled = @e, target_price = @t, updated_at = @at
              WHERE user_id = @u AND product_id = @p`,
  { e: enabled ? 1 : 0, t: target, at: nowIso(), u: userId, p: productId });
  return get(`SELECT * FROM wishlist_items WHERE user_id = @u AND product_id = @p`, { u: userId, p: productId });
}

/**
 * The previous price of a product: the last price in its history that differs
 * from the current one. What the list shows as "was", beside what it saved at.
 */
async function previousPrices(productIds) {
  if (!productIds.length) return {};
  const rows = await all(
    `SELECT h.product_id, h.price, h.created_at FROM price_history h
       JOIN products p ON p.id = h.product_id
      WHERE h.product_id = ANY(@ids) AND h.price <> p.price
      ORDER BY h.created_at DESC`, { ids: productIds }).catch(() => []);
  const out = {};
  for (const r of rows) out[r.product_id] ??= Number(r.price);
  return out;
}

/**
 * The list as the shopper sees it: every saved product with its current price,
 * the price it was saved at, the price before its last change, and the
 * difference that matters to them — now against when they saved it.
 */
export async function listItems(userId) {
  const rows = await all(
    `SELECT w.*, p.name, p.price AS current_price, p.active, p.metadata, p.category, p.sku
       FROM wishlist_items w JOIN products p ON p.id = w.product_id
      WHERE w.user_id = @u ORDER BY w.created_at DESC`, { u: userId });
  const prev = await previousPrices(rows.map((r) => r.product_id));
  return rows.map((r) => {
    let meta = {};
    try { meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : (r.metadata || {}); } catch { meta = {}; }
    const current = Number(r.current_price);
    const saved = Number(r.saved_price);
    return {
      productId: r.product_id, name: r.name, sku: r.sku, category: r.category,
      image: meta.image || null, active: !!r.active,
      currentPrice: current,
      savedPrice: saved,
      previousPrice: prev[r.product_id] ?? null,
      /* Negative is cheaper than when it was saved. */
      diffSinceSaved: current - saved,
      alert: { enabled: !!r.alert_enabled, targetPrice: r.target_price == null ? null : Number(r.target_price) },
      savedAt: r.created_at,
    };
  });
}

/* ── Price changes ─────────────────────────────────────────────────────── */

/**
 * A product's price just changed. Marks every alert this makes due and sends
 * a bounded batch. Called from the two places that write products.price.
 * Never throws: a price change must not fail because an email did.
 */
export async function onPriceChanged(productId, oldPrice, newPrice) {
  try {
    if (!(Number(newPrice) < Number(oldPrice))) return { armed: 0, sent: 0 };
    /* Keep the FIRST price of a run of drops as "previous": two cuts before
       the sender runs are one drop from where the shopper last saw it. */
    const r = await run(
      `UPDATE wishlist_items
          SET pending_from = COALESCE(pending_from, @old), pending_at = COALESCE(pending_at, @at)
        WHERE product_id = @p AND alert_enabled = 1
          AND @new < COALESCE(last_notified_price, saved_price)
          AND (target_price IS NULL OR @new <= target_price)`,
      { p: productId, old: Number(oldPrice), new: Number(newPrice), at: nowIso() });
    const armed = r?.changes || 0;
    const sent = armed ? (await sendPendingAlerts({ limit: SEND_NOW_LIMIT, productId })).sent : 0;
    return { armed, sent };
  } catch (e) {
    console.error('[wishlist] arming price alerts failed:', e.message);
    return { armed: 0, sent: 0, error: e.message };
  }
}

/** The link in every alert that turns them all off, without signing in. */
export function alertsOffToken(userId) {
  return createHmac('sha256', config.auth.jwtSecret).update(`wishlist-alerts:${userId}`).digest('hex').slice(0, 32);
}
export const alertsOffUrl = (userId) =>
  `${appUrl()}/api/wishlist/alerts/off?u=${encodeURIComponent(userId)}&t=${alertsOffToken(userId)}`;

/** Constant-time, like the newsletter's: a token check that leaks timing is not one. */
function tokenOk(userId, token) {
  const want = Buffer.from(alertsOffToken(userId));
  const got = Buffer.from(String(token || ''));
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function disableAllAlerts(userId, token) {
  if (!tokenOk(userId, token)) return false;
  await run(`UPDATE wishlist_items SET alert_enabled = 0, pending_from = NULL, pending_at = NULL, updated_at = @at
              WHERE user_id = @u`, { u: userId, at: nowIso() });
  return true;
}

/** The DM: the same three numbers as the email. */
export function dmFor({ name, url, previous, current, lang }) {
  const fmt = (c) => formatPrice(c, lang);
  return {
    embeds: [{
      title: `\u{1F4C9} ${name}`,
      url,
      description: `~~${fmt(previous)}~~ → **${fmt(current)}**  (−${fmt(previous - current)})\n\n`
        + `[${lang === 'nl' ? 'Bekijk het product' : lang === 'de' ? 'Zum Produkt' : lang === 'fr' ? 'Voir le produit' : 'View the product'}](${url})`,
      color: 0x22c55e,
      footer: { text: `${config.email.fromName} · ${lang === 'nl' ? 'verlanglijst' : lang === 'de' ? 'Wunschliste' : lang === 'fr' ? 'liste de souhaits' : 'wishlist'}` },
      timestamp: new Date().toISOString(),
    }],
  };
}

/**
 * Send the alerts that are due. Re-reads the current price for each: a price
 * that went back up since it was armed is dropped silently, because the news
 * it was armed for is no longer true.
 */
export async function sendPendingAlerts({ limit = 50, productId = null } = {}) {
  const cooldown = new Date(Date.now() - ALERT_COOLDOWN_HOURS * 3_600_000).toISOString();
  const rows = await all(
    `SELECT w.*, p.name, p.price AS current_price, p.active, u.email, u.display_name, u.preferences
       FROM wishlist_items w
       JOIN products p ON p.id = w.product_id
       JOIN users u ON u.id = w.user_id
      WHERE w.pending_at IS NOT NULL AND w.alert_enabled = 1
        AND (w.last_notified_at IS NULL OR w.last_notified_at < @cool)
        ${productId ? 'AND w.product_id = @p' : ''}
      ORDER BY w.pending_at ASC LIMIT @l`, { cool: cooldown, p: productId, l: limit });

  const { discordUidForUser } = await import('./discordRolesService.js');
  const { relayDm } = await import('./discordService.js');
  let sent = 0;
  let dropped = 0;

  for (const r of rows) {
    const current = Number(r.current_price);
    const reference = Number(r.last_notified_price ?? r.saved_price);
    const target = r.target_price == null ? null : Number(r.target_price);
    const stillTrue = r.active && current < reference && (target == null || current <= target);
    if (!stillTrue) {
      await run(`UPDATE wishlist_items SET pending_from = NULL, pending_at = NULL WHERE id = @id`, { id: r.id });
      dropped += 1;
      continue;
    }

    let prefs = {};
    try { prefs = typeof r.preferences === 'string' ? JSON.parse(r.preferences || '{}') : (r.preferences || {}); } catch { prefs = {}; }
    const lang = langOf(prefs);
    /* "Previous" is the price before this drop; never above what the shopper
       last knew, so the difference shown is the saving that is new to them. */
    const previous = Math.min(Number(r.pending_from ?? reference), reference);
    const url = `${appUrl()}/product/${r.product_id}`;

    /* Claim before sending, so a second sender running at the same time finds
       nothing to do rather than sending the same alert twice. */
    const claim = await run(
      `UPDATE wishlist_items SET pending_from = NULL, pending_at = NULL,
              last_notified_price = @cur, last_notified_at = @at, updated_at = @at
        WHERE id = @id AND pending_at IS NOT NULL`, { cur: current, at: nowIso(), id: r.id });
    if (!claim?.changes) continue;

    await sendEmailAsync('price_drop', r.email, {
      lang,
      user: { name: r.display_name || String(r.email).split('@')[0] },
      product: { name: r.name, url },
      price: {
        previous: formatPrice(previous, lang),
        current: formatPrice(current, lang),
        diff: formatPrice(previous - current, lang),
        saved: formatPrice(r.saved_price, lang),
      },
      wishlist: { url: `${appUrl()}/wishlist`, alertsOffUrl: alertsOffUrl(r.user_id) },
    });

    const uid = await discordUidForUser(r.user_id).catch(() => null);
    if (uid) await relayDm(uid, dmFor({ name: r.name, url, previous, current, lang })).catch(() => {});
    sent += 1;
  }
  return { sent, dropped };
}
