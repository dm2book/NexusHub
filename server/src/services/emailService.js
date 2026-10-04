/**
 * Email delivery service.
 *
 * - Uses real SMTP (nodemailer) when SMTP_URL is configured.
 * - Otherwise falls back to a "record" transport that persists the fully
 *   rendered message to email_log so nothing is silently dropped in dev.
 * - Every send (success or failure) is recorded in email_log.
 * - Templates are loaded from the DB so admin edits take effect immediately.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config/env.js';
import { get, all, run, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { renderTemplate, renderTokens, wrapBranded, wrapAdmin, baseContext, EMAIL_THEMES } from './templateService.js';
import { alertOwner } from './notifyService.js';

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
async function sendViaResend({ from, to, subject, html, text, replyTo, headers }) {
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
        ...(headers && Object.keys(headers).length ? { headers } : {}),
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
    .replace(/<span class="preheader"[^>]*>[\s\S]*?<\/span>/gi, '')
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

/** The languages that have their own templates; anything else falls back. */
const TEMPLATE_LANGS = new Set(['nl', 'en', 'de', 'fr']);
const FALLBACK_LANG = 'nl';

/**
 * The template for this event in the reader's language.
 *
 * Falls back to Dutch — the shop's own language and the one every template is
 * guaranteed to have — rather than returning nothing. A missing translation
 * must never mean a missing email: a buyer who does not get their code because
 * their language was unseeded is a refund, and an untranslated confirmation is
 * merely a worse one.
 *
 * A disabled row is a decision about that language, so a disabled German
 * template does NOT quietly fall through to Dutch. It is skipped like any other
 * disabled template.
 */
async function loadTemplate(eventKey, lang) {
  const want = TEMPLATE_LANGS.has(lang) ? lang : FALLBACK_LANG;
  const own = await get('SELECT * FROM email_templates WHERE id = @id AND lang = @lang',
    { id: eventKey, lang: want });
  if (own) return own;
  if (want === FALLBACK_LANG) return null;
  return get('SELECT * FROM email_templates WHERE id = @id AND lang = @lang',
    { id: eventKey, lang: FALLBACK_LANG });
}

/**
 * Which language this email should be written in.
 *
 * The context carries it: an order email gets it from the order's own
 * `billing.lang` (recorded at checkout, in the language the buyer read the shop
 * in), and everything else from the user row. Neither is guaranteed, so the
 * shop's own language is the floor.
 */
export function langFor(context = {}) {
  const candidate = context.lang || context.order?.lang || context.user?.lang;
  return TEMPLATE_LANGS.has(candidate) ? candidate : FALLBACK_LANG;
}

// ── Marketing: consent, unsubscribe, suppression ─────────────────────────

/**
 * The mails that are not strictly needed to deliver what somebody bought, and
 * the list each one belongs to.
 *
 * Every one of these carries a visible unsubscribe link and the RFC 8058
 * one-click headers (Gmail and Yahoo require both for bulk senders since 2024,
 * and without them a launch-night send is the thing that lands the domain in
 * spam). The scope is what one click turns off: stopping price alerts should
 * not also stop the launch mail somebody asked for, and nothing here ever
 * stops an order confirmation.
 */
export const MARKETING_SCOPES = {
  launch_announcement: 'marketing',
  cart_reminder: 'marketing',
  broadcast: 'marketing',
  price_drop: 'alerts',
  review_request: 'reviews',
};
export const UNSUBSCRIBE_SCOPES = ['marketing', 'alerts', 'reviews'];

const normEmail = (e) => String(e || '').trim().toLowerCase();

/**
 * The proof in an unsubscribe link: an HMAC of address and list, keyed with the
 * server's existing JWT secret. Without it the endpoint would be a way to
 * unsubscribe strangers — and, by answering differently for a known address,
 * a way to ask who is on the list.
 */
export function unsubscribeToken(email, scope) {
  return createHmac('sha256', config.auth.jwtSecret)
    .update(`unsubscribe:${scope}:${normEmail(email)}`)
    .digest('hex').slice(0, 32);
}

