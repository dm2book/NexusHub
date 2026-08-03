/** Authentication routes: email OTP, Google/Discord OAuth, session refresh. */
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config/env.js';
import { asyncHandler } from '../middleware/error.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/auth.js';
import { randomToken } from '../utils/crypto.js';
import {
  requestEmailOtp, verifyEmailOtp, requestPhoneOtp, verifyPhoneOtp,
  refreshSession, revokeSession, finalizeLogin, resolveTotpTicket,
  listSessions, revokeOtherSessions, revokeUserSession,
} from '../services/authService.js';
import {
  totpStatus, startTotpEnrollment, confirmTotpEnrollment, disableTotp, verifyUserTotp,
} from '../services/totpService.js';
import {
  listEnabledProviders, buildAuthUrl, handleOAuthCallback,
} from '../services/oauthService.js';
import { publicUser, getUserByEmail, getUserById } from '../services/userService.js';
import {
  createTrustedDevice, resolveTrustedDevice, listTrustedDevices, renameTrustedDevice,
  revokeTrustedDevice, revokeAllTrustedDevices, recordLoginAttempt, recentFailures,
  loginHistory, isSuspiciousLogin,
} from '../services/deviceService.js';
import { normalizePhone, isValidPhone, smsAvailable } from '../services/smsService.js';
import { get } from '../db/index.js';
import { attributeSignup } from '../services/affiliateService.js';
import { audit } from '../services/auditService.js';
import { sendEmailAsync } from '../services/emailService.js';
import { notify } from '../services/notificationService.js';
import { badRequest, tooMany, unauthorized } from '../utils/errors.js';

const DEVICE_COOKIE = 'fm_device';
const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || ''));

const router = Router();

const ctxOf = (req) => ({
  ip: req.ip,
  userAgent: req.get('user-agent'),
  fingerprint: req.get('x-device-id') || null,
  req,
});

function setSessionCookie(res, refreshToken) {
  res.cookie(config.auth.cookieName, refreshToken, {
    httpOnly: true,
    secure: config.isProd,
    // In production the SPA and API may live on different domains (e.g. a Vercel
    // frontend + separate API host). 'none' lets the browser send the session
    // cookie on those cross-site refresh requests so people stay logged in;
    // it requires secure:true, which we always set in prod. Dev stays 'lax'.
    sameSite: config.isProd ? 'none' : 'lax',
    maxAge: config.auth.refreshTtlDays * 86_400_000,
    path: '/api/auth',
  });
}

function setDeviceCookie(res, token) {
  res.cookie(DEVICE_COOKIE, token, {
    httpOnly: true, secure: config.isProd, sameSite: config.isProd ? 'none' : 'lax',
    maxAge: 60 * 86_400_000, path: '/api/auth',
  });
}

// Resolve an identifier (email or phone) to an existing user, if any.
async function userForIdentifier(identifier) {
  if (isEmail(identifier)) return getUserByEmail(String(identifier).toLowerCase());
  const p = normalizePhone(identifier);
  return isValidPhone(p) ? get('SELECT * FROM users WHERE phone=@p', { p }) : null;
}

// ── Email OTP ──────────────────────────────────────────────────────────────
// Shared across instances: five login attempts a minute has to mean five,
// not five per serverless instance that happens to be warm. This is the one
// limiter standing between a code-guessing script and an account.
const otpLimiter = rateLimit({ bucket: 'auth_otp', windowMs: 60_000, max: 5, shared: true });

