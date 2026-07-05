/**
 * Trusted devices ("remember this device" → future logins skip OTP), login
 * history, and suspicious-login detection.
 *
 * A trusted device is an httpOnly cookie `id.secret`; only the sha256 of the
 * secret is stored. Presenting a valid, unexpired, non-revoked token for a user
 * lets them re-authenticate without an OTP.
 */
import { run, get, all, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { sha256, safeEqual, randomToken } from '../utils/crypto.js';
import { deviceLabel } from './authService.js';

const TRUST_DAYS = 60;

// ── Login history / brute-force ────────────────────────────────────────────
export async function recordLoginAttempt({ userId = null, identifier, channel, success, suspicious = false, reason = null, ctx = {} }) {
  await run(
    `INSERT INTO login_attempts (id, user_id, identifier, channel, success, suspicious, reason, ip, user_agent, device_id, created_at)
     VALUES (@id, @uid, @idf, @ch, @ok, @susp, @reason, @ip, @ua, @dev, @at)`,
    { id: newId('la'), uid: userId, idf: identifier || null, ch: channel || null,
      ok: success ? 1 : 0, susp: suspicious ? 1 : 0, reason, ip: ctx.ip || null,
      ua: ctx.userAgent || null, dev: ctx.fingerprint || null, at: nowIso() });
}

/** Recent failed attempts for an identifier/IP within `minutes` (brute-force gate). */
export async function recentFailures(identifier, ip, minutes = 15) {
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const r = await get(
    `SELECT COUNT(*) AS n FROM login_attempts
      WHERE success = 0 AND created_at > @since AND (identifier = @idf OR ip = @ip)`,
    { since, idf: identifier || '', ip: ip || '' });
  return Number(r?.n || 0);
}

export async function loginHistory(userId, limit = 20) {
  return all(
    `SELECT channel, success, suspicious, ip, user_agent AS "userAgent", created_at AS "createdAt"
       FROM login_attempts WHERE user_id = @u ORDER BY created_at DESC LIMIT @limit`,
    { u: userId, limit: Math.min(100, limit) });
}

/** A login is "suspicious" if we've never seen a success from this device or IP. */
export async function isSuspiciousLogin(userId, ctx = {}) {
  if (!userId) return false;
  const r = await get(
    `SELECT COUNT(*) AS n FROM login_attempts
      WHERE user_id = @u AND success = 1 AND (device_id = @dev OR ip = @ip)`,
    { u: userId, dev: ctx.fingerprint || '__none__', ip: ctx.ip || '__none__' });
  // First-ever login isn't "suspicious"; an established account on a brand-new
  // device/IP is.
  const total = await get(`SELECT COUNT(*) AS n FROM login_attempts WHERE user_id=@u AND success=1`, { u: userId });
  return Number(total?.n || 0) > 0 && Number(r?.n || 0) === 0;
}

// ── Trusted devices ────────────────────────────────────────────────────────
export async function createTrustedDevice(userId, ctx = {}) {
  const id = newId('td');
  const secret = randomToken(32);
  const at = nowIso();
  const expires = new Date(Date.now() + TRUST_DAYS * 86_400_000).toISOString();
  await run(
    `INSERT INTO trusted_devices (id, user_id, device_id, token_hash, name, user_agent, ip, last_used_at, expires_at, created_at)
     VALUES (@id, @u, @dev, @h, @name, @ua, @ip, @at, @exp, @at)`,
    { id, u: userId, dev: ctx.fingerprint || null, h: sha256(secret),
      name: deviceLabel(ctx.userAgent), ua: ctx.userAgent || null, ip: ctx.ip || null, at, exp: expires });
  return { token: `${id}.${secret}`, expiresDays: TRUST_DAYS };
}

/** Validate a device token → returns the owning user id, or null. Touches last-used. */
export async function resolveTrustedDevice(token, ctx = {}) {
  const [id, secret] = String(token || '').split('.');
  if (!id || !secret) return null;
  const d = await get('SELECT * FROM trusted_devices WHERE id = @id', { id });
  if (!d || d.revoked_at) return null;
  if (new Date(d.expires_at) < new Date()) return null;
  if (!safeEqual(d.token_hash, sha256(secret))) return null;
  // Sliding expiry: an actively-used trusted device stays trusted — the
  // 60-day window restarts on every successful use.
  const slide = new Date(Date.now() + TRUST_DAYS * 86_400_000).toISOString();
  await run(`UPDATE trusted_devices SET last_used_at = @at, ip = COALESCE(@ip, ip), expires_at = @exp
       WHERE id = @id`,
    { at: nowIso(), ip: ctx.ip || null, exp: slide, id });
  return d.user_id;
}

export async function listTrustedDevices(userId) {
  const rows = await all(
    `SELECT id, name, device_id AS "deviceId", ip, last_used_at AS "lastUsedAt", created_at AS "createdAt"
       FROM trusted_devices
      WHERE user_id = @u AND revoked_at IS NULL AND expires_at > @now
      ORDER BY COALESCE(last_used_at, created_at) DESC`, { u: userId, now: nowIso() });
  return rows;
}

export async function renameTrustedDevice(userId, id, name) {
  const d = await get('SELECT user_id FROM trusted_devices WHERE id=@id', { id });
  if (!d || d.user_id !== userId) return false;
  await run('UPDATE trusted_devices SET name=@n WHERE id=@id', { n: String(name).slice(0, 60), id });
  return true;
}

export async function revokeTrustedDevice(userId, id) {
  const d = await get('SELECT user_id FROM trusted_devices WHERE id=@id', { id });
  if (!d || d.user_id !== userId) return false;
  await run('UPDATE trusted_devices SET revoked_at=@at WHERE id=@id', { at: nowIso(), id });
  return true;
}

export async function revokeAllTrustedDevices(userId) {
  await run('UPDATE trusted_devices SET revoked_at=@at WHERE user_id=@u AND revoked_at IS NULL',
    { at: nowIso(), u: userId });
}
