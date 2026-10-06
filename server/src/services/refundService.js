/**
 * Refunding an order — as money back, or as store credit.
 *
 * The buyer chooses when they ask (refund_requests.method), and the owner's
 * approval does exactly what they chose. The owner can also refund an order
 * directly from its page, either way.
 *
 * MONEY goes back the way it came. When it came through a PSP the refund is
 * sent there FIRST and the order only becomes `refunded` once the PSP accepted
 * it — an order that says refunded while the shop still holds the money is the
 * one outcome worse than a visible error. An order paid by hand (Tikkie,
 * Revolut, PayPal, bank) has no PSP payment: it is marked refunded and the
 * owner sends the money back the same way.
 *
 * CREDIT needs an account, because credit lives in a wallet. The whole order
 * goes back as ONE wallet entry: what was paid plus whatever store credit the
 * order used. transitionOrder normally returns the used credit itself, but it
 * checks for a 'refund' entry on the order first and finds this one, so nothing
 * is credited twice. The entry is tagged, so approving twice credits once.
 */
import { getOrder, transitionOrder, canTransition, getPspPayment } from './orderService.js';
import { addEntry, spentOnOrder } from './walletService.js';
import { refundPayment, isEnabled as mollieEnabled } from './mollieService.js';
import { refundPaymentIntent, isEnabled as stripeEnabled } from './stripeService.js';
import { badRequest, notFound } from '../utils/errors.js';

export const REFUND_METHODS = ['money', 'credit'];

/* Forced, and checked. A paid order is being worked on in the background (the
   supplier queue, the hand queue moving it to processing), so an unforced
   transition can lose that race and return the order unchanged — no error,
   while the money or the credit has already gone out. Forced, transitionOrder
   re-reads and retries; and if it still is not refunded, that is an error. */
async function moveToRefunded(orderId, ctx) {
  const updated = await transitionOrder(orderId, 'refunded', { ...ctx, force: true });
  if (updated?.status !== 'refunded') {
    throw badRequest(`The order could not be marked refunded (it is ${updated?.status || 'unknown'}) — try again`);
  }
  return updated;
}

/** Store credit is only possible for an order placed with an account. */
export const canRefundAsCredit = (order) => !!order?.userId;

/** The amount a store-credit refund puts in the wallet: everything the order took. */
export async function creditRefundAmount(order) {
  const spent = await spentOnOrder(order.id).catch(() => 0);
  return Number(order.total || 0) + spent;
}

/**
 * Refund an order. `method` is 'money' or 'credit'. `ctx` carries the actor
 * ({ actorId, user }) and a reason. Returns { order, refund }.
 * A PSP refusal throws with `pspFailure` set, and nothing changes.
 */
export async function refundOrder(orderId, { method = 'money', reason = '', ...ctx } = {}) {
  if (!REFUND_METHODS.includes(method)) throw badRequest('Refund method must be money or credit');
  const order = await getOrder(orderId);
  if (!order) throw notFound('Order not found');
  if (order.status === 'refunded') return { order, refund: null, already: true };
  if (!canTransition(order.status, 'refunded')) {
    throw badRequest(`An order that is ${order.status} cannot be refunded`);
  }

  if (method === 'credit') {
    if (!canRefundAsCredit(order)) {
      throw badRequest('Store credit needs an account — this order was placed as a guest. Refund the money instead.');
    }
    const amount = await creditRefundAmount(order);
    if (amount <= 0) throw badRequest('Nothing was paid for this order, so there is nothing to credit');
    const entry = await addEntry({ userId: order.userId, amount, type: 'refund',
      description: `Refund as store credit · order ${order.number}`, orderId: order.id,
      createdBy: ctx.actorId || null, tag: `refund-credit:${order.id}` });
    try {
      const updated = await moveToRefunded(order.id,
        { ...ctx, reason: reason || 'Refunded as store credit', refundAs: 'credit' });
      return { order: updated, refund: { method: 'credit', amount, walletEntryId: entry.id } };
    } catch (e) {
      /* The order could not move, so the credit must not stay. */
      if (!entry.deduped) {
        await addEntry({ userId: order.userId, amount: -amount, type: 'adjustment',
          description: `Store-credit refund undone · order ${order.number}`, orderId: order.id,
          createdBy: ctx.actorId || null, allowNegative: true }).catch(() => {});
      }
      throw e;
    }
  }

  let refund = null;
  const psp = await getPspPayment(order.id).catch(() => null);
  const fail = (provider, e) => {
    const err = badRequest(`${provider} refused the refund: ${e.message}`);
    err.pspFailure = { provider, paymentId: psp?.paymentId, error: e.message };
    return err;
  };
  if (psp?.provider === 'mollie' && mollieEnabled()) {
    try {
      refund = await refundPayment(psp.paymentId, {
        cents: order.total, currency: order.currency || 'EUR', description: `Refund ${order.number}`,
      });
    } catch (e) { throw fail('Mollie', e); }
  }
  if (psp?.provider === 'stripe' && stripeEnabled()) {
    try {
      refund = await refundPaymentIntent(order.paymentRef || psp.paymentId, { cents: order.total, orderId: order.id });
    } catch (e) { throw fail('Stripe', e); }
  }
  const updated = await moveToRefunded(order.id, { ...ctx, reason: reason || 'Refunded by staff' });
  return { order: updated, refund: refund ? { method: 'money', provider: psp.provider, id: refund.id }
    : { method: 'money', provider: 'manual' } };
}
