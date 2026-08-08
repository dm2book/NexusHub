/**
 * Customer broadcast (newsletter / announcement) — send one ad-hoc branded email
 * to many customers at once.
 *
 * Respects opt-out: recipients whose profile has emailMarketing === false are
 * skipped. Sends are throttled (well under Resend's rate limit) and capped per
 * run so a single call can't blow the daily quota or a serverless time budget.
 * Every message is logged to email_log (template_id = 'broadcast').
 */
import { all } from '../db/index.js';
import { sendRawEmail } from './emailService.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const parse = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

/** Deduped list of opted-in recipients: [{ email, name }]. */
export async function broadcastRecipients() {
  const rows = await all(
    `SELECT email, display_name, preferences FROM users
      WHERE email IS NOT NULL AND email <> '' ORDER BY created_at ASC`);
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const email = String(r.email).toLowerCase();
    if (seen.has(email)) continue;
    // Opt-out: only skip when the customer explicitly turned marketing off.
    if (parse(r.preferences).emailMarketing === false) continue;
    seen.add(email);
    out.push({ email, name: r.display_name || email.split('@')[0] });
  }
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
      GROUP BY subject ORDER BY sentAt DESC LIMIT @l`, { l: limit });
}
