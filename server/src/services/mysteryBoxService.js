/**
 * Mystery boxes — a paid "giveaway". A mystery box is a product with
 * kind='mystery' and a reward pool (mystery_box_rewards). When an order is
 * paid, we roll one weighted reward per unit and pay it out as store credit,
 * recording exactly what was won (mystery_pulls) so it can be shown back.
 *
 * Real odds, real payout: rewards are weighted and settlement is idempotent
 * (one credit entry per order-item unit, tagged), so a payment retry never
 * double-pays.
 */
import { get, all, run, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { badRequest } from '../utils/errors.js';
import { addEntry } from './walletService.js';
import { notify } from './notificationService.js';

/** Reward pool for a box (admin view / product page "what's inside"). */
export function getRewards(boxId) {
  return all(
    `SELECT id, label, weight, credit_cents AS credit FROM mystery_box_rewards
      WHERE box_id=@b ORDER BY credit_cents DESC`, { b: boxId });
}

/** Replace a box's reward pool (admin). rewards: [{label, weight, credit}] */
export async function setRewards(boxId, rewards = []) {
  await run('DELETE FROM mystery_box_rewards WHERE box_id=@b', { b: boxId });
  const at = nowIso();
  for (const r of rewards.slice(0, 40)) {
    const label = String(r.label || '').trim().slice(0, 80);
    if (!label) continue;
    await run(
      `INSERT INTO mystery_box_rewards (id, box_id, label, weight, credit_cents, created_at)
       VALUES (@id, @b, @l, @w, @c, @at)`,
      { id: newId('mbr'), b: boxId, l: label,
        w: Math.max(1, Math.round(r.weight || 1)),
        c: Math.max(0, Math.round(r.credit || 0)), at });
  }
  return getRewards(boxId);
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

/** Luck from how many boxes are opened in one order: +8% per extra box, capped 2×. */
const luckFor = (units) => Math.min(2, 1 + 0.08 * Math.max(0, units - 1));

/** Winnings recorded for an order (shown on the order + success page). */
export function pullsForOrder(orderId) {
  return all(
    `SELECT id, reward_label AS label, credit_cents AS credit, rerolled_at AS rerolledAt, created_at AS createdAt
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
  // Validate the pool BEFORE claiming the one-time reroll — if an admin cleared
  // the rewards we must fail without burning the buyer's free reroll.
  const rewards = await getRewards(pull.box_id);
  if (!rewards.length) throw badRequest('This box has no reward pool right now — try again later.');
  const claim = await run(
    `UPDATE mystery_pulls SET rerolled_at=@at
      WHERE id=@id AND order_id=@o AND user_id=@u AND rerolled_at IS NULL`,
    { at: nowIso(), id: pullId, o: orderId, u: userId });
  if (!claim.changes) throw badRequest('You’ve already rerolled this box.');
  const rolled = roll(rewards, 1);
  const improved = rolled.credit > pull.credit_cents;
  if (improved) {
    await addEntry({
      userId, amount: rolled.credit - pull.credit_cents, type: 'mystery_prize',
      description: `Mystery reroll: ${rolled.label}`, orderId, tag: `reroll:${pullId}`,
    }).catch(() => {});
    await run('UPDATE mystery_pulls SET reward_label=@l, credit_cents=@c WHERE id=@id',
      { l: rolled.label, c: rolled.credit, id: pullId });
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
 */
export async function settleMysteryForOrder(order) {
  if (!order?.userId || !order.items?.length) return [];
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
  return won;
}
