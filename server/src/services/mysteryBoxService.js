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

/** Weighted random pick from a reward pool. */
function roll(rewards) {
  const total = rewards.reduce((s, r) => s + Math.max(1, r.weight), 0);
  let n = Math.random() * total;
  for (const r of rewards) { n -= Math.max(1, r.weight); if (n <= 0) return r; }
  return rewards[rewards.length - 1];
}

/** Winnings recorded for an order (shown on the order + success page). */
export function pullsForOrder(orderId) {
  return all(
    `SELECT reward_label AS label, credit_cents AS credit, created_at AS createdAt
       FROM mystery_pulls WHERE order_id=@o ORDER BY created_at ASC`, { o: orderId });
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
  const won = [];
  for (const it of order.items) {
    const product = await get('SELECT id, kind, name FROM products WHERE id=@id', { id: it.product_id });
    if (product?.kind !== 'mystery') continue;
    const rewards = await getRewards(product.id);
    if (!rewards.length) continue;
    const units = Math.max(1, Number(it.quantity || 1));
    for (let n = 0; n < units; n++) {
      const tag = `mystery:${it.id}:${n}`;
      const prize = roll(rewards);
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
