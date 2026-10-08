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
import { sendSms, isValidPhone, normalizePhone, smsAvailable, otpSmsText, langForPhone } from './smsService.js';
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

  /* The limit is checked BEFORE the code, and across every live code for this
     address: checked after, a correct guess still signed in once the "too
     many attempts" answer had been given — and spread over IPs, the 6 digits
     could be walked. Hitting it burns all live codes. */
  const tried = live.reduce((a, r) => a + Number(r.attempts || 0), 0);
  if (tried >= config.auth.otpMaxAttempts) {
    await run(`UPDATE otp_codes SET consumed_at = @at WHERE email = @e AND consumed_at IS NULL`, { at: nowIso(), e });
    throw tooMany('Too many attempts. Request a new code.');
  }
  const match = live.find((r) => safeEqual(r.code_hash, supplied));
  if (!match) {
    // Wrong code: counted against the newest live code.
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

  /* In the reader's language: the page's, else the one on their account, else
     the one their number's country speaks. It was English to everyone. */
  const known = await get('SELECT lang FROM users WHERE phone = @p', { p }).catch(() => null);
  const lang = ctx.lang || known?.lang || langForPhone(p);
  const r = await sendSms(p, otpSmsText(code, { lang }));
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
  const tried = live.reduce((a, r) => a + Number(r.attempts || 0), 0);
  if (tried >= config.auth.otpMaxAttempts) {
    await run(`UPDATE sms_verifications SET consumed_at=@at WHERE phone=@p AND consumed_at IS NULL`, { at: nowIso(), p });
    throw tooMany('Too many attempts. Request a new code.');
  }
  const match = live.find((r) => safeEqual(r.code_hash, supplied));
  if (!match) {
    const newest = live[0];
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

/**
 * Wrong authenticator codes one ticket survives. The ticket is the proof that
 * the first factor passed, and it used to take unlimited guesses for its five
 * minutes — the only brake was a per-IP limiter, which an attacker holding the
 * emailed code sidesteps by changing address. Five, then back to the start:
 * every further batch of guesses costs a fresh first factor.
 */
export const TOTP_TICKET_ATTEMPTS = 5;
const TICKET_SPENT = 'Too many incorrect codes, or this login was already used — sign in again.';

/**
 * Short-lived proof that the first factor (email/phone OTP) succeeded.
 *
 * Stays synchronous — the OAuth callback hands it straight into a redirect.
 * The `jti` names the ticket's row in totp_tickets, which is created on its
 * first use; the signature already guarantees nobody can mint a fresh jti to
 * get a fresh counter.
 */
export function issueTotpTicket(user) {
  /* Its own audience: the ticket proves the FIRST factor only, and must never
     be accepted where a signed-in session is (verifyAccess refuses it). */
  return jwt.sign({ sub: user.id, purpose: 'totp' }, config.auth.jwtSecret,
    { expiresIn: '5m', audience: 'totp-ticket', jwtid: randomToken(16) });
}

/** Signature, audience, expiry and shape — no database. */
function readTotpTicket(ticket) {
  let payload;
  try {
    payload = jwt.verify(String(ticket || ''), config.auth.jwtSecret, { audience: 'totp-ticket' });
  } catch {
    throw unauthorized('Your login expired — sign in again.');
  }
  // No jti: issued before attempts were counted, so it has no counter to keep.
  if (payload.purpose !== 'totp' || !payload.jti) throw unauthorized('Invalid login ticket');
  return payload;
}

async function ticketUser(payload) {
  const user = await get('SELECT * FROM users WHERE id = @id', { id: payload.sub });
  if (!user || user.status !== 'active') throw unauthorized('Account unavailable');
  return user;
}

/**
 * Validate a challenge ticket → the user row it belongs to (or throws).
 * Read-only: a ticket that has signed in once, or has run out of attempts, is
 * refused even while its signature is still good.
 */
export async function resolveTotpTicket(ticket) {
  const payload = readTotpTicket(ticket);
  const row = await get('SELECT attempts, consumed_at FROM totp_tickets WHERE id = @id', { id: payload.jti });
  if (row && (row.consumed_at || row.attempts >= TOTP_TICKET_ATTEMPTS)) throw unauthorized(TICKET_SPENT);
  return ticketUser(payload);
}

/**
 * Spend one of a ticket's attempts, BEFORE its code is looked at.
 *
 * Claimed first and atomically — one upsert that only counts while attempts
 * are left — because checking the count and bumping it afterwards let a burst
 * of parallel requests all read "0 used" and each get a guess. Returns the
 * user, the ticket id (for consumeTotpTicket) and how many attempts remain
 * after this one; a ticket with none left throws 401, which the login page
 * answers by starting over.
 */
export async function claimTotpTicketAttempt(ticket) {
  const payload = readTotpTicket(ticket);
  const user = await ticketUser(payload);
  /* Housekeeping, so the table stays "logins of the last few minutes" without a
     job of its own. The hour of slack is deliberate: a row deleted while its
     ticket still verified would hand that ticket a fresh set of attempts. */
  await run('DELETE FROM totp_tickets WHERE expires_at < @cutoff',
    { cutoff: new Date(Date.now() - 3_600_000).toISOString() });
  const row = await get(
    `INSERT INTO totp_tickets (id, user_id, attempts, expires_at, created_at)
          VALUES (@id, @u, 1, @exp, @at)
     ON CONFLICT (id) DO UPDATE SET attempts = totp_tickets.attempts + 1
          WHERE totp_tickets.attempts < @max AND totp_tickets.consumed_at IS NULL
     RETURNING attempts`,
    { id: payload.jti, u: user.id, exp: new Date(payload.exp * 1000).toISOString(),
      at: nowIso(), max: TOTP_TICKET_ATTEMPTS });
  if (!row) throw unauthorized(TICKET_SPENT);
  return { user, ticketId: payload.jti, attemptsLeft: TOTP_TICKET_ATTEMPTS - Number(row.attempts) };
}

/** A ticket signs in once: the second request carrying it is refused. */
export async function consumeTotpTicket(ticketId) {
  const r = await run('UPDATE totp_tickets SET consumed_at = @at WHERE id = @id AND consumed_at IS NULL',
    { at: nowIso(), id: ticketId });
  if (!r.changes) throw unauthorized(TICKET_SPENT);
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
  let claims;
  try {
    claims = jwt.verify(token, config.auth.jwtSecret);
  } catch {
    throw unauthorized('Session expired. Please sign in again.');
  }
  /* An access token belongs to a session and has no purpose. The 2FA ticket is
     signed with the same secret; accepted here, it let a stolen first factor
     skip the authenticator code entirely. */
  if (claims.purpose || claims.aud || !claims.sid) throw unauthorized('Session expired. Please sign in again.');
  return claims;
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

/**
 * Who a browser is signed in as, read from its refresh-session cookie WITHOUT
 * rotating it (→ the user row, or null).
 *
 * For the routes the SPA reaches by navigating rather than by fetch: a
 * navigation carries cookies but never the Authorization header, so the bearer
 * token the rest of the API runs on is simply not there. A secret that does not
 * match is just "not signed in" here — unlike /refresh, which owns rotation and
 * treats a stale secret as theft, a read-only check has no business revoking.
 */
export async function userFromSessionCookie(refreshToken) {
  const [sessionId, secret] = String(refreshToken || '').split('.');
  if (!sessionId || !secret) return null;
  const session = await get(
    'SELECT user_id, refresh_hash, revoked_at, expires_at FROM sessions WHERE id = @id', { id: sessionId });
  if (!session || session.revoked_at || new Date(session.expires_at) < new Date()) return null;
  if (!safeEqual(session.refresh_hash, sha256(secret))) return null;
  const user = await get('SELECT * FROM users WHERE id = @id', { id: session.user_id });
  return user && user.status === 'active' ? user : null;
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