// Unified entry point: email OR phone. If this device is trusted for the
// matching account → instant login, no OTP. Otherwise send a code.
router.post('/start', otpLimiter, asyncHandler(async (req, res) => {
  const { identifier } = z.object({ identifier: z.string().min(3).max(120) }).parse(req.body);
  const ctx = ctxOf(req);
  const channel = isEmail(identifier) ? 'email' : 'sms';

  // Brute-force gate (per identifier / IP).
  if (await recentFailures(identifier, ctx.ip) >= 10) {
    throw tooMany('Too many attempts. Please wait a few minutes and try again.');
  }

  // Already signed in on this browser? If the session cookie belongs to the
  // same account, don't email a code — rotate the session and sign straight in.
  // (Kills the race where the silent boot login and a manual login overlap.)
  const existingRefresh = req.cookies?.[config.auth.cookieName];
  if (existingRefresh) {
    try {
      const [sessionId] = String(existingRefresh).split('.');
      const sess = await get('SELECT * FROM sessions WHERE id = @id', { id: sessionId });
      if (sess && !sess.revoked_at && new Date(sess.expires_at) > new Date()) {
        const user = await userForIdentifier(identifier);
        if (user && user.id === sess.user_id && user.status === 'active') {
          const rotated = await refreshSession(existingRefresh, ctx);
          setSessionCookie(res, rotated.refreshToken);
          await audit({ actor: { id: user.id, email: user.email }, action: 'auth.login',
            metadata: { method: 'existing_session' }, req });
          return res.json({ loggedIn: true, accessToken: rotated.accessToken, user: await publicUser(user.id) });
        }
      }
    } catch { /* invalid/rotated cookie → fall through to the normal flow */ }
  }

  // Trusted-device instant login.
  const deviceToken = req.cookies?.[DEVICE_COOKIE];
  if (deviceToken) {
    const trustedUserId = await resolveTrustedDevice(deviceToken, ctx);
    const user = await userForIdentifier(identifier);
    if (trustedUserId && user && user.id === trustedUserId && user.status === 'active') {
      const session = await finalizeLogin(user, ctx);
      setSessionCookie(res, session.refreshToken);
      await recordLoginAttempt({ userId: user.id, identifier, channel: 'trusted_device', success: true, ctx });
      await audit({ actor: { id: user.id, email: user.email }, action: 'auth.login', metadata: { method: 'trusted_device' }, req });
      return res.json({ loggedIn: true, accessToken: session.accessToken, user: await publicUser(user.id) });
    }
  }

  // Otherwise send an OTP on the right channel.
  if (channel === 'email') await requestEmailOtp(identifier, ctx);
  else await requestPhoneOtp(identifier, ctx);
  res.json({ loggedIn: false, channel });
}));

router.post('/otp/request', otpLimiter, asyncHandler(async (req, res) => {
  const { email } = z.object({ email: z.string().email() }).parse(req.body);
  const result = await requestEmailOtp(email, ctxOf(req));
  res.json(result);
}));

router.post('/otp/verify', otpLimiter, asyncHandler(async (req, res) => {
  const body = z.object({
    email: z.string().email().optional(),
    phone: z.string().max(40).optional(),
    identifier: z.string().max(120).optional(),
    code: z.string().min(4).max(8),
    remember: z.boolean().optional(),
    ref: z.string().max(40).optional(),
  }).parse(req.body);
  const ctx = ctxOf(req);

  // Resolve channel from explicit field or the unified identifier.
  const id = body.email || body.phone || body.identifier;
  const channel = body.phone || (body.identifier && !isEmail(body.identifier)) ? 'sms' : 'email';

  let session;
  try {
    session = channel === 'sms'
      ? await verifyPhoneOtp(id, body.code, ctx)
      : await verifyEmailOtp(id, body.code, ctx);
  } catch (err) {
    await recordLoginAttempt({ identifier: id, channel, success: false, reason: err.message, ctx });
    throw err;
  }

  // Account has an authenticator app enabled → second factor before a session.
  if (session.totpRequired) {
    return res.json({ totpRequired: true, ticket: session.ticket });
  }

  // Suspicious-login detection (established account, brand-new device/IP).
  const suspicious = await isSuspiciousLogin(session.user.id, ctx);
  await recordLoginAttempt({ userId: session.user.id, identifier: id, channel, success: true, suspicious, ctx });
  if (suspicious) {
    await audit({ actor: { id: session.user.id, email: session.user.email }, action: 'auth.login_suspicious',
      metadata: { ip: ctx.ip, device: ctx.userAgent }, req });
    sendEmailAsync('custom_message', session.user.email, {
      subject: 'New sign-in to your ForgeMarket account',
      message: `We noticed a sign-in from a new device or location (IP ${ctx.ip || 'unknown'}). If this was you, you can ignore this. If not, revoke the device in your account security settings and contact support.`,
      order: { number: '', url: `${config.appUrl}/account/settings` },
    });
    if (session.user.id) await notify(session.user.id, { type: 'security', title: 'New device sign-in',
      body: 'A new device signed in to your account. Review your active devices if this wasn’t you.', link: '/account/settings' });
  }

  if (session.firstLogin) {
    if (session.user.email && !session.user.email.endsWith('@phone.forgemarket.local')) {
      sendEmailAsync('account_created', session.user.email, { user: { name: session.user.display_name || String(id).split('@')[0] } });
    }
    if (body.ref) await attributeSignup(session.user.id, body.ref).catch(() => {});
  }

  // Remember this device → future logins skip OTP.
  if (body.remember) {
    const td = await createTrustedDevice(session.user.id, ctx);
    setDeviceCookie(res, td.token);
  }

  await audit({ actor: { id: session.user.id, email: session.user.email },
    action: 'auth.login', metadata: { method: channel }, req });
  setSessionCookie(res, session.refreshToken);
  res.json({
    accessToken: session.accessToken,
    user: await publicUser(session.user.id),
    firstLogin: !!session.firstLogin,
  });
}));

