/**
 * Mystery boxes — retired. What is left here serves the orders that were
 * already placed.
 *
 * A mystery box was a product with kind='mystery' and a reward pool
 * (mystery_box_rewards): when an order was paid, one weighted reward was rolled
 * per unit and paid out as store credit, and what was won recorded in
 * mystery_pulls so it could be shown back. A paid box with random prizes of
 * different value is very likely a game of chance under the Dutch Wet op de
 * kansspelen, which needs a licence this shop does not have, so the owner
 * switched them off (migration 065) and bundles took their place. Nothing new
 * can be sold: the storefront hides boxes, priceOrder refuses one, the admin
 * cannot make or switch one on, and the odds page and the free reroll answer
 * 410.
 *
 * Kept, for orders from before:
 *  - pullsForOrder: the buyer's order page still shows what a box paid out.
 *  - settleMysteryForOrder: an order placed before the switch-off and paid or
 *    released from a fraud hold after it still gets what it was sold.
 *  - reverseMysteryForOrder: a refund, cancel or chargeback still takes the
 *    prize back.
 * Settlement is idempotent (one credit entry per order-item unit, tagged), so a
 * payment retry never double-pays.
 */
import { get, all, run, nowIso, tx } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { formatMoney } from '../utils/money.js';
import { addEntry } from './walletService.js';
import { notify } from './notificationService.js';

/* The luck a big order reached: +8% per extra box in one order, capped here. */
const MAX_LUCK = 2;

/* Where an order has to be for its boxes to be opened, and where it has gone
   when the sale is undone. */
const PAID = ['payment_received', 'processing', 'awaiting_fulfillment', 'completed'];
const UNDONE = ['refunded', 'cancelled', 'failed'];

/** A box's reward pool — what its orders were rolled against (admin view). */
export function getRewards(boxId) {
  return all(
    `SELECT id, label, weight, credit_cents AS credit FROM mystery_box_rewards
      WHERE box_id=@b ORDER BY credit_cents DESC`, { b: boxId });
}

/**
 * Weighted random pick. `luck` (>= 1) shifts the odds toward the higher-value
 * rewards — the "buy more, better prizes" rule the boxes were sold with: the
 * more boxes in one order, the higher the luck. A reward's boost scales with
 * its value, so the jackpot gains the most and the small prizes the least.
 */
function roll(rewards, luck = 1) {
  const max = Math.max(1, ...rewards.map((r) => r.credit || 0));
  const weighted = rewards.map((r) => {
    const valueFactor = (r.credit || 0) / max;            // 0..1 (top prize = 1)
    const w = Math.max(1, r.weight) * (1 + (luck - 1) * valueFactor);
    return { r, w };
  });
  const total = weighted.reduce((s, x) => s + x.w, 0);
  let n = Math.random() * total;
  for (const x of weighted) { n -= x.w; if (n <= 0) return x.r; }
  return rewards[rewards.length - 1];
}

/** Luck from how many boxes are opened in one order: +8% per extra box, capped 2×. */
const luckFor = (units) => Math.min(MAX_LUCK, 1 + 0.08 * Math.max(0, units - 1));

/** Winnings recorded for an order (shown on the order + success page). */
export function pullsForOrder(orderId) {
  return all(
    `SELECT id, reward_label AS label, credit_cents AS credit, rerolled_at AS "rerolledAt", created_at AS "createdAt"
       FROM mystery_pulls WHERE order_id=@o ORDER BY created_at ASC`, { o: orderId });
}

/**
 * Settle every mystery-box line on a paid order: roll a reward per unit, grant
 * store credit, record the pull. Idempotent per unit via the wallet entry tag,
 * so this is safe to call again on a payment retry.
 *
 * Only orders placed before the boxes were retired can hold one — the checkout
 * refuses a box now — but such an order paid, or released from a fraud hold,
 * afterwards was sold its boxes and still gets them opened.
 *
 * Only for a paid order nobody is holding. A prize is store credit that can be
 * spent on codes within the minute, so for a stolen card it IS the delivery:
 * a held order stays shut until releaseFraudHold opens it. Read fresh from the
 * database, never from the object the caller holds — the hold is written just
 * before the payment is.
 */
