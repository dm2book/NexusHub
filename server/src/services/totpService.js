/**
 * TOTP two-factor authentication (authenticator apps).
 *
 * Enrollment is two-phase so an account can never lock itself out with an
 * app that was never set up correctly:
 *   1. startTotpEnrollment() → pending secret + otpauth:// URI (QR / tap link)
 *   2. confirmTotpEnrollment(code) → first valid code promotes it to active.
 *
 * Once enabled, email/phone OTP logins additionally require the current
 * authenticator code (see the /api/auth/totp/login route). Strongly
 * recommended for every staff/admin account.
 */
import { run, get, nowIso } from '../db/index.js';
import { config } from '../config/env.js';
import { generateTotpSecret, verifyTotp, totpUri } from '../utils/totp.js';
import { badRequest } from '../utils/errors.js';

export async function totpStatus(userId) {
  const row = await get('SELECT totp_enabled_at, totp_pending_secret FROM users WHERE id=@id', { id: userId });
  return { enabled: !!row?.totp_enabled_at, enabledAt: row?.totp_enabled_at || null,
    pending: !!row?.totp_pending_secret };
}

/** Phase 1: create a pending secret and hand back the provisioning URI. */
export async function startTotpEnrollment(user) {
  if ((await totpStatus(user.id)).enabled) throw badRequest('Two-factor authentication is already enabled');
  const secret = generateTotpSecret();
  await run('UPDATE users SET totp_pending_secret=@s WHERE id=@id', { s: secret, id: user.id });
  return {
    secret,
    otpauthUrl: totpUri({ secret, account: user.email, issuer: config.email.fromName }),
  };
}

/** Phase 2: the first valid code proves the app works → activate 2FA. */
export async function confirmTotpEnrollment(userId, code) {
  const row = await get('SELECT totp_pending_secret FROM users WHERE id=@id', { id: userId });
  if (!row?.totp_pending_secret) throw badRequest('Start the 2FA setup first');
  if (!verifyTotp(row.totp_pending_secret, code)) {
    throw badRequest('Incorrect code — check your authenticator app and try again');
  }
  await run(`UPDATE users SET totp_secret = totp_pending_secret, totp_pending_secret = NULL,
        totp_enabled_at = @at WHERE id = @id`, { at: nowIso(), id: userId });
  return { enabled: true };
}

/** Disable 2FA — requires a current code so a hijacked session can't drop it silently. */
export async function disableTotp(userId, code) {
  const row = await get('SELECT totp_secret FROM users WHERE id=@id', { id: userId });
  if (!row?.totp_secret) {
    // Nothing active; just clear any half-finished enrollment.
    await run('UPDATE users SET totp_pending_secret=NULL WHERE id=@id', { id: userId });
    return { enabled: false };
  }
  if (!verifyTotp(row.totp_secret, code)) throw badRequest('Incorrect code');
  await run(`UPDATE users SET totp_secret=NULL, totp_pending_secret=NULL, totp_enabled_at=NULL
       WHERE id=@id`, { id: userId });
  return { enabled: false };
}

/** Check a login-time code against the user's active secret. */
export async function verifyUserTotp(userId, code) {
  const row = await get('SELECT totp_secret FROM users WHERE id=@id', { id: userId });
  return !!row?.totp_secret && verifyTotp(row.totp_secret, code);
}
