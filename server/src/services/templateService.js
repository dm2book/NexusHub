/**
 * Branded email layout + token rendering.
 *
 * Templates store only the inner content; we wrap it in a consistent,
 * email-client-safe HTML shell using the configured brand colours/logo so the
 * sender always looks on-brand. Admin edits to subject/body are honoured.
 */
import { config } from '../config/env.js';

/** Replace {{a.b}} tokens from a flat/nested context. Unknown tokens → ''. */
export function renderTokens(str, ctx) {
  return String(str).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, pathExpr) => {
    const val = pathExpr.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);
    return val == null ? '' : String(val);
  });
}

/** Wrap rendered content in the branded, responsive layout. */
export function wrapBranded(contentHtml) {
  const brand = config.email.fromName;
  const color = config.email.brandColor;
  const logo = config.email.logoUrl
    ? `<img src="${config.email.logoUrl}" alt="${brand}" height="36" style="display:block" />`
    : `<span style="font:700 22px/1 Arial,sans-serif;color:#fff">${brand}</span>`;

  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;background:#0a0a0f;font-family:Arial,Helvetica,sans-serif;color:#e5e7eb}
  .wrap{max-width:560px;margin:0 auto;padding:24px}
  .card{background:#12121a;border:1px solid #232336;border-radius:16px;overflow:hidden}
  .head{background:linear-gradient(135deg,${color},#a855f7);padding:24px}
  .body{padding:28px 28px 8px}
  h1{font-size:20px;color:#fff;margin:0 0 12px}
  p{font-size:14px;line-height:1.6;color:#b8bcc8;margin:0 0 14px}
  a.btn{display:inline-block;background:${color};color:#fff !important;text-decoration:none;
        padding:13px 26px;border-radius:10px;font-weight:bold;margin:6px 0 18px}
  .code{font:700 28px/1 'Courier New',monospace;letter-spacing:6px;color:#fff;
        background:#1a1a2e;border-radius:10px;padding:16px;text-align:center}
  .quote{border-left:3px solid ${color};background:#1a1a2e;border-radius:0 10px 10px 0;
         padding:12px 16px;margin:0 0 18px;color:#cbd1de;font-size:14px}
  .summary{width:100%;border-collapse:collapse;margin:0 0 18px;font-size:14px}
  .summary td{padding:9px 0;border-bottom:1px solid #232336;color:#cbd1de}
  .summary .r{text-align:right;color:#fff;white-space:nowrap}
  .summary .tot td{border-top:2px solid #232336;border-bottom:0;font-weight:bold;color:#fff;padding-top:12px}
  .foot{padding:18px 28px 28px;color:#64748b;font-size:12px}
  .foot a{color:#94a3b8}
</style></head>
<body><div class="wrap"><div class="card">
  <div class="head">${logo}</div>
  <div class="body">${contentHtml}</div>
  <div class="foot">
    You're receiving this because you have a ${brand} account.<br>
    <a href="${config.appUrl}/account/settings">Notification settings</a> ·
    <a href="${config.appUrl}">${brand}</a>
  </div>
</div></div></body></html>`;
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
  return { subject, html: wrapBranded(inner) };
}
