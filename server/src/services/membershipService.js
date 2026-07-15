/**
 * Forge+ membership. A time-boxed paid membership that gives a standing discount,
 * priority support/fulfillment flags and exclusive deals. Stored on the user row
 * (membership_tier + membership_until) so it travels with the account.
 */
import { run, get, nowIso } from '../db/index.js';

export const MEMBERSHIP_DAYS = 30;

export const FORGE_PLUS = {
  id: 'forge_plus',
  name: 'Forge+',
  discountPercent: 5,
  priceCents: 499,        // €4.99 / month, payable instantly with store credit
  coinPrice: 40,          // …or with Forge Coins (loyalty perk; tune to taste)
  perks: [
    '5% off every order',
    'Priority support queue',
    'Priority fulfillment',
    'Early access to drops & exclusive deals',
  ],
};

export async function getMembership(userId) {
  const u = await get('SELECT membership_tier, membership_until FROM users WHERE id=@u', { u: userId });
  const active = !!u?.membership_tier && (!u.membership_until || new Date(u.membership_until) > new Date());
  return {
    active,
    tier: active ? u.membership_tier : null,
    until: u?.membership_until || null,
    plan: FORGE_PLUS,
  };
}

export async function isActiveMember(userId) {
  if (!userId) return false;
  return (await getMembership(userId)).active;
}

/** Standing discount percent for a user (0 if not a member). */
export async function memberDiscountPercent(userId) {
  return (await isActiveMember(userId)) ? FORGE_PLUS.discountPercent : 0;
}

/** Grant/extend Forge+ for `days` (admin or post-purchase). */
export async function grantMembership(userId, days = 30) {
  const base = await getMembership(userId);
  const from = base.active && base.until ? new Date(base.until) : new Date();
  const until = new Date(from.getTime() + days * 86_400_000).toISOString();
  await run('UPDATE users SET membership_tier=@t, membership_until=@u WHERE id=@id',
    { t: FORGE_PLUS.id, u: until, id: userId });
  return getMembership(userId);
}

export async function cancelMembership(userId) {
  await run('UPDATE users SET membership_until=@now WHERE id=@id', { now: nowIso(), id: userId });
  return getMembership(userId);
}
