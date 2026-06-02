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

export function saveBilling(userId, d = {}) {
  const id = newId('bil');
  const at = nowIso();
  tx(() => {
    if (d.isDefault) {
      run('UPDATE billing_details SET is_default=0 WHERE user_id=@u', { u: userId });
    }
    run(`INSERT INTO billing_details
          (id, user_id, label, full_name, email, line1, line2, city, postal_code, country, vat_number, is_default, created_at, updated_at)
         VALUES (@id, @u, @label, @name, @email, @l1, @l2, @city, @zip, @country, @vat, @def, @at, @at)`,
        { id, u: userId, label: d.label || 'Billing', name: d.fullName || null,
          email: d.email || null, l1: d.line1 || null, l2: d.line2 || null,
          city: d.city || null, zip: d.postalCode || null, country: d.country || null,
          vat: d.vatNumber || null, def: d.isDefault ? 1 : 0, at });
  })();
  return get('SELECT * FROM billing_details WHERE id=@id', { id });
}

export function deleteBilling(userId, id) {
  run('DELETE FROM billing_details WHERE id=@id AND user_id=@u', { id, u: userId });
}

/** Render a simple, self-contained HTML invoice for an order. */
export function renderInvoice(orderId) {
  const order = getOrder(orderId);
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
</style></head><body>
  <h1>${config.email.fromName}</h1>
  <p class="muted">Invoice for order <strong>${order.number}</strong><br>
     Date: ${new Date(order.createdAt).toLocaleDateString()}</p>
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
    <div class="muted">Payment status: ${order.paymentStatus}</div>
  </div>
</body></html>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
