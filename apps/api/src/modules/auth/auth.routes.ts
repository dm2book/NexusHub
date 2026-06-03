import { Router } from 'express';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { env } from '../../config/env.js';
import { asyncHandler, ok } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import {
  ensureDefaults,
  logout,
  refreshSession,
  requestOtp,
  verifyOtp,
} from './auth.service.js';
import {
  discordAuthUrl,
  googleAuthUrl,
  handleDiscordCallback,
  handleGoogleCallback,
} from './oauth.service.js';
import { verifyToken } from '../../lib/jwt.js';

export const authRouter = Router();

const ctx = (req: { headers: Record<string, unknown>; ip?: string }) => ({
  ua: String(req.headers['user-agent'] ?? ''),
  ip: req.ip,
});

// ── Email OTP ──
authRouter.post(
  '/otp/request',
  authLimiter,
  validate(z.object({ email: z.string().email() })),
  asyncHandler(async (req, res) => {
    const out = await requestOtp(req.body.email);
    ok(res, { sent: true, ...out });
  }),
);

authRouter.post(
  '/otp/verify',
  authLimiter,
  validate(z.object({ email: z.string().email(), code: z.string().length(6) })),
  asyncHandler(async (req, res) => {
    const result = await verifyOtp(req.body.email, req.body.code, ctx(req));
    await ensureDefaults(result.user.id);
    ok(res, result);
  }),
);

// ── Refresh / logout ──
authRouter.post(
  '/refresh',
  validate(z.object({ refreshToken: z.string() })),
  asyncHandler(async (req, res) => {
    const { sub } = verifyToken(req.body.refreshToken);
    const result = await refreshSession(req.body.refreshToken, sub);
    ok(res, result);
  }),
);

authRouter.post(
  '/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    await logout(req.user!.id);
    ok(res, { success: true });
  }),
);

// ── Current user ──
authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, email: true, name: true, avatarUrl: true, role: true, createdAt: true },
    });
    ok(res, user);
  }),
);

// ── OAuth (Google / Discord) ──
authRouter.get('/google', (_req, res) => {
  res.redirect(googleAuthUrl(nanoid()));
});
authRouter.get('/discord', (_req, res) => {
  res.redirect(discordAuthUrl(nanoid()));
});

authRouter.get(
  '/google/callback',
  asyncHandler(async (req, res) => {
    const user = await handleGoogleCallback(String(req.query.code ?? ''));
    const result = await import('./auth.service.js').then((m) => m.issueSession(user, ctx(req)));
    await ensureDefaults(user.id);
    redirectWithTokens(res, result);
  }),
);

authRouter.get(
  '/discord/callback',
  asyncHandler(async (req, res) => {
    const user = await handleDiscordCallback(String(req.query.code ?? ''));
    const result = await import('./auth.service.js').then((m) => m.issueSession(user, ctx(req)));
    await ensureDefaults(user.id);
    redirectWithTokens(res, result);
  }),
);

function redirectWithTokens(
  res: import('express').Response,
  result: { accessToken: string; refreshToken: string },
) {
  const url = new URL('/auth/callback', env.webBaseUrl);
  url.searchParams.set('access', result.accessToken);
  url.searchParams.set('refresh', result.refreshToken);
  res.redirect(url.toString());
}
