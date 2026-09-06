/**
 * Authentication core: passwordless email OTP, JWT access tokens, and
 * server-side refresh sessions. OAuth providers (Google/Discord) plug in via
 * oauthService and reuse the same session machinery here.
 */
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { run, get, all, nowIso } from '../db/index.js';
import { newId, newOtp } from '../utils/ids.js';
import { sha256, safeEqual, randomToken } from '../utils/crypto.js';
import { badRequest, unauthorized, tooMany } from '../utils/errors.js';
import { sendEmailAsync } from './emailService.js';
import { upsertUserByEmail, upsertUserByPhone, touchLogin, getUserPermissions } from './userService.js';
import { sendSms, isValidPhone, normalizePhone, smsAvailable } from './smsService.js';
import { audit } from './auditService.js';

/** Human-readable device label from a User-Agent string (best-effort). */
export function deviceLabel(ua = '') {
  const s = String(ua);
  const os = /Windows/i.test(s) ? 'Windows' : /iPhone|iPad|iOS/i.test(s) ? 'iOS'
    : /Android/i.test(s) ? 'Android' : /Mac OS X|Macintosh/i.test(s) ? 'macOS'
    : /Linux/i.test(s) ? 'Linux' : 'Unknown OS';
  const br = /Edg\//i.test(s) ? 'Edge' : /OPR\/|Opera/i.test(s) ? 'Opera'
    : /Chrome\//i.test(s) ? 'Chrome' : /Firefox\//i.test(s) ? 'Firefox'
    : /Safari\//i.test(s) ? 'Safari' : 'Browser';
  return `${br} · ${os}`;
}

// ── Email OTP ──────────────────────────────────────────────────────────────

/**
 * The login code as individual digit tiles — table-based with inline styles so
 * it renders identically in Gmail, Outlook and Apple Mail. Passed to the
 * login_otp template as {{otp.codeHtml}}.
 */
function otpDigitsHtml(code) {
  const tile = (d) =>
    `<td style="width:48px;height:60px;background:#1c1c30;border:1px solid #3d3d68;border-radius:12px;` +
    `text-align:center;vertical-align:middle;font:800 28px/60px 'Courier New',Courier,monospace;color:#ffffff">${d}</td>`;
  const gap = '<td style="width:9px;font-size:0;line-height:0">&nbsp;</td>';
  return `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:10px auto 14px"><tr>${
    [...String(code)].map(tile).join(gap)}</tr></table>`;
}

/**
 * Create + email a one-time login code. Layered abuse protection:
 *  - per-email throttle (max 3 live codes / TTL window),
 *  - per-IP throttle (max 8 codes / TTL window across all emails),
 *  - a short cooldown between consecutive requests for the same email,
 *  - the requesting IP + device fingerprint are stored for audit/forensics.
 */
export async function requestEmailOtp(email, ctx = {}) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw badRequest('Enter a valid email address');
  const ip = ctx.ip || null;
  const fp = ctx.fingerprint || null;
  const since = new Date(Date.now() - config.auth.otpTtlMinutes * 60_000).toISOString();

  // Per-email throttle.
  const recent = await get(
    `SELECT COUNT(*) AS n, MAX(created_at) AS last FROM otp_codes WHERE email = @e AND created_at > @since`,
    { e, since });
  if (recent.n >= 3) {
    await audit({ action: 'auth.otp_throttled', actor: { email: e }, metadata: { reason: 'email', ip }, req: ctx.req });
    throw tooMany('Too many codes requested for this email. Try again shortly.');
  }
  // 30s cooldown between codes for the same email (blunts automated hammering).
  if (recent.last && Date.now() - new Date(recent.last).getTime() < 30_000) {
    throw tooMany('Please wait a few seconds before requesting another code.');
  }
  // Per-IP throttle (defends against enumerating many emails from one host).
  if (ip) {
    const ipCount = await get(
      `SELECT COUNT(*) AS n FROM otp_codes WHERE ip = @ip AND created_at > @since`, { ip, since });
    if (ipCount.n >= 8) {
      await audit({ action: 'auth.otp_throttled', actor: { email: e }, metadata: { reason: 'ip', ip }, req: ctx.req });
      throw tooMany('Too many login attempts from your network. Try again shortly.');
    }
  }

  const code = newOtp();
  const id = newId('otp');
  const at = nowIso();
  const expires = new Date(Date.now() + config.auth.otpTtlMinutes * 60_000).toISOString();
  await run(`INSERT INTO otp_codes (id, email, code_hash, purpose, ip, fingerprint, expires_at, created_at)
       VALUES (@id, @e, @h, 'login', @ip, @fp, @exp, @at)`,
      { id, e, h: sha256(code), ip, fp, exp: expires, at });

  await audit({ action: 'auth.otp_request', actor: { email: e }, targetType: 'email', targetId: e,
    metadata: { ip, fingerprint: fp }, req: ctx.req });

  // Deliver the code, but never let a mail failure break login: the code is
  // already stored, and the failure is recorded in email_log for diagnosis.
  /* The language this person reads the shop in.
     A login code has no order behind it, so it comes from the user row — set
     the first time they order or sign in — and falls back to whatever the
     browser sent with the request. Without it a German buyer who has already
     received a German confirmation gets a Dutch login code, which is the one
     mail where "is this really from them?" costs a sign-in. */
  const known = await get('SELECT lang FROM users WHERE email = @e', { e }).catch(() => null);
  await sendEmailAsync('login_otp', e, {
    lang: known?.lang || ctx.lang || undefined,
    otp: { code, ttl: config.auth.otpTtlMinutes, codeHtml: otpDigitsHtml(code) },
    user: { name: e.split('@')[0] },
  });
  // Dev convenience: when email isn't actually delivered (no SMTP, non-prod),
  // print the code to the server console so local login works without a mailbox.
  if (!config.isProd && !config.email.smtpUrl) {
    console.log(`\n🔑  [dev] Login code for ${e}:  ${code}\n`);
  }
  return { sent: true, expiresAt: expires, cooldownSeconds: 30 };
}

