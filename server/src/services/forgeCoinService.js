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

/** The Forge Shop catalog — what coins buy. Kept here so it's one source of truth. */
export const FORGE_SHOP = [
  { id: 'coupon5', kind: 'coupon', cost: 3, value: 500, label: '€5 discount code', blurb: '€5 off your next order.' },
  { id: 'coupon10', kind: 'coupon', cost: 5, value: 1000, label: '€10 discount code', blurb: '€10 off your next order.' },
  { id: 'coupon25', kind: 'coupon', cost: 12, value: 2500, label: '€25 discount code', blurb: '€25 off any order — best value.' },
  { id: 'boost', kind: 'boost', cost: 2, value: 1, label: 'Giveaway boost', blurb: '+1 bonus entry in this week’s giveaway (claim in Discord).' },
];

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

/** Spend coins on a Forge Shop reward. Returns { reward, couponCode? }. */
export async function redeemReward(userId, rewardId) {
  const reward = FORGE_SHOP.find((r) => r.id === rewardId);
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
        code, kind: 'fixed', value: reward.value, perUserLimit: 1, maxRedemptions: 1,
        active: true, announce: false,
      }, userId);
      return { reward, couponCode: code };
    }
    // Non-coupon rewards (e.g. giveaway boost) are fulfilled by staff in Discord.
    return { reward };
  });
}
