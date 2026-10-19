/**
 * Small, escaped HTML blocks for mails that have no order behind them.
 *
 * Everything that reaches a `...Html` token is inserted raw by the renderer, so
 * every value here goes through escapeHtml first — an IP, a user agent and a
 * staff-typed rejection reason are all outside our control.
 */
import { emailCopy } from './emailCopy.js';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** The facts of a new sign-in, for the security_alert mail. */
export function loginDetailsHtml({ ip, device, at = new Date() } = {}, lang = 'nl') {
  const c = emailCopy(lang);
  const when = new Date(at).toLocaleString(`${lang}-${lang === 'en' ? 'IE' : lang.toUpperCase()}`,
    { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Amsterdam' });
  const row = (label, value) => `<strong>${escapeHtml(label)}:</strong> ${escapeHtml(value || c.loginUnknown)}`;
  return [
    row(c.loginWhen, when),
    row(c.loginIp, ip),
    row(c.loginDevice, String(device || '').slice(0, 160)),
  ].join('<br>');
}

/** The buyer's own words on a refund request, quoted back to them. */
export function requestNoteHtml(note, lang = 'nl') {
  if (!String(note || '').trim()) return '';
  const c = emailCopy(lang);
  return `<div class="quote"><strong>${escapeHtml(c.requestNote)}:</strong> ${escapeHtml(String(note).slice(0, 500))}</div>`;
}

/** Why a payment proof was not accepted, for the payment_not_verified mail. */
export function proofReasonHtml(reason, lang = 'nl') {
  const c = emailCopy(lang);
  return `<div class="quote"><strong>${escapeHtml(c.proofReason)}:</strong> ${escapeHtml(String(reason).slice(0, 300))}</div>`;
}
