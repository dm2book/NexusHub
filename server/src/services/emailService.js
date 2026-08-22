/**
 * Email delivery service.
 *
 * - Uses real SMTP (nodemailer) when SMTP_URL is configured.
 * - Otherwise falls back to a "record" transport that persists the fully
 *   rendered message to email_log so nothing is silently dropped in dev.
 * - Every send (success or failure) is recorded in email_log.
 * - Templates are loaded from the DB so admin edits take effect immediately.
 */
import { config } from '../config/env.js';
import { get, all, run, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { renderTemplate, renderTokens, wrapBranded, baseContext } from './templateService.js';

/**
 * nodemailer is loaded on the first SMTP send, not on import.
 *
 * The recommended production transport here is Resend's HTTP API — this file
 * says so a few lines down, and raw SMTP from a serverless function is often
 * slow or blocked outright. But the import sat at the top of a module the order
 * path pulls in, so every cold start spent ~75ms loading an SMTP client that a
 * Resend deployment never calls.
 */
let transporter = null;
async function getTransport() {
  if (transporter) return transporter;
  const { default: nodemailer } = await import('nodemailer');
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
async function sendViaResend({ from, to, subject, html, text, replyTo }) {
  // Hard timeout: without it a slow/unreachable Resend call hangs the whole
  // request until Vercel kills the function at maxDuration, and the client gets
  // a non-JSON platform error page instead of a normal response.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.email.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from, to, subject, html,
        ...(text ? { text } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Resend timed out after 10s' : `Resend request failed: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.name || `Resend API error ${res.status}`);
  return { messageId: data?.id || null };
}

/**
 * A readable plain-text version of the message.
 *
 * Not a stripped-tags dump: the parts that carry the value — a login code, a
 * delivered game code, the order total — are exactly the parts that turn into
 * unlabelled digits when the markup is thrown away. Block boundaries become
 * line breaks, links keep their destination, and the invisible preheader is
 * dropped rather than repeated as the first line.
 */
export function htmlToText(html) {
  return String(html)
    // The hidden inbox-preview line, and anything that is not content.
    .replace(/<span class="preheader">[\s\S]*?<\/span>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    // A link is worth nothing in text unless the address comes with it.
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_, href, label) => {
        const t = label.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        return !t ? href : t === href ? t : `${t} (${href})`;
      })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h1|h2|h3|li|table)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '· ')
    .replace(/<td\b[^>]*>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    // Tidy: no runs of blank lines, no trailing spaces, no leading tabs on a line.
    .split('\n').map((l) => l.replace(/\t+/g, '  ').replace(/[ \t]+$/, '').trim())
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
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
  const replyTo = config.email.replyTo || undefined;
  /* A plain-text alternative on every message.
     Checked on the wire: these went out as `Content-Type: text/html` with no
     multipart/alternative. That is a spam-filter penalty on transactional mail
     that must arrive, and it is the only thing a watch preview, a screen reader
     in text mode, or a client with images-and-HTML off has to show. The codes
     in particular are the whole point of the mail and were unreadable without
     an HTML renderer. */
  const text = htmlToText(html);

  try {
    let info;
    let status;
    if (config.email.resendApiKey) {
      info = await sendViaResend({ from, to, subject, html, text, replyTo }); // HTTP API (serverless-safe)
      status = 'sent';
    } else {
      info = await (await getTransport()).sendMail({ from, to, subject, html, text, replyTo });
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

/**
 * Retry recently-failed transactional emails (maintenance sweep). The full
 * render context is persisted with every log row, so a transient provider
 * failure (Resend timeout, network blip) no longer means a customer never
 * gets their codes. Bounded: at most `maxAttempts` rows per template+recipient
 * in the window, so a permanently-broken address ages out instead of looping.
 */
export async function retryFailedEmails({ limit = 20, maxAgeHours = 24, maxAttempts = 4 } = {}) {
  const cut = new Date(Date.now() - maxAgeHours * 3_600_000).toISOString();
  const rows = await all(
    `SELECT id, template_id, to_email, context FROM email_log
      WHERE status = 'failed' AND created_at > @cut AND context IS NOT NULL
        AND error NOT IN ('template disabled', 'template missing')
      ORDER BY created_at ASC LIMIT @l`, { cut, l: limit });
  let resent = 0;
  for (const r of rows) {
    const prior = await get(
      `SELECT COUNT(*) AS n FROM email_log WHERE template_id=@t AND to_email=@to AND created_at > @cut`,
      { t: r.template_id, to: r.to_email, cut });
    if (Number(prior?.n || 0) >= maxAttempts) continue; // give up on this recipient
    // Claim atomically so a concurrent cron run can't double-send.
    const claim = await run(`UPDATE email_log SET status='retried' WHERE id=@id AND status='failed'`, { id: r.id });
    if (!claim?.changes) continue;
    try {
      await sendEmail(r.template_id, r.to_email, JSON.parse(r.context || '{}'));
      resent++;
    } catch { /* outcome already recorded as a fresh log row by sendEmail */ }
  }
  return resent;
}

/**
 * Send ad-hoc content (not a stored template) — used by the customer broadcast.
 * `subject` and `innerHtml` may use {{tokens}} resolved from `context` (e.g.
 * {{user.name}}); the content is wrapped in the branded shell. Every send is
 * logged to email_log under the given `logTag`. Throws on failure so the caller
 * can count it.
 */
export async function sendRawEmail({ to, subject, innerHtml, context = {}, logTag = 'broadcast' }) {
  const id = newId('eml');
  const at = nowIso();
  const ctx = baseContext(context);
  const subj = renderTokens(subject, ctx);
  const html = wrapBranded(renderTokens(innerHtml, ctx), { preheader: subj });
  const from = `${config.email.fromName} <${config.email.fromAddress}>`;
  try {
    let info; let status;
    if (config.email.resendApiKey) {
      info = await sendViaResend({ from, to, subject: subj, html });
      status = 'sent';
    } else {
      info = await (await getTransport()).sendMail({ from, to, subject: subj, html });
      status = config.email.smtpUrl ? 'sent' : 'recorded';
    }
    await run(`INSERT INTO email_log (id, template_id, to_email, subject, status, provider_ref, created_at)
         VALUES (@id, @t, @to, @subj, @st, @ref, @at)`,
        { id, t: logTag, to, subj, st: status, ref: info.messageId || null, at });
    return { id, status };
  } catch (err) {
    await run(`INSERT INTO email_log (id, template_id, to_email, subject, status, error, created_at)
         VALUES (@id, @t, @to, @subj, 'failed', @err, @at)`,
        { id, t: logTag, to, subj, err: err.message, at });
    throw err;
  }
}
