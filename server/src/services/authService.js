/**
 * Authentication core: passwordless email OTP, JWT access tokens, and
 * server-side refresh sessions. OAuth providers (Google/Discord) plug in via
 * oauthService and reuse the same session machinery here.
 */
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { run, get, nowIso } from '../db/index.js';
import { newId, newOtp } from '../utils/ids.js';
import { sha256, safeEqual, randomToken } from '../utils/crypto.js';
import { badRequest, unauthorized, tooMany } from '../utils/errors.js';
import { sendEmailAsync } from './emailService.js';
import { upsertUserByEmail, touchLogin, getUserPermissions } from './userService.js';

// ── Email OTP ──────────────────────────────────────────────────────────────

/** Create + email a one-time login code. Rate-limited per address. */
export async function requestEmailOtp(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw badRequest('Enter a valid email address');

  // Throttle: max 3 codes within the TTL window per address.
  const since = new Date(Date.now() - config.auth.otpTtlMinutes * 60_000).toISOString();
  const recent = await get(
    `SELECT COUNT(*) AS n FROM otp_codes WHERE email = @e AND created_at > @since`,
    { e, since });
  if (recent.n >= 3) throw tooMany('Too many codes requested. Try again shortly.');

  const code = newOtp();
  const id = newId('otp');
  const at = nowIso();
  const expires = new Date(Date.now() + config.auth.otpTtlMinutes * 60_000).toISOString();
  await run(`INSERT INTO otp_codes (id, email, code_hash, purpose, expires_at, created_at)
       VALUES (@id, @e, @h, 'login', @exp, @at)`,
      { id, e, h: sha256(code), exp: expires, at });

  // Deliver the code, but never let a mail failure break login: the code is
  // already stored, and the failure is recorded in email_log for diagnosis.
  await sendEmailAsync('login_otp', e, {
    otp: { code, ttl: config.auth.otpTtlMinutes },
    user: { name: e.split('@')[0] },
  });
  // Dev convenience: when email isn't actually delivered (no SMTP, non-prod),
  // print the code to the server console so local login works without a mailbox.
  if (!config.isProd && !config.email.smtpUrl) {
    console.log(`\n🔑  [dev] Login code for ${e}:  ${code}\n`);
  }
  return { sent: true, expiresAt: expires };
}

/** Verify an OTP and return an authenticated session. */
export async function verifyEmailOtp(email, code, ctx = {}) {
  const e = String(email || '').trim().toLowerCase();
  const row = await get(
    `SELECT * FROM otp_codes WHERE email = @e AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1`, { e });
  if (!row) throw badRequest('No active code. Request a new one.');
  if (new Date(row.expires_at) < new Date()) throw badRequest('Code expired. Request a new one.');
  if (row.attempts >= config.auth.otpMaxAttempts) {
    throw tooMany('Too many attempts. Request a new code.');
  }
  if (!safeEqual(row.code_hash, sha256(String(code).trim()))) {
    await run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = @id', { id: row.id });
    throw badRequest('Incorrect code');
  }
  await run('UPDATE otp_codes SET consumed_at = @at WHERE id = @id', { at: nowIso(), id: row.id });

  const { user, created } = await upsertUserByEmail(e, { email_verified: true });
  if (!user.email_verified) {
    await run('UPDATE users SET email_verified = 1 WHERE id = @id', { id: user.id });
  }
  return finalizeLogin(user, ctx, { firstLogin: created });
}

// ── Sessions / tokens ────────────────────────────────────────────────────

/** Issue access JWT + refresh session for a user. Shared by all login paths. */
export async function finalizeLogin(user, ctx = {}, extra = {}) {
  await touchLogin(user.id);
  const sessionId = newId('ses');
  const refresh = randomToken(32);
  const at = nowIso();
  const expires = new Date(Date.now() + config.auth.refreshTtlDays * 86_400_000).toISOString();
  await run(`INSERT INTO sessions (id, user_id, refresh_hash, user_agent, ip, expires_at, created_at)
       VALUES (@id, @uid, @rh, @ua, @ip, @exp, @at)`,
      { id: sessionId, uid: user.id, rh: sha256(refresh),
        ua: ctx.userAgent || null, ip: ctx.ip || null, exp: expires, at });

  const accessToken = await signAccess(user, sessionId);
  return { accessToken, refreshToken: `${sessionId}.${refresh}`, user, ...extra };
}

async function signAccess(user, sessionId) {
  const perms = [...(await getUserPermissions(user.id))];
  return jwt.sign(
    { sub: user.id, email: user.email, sid: sessionId, perms },
    config.auth.jwtSecret,
    { expiresIn: config.auth.accessTtl });
}

export function verifyAccess(token) {
  try {
    return jwt.verify(token, config.auth.jwtSecret);
  } catch {
    throw unauthorized('Session expired. Please sign in again.');
  }
}

/** Exchange a refresh token for a fresh access token (rotation-safe). */
export async function refreshSession(refreshToken) {
  const [sessionId, secret] = String(refreshToken || '').split('.');
  const session = await get('SELECT * FROM sessions WHERE id = @id', { id: sessionId });
  if (!session || session.revoked_at) throw unauthorized('Invalid session');
  if (new Date(session.expires_at) < new Date()) throw unauthorized('Session expired');
  if (!safeEqual(session.refresh_hash, sha256(secret || ''))) {
    await run('UPDATE sessions SET revoked_at = @at WHERE id = @id', { at: nowIso(), id: sessionId });
    throw unauthorized('Invalid session');
  }
  const user = await get('SELECT * FROM users WHERE id = @id', { id: session.user_id });
  if (!user || user.status !== 'active') throw unauthorized('Account unavailable');
  return { accessToken: await signAccess(user, sessionId) };
}

export async function revokeSession(sessionId) {
  await run('UPDATE sessions SET revoked_at = @at WHERE id = @id', { at: nowIso(), id: sessionId });
}

export async function isSessionActive(sessionId) {
  const s = await get('SELECT revoked_at, expires_at FROM sessions WHERE id = @id', { id: sessionId });
  return !!s && !s.revoked_at && new Date(s.expires_at) > new Date();
}
