/**
 * Email delivery service.
 *
 * - Uses real SMTP (nodemailer) when SMTP_URL is configured.
 * - Otherwise falls back to a "record" transport that persists the fully
 *   rendered message to email_log so nothing is silently dropped in dev.
 * - Every send (success or failure) is recorded in email_log.
 * - Templates are loaded from the DB so admin edits take effect immediately.
 */
import nodemailer from 'nodemailer';
import { config } from '../config/env.js';
import { get, run, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { renderTemplate, baseContext } from './templateService.js';

let transporter = null;
function getTransport() {
  if (transporter) return transporter;
  transporter = config.email.smtpUrl
    ? nodemailer.createTransport(config.email.smtpUrl)
    : nodemailer.createTransport({ jsonTransport: true });
  return transporter;
}

/**
 * Send via Resend's HTTP API — reliable on serverless where raw SMTP often
 * stalls. Throws with Resend's own message on failure (e.g. unverified sender),
 * which we record + log so the cause is never a mystery.
 */
async function sendViaResend({ from, to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.email.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.name || `Resend API error ${res.status}`);
  return { messageId: data?.id || null };
}

function loadTemplate(eventKey) {
  return get('SELECT * FROM email_templates WHERE id = @id', { id: eventKey });
}

/**
 * Send a transactional email for `eventKey` to `to`, merging `context` with the
 * base brand context. Returns the email_log row id.
 */
export async function sendEmail(eventKey, to, context = {}) {
  const id = newId('eml');
  const at = nowIso();
  const tpl = await loadTemplate(eventKey);

  if (!tpl || !tpl.enabled) {
    await run(`INSERT INTO email_log (id, template_id, to_email, status, error, context, created_at)
         VALUES (@id, @t, @to, 'failed', @err, @ctx, @at)`,
        { id, t: eventKey, to, err: tpl ? 'template disabled' : 'template missing',
          ctx: JSON.stringify(context), at });
    return id;
  }

  const ctx = baseContext(context);
  const { subject, html } = renderTemplate(tpl, ctx);
  const from = `${config.email.fromName} <${config.email.fromAddress}>`;

  try {
    let info;
    let status;
    if (config.email.resendApiKey) {
      info = await sendViaResend({ from, to, subject, html }); // HTTP API (serverless-safe)
      status = 'sent';
    } else {
      info = await getTransport().sendMail({ from, to, subject, html });
      status = config.email.smtpUrl ? 'sent' : 'recorded';
    }
    await run(`INSERT INTO email_log (id, template_id, to_email, subject, status, provider_ref, context, created_at)
         VALUES (@id, @t, @to, @subj, @st, @ref, @ctx, @at)`,
        { id, t: eventKey, to, subj: subject, st: status,
          ref: info.messageId || null, ctx: JSON.stringify(context), at });
    return id;
  } catch (err) {
    // Make the real reason visible in the function logs (e.g. Resend "you can
    // only send to your own address until you verify a domain").
    console.error(`[email] ${eventKey} -> ${to} FAILED: ${err.message}`);
    await run(`INSERT INTO email_log (id, template_id, to_email, subject, status, error, context, created_at)
         VALUES (@id, @t, @to, @subj, 'failed', @err, @ctx, @at)`,
        { id, t: eventKey, to, subj: subject, err: err.message,
          ctx: JSON.stringify(context), at });
    throw err;
  }
}

/**
 * Best-effort send used in request flows: awaits the send but never throws, so a
 * mail failure cannot break the order operation. Awaitable to guarantee the
 * write completes before a serverless function suspends.
 */
export async function sendEmailAsync(eventKey, to, context = {}) {
  try {
    await sendEmail(eventKey, to, context);
  } catch (err) {
    console.error(`[email] ${eventKey} -> ${to} failed:`, err.message);
  }
}
