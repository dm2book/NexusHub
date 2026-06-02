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
  if (config.email.smtpUrl) {
    transporter = nodemailer.createTransport(config.email.smtpUrl);
  } else {
    // JSON transport: produces a serialized message without sending.
    transporter = nodemailer.createTransport({ jsonTransport: true });
  }
  return transporter;
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
  const tpl = loadTemplate(eventKey);

  if (!tpl || !tpl.enabled) {
    run(`INSERT INTO email_log (id, template_id, to_email, status, error, context, created_at)
         VALUES (@id, @t, @to, 'failed', @err, @ctx, @at)`,
        { id, t: eventKey, to, err: tpl ? 'template disabled' : 'template missing',
          ctx: JSON.stringify(context), at });
    return id;
  }

  const ctx = baseContext(context);
  const { subject, html } = renderTemplate(tpl, ctx);
  const from = `"${config.email.fromName}" <${config.email.fromAddress}>`;

  try {
    const info = await getTransport().sendMail({ from, to, subject, html });
    const status = config.email.smtpUrl ? 'sent' : 'recorded';
    run(`INSERT INTO email_log (id, template_id, to_email, subject, status, provider_ref, context, created_at)
         VALUES (@id, @t, @to, @subj, @st, @ref, @ctx, @at)`,
        { id, t: eventKey, to, subj: subject, st: status,
          ref: info.messageId || null, ctx: JSON.stringify(context), at });
    return id;
  } catch (err) {
    run(`INSERT INTO email_log (id, template_id, to_email, subject, status, error, context, created_at)
         VALUES (@id, @t, @to, @subj, 'failed', @err, @ctx, @at)`,
        { id, t: eventKey, to, subj: subject, err: err.message,
          ctx: JSON.stringify(context), at });
    throw err;
  }
}

/** Fire-and-forget helper for non-critical notifications. */
export function sendEmailAsync(eventKey, to, context = {}) {
  sendEmail(eventKey, to, context).catch((err) =>
    console.error(`[email] ${eventKey} -> ${to} failed:`, err.message));
}