export async function settleMysteryForOrder(order) {
  if (!order?.userId || !order.items?.length) return [];
  const state = await get('SELECT status, fraud_hold FROM orders WHERE id=@id', { id: order.id });
  if (!state || state.fraud_hold || !PAID.includes(state.status)) return [];
  // Already settled (payment retry / re-entry)? Return what was won, don't re-roll.
  const already = await pullsForOrder(order.id);
  if (already.length) return already;
  // "Buy more, better prizes": luck scales with the TOTAL boxes in this order.
  const mysteryItems = [];
  for (const it of order.items) {
    const product = await get('SELECT id, kind, name FROM products WHERE id=@id', { id: it.product_id });
    if (product?.kind === 'mystery') mysteryItems.push({ it, product });
  }
  const totalBoxes = mysteryItems.reduce((s, m) => s + Math.max(1, Number(m.it.quantity || 1)), 0);
  const luck = luckFor(totalBoxes);
  const won = [];
  for (const { it, product } of mysteryItems) {
    const rewards = await getRewards(product.id);
    if (!rewards.length) continue;
    const units = Math.max(1, Number(it.quantity || 1));
    for (let n = 0; n < units; n++) {
      const tag = `mystery:${it.id}:${n}`;
      const prize = roll(rewards, luck);
      if (prize.credit > 0) {
        await addEntry({
          userId: order.userId, amount: prize.credit, type: 'mystery_prize',
          description: `Mystery box: ${prize.label}`, orderId: order.id, tag,
        }).catch(() => {});
      }
      await run(
        `INSERT INTO mystery_pulls (id, order_id, order_item_id, box_id, user_id, reward_label, credit_cents, created_at)
         VALUES (@id, @o, @oi, @b, @u, @l, @c, @at)`,
        { id: newId('mpull'), o: order.id, oi: it.id, b: product.id, u: order.userId,
          l: prize.label, c: prize.credit, at: nowIso() });
      won.push({ label: prize.label, credit: prize.credit });
    }
  }
  if (won.length) {
    const totalCredit = won.reduce((s, w) => s + w.credit, 0);
    await notify(order.userId, {
      type: 'mystery_prize',
      title: '🎁 Your mystery box is open!',
      body: won.map((w) => w.label).join(', ') + (totalCredit ? ` — €${(totalCredit / 100).toFixed(2)} store credit added.` : ''),
      link: `/account/orders/${order.id}`,
    }).catch(() => {});
  }
  /* A refund that landed while the boxes were being opened ran its reversal
     before these prizes existed. Take them back now. */
  const after = await get('SELECT status FROM orders WHERE id=@id', { id: order.id });
  if (won.length && UNDONE.includes(after?.status)) {
    await reverseMysteryForOrder(order.id, after.status)
      .catch((e) => console.error('[mystery] late reversal:', e.message));
  }
  return won;
}

/**
 * Take back what an order's mystery boxes paid out, because the sale was
 * undone: refunded (as money or as credit), cancelled, failed, or charged back.
 *
 * Contract, for every caller (the order state machine, refundService,
 * chargebackService):
 *  - Debits the buyer's wallet by what the order's 'mystery_prize' entries
 *    still add up to — prizes plus the reroll top-ups paid while rerolls
 *    existed, minus earlier reversals — as one negative 'mystery_prize' entry
 *    on the order. allowNegative, the same as a reversed referral commission:
 *    a prize already spent is owed.
 *  - Idempotent: the sum is read under the wallet's user lock, so a second
 *    call (a refund and a chargeback webhook for the same order) finds nothing
 *    left and returns null.
 *  - Does not look at the order status; deciding that the sale is undone is the
 *    caller's job. Returns { reversed: cents } or null.
 *  - The refund entry itself stays the full amount paid. A figure QUOTED to
 *    the buyer may show what the wallet gains net of the prizes, but do not
 *    also subtract them from the refund entry, or the buyer pays them twice.
 */
export async function reverseMysteryForOrder(orderId, reason = 'order reversed') {
  if (!orderId) return null;
  const order = await get('SELECT id, number, user_id FROM orders WHERE id=@o', { o: orderId });
  if (!order?.user_id) return null;
  const reversed = await tx(async () => {
    // addEntry takes the same lock; holding it from the read on means two
    // reversals at once cannot both see the prize as still there.
    await get('SELECT id FROM users WHERE id=@u FOR UPDATE', { u: order.user_id });
    const r = await get(
      `SELECT COALESCE(SUM(amount), 0) AS net, COUNT(*) FILTER (WHERE amount < 0) AS n
         FROM credit_transactions WHERE order_id=@o AND user_id=@u AND type='mystery_prize'`,
      { o: orderId, u: order.user_id });
    const net = Number(r?.net || 0);
    if (net <= 0) return 0;
    await addEntry({
      userId: order.user_id, amount: -net, type: 'mystery_prize',
      description: `Mystery prize taken back · ${reason} · order ${order.number}`, orderId,
      tag: `mystery-reversal:${orderId}:${Number(r?.n || 0) + 1}`, allowNegative: true,
    });
    return net;
  });
  if (!reversed) return null;
  await notify(order.user_id, {
    type: 'system', title: 'A mystery box prize was taken back',
    body: `Order ${order.number} (${reason}): the ${formatMoney(reversed)} its mystery boxes paid out `
      + 'in store credit has been taken back off your wallet.',
    link: '/account/wallet',
  }).catch(() => {});
  return { reversed };
}