/** Verify an OTP and return an authenticated session. */
export async function verifyEmailOtp(email, code, ctx = {}) {
  const e = String(email || '').trim().toLowerCase();
  const supplied = sha256(String(code).trim());
  // Check against every still-valid (unconsumed, unexpired) code for this
  // address — not just the newest. People often tap "Send code" more than once,
  // and any code we actually e-mailed should work, not only the latest one.
  const rows = await all(
    `SELECT * FROM otp_codes WHERE email = @e AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 10`, { e });
  if (!rows.length) throw badRequest('No active code. Request a new one.');

  const live = rows.filter((r) => new Date(r.expires_at) >= new Date());
  if (!live.length) throw badRequest('Code expired. Request a new one.');

  const match = live.find((r) => safeEqual(r.code_hash, supplied));
  if (!match) {
    // Wrong code: count the attempt against the newest live code, and lock out
    // only once that one has burned through its attempts.
    const newest = live[0];
    await audit({ action: 'auth.otp_verify_fail', actor: { email: e }, targetType: 'email', targetId: e,
      metadata: { ip: ctx.ip, attempts: newest.attempts + 1 }, req: ctx.req });
    if (newest.attempts >= config.auth.otpMaxAttempts) {
      throw tooMany('Too many attempts. Request a new code.');
    }
    await run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = @id', { id: newest.id });
    throw badRequest('Incorrect code');
  }
  await run('UPDATE otp_codes SET consumed_at = @at WHERE id = @id', { at: nowIso(), id: match.id });

  const { user, created } = await upsertUserByEmail(e, { email_verified: true });
  if (!user.email_verified) {
    await run('UPDATE users SET email_verified = 1 WHERE id = @id', { id: user.id });
  }
  // Accounts with an authenticator app enabled need the second factor before a
  // session is issued — return a short-lived challenge ticket instead.
  if (user.totp_secret && user.totp_enabled_at) {
    return { totpRequired: true, ticket: issueTotpTicket(user), user, firstLogin: created };
  }
  return finalizeLogin(user, ctx, { firstLogin: created });
}

// ── Phone / SMS OTP ─────────────────────────────────────────────────────────

