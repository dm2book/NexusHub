/**
 * Forge Coins — a loyalty currency members earn by shopping and spend in the
 * Forge Shop. Real balance only: it's the SUM of an append-only ledger, never a
 * cached number that can drift.
 *
 *   Earn:  1 coin per €10 of paid spend (floor), awarded once per order.
 *   Spend: redeem coins for a personal discount coupon (or a giveaway boost).
 */
import { get, all, run, tx, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { badRequest } from '../utils/errors.js';
import { createCoupon } from './couponService.js';

export const COINS_PER_EURO_CENTS = 1000; // €10 = 1 coin

/** The built-in Forge Shop catalog — what coins buy. Admin-added items (stored in
 *  forge_shop_items) are merged on top of these at read time.
 *
 *  Pricing note: members earn 1 coin per €10 spent, so a reward costing N coins
 *  represents €(N×10) of spend. These costs keep the effective payback around
 *  3–3.5% (sustainable against the store's ~18% margin) — a big reward is a
 *  little better value to reward saving up. Don't drop them below ~1.5 coins per
 *  €1 of discount or you give margin away. */
export const FORGE_SHOP = [
  { id: 'coupon5', kind: 'coupon', cost: 15, value: 500, label: '€5 discount code', blurb: '€5 off your next order.' },
  { id: 'coupon10', kind: 'coupon', cost: 28, value: 1000, label: '€10 discount code', blurb: '€10 off your next order — saves you a coin.' },
  { id: 'coupon25', kind: 'coupon', cost: 65, value: 2500, label: '€25 discount code', blurb: '€25 off any order — best value.' },
  { id: 'boost', kind: 'boost', cost: 8, value: 1, label: 'Giveaway boost', blurb: '+1 bonus entry in this week’s giveaway (claim in Discord).' },
];

/** Admin-managed Forge Shop items, shaped like FORGE_SHOP entries. */
export async function listShopItems() {
  const rows = await all(`SELECT * FROM forge_shop_items WHERE active=1 ORDER BY cost ASC`);
  return rows.map((r) => ({
    id: r.id, kind: 'coupon', cost: Number(r.cost), value: Number(r.value),
    couponKind: r.coupon_kind === 'percent' ? 'percent' : 'fixed',
    label: r.label, blurb: r.blurb || '',
  }));
}

/** The full shop (built-in + admin items) that the account page shows. */
export async function forgeShopCatalog() {
  return [...FORGE_SHOP, ...(await listShopItems())];
}

/** Resolve a reward id to a built-in or admin-defined item (null if unknown). */
async function findReward(rewardId) {
  const builtin = FORGE_SHOP.find((r) => r.id === rewardId);
  if (builtin) return { ...builtin, couponKind: 'fixed' };
  const items = await listShopItems();
  return items.find((r) => r.id === rewardId) || null;
}

/** Current balance = SUM(delta). */
export async function coinBalance(userId) {
  if (!userId) return 0;
  const r = await get('SELECT COALESCE(SUM(delta),0) AS n FROM forge_coin_ledger WHERE user_id=@u', { u: userId });
  return Number(r?.n || 0);
}

/** Recent ledger entries for the account page. */
export function coinHistory(userId, limit = 20) {
  return all(
    `SELECT delta, reason, ref, created_at AS createdAt FROM forge_coin_ledger
      WHERE user_id=@u ORDER BY created_at DESC LIMIT @l`, { u: userId, l: limit });
}

/**
 * Award coins for a paid order — idempotent: the unique (reason,ref) index means
 * a retried payment never double-awards. €10 → 1 coin (floor).
 */
export async function awardCoinsForOrder(order) {
  if (!order?.userId) return 0;
  const coins = Math.floor(Number(order.total || 0) / COINS_PER_EURO_CENTS);
  if (coins <= 0) return 0;
  try {
    await run(
      `INSERT INTO forge_coin_ledger (id, user_id, delta, reason, ref, created_at)
       VALUES (@id, @u, @d, 'order', @ref, @at)`,
      { id: newId('coin'), u: order.userId, d: coins, ref: order.id, at: nowIso() });
    return coins;
  } catch { return 0; } // unique-index clash = already awarded
}

/** Admin: grant (or deduct) coins. Negative grants never take a balance below 0. */
export async function grantCoins(userId, amount, grantedBy = null) {
  const delta = Math.round(Number(amount));
  if (!delta) throw badRequest('Amount must be a non-zero whole number.');
  return tx(async () => {
    if (delta < 0) {
      const balance = await coinBalance(userId);
      if (balance + delta < 0) throw badRequest(`Balance is ${balance} — can't deduct ${-delta}.`);
    }
    // ref stays NULL: the (reason,ref) unique index is for order-earn dedupe
    // and would otherwise block a second grant by the same admin. Attribution
    // lives in the audit log.
    await run(
      `INSERT INTO forge_coin_ledger (id, user_id, delta, reason, ref, created_at)
       VALUES (@id, @u, @d, 'grant', NULL, @at)`,
      { id: newId('coin'), u: userId, d: delta, at: nowIso() });
    return { balance: await coinBalance(userId) };
  });
}

/** Spend coins on a Forge Shop reward. Returns { reward, couponCode? }. */
export async function redeemReward(userId, rewardId) {
  const reward = await findReward(rewardId);
  if (!reward) throw badRequest('Unknown reward.');
  return tx(async () => {
    const balance = await coinBalance(userId);
    if (balance < reward.cost) throw badRequest(`Not enough Forge Coins — you need ${reward.cost}, you have ${balance}.`);
    // For coupons, the generated code doubles as the ledger ref so the buyer
    // can always find it back in their history (a toast is easy to miss).
    const code = reward.kind === 'coupon'
      ? `FORGE${Math.random().toString(36).slice(2, 7).toUpperCase()}` : null;
    // Debit first (inside the transaction) so concurrent redeems can't overspend.
    await run(
      `INSERT INTO forge_coin_ledger (id, user_id, delta, reason, ref, created_at)
       VALUES (@id, @u, @d, 'redeem', @ref, @at)`,
      { id: newId('coin'), u: userId, d: -reward.cost, ref: code || reward.id, at: nowIso() });

    if (code) {
      await createCoupon({
        code, kind: reward.couponKind || 'fixed', value: reward.value, perUserLimit: 1, maxRedemptions: 1,
        active: true, announce: false,
      }, userId);
      return { reward, couponCode: code };
    }
    // Non-coupon rewards (e.g. giveaway boost) are fulfilled by staff in Discord.
    return { reward };
  });
}

// ── Admin: manage custom Forge Shop items ────────────────────────────────────
export async function listAllShopItems() {
  return all(`SELECT * FROM forge_shop_items ORDER BY created_at DESC`);
}

export async function createShopItem({ label, blurb = null, cost, couponKind = 'fixed', value }) {
  const c = Math.round(Number(cost));
  const v = Math.round(Number(value));
  const kind = couponKind === 'percent' ? 'percent' : 'fixed';
  if (!label?.trim()) throw badRequest('Give the reward a name.');
  if (!(c > 0)) throw badRequest('Cost must be at least 1 coin.');
  if (kind === 'percent' ? !(v > 0 && v <= 90) : !(v > 0)) {
    throw badRequest(kind === 'percent' ? 'Percent must be 1–90.' : 'Value must be above €0.');
  }
  const id = newId('fsi');
  await run(
    `INSERT INTO forge_shop_items (id, label, blurb, cost, coupon_kind, value, active, created_at)
     VALUES (@id, @label, @blurb, @cost, @kind, @value, 1, @at)`,
    { id, label: label.trim().slice(0, 80), blurb: blurb ? String(blurb).slice(0, 160) : null,
      cost: c, kind, value: v, at: nowIso() });
  return get('SELECT * FROM forge_shop_items WHERE id=@id', { id });
}

export async function setShopItemActive(id, active) {
  await run('UPDATE forge_shop_items SET active=@a WHERE id=@id', { a: active ? 1 : 0, id });
  return get('SELECT * FROM forge_shop_items WHERE id=@id', { id });
}

export async function deleteShopItem(id) {
  const r = await run('DELETE FROM forge_shop_items WHERE id=@id', { id });
  return !!r.changes;
}
