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
 *
 * Both count what already went back. A partial refund made in the Stripe or
 * Mollie dashboard is recorded on the order (recordPspRefund, from their
 * webhooks), and a later refund returns only the rest — it paid the whole
 * order again on top before.
 *
 * What the order EARNED goes back with it in transitionOrder: a mystery prize
 * is taken back as its own wallet entry, not netted out of the refund, so the
 * statement shows both. The refund entry is therefore the full amount, and
 * creditRefundAmount — the figure quoted to the buyer and the owner — is that
 * amount less the prizes, which is what the wallet actually gains.
 */
import { get, run } from '../db/index.js';
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

/**
 * Record what the payment provider has refunded on an order so far.
 *
 * Stripe (charge.amount_refunded) and Mollie (amountRefunded) both report a
 * running total, so the largest figure seen is kept: webhooks arrive out of
 * order, and an older event must not make a refund look smaller than it was.
 * Never more than the order total.
 */
export async function recordPspRefund(orderId, cents) {
  const c = Math.max(0, Math.round(Number(cents) || 0));
  if (!orderId || !c) return;
  await run(`UPDATE orders SET refunded_cents = GREATEST(COALESCE(refunded_cents, 0), LEAST(@c, total))
              WHERE id=@id`, { id: orderId, c });
}

/** Money the provider already sent back on this order — 0 when none. */
async function refundedAtProvider(orderId) {
  const r = await get('SELECT refunded_cents FROM orders WHERE id=@id', { id: orderId }).catch(() => null);
  return Math.max(0, Number(r?.refunded_cents || 0));
}

/** What a money refund still sends back: the total, less what the provider already refunded. */
export async function moneyRefundAmount(order) {
  return Math.max(0, Number(order.total || 0) - await refundedAtProvider(order.id));
}

/** The one wallet entry a store-credit refund writes: the money still held plus the credit the order used. */
async function creditRefundEntry(order) {
  const [money, spent] = await Promise.all([moneyRefundAmount(order), spentOnOrder(order.id).catch(() => 0)]);
  return money + spent;
}

/** Mystery-box prize credit this order paid out and that has not been taken back yet. */
async function prizesStanding(orderId) {
  const r = await get(`SELECT COALESCE(SUM(amount), 0) AS s FROM credit_transactions
                        WHERE order_id=@o AND type='mystery_prize'`, { o: orderId }).catch(() => null);
  return Math.max(0, Number(r?.s || 0));
}

/**
 * What a store-credit refund leaves in the wallet: everything the order took,
 * less money the provider already refunded and less the prizes its mystery
 * boxes paid out (those are taken back when the order is refunded). The figure
 * a refund request records and the owner is shown.
 */
export async function creditRefundAmount(order) {
  const [entry, prizes] = await Promise.all([creditRefundEntry(order), prizesStanding(order.id)]);
  return Math.max(0, entry - prizes);
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
    /* The full amount, prizes NOT subtracted: transitionOrder takes them back
       as their own entry, and subtracting them here as well would make the
       buyer pay them back twice. */
    const amount = await creditRefundEntry(order);
    if (amount <= 0) throw badRequest('Nothing was paid for this order, so there is nothing to credit');
    const entry = await addEntry({ userId: order.userId, amount, type: 'refund',
      description: `Refund as store credit · order ${order.number}`, orderId: order.id,
      createdBy: ctx.actorId || null, tag: `refund-credit:${order.id}` });
    try {
      // refundAmount: what the mail states — less than total + credit once part went back at the provider.
      const updated = await moveToRefunded(order.id,
        { ...ctx, reason: reason || 'Refunded as store credit', refundAs: 'credit', refundAmount: amount });
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
  /* Only what the provider still holds. Part already refunded in its dashboard
     is with the buyer, and asking for the whole total again is refused — or,
     with nothing left at all, an amount of 0 would read as "everything". */
  const cents = await moneyRefundAmount(order);
  const fail = (provider, e) => {
    const err = badRequest(`${provider} refused the refund: ${e.message}`);
    err.pspFailure = { provider, paymentId: psp?.paymentId, error: e.message };
    return err;
  };
  if (cents > 0 && psp?.provider === 'mollie' && mollieEnabled()) {
    try {
      refund = await refundPayment(psp.paymentId, {
        cents, currency: order.currency || 'EUR', description: `Refund ${order.number}`,
      });
    } catch (e) { throw fail('Mollie', e); }
  }
  if (cents > 0 && psp?.provider === 'stripe' && stripeEnabled()) {
    try {
      refund = await refundPaymentIntent(order.paymentRef || psp.paymentId, { cents, orderId: order.id });
    } catch (e) { throw fail('Stripe', e); }
  }
  const updated = await moveToRefunded(order.id, { ...ctx, reason: reason || 'Refunded by staff' });
  /* `cents` is the money that went back now. Nothing left at the provider
     (all of it refunded in its dashboard already) is still that provider's
     refund, not one the owner has to send by hand. */
  return { order: updated, refund: refund ? { method: 'money', provider: psp.provider, id: refund.id, cents }
    : psp && !cents && order.total > 0 ? { method: 'money', provider: psp.provider, id: null, cents: 0 }
      : { method: 'money', provider: 'manual', cents } };
}
