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

/** Replace {{a.b}} tokens from a flat/nested context. Unknown tokens → ''. */
export function renderTokens(str, ctx) {
  return String(str).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, pathExpr) => {
    const val = pathExpr.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);
    return val == null ? '' : String(val);
  });
}

/** Wrap rendered content in the premium branded layout. */
export function wrapBranded(contentHtml, { preheader = '' } = {}) {
  const brand = config.email.fromName;
  const color = config.email.brandColor;
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
  body{margin:0;padding:0;background:#0a0a12;font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#e5e7eb;-webkit-text-size-adjust:100%}
  .wrap{max-width:568px;margin:0 auto;padding:28px 16px}
  .card{background:#13131d;border:1px solid #262638;border-radius:18px;overflow:hidden}
  .head{background:linear-gradient(120deg,${color} 0%,#a855f7 55%,#d946ef 100%);padding:26px 30px}
  .head-sub{font:400 12px/1.4 Arial,sans-serif;color:rgba(255,255,255,.85);padding-top:8px;letter-spacing:.4px}
  .body{padding:32px 30px 12px}
  h1{font-size:22px;line-height:1.3;color:#ffffff;margin:0 0 14px;font-weight:800;letter-spacing:-.3px}
  p{font-size:14.5px;line-height:1.65;color:#b9bfcd;margin:0 0 15px}
  strong{color:#fff}
  a{color:#a78bfa}
  a.btn{display:inline-block;background:linear-gradient(120deg,${color},#a855f7);color:#ffffff !important;text-decoration:none;
        padding:14px 30px;border-radius:12px;font-weight:700;font-size:15px;margin:8px 0 20px;
        box-shadow:0 6px 20px rgba(124,92,255,.35)}
  .code{font:800 30px/1 'Courier New',monospace;letter-spacing:8px;color:#ffffff;
        background:linear-gradient(180deg,#1c1c2c,#17172a);border:1px solid #34345a;border-radius:14px;
        padding:20px;text-align:center;margin:4px 0 16px}
  .notice{background:#181826;border:1px solid #2c2c48;border-left:3px solid #f5b324;border-radius:0 12px 12px 0;
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
      <div class="head-sub">Instant digital goods · delivered in seconds</div>
    </div>
    <div class="body">${contentHtml}</div>
    <div style="padding:0 30px">
      <div class="pill-row">
        <span class="pill">⚡ Instant delivery</span><span class="pill">🛡 Buyer protected</span><span class="pill">💬 24/7 support</span>
      </div>
      <div class="divider"></div>
    </div>
    <div class="foot">
      You're receiving this because you have a ${brand} account or placed an order.<br><br>
      <a href="${config.appUrl}/track">Track order</a> &nbsp;·&nbsp;
      <a href="${config.appUrl}/contact">Support</a> &nbsp;·&nbsp;
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
  const subject = renderTokens(template.subject, ctx);
  const inner = renderTokens(template.body_html, ctx);
  // First line of text content doubles as the hidden inbox preview (preheader).
  const preheader = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110);
  return { subject, html: wrapBranded(inner, { preheader }) };
}