export function unsubscribeTokenOk(email, scope, token) {
  if (!UNSUBSCRIBE_SCOPES.includes(scope)) return false;
  const want = Buffer.from(unsubscribeToken(email, scope));
  const got = Buffer.from(String(token || ''));
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The link — the same URL serves the confirm page (GET) and the one-click POST. */
export function unsubscribeUrl(email, scope) {
  const app = String(config.appUrl || '').replace(/\/+$/, '');
  return `${app}/api/unsubscribe?e=${encodeURIComponent(normEmail(email))}`
    + `&s=${encodeURIComponent(scope)}&t=${unsubscribeToken(email, scope)}`;
}

/** Has this address opted out of this list? */
export async function isSuppressed(email, scope) {
  const row = await get('SELECT 1 AS x FROM email_suppressions WHERE email = @e AND scope = @s',
    { e: normEmail(email), s: scope }).catch(() => null);
  return !!row;
}

/**
 * Take an address off a list, everywhere that list is recorded.
 *
 * The suppression row is what the send path checks, so it holds for guests and
 * for addresses that later create an account. The other writes keep the
 * places a person can SEE their choice — the newsletter row, the account's
 * marketing preference, the wishlist's alert toggles — telling the same story.
 */
export async function applyUnsubscribe(email, scope) {
  const e = normEmail(email);
  if (!e || !UNSUBSCRIBE_SCOPES.includes(scope)) return false;
  const at = nowIso();
  await run(`INSERT INTO email_suppressions (email, scope, created_at) VALUES (@e, @s, @at)
             ON CONFLICT (email, scope) DO NOTHING`, { e, s: scope, at });
  if (scope === 'marketing') {
    await run(`UPDATE newsletter_signups SET unsubscribed_at = @at WHERE email = @e AND unsubscribed_at IS NULL`,
      { e, at }).catch(() => {});
    const users = await all('SELECT id, preferences FROM users WHERE email = @e', { e }).catch(() => []);
    for (const u of users) {
      let prefs = {};
      try { prefs = JSON.parse(u.preferences || '{}') || {}; } catch { prefs = {}; }
      if (prefs.emailMarketing === false) continue;
      prefs.emailMarketing = false;
      await run('UPDATE users SET preferences = @p WHERE id = @id',
        { p: JSON.stringify(prefs), id: u.id }).catch(() => {});
    }
  }
  if (scope === 'alerts') {
    await run(`UPDATE wishlist_items SET alert_enabled = 0
                WHERE user_id IN (SELECT id FROM users WHERE email = @e)`, { e }).catch(() => {});
  }
  return true;
}

/** RFC 8058: a POSTable https URL plus the header that says one click is enough. */
function listUnsubscribeHeaders(url) {
  return url ? {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  } : {};
}

// ── What is safe to keep ─────────────────────────────────────────────────

/** Never retried: a login code is dead within minutes, and a gift-card mail
    can only be rebuilt from the code, which is exactly what is not stored. */
const NO_RETRY = new Set(['login_otp', 'gift_card']);
/* Keys that carry something that unlocks value: a login code, a delivered game
   code, a gift-card code, or a block of HTML built from them. */
const SECRET_KEY = /^(otp|code|codes|codeHtml|deliveryHtml|deliveriesHtml|redeemHtml|password|token|secret)$/i;

function redact(value, depth = 0) {
  if (depth > 6 || value == null || typeof value !== 'object') return { value, dropped: false };
  let dropped = false;
  const out = Array.isArray(value) ? [] : {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY.test(k)) { dropped = true; continue; }
    const r = redact(v, depth + 1);
    dropped = dropped || r.dropped;
    if (Array.isArray(out)) out.push(r.value); else out[k] = r.value;
  }
  return { value: out, dropped };
}

/**
 * The context as it may be written to email_log.
 *
 * The full render context used to be stored with every row so a failed send
 * could be retried — which meant every login code and every delivered game
 * code sat in plain text in a table the admin log endpoint returned whole.
 * Now an order mail stores only the order id (the retry rebuilds everything
 * from the order), anything else is stored with its secrets cut out, and a mail
 * that cannot be rebuilt without a secret is marked as not retryable.
 */
export function persistableContext(eventKey, context = {}) {
  if (context.orderId) {
    return {
      lang: context.lang || null,
      _order: { id: context.orderId, ...(context.orderOpts || {}) },
    };
  }
  const { value, dropped } = redact(context);
  const out = { ...value };
  delete out.orderOpts;
  if (dropped || NO_RETRY.has(eventKey)) out._noRetry = true;
  return out;
}

/**
 * Send a transactional email for `eventKey` to `to`, merging `context` with the
 * base brand context. Returns the email_log row id.
 */
