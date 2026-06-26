/**
 * Affiliate / referral program. Each user has one referral code; new customers
 * who arrive with ?ref=CODE are attributed, and a commission is recorded on each
 * of their paid orders for the referrer to be paid out.
 */
import { run, get, all, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';

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
  if (!order?.user_id) return;
  const u = await get('SELECT referred_by FROM users WHERE id=@u', { u: order.user_id });
  const code = u?.referred_by;
  if (!code) return;
  const referrerId = await referrerForCode(code);
  if (!referrerId || referrerId === order.user_id) return;
  // One commission per order.
  const dupe = await get(`SELECT id FROM referral_events WHERE order_id=@o AND kind='order'`, { o: order.id });
  if (dupe) return;
  const commission = Math.round((order.total || 0) * COMMISSION_PERCENT / 100);
  await run(`INSERT INTO referral_events (id, code, referrer_id, referred_id, order_id, kind, commission, status, created_at)
       VALUES (@id, @c, @ref, @rd, @o, 'order', @com, 'pending', @at)`,
    { id: newId('rev'), c: String(code).toUpperCase(), ref: referrerId, rd: order.user_id,
      o: order.id, com: commission, at: nowIso() });
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
