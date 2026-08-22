/**
 * Branded email layout + token rendering.
 *
 * Templates store only the inner content; we wrap it in a consistent,
 * email-client-safe HTML shell using the configured brand colours/logo so the
 * sender always looks on-brand. Admin edits to subject/body are honoured.
 *
 * Layout notes: table-based structure + widely-supported CSS only (no flex/grid),
 * so it renders correctly in Gmail, Outlook, Apple Mail and mobile clients.
 */
import { config } from '../config/env.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Replace {{a.b}} tokens from a flat/nested context. Unknown tokens → ''.
 *  Values are HTML-escaped UNLESS the token name ends in `Html` (itemsHtml,
 *  deliveriesHtml, …) — those are built server-side with their own escaping.
 *  Without this, customer-controlled fields (e.g. billing.full_name → user.name)
 *  would inject raw HTML into branded emails sent from our verified domain,
 *  turning checkout into a phishing relay to any address. */
export function renderTokens(str, ctx, { where = 'template' } = {}) {
  return String(str).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, pathExpr) => {
    const val = pathExpr.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);
    if (val == null) {
      /* An empty string is still the right OUTPUT — half a subject line beats a
         raw {{token}} in someone's inbox — but it must not be silent. A caller
         that forgets a field ships mail like " is your ForgeMarket login code",
         and nothing anywhere notices; this is the only place that can see it. */
      console.warn(`[email] ${where}: {{${pathExpr}}} had no value — rendered as empty`);
      return '';
    }
    return /Html$/.test(pathExpr.split('.').pop()) ? String(val) : esc(String(val));
  });
}

/**
 * Per-email identity.
 *
 * Every mail used to carry the same purple header and the same three pills
 * ("Instant delivery · Buyer protected · 24/7 support"), so a login code, a
 * refund and a delivery were indistinguishable in an inbox — and two of those
 * pills were claims the storefront no longer makes.
 *
 * Each template now gets an accent, an eyebrow line that says what the mail IS,
 * and a footer strip that only makes promises that hold for THAT mail. `pills`
 * of [] renders no strip at all — a security code is not a place for marketing.
 */
export const EMAIL_THEMES = {
  account_created:   { accent: '#7c5cff', accent2: '#a855f7', eyebrow: 'Account created',   pills: ['🔐 No password to remember', '💬 Support on Discord'] },
  order_received:    { accent: '#f5b324', accent2: '#fb923c', eyebrow: 'Order received',    pills: ['🧾 Reference = your order number', '🛡 Money back if undelivered'] },
  payment_reminder:  { accent: '#f5b324', accent2: '#f97316', eyebrow: 'Waiting for payment', pills: ['⏳ Still reserved for you', '🛡 Money back if undelivered'] },
  payment_confirmed: { accent: '#34d399', accent2: '#10b981', eyebrow: 'Payment confirmed', pills: ['✅ Payment received', '📦 Preparing your order'] },
  order_processing:  { accent: '#38bdf8', accent2: '#6366f1', eyebrow: 'Order in progress', pills: ['📦 Being prepared', '💬 Support on Discord'] },
  order_completed:   { accent: '#34d399', accent2: '#10b981', eyebrow: 'Delivered',         pills: ['🛡 Money back if undelivered', '💬 Something wrong? Reply'] },
  refund_issued:     { accent: '#a855f7', accent2: '#d946ef', eyebrow: 'Refund issued',     pills: ['↩️ Refund on its way'] },
  custom_message:    { accent: '#7c5cff', accent2: '#a855f7', eyebrow: 'Message from support', pills: ['💬 Just reply to reach a human'] },
  support_reply:     { accent: '#7c5cff', accent2: '#a855f7', eyebrow: 'Support reply',      pills: ['💬 Just reply to reach a human'] },
  cart_reminder:     { accent: '#7c5cff', accent2: '#d946ef', eyebrow: 'Still in your cart', pills: ['🛒 No account needed', '💸 No hidden fees'] },
  review_request:    { accent: '#f59e0b', accent2: '#f97316', eyebrow: 'How did we do?',    pills: ['⭐ Takes 20 seconds'] },
  gift_card:         { accent: '#d946ef', accent2: '#a855f7', eyebrow: 'Gift card',         pills: ['🎁 Never expires unused'] },
  // Security mail: no marketing, no distractions, nothing to click by mistake.
  login_otp:         { accent: '#64748b', accent2: '#475569', eyebrow: 'Security code',     pills: [] },
};

const DEFAULT_THEME = { accent: null, eyebrow: 'Digital goods for gamers', pills: [] };