export async function sendEmail(eventKey, to, context = {}) {
  const id = newId('eml');
  const at = nowIso();
  const lang = langFor(context);
  const stored = JSON.stringify(persistableContext(eventKey, context));
  const scope = MARKETING_SCOPES[eventKey];

  /* A marketing mail to somebody who said stop is not sent, and the decision
     is logged rather than silent, so "why did they not get it?" has an answer. */
  if (scope && await isSuppressed(to, scope)) {
    await run(`INSERT INTO email_log (id, template_id, to_email, status, error, created_at)
         VALUES (@id, @t, @to, 'suppressed', @err, @at)`,
        { id, t: eventKey, to, err: `unsubscribed from ${scope}`, at });
    return id;
  }

  const tpl = await loadTemplate(eventKey, lang);

  if (!tpl || !tpl.enabled) {
    await run(`INSERT INTO email_log (id, template_id, to_email, status, error, context, created_at)
         VALUES (@id, @t, @to, 'failed', @err, @ctx, @at)`,
        { id, t: eventKey, to, err: tpl ? 'template disabled' : 'template missing',
          ctx: stored, at });
    return id;
  }

  const unsub = scope ? unsubscribeUrl(to, scope) : null;
  const ctx = baseContext({
    ...context,
    ...(unsub ? { unsubscribe: { url: unsub, ...(context.unsubscribe || {}) } } : {}),
  });
  const { subject, html } = renderTemplate(tpl, ctx);
  const from = `${config.email.fromName} <${config.email.fromAddress}>`;
  const replyTo = config.email.replyTo || undefined;
  const headers = listUnsubscribeHeaders(ctx.unsubscribe?.url || null);
  /* A plain-text alternative on every message.
     Checked on the wire: these went out as `Content-Type: text/html` with no
     multipart/alternative. That is a spam-filter penalty on transactional mail
     that must arrive, and it is the only thing a watch preview, a screen reader
     in text mode, or a client with images-and-HTML off has to show. */
  const text = htmlToText(html);

  try {
    let info;
    let status;
    if (config.email.resendApiKey) {
      info = await sendViaResend({ from, to, subject, html, text, replyTo, headers }); // HTTP API (serverless-safe)
      status = 'sent';
    } else {
      info = await (await getTransport()).sendMail({ from, to, subject, html, text, replyTo, headers });
      status = config.email.smtpUrl ? 'sent' : 'recorded';
    }
    /* The subject of a login mail is stored as its template id only. It no
       longer contains the code, but a subject an owner edits back to include
       it should not be the thing that puts codes into a log again. */
    await run(`INSERT INTO email_log (id, template_id, to_email, subject, status, provider_ref, context, created_at)
         VALUES (@id, @t, @to, @subj, @st, @ref, @ctx, @at)`,
        { id, t: eventKey, to, subj: NO_RETRY.has(eventKey) ? `[${eventKey}]` : subject, st: status,
          ref: info.messageId || null, ctx: stored, at });
    return id;
  } catch (err) {
    // Make the real reason visible in the function logs (e.g. Resend "you can
    // only send to your own address until you verify a domain").
    console.error(`[email] ${eventKey} -> ${to} FAILED: ${err.message}`);
    await run(`INSERT INTO email_log (id, template_id, to_email, subject, status, error, context, created_at)
         VALUES (@id, @t, @to, @subj, 'failed', @err, @ctx, @at)`,
        { id, t: eventKey, to, subj: NO_RETRY.has(eventKey) ? `[${eventKey}]` : subject, err: err.message,
          ctx: stored, at });

    /* A delivery mail that does not send is a paid-for code sitting in a
       database table nobody reads. Keyed on the TEMPLATE, not the recipient:
       one bounced address is the address; every order_completed failing is the
       mailer, and that is the alert worth having. */
    alertOwner('email.failed', {
      title: `Email "${eventKey}" could not be sent`,
      lines: [
        `Recipient: ${String(to).replace(/(.).*(@.*)/, '$1•••$2')}`,
        `Error: ${String(err.message || 'unknown').slice(0, 200)}`,
        NO_RETRY.has(eventKey)
          ? 'The failure is in email_log. This mail is not retried automatically.'
          : 'The message is in email_log and the hourly sweep will retry it.',
      ],
      url: `${config.appUrl}/admin/emails`,
      key: `${eventKey}:${at.slice(0, 13)}`,
    }).catch(() => {});

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
 * Retry recently-failed transactional emails (maintenance sweep).
 *
 * An order mail is rebuilt from the order itself — the stored row holds only
 * its id — so the retried mail shows the order as it is NOW, codes included,
 * without the codes ever having been written to the log. Login codes are never
 * retried, and neither is anything stored with a secret cut out of it. Bounded:
 * at most `maxAttempts` rows per template+recipient in the window, so a
 * permanently-broken address ages out instead of looping.
 */
export async function retryFailedEmails({ limit = 20, maxAgeHours = 24, maxAttempts = 4 } = {}) {
  const cut = new Date(Date.now() - maxAgeHours * 3_600_000).toISOString();
  const rows = await all(
    `SELECT id, template_id, to_email, context FROM email_log
      WHERE status = 'failed' AND created_at > @cut AND context IS NOT NULL
        AND error NOT IN ('template disabled', 'template missing')
        AND template_id NOT IN ('login_otp', 'gift_card')
      ORDER BY created_at ASC LIMIT @l`, { cut, l: limit });
  let resent = 0;
  for (const r of rows) {
    let ctx;
    try { ctx = JSON.parse(r.context || '{}') || {}; } catch { ctx = {}; }
    if (ctx._noRetry) continue;
    const prior = await get(
      `SELECT COUNT(*) AS n FROM email_log WHERE template_id=@t AND to_email=@to AND created_at > @cut`,
      { t: r.template_id, to: r.to_email, cut });
    if (Number(prior?.n || 0) >= maxAttempts) continue; // give up on this recipient
    // Claim atomically so a concurrent cron run can't double-send.
    const claim = await run(`UPDATE email_log SET status='retried' WHERE id=@id AND status='failed'`, { id: r.id });
    if (!claim?.changes) continue;
    try {
      if (ctx._order?.id) {
        const { orderEmailContextById } = await import('./orderService.js');
        const { id: orderId, ...opts } = ctx._order;
        const rebuilt = await orderEmailContextById(orderId, opts);
        if (!rebuilt) continue;
        await sendEmail(r.template_id, r.to_email, rebuilt);
      } else {
        await sendEmail(r.template_id, r.to_email, ctx);
      }
      resent++;
    } catch { /* outcome already recorded as a fresh log row by sendEmail */ }
  }
  return resent;
}

/**
 * Forget the mail log after `days` (default 30).
 *
 * Every row names a recipient and what they were sent; the log exists to
 * answer "did that mail go out?" in the weeks after, not to be a permanent
 * record of who bought what. The retry sweep only looks back a day.
 */
export async function purgeEmailLog({ days = 30 } = {}) {
  const cut = new Date(Date.now() - days * 86_400_000).toISOString();
  const r = await run('DELETE FROM email_log WHERE created_at < @cut', { cut });
  return r?.changes ?? 0;
}

/**
 * Send ad-hoc content (not a stored template) — used by the customer broadcast
 * and by owner alerts. `subject` and `innerHtml` may use {{tokens}} resolved
 * from `context` (e.g. {{user.name}}). Customer mail is wrapped in the branded
 * shell in the reader's language; owner alerts (`logTag` "alert:…") in a plain
 * admin frame. `unsubscribeScope` makes it a marketing mail: suppressed
 * addresses are skipped, and the visible link and one-click headers are added.
 * Throws on failure so the caller can count it.
 */
export async function sendRawEmail({
  to, subject, innerHtml, context = {}, logTag = 'broadcast', lang, unsubscribeScope = null,
}) {
  const id = newId('eml');
  const at = nowIso();
  const admin = String(logTag).startsWith('alert:');
  const scope = unsubscribeScope || (MARKETING_SCOPES[logTag] && !admin ? MARKETING_SCOPES[logTag] : null);
  if (scope && await isSuppressed(to, scope)) {
    await run(`INSERT INTO email_log (id, template_id, to_email, subject, status, error, created_at)
         VALUES (@id, @t, @to, @subj, 'suppressed', @err, @at)`,
        { id, t: logTag, to, subj: subject, err: `unsubscribed from ${scope}`, at });
    return { id, status: 'suppressed' };
  }
  const unsub = scope ? unsubscribeUrl(to, scope) : null;
  const ctx = baseContext({ ...context, ...(unsub ? { unsubscribe: { url: unsub } } : {}) });
  const subj = renderTokens(subject, ctx);
  const inner = renderTokens(innerHtml, ctx);
  const html = admin
    ? wrapAdmin(inner, { preheader: subj })
    : wrapBranded(inner, {
      preheader: subj, lang: langFor({ lang }), templateId: logTag,
      theme: EMAIL_THEMES[logTag] || undefined, unsubscribeUrl: unsub,
    });
  const from = `${config.email.fromName} <${config.email.fromAddress}>`;
  /* A Reply-To that reaches a person, and a plain-text alternative: without
     the text part the message goes out as `Content-Type: text/html` with no
     multipart, which is a spam-filter penalty. */
  const replyTo = config.email.replyTo || undefined;
  const text = htmlToText(html);
  const headers = listUnsubscribeHeaders(unsub);
  try {
    let info; let status;
    if (config.email.resendApiKey) {
      info = await sendViaResend({ from, to, subject: subj, html, text, replyTo, headers });
      status = 'sent';
    } else {
      info = await (await getTransport()).sendMail({ from, to, subject: subj, html, text, replyTo, headers });
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
