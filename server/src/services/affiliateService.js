/**
 * Affiliate / referral program. Each user has one referral code; new customers
 * who arrive with ?ref=CODE are attributed, and a commission is recorded on each
 * of their paid orders for the referrer to be paid out.
 */
import { run, get, all, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { postReferralEarned } from './discordService.js';
import { discordUidForUser } from './discordRolesService.js';
import { credit } from './walletService.js';
import { notify } from './notificationService.js';

export const COMMISSION_PERCENT = 5;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode(seed = '') {
  let s = (seed.split('@')[0] || 'forge').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) || 'FORGE';
  let rand = '';
  for (let i = 0; i < 4; i++) rand += ALPHABET[Math.floor((Date.now() * (i + 1) + s.length) % ALPHABET.length)];
  return `${s}${rand}`;
}

/** Return the user's referral code, creating one on first use. */
export async function getOrCreateCode(userId, email = '') {
  const existing = await get('SELECT code FROM referrals WHERE user_id=@u', { u: userId });
  if (existing) return existing.code;
  // Generate a unique code (retry on the rare collision).
  for (let i = 0; i < 6; i++) {
    const code = makeCode(email) + (i ? String(i) : '');
    const clash = await get('SELECT code FROM referrals WHERE code=@c', { c: code });
    if (!clash) {
      await run('INSERT INTO referrals (code, user_id, created_at) VALUES (@c, @u, @at)',
        { c: code, u: userId, at: nowIso() });
      return code;
    }
  }
  const code = newId('ref').toUpperCase().slice(4, 13);
  await run('INSERT INTO referrals (code, user_id, created_at) VALUES (@c, @u, @at)', { c: code, u: userId, at: nowIso() });
  return code;
}

/** Resolve a code → referrer user id (or null). */
export async function referrerForCode(code) {
  if (!code) return null;
  const r = await get('SELECT user_id FROM referrals WHERE code=@c', { c: String(code).toUpperCase() });
  return r?.user_id || null;
}

/** Attribute a newly-created user to a referral code (best-effort, once). */
export async function attributeSignup(referredUserId, code) {
  const referrerId = await referrerForCode(code);
  if (!referrerId || referrerId === referredUserId) return;
  await run('UPDATE users SET referred_by=@c WHERE id=@u AND referred_by IS NULL',
    { c: String(code).toUpperCase(), u: referredUserId });
  await run(`INSERT INTO referral_events (id, code, referrer_id, referred_id, kind, commission, status, created_at)
       VALUES (@id, @c, @ref, @rd, 'signup', 0, 'approved', @at)`,
    { id: newId('rev'), c: String(code).toUpperCase(), ref: referrerId, rd: referredUserId, at: nowIso() });
}

/** Record a commission for a paid order placed by a referred customer. */
export async function recordOrderCommission(order) {
  // getOrder() hydrates to `userId`; raw rows use `user_id` — accept both.
  const buyerId = order?.userId || order?.user_id;
  if (!buyerId) return;
  const u = await get('SELECT referred_by FROM users WHERE id=@u', { u: buyerId });
  const code = u?.referred_by;
  if (!code) return;
  const referrerId = await referrerForCode(code);
  if (!referrerId || referrerId === buyerId) return;
  // One commission per order.
  const dupe = await get(`SELECT id FROM referral_events WHERE order_id=@o AND kind='order'`, { o: order.id });
  if (dupe) return;
  const commission = Math.round((order.total || 0) * COMMISSION_PERCENT / 100);
  if (commission <= 0) return;
  // Pay the commission straight into the referrer's store-credit wallet — referral
  // earnings ARE spendable credit. The ledger entry is the source of truth; the
  // referral_event records it as paid for the affiliate dashboard.
  await run(`INSERT INTO referral_events (id, code, referrer_id, referred_id, order_id, kind, commission, status, created_at)
       VALUES (@id, @c, @ref, @rd, @o, 'order', @com, 'paid', @at)`,
    { id: newId('rev'), c: String(code).toUpperCase(), ref: referrerId, rd: buyerId,
      o: order.id, com: commission, at: nowIso() });
  await credit(referrerId, commission, 'referral', `Referral commission · order ${order.number || order.id}`, { orderId: order.id })
    .catch((e) => console.error('[affiliate] wallet credit', e.message));
  /* "earned you 1.95 in store credit" — no currency. It reads as a coin count
     next to a wallet that is denominated in euros. */
  await notify(referrerId, {
    type: 'system', title: 'You earned store credit',
    body: `A referral order earned you €${(commission / 100).toFixed(2)} in store credit.`,
    link: '/account/wallet',
  }).catch(() => {});

  /* And in Discord, which is where the person who shared the link actually is.
     A programme that pays silently is shared once and never again. */
  const uid = await discordUidForUser(referrerId).catch(() => null);
  if (uid) await postReferralEarned(uid, { commissionCents: commission }).catch(() => {});
}

/** Dashboard stats for a referrer. */
export async function affiliateStats(userId, email = '') {
  const code = await getOrCreateCode(userId, email);
  const agg = await get(
    `SELECT
        COUNT(DISTINCT referred_id) FILTER (WHERE referred_id IS NOT NULL) AS referrals,
        COUNT(*) FILTER (WHERE kind='order') AS orders,
        COALESCE(SUM(commission) FILTER (WHERE status IN ('pending','approved')),0) AS pending,
        COALESCE(SUM(commission) FILTER (WHERE status='paid'),0) AS paid,
        COALESCE(SUM(commission),0) AS total
       FROM referral_events WHERE referrer_id=@u`, { u: userId });
  const recent = await all(
    `SELECT kind, commission, status, created_at AS "createdAt"
       FROM referral_events WHERE referrer_id=@u ORDER BY created_at DESC LIMIT 10`, { u: userId });
  return {
    code,
    commissionPercent: COMMISSION_PERCENT,
    referrals: Number(agg?.referrals || 0),
    orders: Number(agg?.orders || 0),
    pendingCommission: Number(agg?.pending || 0),
    paidCommission: Number(agg?.paid || 0),
    totalCommission: Number(agg?.total || 0),
    recent,
  };
}
