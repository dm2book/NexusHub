/**
 * Customer broadcast (newsletter / announcement) — send one ad-hoc branded email
 * to many customers at once.
 *
 * Opt-in only (see broadcastRecipients): recipients whose profile has emailMarketing !== true are
 * skipped. Sends are throttled (well under Resend's rate limit) and capped per
 * run so a single call can't blow the daily quota or a serverless time budget.
 * Every message is logged to email_log (template_id = 'broadcast').
 */
import { all } from '../db/index.js';
import { sendRawEmail } from './emailService.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const parse = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

/**
 * Deduped list of recipients who ASKED for it: [{ email, name }].
 *
 * Opt-in, not opt-out. The list used to be every account unless marketing had
 * been switched off — and in the Netherlands (Telecommunicatiewet 11.7) a
 * newsletter needs consent first. Consent here is either the account's
 * "Product news & offers" switch, turned on, or a newsletter sign-up that was
 * not withdrawn. Anyone on the suppression list is left out either way.
 */
export async function broadcastRecipients() {
  const users = await all(
    `SELECT email, display_name, preferences FROM users
      WHERE email IS NOT NULL AND email <> '' ORDER BY created_at ASC`);
  const signups = await all(
    `SELECT email FROM newsletter_signups WHERE unsubscribed_at IS NULL ORDER BY created_at ASC`).catch(() => []);
  const suppressed = new Set((await all(`SELECT email FROM email_suppressions WHERE scope='marketing'`).catch(() => []))
    .map((r) => String(r.email).toLowerCase()));
  const seen = new Set();
  const out = [];
  const add = (email, name) => {
    const e = String(email).toLowerCase();
    if (seen.has(e) || suppressed.has(e)) return;
    seen.add(e);
    out.push({ email: e, name: name || e.split('@')[0] });
  };
  for (const r of users) if (parse(r.preferences).emailMarketing === true) add(r.email, r.display_name);
  for (const r of signups) add(r.email);
  return out;
}

export async function broadcastAudienceCount() {
  return (await broadcastRecipients()).length;
}

/**
 * Send `subject` + `innerHtml` (may use {{user.name}}) to every opted-in
 * customer, throttled. Caps at `limit` recipients per call. Returns a summary.
 */
export async function sendBroadcast({ subject, innerHtml, limit = 200, throttleMs = 160 } = {}) {
  if (!subject?.trim() || !innerHtml?.trim()) {
    throw new Error('A broadcast needs both a subject and a message.');
  }
  const audience = await broadcastRecipients();
  // Idempotency: if a send was interrupted (serverless timeout) and retried,
  // skip anyone who already got THIS subject in the last 24h — so a re-run
  // continues instead of double-mailing.
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const doneRows = await all(
    `SELECT DISTINCT to_email FROM email_log
      WHERE template_id='broadcast' AND subject=@s AND status IN ('sent','recorded') AND created_at > @since`,
    { s: subject, since });
  const done = new Set(doneRows.map((r) => String(r.to_email).toLowerCase()));
  const pending = audience.filter((r) => !done.has(r.email));
  const recipients = pending.slice(0, limit);
  let sent = 0; let failed = 0;
  for (const r of recipients) {
    try {
      await sendRawEmail({
        to: r.email, subject, innerHtml,
        context: { user: { name: r.name } }, logTag: 'broadcast',
      });
      sent++;
    } catch { failed++; }
    await sleep(throttleMs); // stay well under the provider rate limit
  }
  return { audience: audience.length, attempted: recipients.length, sent, failed,
    skipped: Math.max(0, audience.length - recipients.length) };
}

/** Recent broadcasts for the admin history (grouped from the email log). */
export function recentBroadcasts(limit = 20) {
  return all(
    `SELECT subject, COUNT(*) AS recipients,
            SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
            MAX(created_at) AS "sentAt"
       FROM email_log WHERE template_id='broadcast'
      GROUP BY subject ORDER BY "sentAt" DESC LIMIT @l`, { l: limit });
}
