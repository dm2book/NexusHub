/**
 * Chargebacks — money taken back against our will.
 *
 * Until now a chargeback was invisible: it turned the order 'refunded', which
 * is the same thing the shop does when it refunds a buyer as a courtesy. Those
 * are opposite facts. One is service; the other is a card scheme reversing a
 * payment weeks after a code was read and cannot be undone.
 *
 * Only the second should make the next order from that buyer harder, and that
 * is the whole reason this ledger exists — it is read by the fraud scorer, and
 * it is the record you need when the PSP asks for evidence.
 */
import { run, get, all, nowIso } from '../db/index.js';
import { reverseOrderCommission } from './affiliateService.js';
import { newId } from '../utils/ids.js';
import { audit } from './auditService.js';
import { alertOwner } from './notifyService.js';
import { formatMoney } from '../utils/money.js';
import { config } from '../config/env.js';

/**
 * Record a chargeback. Idempotent per PSP payment id.
 *
 * The PSP fires the same webhook more than once, so the payment id carries a
 * unique index and a repeat is a no-op rather than a second row that doubles
 * the buyer's apparent history.
 */
export async function recordChargeback({
  order, amount, currency = 'EUR', provider = null, paymentId = null,
  reason = null, source = 'psp', actor = null,
} = {}) {
  const email = String(order?.email || '').toLowerCase();
  if (!email) throw new Error('a chargeback needs the email it belongs to');

  if (paymentId) {
    const existing = await get('SELECT id FROM chargebacks WHERE payment_id=@p', { p: paymentId });
    if (existing) return { id: existing.id, duplicate: true };
  }

  const id = newId('cbk');
  await run(
    `INSERT INTO chargebacks
       (id, order_id, order_number, email, ip, amount, currency, provider, payment_id, reason, source, created_at)
     VALUES (@id, @oid, @num, @email, @ip, @amt, @cur, @prov, @pid, @reason, @src, @at)
     ON CONFLICT DO NOTHING`,
    { id, oid: order?.id || null, num: order?.number || null, email,
      ip: order?.ip || null, amt: Math.abs(Number(amount) || 0), cur: currency,
      prov: provider, pid: paymentId, reason, src: source, at: nowIso() });

  await audit({
    actor: actor || { id: source, email: source }, action: 'order.chargeback',
    targetType: 'order', targetId: order?.id || null,
    metadata: { amount, currency, provider, paymentId, reason, source },
  }).catch(() => {});

  console.warn(`[chargeback] ${order?.number || '(no order)'} · ${email} · ${amount} ${currency} · ${reason || source}`);

  /* The loud one, and the reason this feature exists.
     A chargeback has a deadline — the bank wants the evidence within days, and
     a defence submitted late is the money gone plus a fee. It is sent at high
     priority so it gets through a silent phone, and it sits AFTER the duplicate
     guard above: a PSP that retries its webhook must not buzz the owner twice
     for the same dispute, or the alerts stop being read. */
  await alertOwner('chargeback', {
    title: `${order?.number || 'Unknown order'} · ${formatMoney(Math.abs(Number(amount) || 0), currency)}`,
    lines: [
      `Customer: ${email}`,
      `Reason: ${reason || source}`,
      'Gather the delivery proof and answer the bank before the deadline.',
    ],
    url: order?.id ? `${config.appUrl}/admin/orders/${order.id}` : `${config.appUrl}/admin/security`,
    // The dispute, not the notification. A bank that reports the same
    // chargeback through two routes is still one chargeback.
    key: id,
  }).catch(() => {});

  /* And take the referral commission back.
     A chargeback is the money leaving weeks after the sale; the 5% left on the
     day it arrived and is spendable store credit by now. Best-effort and after
     the alert, because a failure here must not stop the owner being told there
     is a deadline to answer. */
  if (order?.id) {
    await reverseOrderCommission(order.id, 'charged back')
      .catch((e) => console.error('[chargeback] commission reversal', e.message));
  }

  return { id, duplicate: false };
}

/** How many chargebacks this email has, ever. The strongest signal there is. */
export async function chargebackCountForEmail(email) {
  if (!email) return 0;
  const r = await get('SELECT COUNT(*) AS n FROM chargebacks WHERE email=@e',
    { e: String(email).toLowerCase() });
  return Number(r?.n || 0);
}

/**
 * …and for an IP.
 *
 * Catches the buyer who came back under a fresh email, which is the entire
 * point of a fresh email. Weaker than the address match — IPs are shared and
 * reassigned — so the scorer weights it lower.
 */
export async function chargebackCountForIp(ip) {
  if (!ip) return 0;
  const r = await get('SELECT COUNT(*) AS n FROM chargebacks WHERE ip=@i', { i: ip });
  return Number(r?.n || 0);
}

export function listChargebacks({ limit = 100 } = {}) {
  return all(
    `SELECT id, order_id AS "orderId", order_number AS "orderNumber", email, amount, currency,
            provider, payment_id AS "paymentId", reason, source, created_at AS "createdAt"
       FROM chargebacks ORDER BY created_at DESC LIMIT @lim`, { lim: Math.min(limit, 500) });
}

/** Totals for the admin header — what this has actually cost. */
export async function chargebackSummary() {
  const r = await get(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total,
            COUNT(*) FILTER (WHERE created_at > @since) AS recent
       FROM chargebacks`,
    { since: new Date(Date.now() - 90 * 86_400_000).toISOString() });
  return { count: Number(r?.n || 0), totalCents: Number(r?.total || 0), last90Days: Number(r?.recent || 0) };
}