// Silent device login: no identifier needed. If this browser carries a valid
// trusted-device cookie (created after a full login where the user ticked
// "Trust this device", incl. any 2FA), start a fresh session directly. This is
// what keeps returning customers signed in even after their session expired.
router.post('/device-login', rateLimit({ bucket: 'device_login', windowMs: 60_000, max: 10 }),
  asyncHandler(async (req, res) => {
    const deviceToken = req.cookies?.[DEVICE_COOKIE];
    if (!deviceToken) throw unauthorized('No trusted device');
    const ctx = ctxOf(req);
    const userId = await resolveTrustedDevice(deviceToken, ctx);
    if (!userId) throw unauthorized('No trusted device');
    const user = await getUserById(userId);
    if (!user || user.status !== 'active') throw unauthorized('No trusted device');

    const session = await finalizeLogin(user, ctx);
    await recordLoginAttempt({ userId: user.id, identifier: user.email, channel: 'trusted_device', success: true, ctx });
    await audit({ actor: { id: user.id, email: user.email }, action: 'auth.login',
      metadata: { method: 'trusted_device_auto' }, req });
    setSessionCookie(res, session.refreshToken);
    res.json({ accessToken: session.accessToken, user: await publicUser(user.id) });
  }));

// ── Two-factor authentication (TOTP / authenticator apps) ────────────────────

// Complete a 2FA-gated login: OTP already verified (proven by the ticket) +
// the current authenticator code → real session.
router.post('/totp/login', otpLimiter, asyncHandler(async (req, res) => {
  const { ticket, code, remember } = z.object({
    ticket: z.string().min(10),
    code: z.string().min(6).max(8),
    remember: z.boolean().optional(),
  }).parse(req.body);
  const ctx = ctxOf(req);
  const user = await resolveTotpTicket(ticket);
  if (!(await verifyUserTotp(user.id, code))) {
    await recordLoginAttempt({ userId: user.id, identifier: user.email, channel: 'totp',
      success: false, reason: 'bad totp code', ctx });
    throw badRequest('Incorrect authenticator code');
  }
  const session = await finalizeLogin(user, ctx);
  const suspicious = await isSuspiciousLogin(user.id, ctx);
  await recordLoginAttempt({ userId: user.id, identifier: user.email, channel: 'totp',
    success: true, suspicious, ctx });
  if (remember) {
    const td = await createTrustedDevice(user.id, ctx);
    setDeviceCookie(res, td.token);
  }
  await audit({ actor: { id: user.id, email: user.email }, action: 'auth.login',
    metadata: { method: 'otp+totp' }, req });
  setSessionCookie(res, session.refreshToken);
  res.json({ accessToken: session.accessToken, user: await publicUser(user.id) });
}));

