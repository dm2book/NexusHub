/**
 * Background maintenance — run on a schedule (Vercel Cron → /api/cron/maintenance).
 * Keeps the database tidy and self-heals stuck state. Every step is idempotent and
 * safe to run repeatedly.
 */
import { run, get, all, nowIso } from '../db/index.js';
import { transitionOrder, sendPaymentReminders, sendReviewRequests } from './orderService.js';

const HOURS = (n) => new Date(Date.now() - n * 3_600_000).toISOString();
const DAYS = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

export async function runMaintenance() {
  const summary = { otpPurged: 0, sessionsExpired: 0, ordersCancelled: 0, remindersSent: 0, reviewRequestsSent: 0, at: nowIso() };

  // 1. Purge OTP codes that are long expired / already consumed (keep table small).
  try {
    const r = await run(`DELETE FROM otp_codes WHERE expires_at < @cut OR (consumed_at IS NOT NULL AND created_at < @cut)`,
      { cut: HOURS(2) });
    summary.otpPurged = r?.changes ?? 0;
  } catch (e) { summary.otpError = e.message; }

  // 2. Mark expired refresh sessions revoked so they drop out of "active sessions".
  try {
    const r = await run(`UPDATE sessions SET revoked_at = @at WHERE revoked_at IS NULL AND expires_at < @now`,
      { at: nowIso(), now: nowIso() });
    summary.sessionsExpired = r?.changes ?? 0;
  } catch (e) { summary.sessionError = e.message; }

  // 3. Auto-cancel orders left unpaid for 14+ days (frees reserved intent).
  try {
    const stale = await all(`SELECT id FROM orders WHERE status='pending' AND created_at < @cut LIMIT 100`,
      { cut: DAYS(14) });
    for (const o of stale) {
      try {
        await transitionOrder(o.id, 'cancelled', { actorId: 'system', reason: 'Auto-cancelled: unpaid for 14 days' });
        summary.ordersCancelled++;
      } catch { /* skip individual failures */ }
    }
  } catch (e) { summary.orderError = e.message; }

  // 4. Abandoned-payment recovery: remind customers whose order is still unpaid
  //    an hour after checkout (one reminder per order, includes the pay links).
  try {
    summary.remindersSent = await sendPaymentReminders({ afterMinutes: 60 });
  } catch (e) { summary.reminderError = e.message; }

  // 5. Post-delivery review request: one "how was your order?" email per
  //    completed order, a day after delivery (one per order, never repeated).
  try {
    summary.reviewRequestsSent = await sendReviewRequests({ afterHours: 24 });
  } catch (e) { summary.reviewError = e.message; }

  return summary;
}

/** Lightweight health probe — confirms the database answers a trivial query. */
export async function healthCheck() {
  const started = Date.now();
  try {
    await get('SELECT 1 AS ok');
    return { ok: true, db: 'up', latencyMs: Date.now() - started, ts: nowIso() };
  } catch (e) {
    return { ok: false, db: 'down', error: e.message, latencyMs: Date.now() - started, ts: nowIso() };
  }
}
