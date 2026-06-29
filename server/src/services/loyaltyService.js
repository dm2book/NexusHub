/**
 * Loyalty program. A customer's tier is derived from their lifetime paid spend
 * (no separate points ledger to drift out of sync). XP is simply euros spent.
 *   Bronze (default) → Silver → Gold → Platinum.
 */
import { get } from '../db/index.js';
import { credit, hasUserGrant } from './walletService.js';
import { notify } from './notificationService.js';
import { formatMoney } from '../utils/money.js';

const PAID = "status IN ('payment_received','processing','awaiting_fulfillment','completed')";

// `reward` is a one-time store-credit bonus granted the first time a customer
// reaches the tier (cents).
export const TIERS = [
  { id: 'bronze', name: 'Bronze', min: 0, reward: 0, perksText: 'Member pricing on featured drops', color: '#cd7f32' },
  { id: 'silver', name: 'Silver', min: 10000, reward: 200, perksText: '+ priority support queue & €2 credit', color: '#9ca3af' },
  { id: 'gold', name: 'Gold', min: 50000, reward: 1000, perksText: '+ early access to restocks & €10 credit', color: '#f59e0b' },
  { id: 'platinum', name: 'Platinum', min: 200000, reward: 5000, perksText: '+ priority fulfillment & €50 credit', color: '#a78bfa' },
];

function tierForSpend(cents) {
  let t = TIERS[0];
  for (const tier of TIERS) if (cents >= tier.min) t = tier;
  return t;
}

/** Loyalty summary for a user: tier, spend (XP), progress to the next tier. */
export async function loyaltyFor(userId) {
  const row = await get(
    `SELECT COALESCE(SUM(total),0) AS spent, COUNT(*) AS orders
       FROM orders WHERE user_id = @u AND ${PAID}`, { u: userId });
  const spent = Number(row?.spent || 0);
  const tier = tierForSpend(spent);
  const idx = TIERS.findIndex((t) => t.id === tier.id);
  const next = TIERS[idx + 1] || null;
  const progress = next ? Math.min(100, Math.round(((spent - tier.min) / (next.min - tier.min)) * 100)) : 100;
  return {
    tier: tier.id,
    tierName: tier.name,
    color: tier.color,
    perks: tier.perksText,
    xp: spent,                       // euros spent, in cents
    orders: Number(row?.orders || 0),
    next: next ? { id: next.id, name: next.name, min: next.min } : null,
    remainingToNext: next ? Math.max(0, next.min - spent) : 0,
    progress,
    tiers: TIERS.map(({ id, name, min, color, reward }) => ({ id, name, min, color, reward })),
  };
}

/**
 * Grant any loyalty-tier credit bonuses the user has newly earned. Idempotent:
 * each tier's bonus is granted at most once (guarded by a stable description tag).
 * Called after a payment is recorded (best-effort). Returns granted tiers.
 */
const tierTag = (tierId) => `loyalty:${tierId}`;
export async function grantTierRewards(userId) {
  if (!userId) return [];
  const row = await get(
    `SELECT COALESCE(SUM(total),0) AS spent FROM orders WHERE user_id = @u AND ${PAID}`, { u: userId });
  const spent = Number(row?.spent || 0);
  const granted = [];
  for (const tier of TIERS) {
    if (tier.reward <= 0 || spent < tier.min) continue;
    if (await hasUserGrant(userId, tierTag(tier.id))) continue;
    await credit(userId, tier.reward, 'grant',
      `${tier.name} tier bonus · ${formatMoney(tier.reward, 'EUR')}`, { tag: tierTag(tier.id) });
    await notify(userId, {
      type: 'system', title: `You reached ${tier.name}! 🎉`,
      body: `You earned ${formatMoney(tier.reward, 'EUR')} in store credit as a ${tier.name} member.`,
      link: '/account/wallet',
    }).catch(() => {});
    granted.push(tier.id);
  }
  return granted;
}
