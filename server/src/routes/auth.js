/** Authentication routes: email OTP, Google/Discord OAuth, session refresh. */
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config/env.js';
import { asyncHandler } from '../middleware/error.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/auth.js';
import { randomToken } from '../utils/crypto.js';
import {
  requestEmailOtp, verifyEmailOtp, refreshSession, revokeSession,
} from '../services/authService.js';
import {
  listEnabledProviders, buildAuthUrl, handleOAuthCallback,
} from '../services/oauthService.js';
import { publicUser } from '../services/userService.js';
import { audit } from '../services/auditService.js';
import { sendEmailAsync } from '../services/emailService.js';
import { badRequest } from '../utils/errors.js';

const router = Router();

const ctxOf = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });

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

// ── Email OTP ──────────────────────────────────────────────────────────────
const otpLimiter = rateLimit({ bucket: 'auth_otp', windowMs: 60_000, max: 5 });

router.post('/otp/request', otpLimiter, asyncHandler(async (req, res) => {
  const { email } = z.object({ email: z.string().email() }).parse(req.body);
  const result = await requestEmailOtp(email);
  res.json(result);
}));

router.post('/otp/verify', otpLimiter, asyncHandler(async (req, res) => {
  const { email, code } = z.object({
    email: z.string().email(), code: z.string().min(4).max(8),
  }).parse(req.body);
  const session = await verifyEmailOtp(email, code, ctxOf(req));
  if (session.firstLogin) {
    sendEmailAsync('account_created', session.user.email,
      { user: { name: session.user.display_name || email.split('@')[0] } });
  }
  await audit({ actor: { id: session.user.id, email: session.user.email },
    action: 'auth.login', metadata: { method: 'otp' }, req });
  setSessionCookie(res, session.refreshToken);
  res.json({
    accessToken: session.accessToken,
    user: await publicUser(session.user.id),
    firstLogin: !!session.firstLogin,
  });
}));

// ── OAuth ────────────────────────────────────────────────────────────────
router.get('/providers', (_req, res) => {
  res.json({ providers: listEnabledProviders() });
});

// Start flow — sets a signed state cookie and redirects to the provider.
router.get('/oauth/:provider/start', (req, res) => {
  const provider = req.params.provider;
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
    return res.redirect(`${config.appUrl}/login?error=oauth_state`);
  }
  res.clearCookie(`oauth_state_${provider}`, { path: '/api/auth' });
  const session = await handleOAuthCallback(provider, String(code), ctxOf(req));
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
  res.json(refreshSession(refreshToken));
}));

router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  if (req.auth?.sid) await revokeSession(req.auth.sid);
  res.clearCookie(config.auth.cookieName, { path: '/api/auth' });
  await audit({ actor: { id: req.user.id, email: req.user.email }, action: 'auth.logout', req });
  res.json({ ok: true });
}));

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
