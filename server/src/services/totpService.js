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
 *
 * A code works ONCE. Every check of a code against the active secret goes
 * through checkUserTotp, which records the time-step it matched
 * (users.totp_last_step) and refuses that step and every earlier one from then
 * on — the login challenge, switching 2FA off, and anything that asks for a
 * code later all share that one rule.
 */
import { run, get, nowIso } from '../db/index.js';
import { config } from '../config/env.js';
import { generateTotpSecret, matchTotpStep, totpUri } from '../utils/totp.js';
import { badRequest } from '../utils/errors.js';

/** Said when a right code has been used already — the fix is to wait for the next one. */
export const TOTP_REUSED_MESSAGE =
  'That code was already used. Wait for the next one from your authenticator app.';

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
  const step = matchTotpStep(row.totp_pending_secret, code);
  if (step === null) {
    throw badRequest('Incorrect code — check your authenticator app and try again');
  }
  /* The confirming code counts as used: its step becomes the last accepted
     one, so the same six digits cannot turn straight around and pass a login
     or switch 2FA off again while they are still on the screen.
     The pending secret is matched in the WHERE because a double-submitted form
     used to run this twice, and the second run promoted the now-NULL pending
     secret over the one the first had just activated — leaving an account
     that showed "2FA enabled" with no secret, so no login ever asked for it. */
  const r = await run(`UPDATE users SET totp_secret = totp_pending_secret, totp_pending_secret = NULL,
        totp_enabled_at = @at, totp_last_step = @step
      WHERE id = @id AND totp_pending_secret = @secret`,
    { at: nowIso(), step, id: userId, secret: row.totp_pending_secret });
  if (!r.changes) {
    // Lost the race to an identical request: whichever won, say what is true now.
    if ((await totpStatus(userId)).enabled) return { enabled: true };
    throw badRequest('Start the 2FA setup first');
  }
  return { enabled: true };
}

/**
 * Check a code against the account's ACTIVE secret and, if it is right, spend it.
 *
 * Returns `{ ok: true, step }`, or `{ ok: false, reason }` with reason
 *   'not_enabled' — the account has no active authenticator,
 *   'invalid'     — the code is wrong,
 *   'reused'      — the code is right but its time-step was already accepted.
 *
 * Spending happens in the same statement that checks the step is still newer
 * than the last one accepted, so two requests racing with one code cannot both
 * get through: the database lets exactly one of them move the step forward.
 */
export async function checkUserTotp(userId, code) {
  const row = await get('SELECT totp_secret, totp_last_step FROM users WHERE id=@id', { id: userId });
  if (!row?.totp_secret) return { ok: false, reason: 'not_enabled' };
  const last = row.totp_last_step == null ? null : Number(row.totp_last_step);
  const step = matchTotpStep(row.totp_secret, code, { after: last });
  if (step === null) {
    const reused = last != null && matchTotpStep(row.totp_secret, code) !== null;
    return { ok: false, reason: reused ? 'reused' : 'invalid' };
  }
  const r = await run(`UPDATE users SET totp_last_step = @step
      WHERE id = @id AND totp_secret = @secret
        AND (totp_last_step IS NULL OR totp_last_step < @step)`,
    { step, id: userId, secret: row.totp_secret });
  if (!r.changes) return { ok: false, reason: 'reused' };
  return { ok: true, step };
}

/** Disable 2FA — requires a current code so a hijacked session can't drop it silently. */
export async function disableTotp(userId, code) {
  const check = await checkUserTotp(userId, code);
  if (check.reason === 'not_enabled') {
    // Nothing active; just clear any half-finished enrollment.
    await run('UPDATE users SET totp_pending_secret=NULL WHERE id=@id', { id: userId });
    return { enabled: false };
  }
  if (!check.ok) throw badRequest(check.reason === 'reused' ? TOTP_REUSED_MESSAGE : 'Incorrect code');
  await run(`UPDATE users SET totp_secret=NULL, totp_pending_secret=NULL, totp_enabled_at=NULL,
         totp_last_step=NULL
       WHERE id=@id`, { id: userId });
  return { enabled: false };
}

/**
 * Check a login-time (or any later) code against the user's active secret.
 * True only for a right code that has not been used before — and using it here
 * spends it. Callers that need to say WHY a code failed use checkUserTotp.
 */
export async function verifyUserTotp(userId, code) {
  return (await checkUserTotp(userId, code)).ok;
}
