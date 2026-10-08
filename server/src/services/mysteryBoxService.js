/**
 * Mystery boxes — a paid "giveaway". A mystery box is a product with
 * kind='mystery' and a reward pool (mystery_box_rewards). When an order is
 * paid, we roll one weighted reward per unit and pay it out as store credit,
 * recording exactly what was won (mystery_pulls) so it can be shown back.
 *
 * Real odds, real payout: rewards are weighted and settlement is idempotent
 * (one credit entry per order-item unit, tagged), so a payment retry never
 * double-pays.
 *
 * The one rule the economics rest on: a box never pays out as much as it
 * costs, counted the way a buyer can best play it (14+ boxes in one order for
 * the luck cap, every free reroll used). A pool that breaks it turns money —
 * or store credit, which then buys codes — into more store credit, so it is
 * refused where pools are saved and flagged by the launch check.
 */
import { get, all, run, nowIso, tx } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { badRequest } from '../utils/errors.js';
import { formatMoney } from '../utils/money.js';
import { addEntry } from './walletService.js';
import { notify } from './notificationService.js';

/* The luck a big order reaches and the luck the free reroll rolls at. Named
   once because the payout check below has to use exactly what roll() is given —
   a check against other numbers than the game uses checks nothing. */
const MAX_LUCK = 2;
const REROLL_LUCK = 1;

/* Where an order has to be for its boxes to be opened, and where it has gone
   when the sale is undone. */
const PAID = ['payment_received', 'processing', 'awaiting_fulfillment', 'completed'];
const UNDONE = ['refunded', 'cancelled', 'failed'];

/** Reward pool for a box (admin view / product page "what's inside"). */
export function getRewards(boxId) {
  return all(
    `SELECT id, label, weight, credit_cents AS credit FROM mystery_box_rewards
      WHERE box_id=@b ORDER BY credit_cents DESC`, { b: boxId });
}

/**
 * Replace a box's reward pool (admin). rewards: [{label, weight, credit}]
 *
 * Refused, before anything is written, when the pool would pay out as much as
 * the box costs (see poolVerdict) — whoever calls this, the admin screen or
 * the starter seed.
 */
export async function setRewards(boxId, rewards = []) {
  const clean = [];
  for (const r of rewards.slice(0, 40)) {
    const label = String(r.label || '').trim().slice(0, 80);
    if (!label) continue;
    clean.push({ label, weight: Math.max(1, Math.round(r.weight || 1)),
      credit: Math.max(0, Math.round(r.credit || 0)) });
  }
  const box = await get('SELECT price FROM products WHERE id=@b', { b: boxId });
  if (box) assertPoolBelowPrice(clean, box.price);
  /* One transaction. The old pool was deleted and the new one written row by
     row, so a box opened in between rolled against part of a pool, or found
     none and paid nothing. The box row is locked so two saves at once (a
     double click, two cold starts) take turns instead of leaving both pools. */
  await tx(async () => {
    await get('SELECT id FROM products WHERE id=@b FOR UPDATE', { b: boxId });
    await run('DELETE FROM mystery_box_rewards WHERE box_id=@b', { b: boxId });
    const at = nowIso();
    for (const r of clean) {
      await run(
        `INSERT INTO mystery_box_rewards (id, box_id, label, weight, credit_cents, created_at)
         VALUES (@id, @b, @l, @w, @c, @at)`,
        { id: newId('mbr'), b: boxId, l: r.label, w: r.weight, c: r.credit, at });
    }
  });
  return getRewards(boxId);
}

/** The chance of each reward at a given luck — the exact weights roll() uses. */
function chances(rewards, luck = 1) {
  const max = Math.max(1, ...rewards.map((r) => r.credit || 0));
  const ws = rewards.map((r) => Math.max(1, r.weight) * (1 + (luck - 1) * ((r.credit || 0) / max)));
  const total = ws.reduce((s, w) => s + w, 0) || 1;
  return ws.map((w) => w / total);
}

/**
 * What one box pays out on average, in cents, free reroll included: the box
 * rolls at `luck`, the reroll at REROLL_LUCK, and the buyer keeps the higher
 * (rerollPull). At MAX_LUCK this is the most a buyer can get out of a box.
 *
 * The starter pool's own comment said "≈ €38.75 per €49.99 box" — true for the
 * first roll alone. With the reroll the same pool paid €50.32 for one box and
 * €53.10 at the luck cap, so every box bought with credit grew the wallet.
 */
export function expectedPayout(rewards, luck = 1) {
  if (!rewards?.length) return 0;
  const p = chances(rewards, luck), q = chances(rewards, REROLL_LUCK);
  let sum = 0;
  for (let i = 0; i < rewards.length; i++) {
    for (let j = 0; j < rewards.length; j++) {
      sum += p[i] * q[j] * Math.max(rewards[i].credit || 0, rewards[j].credit || 0);
    }
  }
  return sum;
}

/**
 * Can this pool be sold at `price`? Judged on the worst case for the shop —
 * the luck cap and every reroll used. Equal is not good enough: at equal, a
 * box bought with credit comes back whole and every round is free.
 */
export function poolVerdict(rewards, price) {
  const worst = Math.round(expectedPayout(rewards, MAX_LUCK));
  const cents = Math.max(0, Number(price) || 0);
  return { worst, price: cents, safe: worst === 0 || worst < cents };
}

