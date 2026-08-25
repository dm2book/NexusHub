/** Saved billing details + invoice generation. */
import { run, get, all, nowIso, tx } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { notFound } from '../utils/errors.js';
import { formatMoney } from '../utils/money.js';
import { getOrder } from './orderService.js';
import { config } from '../config/env.js';

export function listBilling(userId) {
  return all('SELECT * FROM billing_details WHERE user_id=@u ORDER BY is_default DESC, created_at DESC',
             { u: userId });
}

export async function saveBilling(userId, d = {}) {
  const id = newId('bil');
  const at = nowIso();
  await tx(async () => {
    if (d.isDefault) {
      await run('UPDATE billing_details SET is_default=0 WHERE user_id=@u', { u: userId });
    }
    await run(`INSERT INTO billing_details
          (id, user_id, label, full_name, email, line1, line2, city, postal_code, country, vat_number, is_default, created_at, updated_at)
         VALUES (@id, @u, @label, @name, @email, @l1, @l2, @city, @zip, @country, @vat, @def, @at, @at)`,
        { id, u: userId, label: d.label || 'Billing', name: d.fullName || null,
          email: d.email || null, l1: d.line1 || null, l2: d.line2 || null,
          city: d.city || null, zip: d.postalCode || null, country: d.country || null,
          vat: d.vatNumber || null, def: d.isDefault ? 1 : 0, at });
  });
  return get('SELECT * FROM billing_details WHERE id=@id', { id });
}

export async function deleteBilling(userId, id) {
  await run('DELETE FROM billing_details WHERE id=@id AND user_id=@u', { id, u: userId });
}

/**
 * The seller block, and what happens when there is no seller to name.
 *
 * A document headed "Invoice" is held to what an invoice must contain: who
 * issued it, from what address, and under which registration. This one carried
 * none of that — it printed the brand name from an email setting, the BUYER's
 * VAT number, and nothing about the seller at all.
 *
 * Loaded from src/lib/legalIdentity.js so there is one place the shop's legal
 * facts live. Unset fields are omitted rather than printed empty, and when the
 * legally required minimum is missing the document says so ON ITS FACE instead
 * of looking like a valid invoice that happens to be missing a line. A buyer
 * handing this to their accountant should be able to see the problem; so should
 * the person who forgot to fill it in.
 */
let identity = null;
async function sellerBlock() {
  if (identity === null) {
    try {
      const path = await import('node:path');
      const url = await import('node:url');
      const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..', '..');
      identity = await import(path.join(root, 'src/lib/legalIdentity.js'));
    } catch { identity = false; }
  }
  if (!identity) return '';
  const { LEGAL, legalComplete, legalAddressLine } = identity;
  if (!legalComplete()) {
    return `<p class="warn"><strong>This document is not a valid invoice.</strong><br>
      The seller\u2019s legal name and address are not published yet, and an invoice
      must carry them. Ask ${escapeHtml(config.email.replyTo || config.email.fromAddress)}
      for a complete copy before using this for your bookkeeping.</p>`;
  }
  return `<p class="muted"><strong>From:</strong><br>
    ${escapeHtml(LEGAL.tradeName)}${LEGAL.legalName ? ` \u2014 ${escapeHtml(LEGAL.legalName)}` : ''}<br>
    ${escapeHtml(legalAddressLine())}<br>
    ${LEGAL.kvk ? `KvK: ${escapeHtml(LEGAL.kvk)}<br>` : ''}
    ${LEGAL.vat ? `BTW-id: ${escapeHtml(LEGAL.vat)}<br>` : ''}
    ${config.email.replyTo ? escapeHtml(config.email.replyTo) : ''}</p>`;
}

/**
 * The VAT line, or an honest absence of one.
 *
 * No order in this system records a VAT rate or amount, so there is no
 * breakdown to print. What can be stated truthfully is which of the two
 * situations applies, and the difference matters to whoever receives this:
 * a VAT-registered seller owes a breakdown, and one who is not owes an
 * explanation of why there is none. Inventing a rate to fill the gap would turn
 * a missing line into a false one.
 */
async function vatLine() {
  if (identity === null) await sellerBlock();
  const vat = identity && identity.LEGAL?.vat;
  return vat
    ? `<div class="muted">Prices include VAT. This copy does not itemise the VAT amount \u2014
        ask ${escapeHtml(config.email.replyTo || config.email.fromAddress)} for an itemised invoice.</div>`
    : '<div class="muted">No VAT is itemised: the seller does not publish a BTW identification number.</div>';
}

/** Render a simple, self-contained HTML invoice for an order. */
export async function renderInvoice(orderId) {
  const order = await getOrder(orderId);
  if (!order) throw notFound('Order not found');
  const rows = order.items.map((i) => `
    <tr>
      <td>${escapeHtml(i.name)}</td>
      <td style="text-align:center">${i.quantity}</td>
      <td style="text-align:right">${formatMoney(i.unit_price, order.currency)}</td>
      <td style="text-align:right">${formatMoney(i.unit_price * i.quantity, order.currency)}</td>
    </tr>`).join('');
  const b = order.billing || {};
  return `<!doctype html><html><head><meta charset="utf-8">
<title>Invoice ${order.number}</title>
<style>
  body{font-family:Arial,sans-serif;color:#111;max-width:720px;margin:40px auto;padding:0 24px}
  h1{color:${config.email.brandColor}} table{width:100%;border-collapse:collapse;margin-top:24px}
  th,td{padding:8px;border-bottom:1px solid #eee;font-size:14px} th{text-align:left;color:#666}
  .totals{margin-top:16px;text-align:right;font-size:16px} .muted{color:#666;font-size:13px}
  .warn{border:1px solid #d97706;background:#fffbeb;color:#92400e;padding:10px 12px;
        border-radius:8px;font-size:13px;line-height:1.5}
</style></head><body>
  <h1>${config.email.fromName}</h1>
  <p class="muted">Invoice for order <strong>${order.number}</strong><br>
     Date: ${new Date(order.createdAt).toLocaleDateString()}</p>
  ${await sellerBlock()}
  <p class="muted"><strong>Billed to:</strong><br>
    ${escapeHtml(b.full_name || order.email)}<br>
    ${escapeHtml(b.line1 || '')} ${escapeHtml(b.line2 || '')}<br>
    ${escapeHtml(b.city || '')} ${escapeHtml(b.postal_code || '')} ${escapeHtml(b.country || '')}
    ${b.vat_number ? `<br>VAT: ${escapeHtml(b.vat_number)}` : ''}</p>
  <table><thead><tr><th>Item</th><th style="text-align:center">Qty</th>
    <th style="text-align:right">Unit</th><th style="text-align:right">Total</th></tr></thead>
    <tbody>${rows}</tbody></table>
  <div class="totals">
    <div>Subtotal: ${formatMoney(order.subtotal, order.currency)}</div>
    <div><strong>Total: ${formatMoney(order.total, order.currency)}</strong></div>
    ${await vatLine()}
    <div class="muted">Payment status: ${order.paymentStatus}</div>
  </div>
</body></html>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