// Status / setup / enable / disable for the signed-in user.
router.get('/totp', requireAuth, asyncHandler(async (req, res) => {
  res.json(await totpStatus(req.user.id));
}));

router.post('/totp/setup', requireAuth, asyncHandler(async (req, res) => {
  const result = await startTotpEnrollment(req.user);
  await audit({ actor: { id: req.user.id, email: req.user.email }, action: 'auth.totp_setup', req });
  res.json(result);
}));

router.post('/totp/enable', requireAuth, asyncHandler(async (req, res) => {
  const { code } = z.object({ code: z.string().min(6).max(8) }).parse(req.body);
  const result = await confirmTotpEnrollment(req.user.id, code);
  await audit({ actor: { id: req.user.id, email: req.user.email }, action: 'auth.totp_enabled', req });
  await notify(req.user.id, { type: 'security', title: 'Two-factor authentication enabled',
    body: 'Logins now require a code from your authenticator app. Nice — your account is safer.',
    link: '/account/settings' }).catch(() => {});
  res.json(result);
}));

router.post('/totp/disable', requireAuth, asyncHandler(async (req, res) => {
  const { code } = z.object({ code: z.string().min(6).max(8) }).parse(req.body);
  const result = await disableTotp(req.user.id, code);
  await audit({ actor: { id: req.user.id, email: req.user.email }, action: 'auth.totp_disabled', req });
  await notify(req.user.id, { type: 'security', title: 'Two-factor authentication disabled',
    body: 'Your account no longer requires an authenticator code at login. If this wasn’t you, contact support immediately.',
    link: '/account/settings' }).catch(() => {});
  res.json(result);
}));

// ── OAuth ────────────────────────────────────────────────────────────────
router.get('/providers', (_req, res) => {
  // `channels` is what the login form asks itself before promising anything:
  // email always works, SMS only when a provider is wired up. Offering a way
  // in that cannot deliver is worse than not offering it.
  res.json({
    providers: listEnabledProviders(),
    channels: smsAvailable() ? ['email', 'sms'] : ['email'],
  });
});

/**
 * These two routes are entered by *navigating*, not by fetch — the browser is
 * showing whatever they return. So they must never answer with an API error
 * body: a buyer who taps "Continue with Discord" while the provider is
 * unconfigured used to land on a white page reading
 * `{"error":{"message":"Provider discord not configured"}}`. Every failure here
 * goes back to the login page with a code the SPA can put into words.
 */
const oauthFail = (res, reason, provider) =>
  res.redirect(`${config.appUrl}/login?error=${reason}&provider=${encodeURIComponent(provider)}`);

// Start flow — sets a signed state cookie and redirects to the provider.
router.get('/oauth/:provider/start', (req, res) => {
  const provider = req.params.provider;
  if (!listEnabledProviders().includes(provider)) return oauthFail(res, 'oauth_unavailable', provider);
  const state = randomToken(16);
  res.cookie(`oauth_state_${provider}`, state, {
    httpOnly: true, secure: config.isProd, sameSite: 'lax', maxAge: 600_000, path: '/api/auth',
  });
  res.redirect(buildAuthUrl(provider, state));
});

// Provider callback — verifies state, logs in, redirects to the SPA.
router.get('/oauth/:provider/callback', asyncHandler(async (req, res) => {
  const provider = req.params.provider;
  const { code, state } = req.query;
  const expected = req.cookies?.[`oauth_state_${provider}`];
  if (!code || !state || state !== expected) {
    return oauthFail(res, 'oauth_state', provider);
  }
  res.clearCookie(`oauth_state_${provider}`, { path: '/api/auth' });
  let session;
  try {
    session = await handleOAuthCallback(provider, String(code), ctxOf(req));
  } catch {
    // Token exchange refused, no email on the profile, provider down — none of
    // that is something the buyer can read from a JSON body.
    return oauthFail(res, 'oauth_failed', provider);
  }
  await audit({ actor: { id: session.user.id, email: session.user.email },
    action: 'auth.login', metadata: { method: provider }, req });
  setSessionCookie(res, session.refreshToken);
  // Hand the access token to the SPA via a short-lived fragment.
  res.redirect(`${config.appUrl}/auth/callback#token=${session.accessToken}`);
}));