/** Wrap rendered content in the premium branded layout. */
export function wrapBranded(contentHtml, { preheader = '', theme = DEFAULT_THEME } = {}) {
  const brand = config.email.fromName;
  // The accent tints the header, the button and the rules — so the mail's
  // purpose is readable before a single word is.
  const color = theme.accent || config.email.brandColor;
  const color2 = theme.accent2 || '#a855f7';
  const pills = theme.pills || [];
  const eyebrow = theme.eyebrow || DEFAULT_THEME.eyebrow;
  const year = new Date().getFullYear();
  const logo = config.email.logoUrl
    ? `<img src="${config.email.logoUrl}" alt="${brand}" height="34" style="display:block;border:0" />`
    : `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
         <td style="background:rgba(255,255,255,.18);border-radius:10px;width:36px;height:36px;text-align:center;vertical-align:middle;font:800 18px/36px Arial,sans-serif;color:#fff">⚡</td>
         <td style="padding-left:10px;font:800 21px/1 Arial,sans-serif;color:#fff;letter-spacing:-.3px">${brand}</td>
       </tr></table>`;

  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<style>
  body{margin:0;padding:0;background:#08080f;font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#e5e7eb;-webkit-text-size-adjust:100%}
  .wrap{max-width:568px;margin:0 auto;padding:32px 16px}
  .card{background:#12121c;border:1px solid #26263a;border-radius:22px;overflow:hidden}
  .head{background:linear-gradient(120deg,${color} 0%,${color2} 100%);padding:30px 30px 26px;
        background-image:radial-gradient(circle at 85% 20%,rgba(255,255,255,.22),transparent 45%),
                         linear-gradient(rgba(255,255,255,.06) 1px,transparent 1px),
                         linear-gradient(90deg,rgba(255,255,255,.06) 1px,transparent 1px),
                         linear-gradient(120deg,${color} 0%,${color2} 100%);
        background-size:auto,34px 34px,34px 34px,auto}
  .head-sub{font:600 11.5px/1.4 Arial,sans-serif;color:rgba(255,255,255,.9);padding-top:9px;letter-spacing:1.6px;text-transform:uppercase}
  .body{padding:34px 30px 12px}
  h1{font-size:23px;line-height:1.3;color:#ffffff;margin:0 0 14px;font-weight:800;letter-spacing:-.3px}
  p{font-size:14.5px;line-height:1.7;color:#b9bfcd;margin:0 0 15px}
  .badge{width:64px;height:64px;border-radius:18px;background:linear-gradient(135deg,${color},${color2});
         text-align:center;font-size:30px;line-height:64px;margin:2px auto 18px;
         box-shadow:0 10px 26px rgba(0,0,0,.5)}
  .pill-note{display:inline-block;font:700 12px/1 Arial,sans-serif;color:#c7d2fe;background:#1b1b30;
             border:1px solid #34345c;border-radius:999px;padding:9px 16px;letter-spacing:.4px}
  strong{color:#fff}
  a{color:#a78bfa}
  a.btn{display:inline-block;background:linear-gradient(120deg,${color},${color2});color:#ffffff !important;text-decoration:none;
        padding:14px 30px;border-radius:12px;font-weight:700;font-size:15px;margin:8px 0 20px;
        box-shadow:0 6px 18px rgba(0,0,0,.45)}
  .code{font:800 30px/1 'Courier New',monospace;letter-spacing:8px;color:#ffffff;
        background:linear-gradient(180deg,#1c1c2c,#17172a);border:1px solid #34345a;border-radius:14px;
        padding:20px;text-align:center;margin:4px 0 16px}
  .notice{background:#181826;border:1px solid #2c2c48;border-left:3px solid ${color};border-radius:0 12px 12px 0;
          padding:13px 16px;margin:6px 0 18px;color:#a8b0c2;font-size:13px;line-height:1.6}
  .notice strong{color:#e5e7eb}
  .quote{border-left:3px solid ${color};background:#1a1a2c;border-radius:0 12px 12px 0;
         padding:14px 18px;margin:0 0 18px;color:#cbd1de;font-size:14px;line-height:1.6}
  .summary{width:100%;border-collapse:collapse;margin:2px 0 20px;font-size:14px}
  .summary td{padding:10px 0;border-bottom:1px solid #24243a;color:#cbd1de}
  .summary .r{text-align:right;color:#fff;white-space:nowrap;font-weight:600}
  .summary .tot td{border-top:2px solid #34345a;border-bottom:0;font-weight:800;color:#fff;padding-top:14px;font-size:15px}
  .pill-row{padding:0 0 18px}
  .pill{display:inline-block;font:600 11px/1 Arial,sans-serif;color:#9aa3b8;background:#1a1a2c;
        border:1px solid #262640;border-radius:999px;padding:7px 12px;margin:0 6px 6px 0}
  .divider{height:1px;background:#22223a;margin:6px 0 20px}
  .foot{padding:20px 30px 30px;color:#647087;font-size:12px;line-height:1.6}
  .foot a{color:#8f9bb3;text-decoration:none}
  .preheader{display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all}
</style></head>
<body>
<span class="preheader">${preheader}</span>
<div class="wrap">
  <div class="card">
    <div class="head">${logo}
      <div class="head-sub">${esc(eyebrow)}</div>
    </div>
    <div class="body">${contentHtml}</div>
    ${pills.length ? `<div style="padding:0 30px">
      <div class="pill-row">${pills.map((p) => `<span class="pill">${esc(p)}</span>`).join('')}</div>
      <div class="divider"></div>
    </div>` : `<div style="padding:0 30px"><div class="divider"></div></div>`}
    <div class="foot">
      You're receiving this because you have a ${brand} account or placed an order.<br><br>
      <a href="${config.appUrl}/track">Track order</a> &nbsp;·&nbsp;
      <a href="${config.appUrl}/discord">Discord support</a> &nbsp;·&nbsp;
      <a href="${config.appUrl}/account/settings">Email settings</a><br><br>
      © ${year} ${brand} — <a href="${config.appUrl}">${config.appUrl.replace(/^https?:\/\//, '')}</a>
    </div>
  </div>
</div>
</body></html>`;
}

/** Build a default context shared by all emails. */
export function baseContext(extra = {}) {
  return {
    brand: { name: config.email.fromName },
    app: { url: config.appUrl },
    ...extra,
  };
}

/** Render a stored template row → { subject, html }. */
export function renderTemplate(template, ctx) {
  const subject = renderTokens(template.subject, ctx, { where: `${template.id} subject` });
  const inner = renderTokens(template.body_html, ctx, { where: `${template.id} body` });
  // First line of text content doubles as the hidden inbox preview (preheader).
  const preheader = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110);
  const theme = EMAIL_THEMES[template.id] || DEFAULT_THEME;
  return { subject, html: wrapBranded(inner, { preheader, theme }) };
}
