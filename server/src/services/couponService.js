/**
 * Database-backed coupons (admin-managed), with the legacy env COUPONS list kept
 * as a read-only fallback so existing codes keep working. The server is the source
 * of truth for the discount — the client only previews it.
 */
import { run, get, all, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { couponFor } from '../config/env.js';
import { badRequest, notFound } from '../utils/errors.js';
import { postDropEvent } from './discordService.js';

const up = (c) => String(c || '').trim().toUpperCase();

/** Compute the discount (cents) a coupon row yields for a subtotal. */
function discountOf(row, subtotal) {
  if (row.kind === 'fixed') return Math.min(subtotal, Math.max(0, Number(row.value)));
  return Math.min(subtotal, Math.round(subtotal * Math.max(0, Math.min(90, Number(row.value))) / 100));
}

/**
 * Evaluate a code for a given subtotal/customer. Returns a normalized result the
 * checkout + order pipeline both use. Never throws for "invalid" — returns ok:false.
 */
export async function evaluateCoupon(code, { subtotal = 0, userId = null, email = null } = {}) {
  const c = up(code);
  if (!c) return { ok: false, reason: 'Enter a code' };

  const row = await get('SELECT * FROM coupons WHERE code = @c', { c });
  if (row) {
    if (!row.active) return { ok: false, reason: 'This code is no longer active' };
    const now = Date.now();
    if (row.starts_at && new Date(row.starts_at).getTime() > now) return { ok: false, reason: 'This code is not active yet' };
    if (row.expires_at && new Date(row.expires_at).getTime() < now) return { ok: false, reason: 'This code has expired' };
    if (subtotal < Number(row.min_subtotal || 0)) {
      return { ok: false, reason: `Spend at least ${(row.min_subtotal / 100).toFixed(2)} to use this code` };
    }
    if (row.max_redemptions != null && row.redeemed_count >= row.max_redemptions) {
      return { ok: false, reason: 'This code has reached its limit' };
    }
    if (row.per_user_limit != null && (userId || email)) {
      const used = await get(
        `SELECT COUNT(*) AS n FROM coupon_redemptions WHERE code=@c AND (user_id=@u OR (email IS NOT NULL AND email=@e))`,
        { c, u: userId, e: email ? String(email).toLowerCase() : null });
      if (Number(used?.n || 0) >= row.per_user_limit) return { ok: false, reason: "You've already used this code" };
    }
    const discount = discountOf(row, subtotal);
    return {
      ok: true, code: c, kind: row.kind, value: Number(row.value),
      percent: row.kind === 'percent' ? Number(row.value) : null,
      discount, label: row.kind === 'percent' ? `${row.value}% off` : `${(row.value / 100).toFixed(2)} off`, source: 'db',
    };
  }

  // Legacy env fallback (percent only).
  const env = couponFor(c);
  if (env) {
    const discount = Math.min(subtotal, Math.round(subtotal * env.percent / 100));
    return { ok: true, code: env.code, kind: 'percent', value: env.percent, percent: env.percent, discount, label: `${env.percent}% off`, source: 'env' };
  }
  return { ok: false, reason: 'Invalid or expired code' };
}

/** Record a redemption + bump the counter (DB coupons only). Best-effort. */
export async function recordCouponRedemption({ code, userId = null, email = null, orderId = null, ip = null }) {
  const c = up(code);
  if (!c) return;
  await run(
    `INSERT INTO coupon_redemptions (id, code, user_id, email, ip, order_id, created_at)
     VALUES (@id, @c, @u, @e, @ip, @o, @at)`,
    { id: newId('crd'), c, u: userId, e: email ? String(email).toLowerCase() : null, ip, o: orderId, at: nowIso() });
  await run('UPDATE coupons SET redeemed_count = redeemed_count + 1 WHERE code = @c', { c });
}

// ── Admin CRUD ───────────────────────────────────────────────────────────────
const clampPercent = (v) => Math.max(1, Math.min(90, Math.round(v)));

export async function createCoupon(input, actorId) {
  const code = up(input.code);
  if (!code) throw badRequest('Code is required');
  if (await get('SELECT id FROM coupons WHERE code=@c', { c: code })) throw badRequest('That code already exists');
  const kind = input.kind === 'fixed' ? 'fixed' : 'percent';
  const value = kind === 'fixed' ? Math.max(1, Math.round(input.value)) : clampPercent(input.value);
  const id = newId('cpn');
  await run(
    `INSERT INTO coupons (id, code, kind, value, min_subtotal, max_redemptions, per_user_limit, starts_at, expires_at, active, created_at)
     VALUES (@id, @code, @kind, @value, @min, @max, @per, @starts, @exp, @active, @at)`,
    { id, code, kind, value, min: Math.max(0, Math.round(input.minSubtotal || 0)),
      max: input.maxRedemptions ?? null, per: input.perUserLimit ?? null,
      starts: input.startsAt || null, exp: input.expiresAt || null,
      active: input.active === false ? 0 : 1, at: nowIso(), actorId });
  const created = await getCoupon(id);
  // Share fresh public discount codes in #drops-and-deals (best-effort).
  if (created?.active && input.announce !== false) {
    postDropEvent('coupon', created).catch(() => {});
  }
  return created;
}

export async function updateCoupon(id, patch) {
  const c = await get('SELECT * FROM coupons WHERE id=@id', { id });
  if (!c) throw notFound('Coupon not found');
  const fields = {};
  if (patch.kind) fields.kind = patch.kind === 'fixed' ? 'fixed' : 'percent';
  if (patch.value != null) fields.value = (fields.kind || c.kind) === 'fixed' ? Math.max(1, Math.round(patch.value)) : clampPercent(patch.value);
  if (patch.minSubtotal != null) fields.min_subtotal = Math.max(0, Math.round(patch.minSubtotal));
  if ('maxRedemptions' in patch) fields.max_redemptions = patch.maxRedemptions ?? null;
  if ('perUserLimit' in patch) fields.per_user_limit = patch.perUserLimit ?? null;
  if ('expiresAt' in patch) fields.expires_at = patch.expiresAt || null;
  if (patch.active != null) fields.active = patch.active ? 1 : 0;
  const keys = Object.keys(fields);
  if (keys.length) {
    await run(`UPDATE coupons SET ${keys.map((k) => `${k}=@${k}`).join(', ')} WHERE id=@id`, { ...fields, id });
  }
  return getCoupon(id);
}

export async function deleteCoupon(id) {
  const r = await run('DELETE FROM coupons WHERE id=@id', { id });
  return (r?.changes || 0) > 0;
}

const shape = (r) => r && ({
  id: r.id, code: r.code, kind: r.kind, value: Number(r.value),
  minSubtotal: Number(r.min_subtotal), maxRedemptions: r.max_redemptions, perUserLimit: r.per_user_limit,
  redeemedCount: Number(r.redeemed_count), startsAt: r.starts_at, expiresAt: r.expires_at,
  active: !!r.active, createdAt: r.created_at,
});
export async function getCoupon(id) { return shape(await get('SELECT * FROM coupons WHERE id=@id', { id })); }
export async function listCoupons() {
  return (await all('SELECT * FROM coupons ORDER BY created_at DESC')).map(shape);
}