// ── Session lifecycle ──────────────────────────────────────────────────────
router.post('/refresh', asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[config.auth.cookieName] || req.body?.refreshToken;
  if (!refreshToken) throw badRequest('No session');
  // Rotation: refreshSession returns a NEW refresh token each time; re-set the
  // cookie so the previous one is single-use. (Previously this wasn't awaited,
  // so the client received an empty body and got logged out.)
  const { accessToken, refreshToken: rotated } = await refreshSession(refreshToken, ctxOf(req));
  if (rotated) setSessionCookie(res, rotated);
  res.json({ accessToken });
}));

router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  if (req.auth?.sid) await revokeSession(req.auth.sid);
  res.clearCookie(config.auth.cookieName, { path: '/api/auth' });
  await audit({ actor: { id: req.user.id, email: req.user.email }, action: 'auth.logout', req });
  res.json({ ok: true });
}));

// ── Active session management ────────────────────────────────────────────────
router.get('/sessions', requireAuth, asyncHandler(async (req, res) => {
  res.json({ sessions: await listSessions(req.user.id, req.auth?.sid) });
}));

// Revoke one session (must belong to the caller).
router.delete('/sessions/:id', requireAuth, asyncHandler(async (req, res) => {
  await revokeUserSession(req.user.id, req.params.id);
  await audit({ actor: { id: req.user.id, email: req.user.email },
    action: 'auth.session_revoke', targetType: 'session', targetId: req.params.id, req });
  res.json({ ok: true });
}));

// Sign out everywhere else (keep the current session).
router.post('/sessions/revoke-others', requireAuth, asyncHandler(async (req, res) => {
  await revokeOtherSessions(req.user.id, req.auth?.sid);
  await audit({ actor: { id: req.user.id, email: req.user.email },
    action: 'auth.session_revoke_others', req });
  res.json({ ok: true });
}));

// ── Trusted devices + login history ──────────────────────────────────────────
router.get('/devices', requireAuth, asyncHandler(async (req, res) => {
  res.json({ devices: await listTrustedDevices(req.user.id) });
}));

router.patch('/devices/:id', requireAuth, asyncHandler(async (req, res) => {
  const { name } = z.object({ name: z.string().min(1).max(60) }).parse(req.body);
  const ok = await renameTrustedDevice(req.user.id, req.params.id, name);
  if (!ok) throw badRequest('Device not found');
  res.json({ ok: true });
}));

router.delete('/devices/:id', requireAuth, asyncHandler(async (req, res) => {
  const ok = await revokeTrustedDevice(req.user.id, req.params.id);
  if (!ok) throw badRequest('Device not found');
  await audit({ actor: { id: req.user.id, email: req.user.email },
    action: 'auth.device_revoke', targetType: 'trusted_device', targetId: req.params.id, req });
  res.json({ ok: true });
}));

router.get('/login-history', requireAuth, asyncHandler(async (req, res) => {
  res.json({ history: await loginHistory(req.user.id, 20) });
}));

// Sign out of everything: all sessions + all trusted devices.
router.post('/logout-all', requireAuth, asyncHandler(async (req, res) => {
  await revokeOtherSessions(req.user.id, null);
  if (req.auth?.sid) await revokeSession(req.auth.sid);
  await revokeAllTrustedDevices(req.user.id);
  res.clearCookie(config.auth.cookieName, { path: '/api/auth' });
  res.clearCookie(DEVICE_COOKIE, { path: '/api/auth' });
  await audit({ actor: { id: req.user.id, email: req.user.email }, action: 'auth.logout_all', req });
  res.json({ ok: true });
}));

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
