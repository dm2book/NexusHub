import bcrypt from 'bcryptjs';
import { Role } from '@memeforge/shared';
import { DEFAULT_AUTO_SELL_LADDER } from '@memeforge/shared';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { badRequest, unauthorized } from '../../lib/errors.js';
import { signAccessToken, signRefreshToken } from '../../lib/jwt.js';
import type { Prisma } from '@prisma/client';

const OTP_TTL_MS = 10 * 60_000;
const MAX_OTP_ATTEMPTS = 5;

function genOtp(): string {
  return String(Math.floor(100_000 + Math.random() * 900_000));
}

/** The configured owner email is auto-promoted to OWNER on creation. */
function roleForEmail(email: string): Role {
  return email.toLowerCase() === env.ownerEmail ? Role.OWNER : Role.VIEWER;
}

export async function findOrCreateUser(
  email: string,
  extra: Partial<Prisma.UserCreateInput> = {},
) {
  const normalized = email.toLowerCase();
  let user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: normalized,
        role: roleForEmail(normalized),
        notificationPref: { create: {} },
        ...extra,
      },
    });
    logger.info({ email: normalized, role: user.role }, 'Created user');
  } else if (roleForEmail(normalized) === Role.OWNER && user.role !== Role.OWNER) {
    user = await prisma.user.update({ where: { id: user.id }, data: { role: Role.OWNER } });
  }
  return user;
}

/** Step 1 of email OTP login: generate + (pretend to) send a code. */
export async function requestOtp(email: string): Promise<{ devCode?: string }> {
  const user = await findOrCreateUser(email);
  const code = genOtp();
  const codeHash = await bcrypt.hash(code, 8);
  await prisma.otpCode.create({
    data: { userId: user.id, codeHash, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });

  // Delivery is handled by the notification bus / email channel. When SMTP is
  // not configured we log the code so local login still works.
  if (!env.smtp.host) {
    logger.info({ email, code }, '🔑 OTP (SMTP not configured — using console delivery)');
    return { devCode: env.isProd ? undefined : code };
  }
  // Lazy import to avoid a cycle.
  const { notifications } = await import('../notifications/notification.service.js');
  await notifications.dispatch(user.id, {
    type: 'SYSTEM',
    title: 'Your MemeForge login code',
    body: `Your one-time code is ${code}. It expires in 10 minutes.`,
    emoji: '🔐',
    channels: ['EMAIL'] as never,
  });
  return {};
}

/** Step 2: verify the OTP and issue tokens. */
export async function verifyOtp(email: string, code: string, ctx: { ua?: string; ip?: string }) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) throw badRequest('Request a code first');

  const otp = await prisma.otpCode.findFirst({
    where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!otp) throw unauthorized('Code expired — request a new one');
  if (otp.attempts >= MAX_OTP_ATTEMPTS) throw unauthorized('Too many attempts');

  const valid = await bcrypt.compare(code, otp.codeHash);
  if (!valid) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw unauthorized('Invalid code');
  }
  await prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  return issueSession(user, ctx);
}

/** Create a refresh session + return both tokens. */
export async function issueSession(
  user: { id: string; email: string; role: Role },
  ctx: { ua?: string; ip?: string },
) {
  const jwtUser = { id: user.id, email: user.email, role: user.role };
  const refreshToken = signRefreshToken(jwtUser);
  const accessToken = signAccessToken(jwtUser);
  const refreshHash = await bcrypt.hash(refreshToken, 8);
  await prisma.session.create({
    data: {
      userId: user.id,
      refreshHash,
      userAgent: ctx.ua,
      ip: ctx.ip,
      expiresAt: new Date(Date.now() + 30 * 24 * 3_600_000),
    },
  });
  return { accessToken, refreshToken, user: jwtUser };
}

/** Rotate a refresh token. */
export async function refreshSession(refreshToken: string, userId: string) {
  const sessions = await prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
  });
  let matched = null;
  for (const s of sessions) {
    if (await bcrypt.compare(refreshToken, s.refreshHash)) {
      matched = s;
      break;
    }
  }
  if (!matched) throw unauthorized('Invalid refresh token');

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unauthorized();

  // Revoke the old session and issue a new one (rotation).
  await prisma.session.update({ where: { id: matched.id }, data: { revokedAt: new Date() } });
  return issueSession(user, { ua: matched.userAgent ?? undefined, ip: matched.ip ?? undefined });
}

export async function logout(userId: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Ensure a freshly-created user has a default wallet + automation config. */
export async function ensureDefaults(userId: string) {
  const existing = await prisma.wallet.findFirst({ where: { userId } });
  if (!existing) {
    await prisma.wallet.create({
      data: { userId, label: 'Main Wallet', address: `mock-${userId.slice(0, 8)}` },
    });
  }
  await prisma.profitLockConfig.upsert({
    where: { userId },
    update: {},
    create: { userId, sweepPct: 50 },
  });
  void DEFAULT_AUTO_SELL_LADDER; // ladders applied per-position on open
}
