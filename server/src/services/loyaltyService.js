/**
 * Loyalty program. A customer's tier is derived from their lifetime paid spend
 * (no separate points ledger to drift out of sync). XP is simply euros spent.
 *   Bronze (default) → Silver → Gold → Platinum.
 */
import { get, tx } from '../db/index.js';
import { credit, debit } from './walletService.js';
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
 * each tier's bonus is held at most once (guarded by tags, see tierState).
 * Called after a payment is recorded (best-effort). Returns granted tiers.
 */
const tierTag = (tierId) => `loyalty:${tierId}`;

/**
 * Where a buyer stands with one tier's bonus.
 *
 * The first grant carries the tag `loyalty:<tier>`, as it always has; a bonus
 * taken back gets `loyalty-revoke:<tier>:<n>`, and earned again after that
 * `loyalty:<tier>:<n>`. Every tag is new, so the wallet's tag check is what
 * makes a grant or a revoke happen once even when two run at the same moment,
 * and the bonus is held while there are more grants than revokes.
 */
async function tierState(userId, tierId) {
  const r = await get(
    `SELECT COUNT(*) FILTER (WHERE tag = @g OR tag LIKE @gn) AS grants,
            COUNT(*) FILTER (WHERE tag LIKE @rv) AS revokes,
            (ARRAY_AGG(amount ORDER BY created_at DESC) FILTER (WHERE tag = @g OR tag LIKE @gn))[1] AS last
       FROM credit_transactions WHERE user_id = @u AND (tag = @g OR tag LIKE @gn OR tag LIKE @rv)`,
    { u: userId, g: tierTag(tierId), gn: `${tierTag(tierId)}:%`, rv: `loyalty-revoke:${tierId}:%` });
  const grants = Number(r?.grants || 0);
  const revokes = Number(r?.revokes || 0);
  return { grants, held: grants > revokes, lastAmount: Number(r?.last || 0) };
}

const paidSpend = async (userId) => Number((await get(
  `SELECT COALESCE(SUM(total),0) AS spent FROM orders WHERE user_id = @u AND ${PAID}`, { u: userId }))?.spent || 0);

/* Grant and revoke both run under the buyer's row lock (the one every wallet
   write takes), reading spend and tags inside it: a refund and a payment for
   the same buyer at the same moment then cannot leave the bonus taken back
   while the spend still reaches the tier, or granted twice. */
const lockUser = (userId) => get('SELECT id FROM users WHERE id=@u FOR UPDATE', { u: userId });

export async function grantTierRewards(userId) {
  if (!userId) return [];
  const granted = await tx(async () => {
    await lockUser(userId);
    const spent = await paidSpend(userId);
    const out = [];
    for (const tier of TIERS) {
      if (tier.reward <= 0 || spent < tier.min) continue;
      const state = await tierState(userId, tier.id);
      if (state.held) continue;
      const tag = state.grants ? `${tierTag(tier.id)}:${state.grants + 1}` : tierTag(tier.id);
      const entry = await credit(userId, tier.reward, 'grant',
        `${tier.name} tier bonus · ${formatMoney(tier.reward, 'EUR')}`, { tag });
      if (!entry.deduped) out.push(tier);
    }
    return out;
  });
  for (const tier of granted) {
    await notify(userId, {
      type: 'system', title: `You reached ${tier.name}! 🎉`,
      body: `You earned ${formatMoney(tier.reward, 'EUR')} in store credit as a ${tier.name} member.`,
      link: '/account/wallet',
    }).catch(() => {});
  }
  return granted.map((t) => t.id);
}

/**
 * Take back the tier bonuses a buyer no longer reaches, after one of their
 * paid orders was refunded, charged back or cancelled.
 *
 * Lifetime spend only counts orders that are still sales, so the refund has
 * already lowered it. A bonus whose threshold is no longer met came from money
 * that went back — paying past a tier and having it refunded kept the bonus as
 * free store credit. Taken back once per grant (tagged, see tierState), as a
 * debt when it was already spent (allowNegative, like a reversed referral
 * commission), and granted again when the buyer reaches the tier again.
 */
export async function revokeTierRewards(userId, why = 'an order was refunded') {
  if (!userId) return [];
  const revoked = await tx(async () => {
    await lockUser(userId);
    const spent = await paidSpend(userId);
    const out = [];
    for (const tier of TIERS) {
      if (tier.reward <= 0 || spent >= tier.min) continue;
      const state = await tierState(userId, tier.id);
      if (!state.held) continue;
      const amount = state.lastAmount || tier.reward;
      const entry = await debit(userId, amount, 'adjustment', `${tier.name} tier bonus taken back · ${why}`,
        { tag: `loyalty-revoke:${tier.id}:${state.grants}`, allowNegative: true });
      if (!entry.deduped) out.push({ tier, amount });
    }
    return out;
  });
  for (const { tier, amount } of revoked) {
    await notify(userId, {
      type: 'system', title: `${tier.name} tier bonus taken back`,
      body: `Your paid spend is below ${tier.name} again (${why}), so the ${formatMoney(amount, 'EUR')} `
        + 'bonus has been taken back off your store credit.',
      link: '/account/wallet',
    }).catch(() => {});
  }
  return revoked.map((r) => r.tier.id);
}