/** Throw the admin a message with both numbers in it when a pool fails poolVerdict. */
export function assertPoolBelowPrice(rewards, price) {
  const v = poolVerdict(rewards, price);
  if (v.safe) return v;
  throw badRequest(
    `This reward pool pays out more than the box costs: with the free reroll and the luck bonus for `
    + `14 or more boxes in one order, one box pays out ${formatMoney(v.worst)} on average and costs `
    + `${formatMoney(v.price)}. Lower the prizes or the weight of the big ones, or raise the price.`);
}

/**
 * Weighted random pick. `luck` (>= 1) shifts the odds toward the higher-value
 * rewards — this is the "buy more, better prizes" mechanic: the more boxes in
 * one order, the higher the luck. A reward's boost scales with its value, so
 * the jackpot gains the most and the small prizes the least.
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

/**
 * The real odds, from the same weights roll() uses: per reward, the chance for
 * one box and for an order big enough to reach the luck cap, and the average
 * value of one box. Shown on the product page — a paid chance at prizes with
 * money value must say what the chances are.
 */
export function oddsFor(rewards) {
  const at = (luck) => {
    const max = Math.max(1, ...rewards.map((r) => r.credit || 0));
    const ws = rewards.map((r) => Math.max(1, r.weight) * (1 + (luck - 1) * ((r.credit || 0) / max)));
    const total = ws.reduce((x, y) => x + y, 0) || 1;
    return ws.map((w) => w / total);
  };
  const one = at(1), best = at(2);
  const pct = (x) => Math.round(x * 1000) / 10;
  return {
    rewards: rewards.map((r, i) => ({ label: r.label, credit: r.credit, chance: pct(one[i]), chanceMax: pct(best[i]) })),
    averageCredit: Math.round(rewards.reduce((s, r, i) => s + (r.credit || 0) * one[i], 0)),
    maxLuckFromBoxes: 14,                                   // luckFor reaches 2× at 14 boxes in one order
  };
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
 * Reroll a single box once — risk-free: we roll a fresh prize and the buyer
 * keeps whichever is higher. Atomically claims the one reroll so it can't be
 * used twice.
 */
export async function rerollPull(userId, orderId, pullId) {
  const pull = await get('SELECT * FROM mystery_pulls WHERE id=@id AND order_id=@o AND user_id=@u',
    { id: pullId, o: orderId, u: userId });
  if (!pull) throw badRequest('Prize not found.');
  if (pull.rerolled_at) throw badRequest('You’ve already rerolled this box.');
  /* A reroll is a second chance on a sale that stands. Not on a refunded order:
     its prizes were taken back, and the reroll would pay out again on top of
     the refund. Not while a person is still checking the order. And not before
     the whole order is delivered, while a refund is still on the table.
     Checked before the claim, so a refusal does not use up the reroll. */
  const order = await get('SELECT status, fraud_hold FROM orders WHERE id=@o', { o: orderId });
  if (UNDONE.includes(order?.status)) {
    throw badRequest('This order was refunded or cancelled, so its boxes can no longer be rerolled.');
  }
  if (order?.fraud_hold) throw badRequest('This order is being checked — you can reroll once it has been approved.');
  if (order?.status !== 'completed') throw badRequest('You can reroll once your whole order has been delivered.');
  // Validate the pool BEFORE claiming the one-time reroll — if an admin cleared
  // the rewards we must fail without burning the buyer's free reroll.
  const rewards = await getRewards(pull.box_id);
  if (!rewards.length) throw badRequest('This box has no reward pool right now — try again later.');
  const claim = await run(
    `UPDATE mystery_pulls SET rerolled_at=@at
      WHERE id=@id AND order_id=@o AND user_id=@u AND rerolled_at IS NULL`,
    { at: nowIso(), id: pullId, o: orderId, u: userId });
  if (!claim.changes) throw badRequest('You’ve already rerolled this box.');
  const rolled = roll(rewards, REROLL_LUCK);
  const improved = rolled.credit > pull.credit_cents;
  if (improved) {
    await addEntry({
      userId, amount: rolled.credit - pull.credit_cents, type: 'mystery_prize',
      description: `Mystery reroll: ${rolled.label}`, orderId, tag: `reroll:${pullId}`,
    }).catch(() => {});
    await run('UPDATE mystery_pulls SET reward_label=@l, credit_cents=@c WHERE id=@id',
      { l: rolled.label, c: rolled.credit, id: pullId });
    /* A refund that landed between the check above and this credit has
       already taken back what it found — not this. */
    const now = await get('SELECT status FROM orders WHERE id=@o', { o: orderId });
    if (UNDONE.includes(now?.status)) {
      await reverseMysteryForOrder(orderId, now.status)
        .catch((e) => console.error('[mystery] reroll reversal:', e.message));
    }
  }
  return {
    label: improved ? rolled.label : pull.reward_label,
    credit: improved ? rolled.credit : pull.credit_cents,
    rolled: rolled.label, rolledCredit: rolled.credit, improved,
  };
}

/**
 * Settle every mystery-box line on a paid order: roll a reward per unit, grant
 * store credit, record the pull. Idempotent per unit via the wallet entry tag,
 * so this is safe to call again on a payment retry.
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
 *    still add up to — prizes plus reroll top-ups, minus earlier reversals —
 *    as one negative 'mystery_prize' entry on the order. allowNegative, the
 *    same as a reversed referral commission: a prize already spent is owed.
 *  - Idempotent: the sum is read under the wallet's user lock, so a second
 *    call (a refund and a chargeback webhook for the same order) finds nothing
 *    left and returns null. A reroll credited after an earlier call is picked
 *    up by the next one.
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