/** Create + SMS a one-time login code to a phone number. Rate-limited per number/IP. */
export async function requestPhoneOtp(phone, ctx = {}) {
  // Refuse before writing a code row. Storing an OTP we cannot deliver leaves
  // the caller to announce "code sent" and the person to wait out a countdown
  // for a message nobody sent — and it burns their rate-limit budget doing it.
  // This is the single choke point for all three callers (login, resend, and
  // adding a number to an account), so the promise can only be made where it
  // can be kept.
  if (!smsAvailable()) throw badRequest('SMS codes aren’t available right now. Use your email address to sign in instead.');
  const p = normalizePhone(phone);
  if (!isValidPhone(p)) throw badRequest('Enter a valid phone number (e.g. +31612345678)');
  const ip = ctx.ip || null;
  const since = new Date(Date.now() - config.auth.otpTtlMinutes * 60_000).toISOString();

  const recent = await get(
    `SELECT COUNT(*) AS n, MAX(created_at) AS last FROM sms_verifications WHERE phone=@p AND created_at>@since`,
    { p, since });
  if (recent.n >= 3) { await audit({ action: 'auth.sms_throttled', metadata: { reason: 'phone', ip }, req: ctx.req }); throw tooMany('Too many SMS codes. Try again shortly.'); }
  if (recent.last && Date.now() - new Date(recent.last).getTime() < 30_000) throw tooMany('Please wait before requesting another SMS code.');
  if (ip) {
    const ipc = await get(`SELECT COUNT(*) AS n FROM sms_verifications WHERE ip=@ip AND created_at>@since`, { ip, since });
    if (ipc.n >= 8) { await audit({ action: 'auth.sms_throttled', metadata: { reason: 'ip', ip }, req: ctx.req }); throw tooMany('Too many SMS attempts from your network.'); }
  }

  const code = newOtp();
  const expires = new Date(Date.now() + config.auth.otpTtlMinutes * 60_000).toISOString();
  await run(`INSERT INTO sms_verifications (id, phone, code_hash, ip, expires_at, created_at)
       VALUES (@id, @p, @h, @ip, @exp, @at)`,
      { id: newId('sms'), p, h: sha256(code), ip, exp: expires, at: nowIso() });
  await audit({ action: 'auth.sms_request', targetType: 'phone', targetId: p, metadata: { ip }, req: ctx.req });

  const r = await sendSms(p, `Your ${config.email.fromName} code is ${code}. It expires in ${config.auth.otpTtlMinutes} min.`);
  return { sent: true, delivered: r.sent, expiresAt: expires, cooldownSeconds: 30 };
}

/** Verify a phone OTP → authenticated session. */
export async function verifyPhoneOtp(phone, code, ctx = {}) {
  const p = normalizePhone(phone);
  const supplied = sha256(String(code).trim());
  const rows = await all(
    `SELECT * FROM sms_verifications WHERE phone=@p AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 10`, { p });
  if (!rows.length) throw badRequest('No active code. Request a new one.');
  const live = rows.filter((r) => new Date(r.expires_at) >= new Date());
  if (!live.length) throw badRequest('Code expired. Request a new one.');
  const match = live.find((r) => safeEqual(r.code_hash, supplied));
  if (!match) {
    const newest = live[0];
    if (newest.attempts >= config.auth.otpMaxAttempts) throw tooMany('Too many attempts. Request a new code.');
    await run('UPDATE sms_verifications SET attempts = attempts + 1 WHERE id=@id', { id: newest.id });
    throw badRequest('Incorrect code');
  }
  await run('UPDATE sms_verifications SET consumed_at=@at WHERE id=@id', { at: nowIso(), id: match.id });
  const { user, created } = await upsertUserByPhone(p);
  if (user.totp_secret && user.totp_enabled_at) {
    return { totpRequired: true, ticket: issueTotpTicket(user), user, firstLogin: created };
  }
  return finalizeLogin(user, ctx, { firstLogin: created });
}

// ── TOTP second-factor challenge ─────────────────────────────────────────────

/** Short-lived proof that the first factor (email/phone OTP) succeeded. */
export function issueTotpTicket(user) {
  return jwt.sign({ sub: user.id, purpose: 'totp' }, config.auth.jwtSecret, { expiresIn: '5m' });
}

/** Validate a challenge ticket → the user row it belongs to (or throws). */
export async function resolveTotpTicket(ticket) {
  let payload;
  try {
    payload = jwt.verify(ticket, config.auth.jwtSecret);
  } catch {
    throw unauthorized('Your login expired — sign in again.');
  }
  if (payload.purpose !== 'totp') throw unauthorized('Invalid login ticket');
  const user = await get('SELECT * FROM users WHERE id = @id', { id: payload.sub });
  if (!user || user.status !== 'active') throw unauthorized('Account unavailable');
  return user;
}

// ── Sessions / tokens ────────────────────────────────────────────────────

