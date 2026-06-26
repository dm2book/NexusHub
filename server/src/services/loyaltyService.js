/**
 * Loyalty program. A customer's tier is derived from their lifetime paid spend
 * (no separate points ledger to drift out of sync). XP is simply euros spent.
 *   Bronze (default) → Silver → Gold → Platinum.
 */
import { get } from '../db/index.js';

const PAID = "status IN ('payment_received','processing','awaiting_fulfillment','completed')";

export const TIERS = [
  { id: 'bronze', name: 'Bronze', min: 0, perksText: 'Member pricing on featured drops', color: '#cd7f32' },
  { id: 'silver', name: 'Silver', min: 10000, perksText: '+ priority support queue', color: '#9ca3af' },
  { id: 'gold', name: 'Gold', min: 50000, perksText: '+ early access to restocks & deals', color: '#f59e0b' },
  { id: 'platinum', name: 'Platinum', min: 200000, perksText: '+ priority fulfillment & exclusive offers', color: '#a78bfa' },
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
    tiers: TIERS.map(({ id, name, min, color }) => ({ id, name, min, color })),
  };
}
