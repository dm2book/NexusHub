/**
 * Background maintenance — run on a schedule (Vercel Cron → /api/cron/maintenance).
 * Keeps the database tidy and self-heals stuck state. Every step is idempotent and
 * safe to run repeatedly.
 */
import { run, get, all, nowIso } from '../db/index.js';
import { transitionOrder, sendPaymentReminders, sendReviewRequests } from './orderService.js';
import { sendCartReminders } from './cartService.js';
import { retryPendingFulfillments, drainSupplierQueue, sweepUnfulfilledPaidOrders } from './fulfillmentService.js';
import { retryFailedEmails } from './emailService.js';
import { sweepMemberRoles } from './discordRolesService.js';
import { purgeExpiredLinkIntents } from './discordLinkService.js';
import { pruneOutbox } from './discordService.js';

const HOURS = (n) => new Date(Date.now() - n * 3_600_000).toISOString();
const DAYS = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

export async function runMaintenance() {
  const summary = { otpPurged: 0, ipsForgotten: 0, sessionsExpired: 0, ordersCancelled: 0, remindersSent: 0, reviewRequestsSent: 0, cartRemindersSent: 0, fulfillmentsRetried: 0, at: nowIso() };

  // 1. Purge OTP codes that are long expired / already consumed (keep table small).
  try {
    const r = await run(`DELETE FROM otp_codes WHERE expires_at < @cut OR (consumed_at IS NOT NULL AND created_at < @cut)`,
      { cut: HOURS(2) });
    summary.otpPurged = r?.changes ?? 0;
  } catch (e) { summary.otpError = e.message; }

  // 1b. Forget IP addresses once they have done their job.
  //
  // The IP is genuinely load-bearing while it is fresh: it caps OTP requests
  // per network (authService), it is half the brute-force gate on login
  // (recentFailures matches on identifier OR ip) and it is how an unfamiliar
  // sign-in is spotted. Not collecting it would leave real holes.
  //
  // But those windows are minutes to weeks, and the rows lived forever. That is
  // the part the GDPR actually objects to — keeping personal data past the
  // purpose it was collected for. So the ROW stays (audit trails, order
  // history, fraud evidence all keep their shape) and only the IP is nulled,
  // well outside every window that reads it.
  try {
    // Which of these actually carry an ip is a schema question, not something
    // to hardcode — the first version of this listed refund_requests, which has
    // no ip column, and the whole step aborted on the error.
    const WINDOWS = {
      login_attempts: 90,     // read within 15 min (failures) and ~90 days (familiar device)
      sms_verifications: 7,   // read within the OTP lifetime only
      otp_codes: 2,           // rows are deleted above anyway; this catches stragglers
      sessions: 90,           // current state while active; pointless once long expired
      trusted_devices: 180,   // "is this the device you always use" needs history
      payment_proofs: 365,    // fraud evidence attached to money
      coupon_redemptions: 365,
      // Read by fraud scoring: "has this address ordered under other emails
      // today" and "has a chargeback come from here". Both windows are days to
      // months, so a year is already generous — but a chargeback can arrive
      // ~120 days after the payment, so the ledger keeps its address longer
      // than the order does or the signal would expire before the fraud did.
      orders: 365,
      chargebacks: 540,
      audit_logs: 365,        // security evidence — longest, but not forever
    };
    const present = await all(
      `SELECT table_name FROM information_schema.columns
        WHERE column_name = 'ip' AND table_schema = 'public'`);
    const have = new Set(present.map((r) => r.table_name));
    let cleared = 0;
    for (const [table, days] of Object.entries(WINDOWS)) {
      if (!have.has(table)) continue;
      const r = await run(
        `UPDATE ${table} SET ip = NULL WHERE ip IS NOT NULL AND created_at < @cut`, { cut: DAYS(days) });
      cleared += r?.changes ?? 0;
    }
    summary.ipsForgotten = cleared;
  } catch (e) { summary.ipForgetError = e.message; }

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

  // 6. Abandoned-cart recovery: one reminder per idle cart (has items, no order
  //    placed since, not already reminded for this cart version).
  try {
    summary.cartRemindersSent = await sendCartReminders({ afterHours: 4 });
  } catch (e) { summary.cartError = e.message; }

  // 7. Re-poll async supplier fulfilments that returned a reference and are
  //    still in progress, so they complete without a manual nudge.
  try {
    summary.fulfillmentsRetried = await retryPendingFulfillments({ limit: 25 });
  } catch (e) { summary.fulfillmentError = e.message; }

  // 8. Drain the serial supplier queue (safety net if a payment-time drain was
  //    interrupted): buys + delivers pending paid orders one at a time.
  try {
    summary.supplierQueue = (await drainSupplierQueue({ actorId: 'system' })).processed || 0;
  } catch (e) { summary.supplierQueueError = e.message; }

  // 9. The net under the pipeline: any paid order nothing has picked up.
  //    Delivery is started without being awaited, so on a serverless host it can
  //    simply never run — the order sits paid, in stock and undelivered. The
  //    automatic path is retried first; only what genuinely cannot be dispensed
  //    (no stock, no auto-supplier — e.g. a P2P top-up) goes to the hand queue,
  //    so it surfaces there instead of sitting invisible.
  try {
    const sweep = await sweepUnfulfilledPaidOrders({ limit: 50 });
    summary.manualQueued = sweep.queued;
    summary.autoDispensed = sweep.dispensed;
  } catch (e) { summary.manualQueueError = e.message; }

  // 10. Re-send transactional emails that failed on a transient provider error
  //     (their full render context is persisted with the log row).
  try {
    summary.emailsRetried = await retryFailedEmails({ limit: 20 });
  } catch (e) { summary.emailRetryError = e.message; }

  // 11. Reconcile Discord roles for the members checked longest ago.
  //
  //     Roles used to be granted only at the instant an order was paid, so
  //     anyone who linked their account and joined the server afterwards never
  //     received the role they had already earned — nothing ever came back for
  //     them. This also catches the other direction: a refund that happened
  //     while Discord was unreachable leaves a badge that should be gone.
  try {
    const swept = await sweepMemberRoles({ limit: 25 });
    summary.discordRolesChecked = swept.checked ?? 0;
    summary.discordRolesChanged = swept.changed ?? 0;
  } catch (e) { summary.discordRoleError = e.message; }

  // 12. Expired, unused link intents are junk — they are single-use and live
  //     ten minutes.
  try {
    summary.linkIntentsPurged = await purgeExpiredLinkIntents();
  } catch (e) { summary.linkIntentError = e.message; }

  // 13. Discard Discord events nobody is ever going to deliver.
  //
  //     The outbox only pruned itself from inside claimOutbox, and only rows the
  //     bot had already delivered — so cleaning up required a working bot, which
  //     is exactly the thing that is missing when the queue grows. A sale ping
  //     carries the buyer's email, so an unattended outbox is an unbounded store
  //     of customer data sitting next to the IP retention rules above.
  try {
    summary.discordOutboxPruned = await pruneOutbox();
  } catch (e) { summary.discordOutboxError = e.message; }

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