/** Issue access JWT + refresh session for a user. Shared by all login paths. */
export async function finalizeLogin(user, ctx = {}, extra = {}) {
  await touchLogin(user.id);
  const sessionId = newId('ses');
  const refresh = randomToken(32);
  const at = nowIso();
  const expires = new Date(Date.now() + config.auth.refreshTtlDays * 86_400_000).toISOString();
  await run(`INSERT INTO sessions (id, user_id, refresh_hash, user_agent, device, ip, last_used_at, expires_at, created_at)
       VALUES (@id, @uid, @rh, @ua, @dev, @ip, @at, @exp, @at)`,
      { id: sessionId, uid: user.id, rh: sha256(refresh),
        ua: ctx.userAgent || null, dev: deviceLabel(ctx.userAgent), ip: ctx.ip || null, exp: expires, at });

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

/**
 * Exchange a refresh token for a fresh access token AND a rotated refresh token
 * (one-time-use rotation). If a refresh secret that doesn't match the current
 * hash is ever presented, that's a sign the token was stolen/replayed — we
 * revoke the entire session chain so neither party can keep using it.
 */
export async function refreshSession(refreshToken, ctx = {}) {
  const [sessionId, secret] = String(refreshToken || '').split('.');
  const session = await get('SELECT * FROM sessions WHERE id = @id', { id: sessionId });
  if (!session || session.revoked_at) throw unauthorized('Invalid session');
  if (new Date(session.expires_at) < new Date()) throw unauthorized('Session expired');

  if (!safeEqual(session.refresh_hash, sha256(secret || ''))) {
    // Reuse/theft detected — kill this session.
    await run('UPDATE sessions SET revoked_at = @at WHERE id = @id', { at: nowIso(), id: sessionId });
    await audit({ action: 'auth.refresh_reuse', actor: { id: session.user_id },
      targetType: 'session', targetId: sessionId, metadata: { ip: ctx.ip }, req: ctx.req });
    throw unauthorized('Session expired. Please sign in again.');
  }

  const user = await get('SELECT * FROM users WHERE id = @id', { id: session.user_id });
  if (!user || user.status !== 'active') throw unauthorized('Account unavailable');

  // Rotate: issue a brand-new refresh secret and update the row in place.
  // Sliding expiry: every active refresh restarts the 30-day window, so a
  // returning customer stays signed in indefinitely — only true inactivity
  // (refreshTtlDays without a visit) ends the session.
  const newSecret = randomToken(32);
  const slide = new Date(Date.now() + config.auth.refreshTtlDays * 86_400_000).toISOString();
  await run(`UPDATE sessions SET refresh_hash = @rh, last_used_at = @at, expires_at = @exp,
        rotated_count = COALESCE(rotated_count,0) + 1,
        ip = COALESCE(@ip, ip), user_agent = COALESCE(@ua, user_agent)
      WHERE id = @id`,
      { rh: sha256(newSecret), at: nowIso(), exp: slide, ip: ctx.ip || null, ua: ctx.userAgent || null, id: sessionId });

  return { accessToken: await signAccess(user, sessionId), refreshToken: `${sessionId}.${newSecret}` };
}

export async function revokeSession(sessionId) {
  await run('UPDATE sessions SET revoked_at = @at WHERE id = @id', { at: nowIso(), id: sessionId });
}

/** Active (non-revoked, unexpired) sessions for a user, newest activity first. */
export async function listSessions(userId, currentSid = null) {
  const rows = await all(
    `SELECT id, device, ip, user_agent, created_at, last_used_at
       FROM sessions
      WHERE user_id = @u AND revoked_at IS NULL AND expires_at > @now
      ORDER BY COALESCE(last_used_at, created_at) DESC`,
    { u: userId, now: nowIso() });
  return rows.map((r) => ({
    id: r.id,
    device: r.device || deviceLabel(r.user_agent),
    ip: r.ip,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at || r.created_at,
    current: r.id === currentSid,
  }));
}

/** Revoke every active session for a user except (optionally) one to keep. */
export async function revokeOtherSessions(userId, keepSid = null) {
  await run(
    `UPDATE sessions SET revoked_at = @at
       WHERE user_id = @u AND revoked_at IS NULL AND id <> @keep`,
    { at: nowIso(), u: userId, keep: keepSid || '' });
}

/** Revoke a single session, but only if it belongs to the given user. */
export async function revokeUserSession(userId, sessionId) {
  const s = await get('SELECT user_id FROM sessions WHERE id = @id', { id: sessionId });
  if (!s || s.user_id !== userId) throw unauthorized('Session not found');
  await revokeSession(sessionId);
}

export async function isSessionActive(sessionId) {
  const s = await get('SELECT revoked_at, expires_at FROM sessions WHERE id = @id', { id: sessionId });
  return !!s && !s.revoked_at && new Date(s.expires_at) > new Date();
}
