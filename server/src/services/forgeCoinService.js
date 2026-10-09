/**
 * Forge Coins — a loyalty currency members earn by shopping and spend in the
 * Forge Shop. Real balance only: it's the SUM of an append-only ledger, never a
 * cached number that can drift.
 *
 *   Earn:  1 coin per €10 of paid spend (floor), awarded once per order.
 *   Spend: redeem coins for a personal discount coupon (or a giveaway boost).
 */
import { get, all, run, tx, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { badRequest } from '../utils/errors.js';
import { createCoupon } from './couponService.js';

export const COINS_PER_EURO_CENTS = 1000; // €10 = 1 coin

/** The built-in Forge Shop catalog — what coins buy. Admin-added items (stored in
 *  forge_shop_items) are merged on top of these at read time.
 *
 *  Pricing note: members earn 1 coin per €10 spent, so a reward costing N coins
 *  represents €(N×10) of spend. These costs keep the effective payback around
 *  3–3.5% (sustainable against the store's ~18% margin) — a big reward is a
 *  little better value to reward saving up. Don't drop them below ~1.5 coins per
 *  €1 of discount or you give margin away.
 *
 *  Minimum order: a code is single-use, and every order's discounts together
 *  stop at 40% (MAX_TOTAL_DISCOUNT_PERCENT). The €25 code said "€25 off any
 *  order", so on a €30 order it gave €12 and was gone — 65 coins for €12. A
 *  code now needs the order on which 40% is its whole value (value / 0.40:
 *  €12.50, €25, €62.50), and the reward text says so. The minimum counts what
 *  the code can discount, so a mystery box does not count towards it.
 *  Exempting coin codes from the 40% was the other way out, but no product has
 *  a cost price (see the ceiling in config/env.js), so what a code that empties
 *  an order would cost cannot be checked; the 40% stays the bound for every
 *  code. These amounts are written for the default 40% — the reward texts in
 *  the storefront dictionaries (acc.shop.item.<id>.blurb) name them too, so a
 *  different ceiling means changing both. Codes already sold keep the terms
 *  they were sold with. */
export const FORGE_SHOP = [
  { id: 'coupon5', kind: 'coupon', cost: 15, value: 500, minSubtotal: 1250, label: '€5 discount code', blurb: '€5 off an order of €12.50 or more.' },
  { id: 'coupon10', kind: 'coupon', cost: 28, value: 1000, minSubtotal: 2500, label: '€10 discount code', blurb: '€10 off an order of €25.00 or more — saves you a coin.' },
  { id: 'coupon25', kind: 'coupon', cost: 65, value: 2500, minSubtotal: 6250, label: '€25 discount code', blurb: '€25 off an order of €62.50 or more — best value.' },
  { id: 'boost', kind: 'boost', cost: 8, value: 1, label: 'Giveaway boost', blurb: '+1 bonus entry in this week’s giveaway (claim in Discord).' },
];

/** Admin-managed Forge Shop items, shaped like FORGE_SHOP entries. */
export async function listShopItems() {
  const rows = await all(`SELECT * FROM forge_shop_items WHERE active=1 ORDER BY cost ASC`);
  return rows.map((r) => ({
    id: r.id, kind: 'coupon', cost: Number(r.cost), value: Number(r.value),
    couponKind: r.coupon_kind === 'percent' ? 'percent' : 'fixed',
    label: r.label, blurb: r.blurb || '',
  }));
}

/** The full shop (built-in + admin items) that the account page shows. */
export async function forgeShopCatalog() {
  return [...FORGE_SHOP, ...(await listShopItems())];
}

/** Resolve a reward id to a built-in or admin-defined item (null if unknown). */
async function findReward(rewardId) {
  const builtin = FORGE_SHOP.find((r) => r.id === rewardId);
  if (builtin) return { ...builtin, couponKind: 'fixed' };
  const items = await listShopItems();
  return items.find((r) => r.id === rewardId) || null;
}

/** Current balance = SUM(delta). */
export async function coinBalance(userId) {
  if (!userId) return 0;
  const r = await get('SELECT COALESCE(SUM(delta),0) AS n FROM forge_coin_ledger WHERE user_id=@u', { u: userId });
  return Number(r?.n || 0);
}

/** Serialize concurrent spends for a user by locking their user row inside the
 *  current transaction (Postgres forbids FOR UPDATE with an aggregate, so we
 *  lock here, THEN sum). Mirrors walletService — without it two concurrent
 *  spends could both pass the balance check and overspend into a negative
 *  balance (free rewards / free membership). */
async function lockUser(userId) {
  await get('SELECT id FROM users WHERE id=@u FOR UPDATE', { u: userId });
}

/** Recent ledger entries for the account page. */
/**
 * Lifetime earned and spent, as two sums.
 *
 * NOT derivable from coinHistory: that returns the most recent twenty rows, so
 * adding them up gives a total that is right for a new member and quietly wrong
 * for everyone else — and wrong in the flattering direction, because the oldest
 * rows drop off first. Two SUMs over the whole ledger instead.
 */
export async function coinTotals(userId) {
  if (!userId) return { earned: 0, spent: 0 };
  // Coins taken back with a refunded order were never earned, not spent.
  const r = await get(
    `SELECT COALESCE(SUM(delta) FILTER (WHERE delta > 0 OR reason = 'order_reversal'), 0) AS earned,
            COALESCE(SUM(-delta) FILTER (WHERE delta < 0 AND reason <> 'order_reversal'), 0) AS spent
       FROM forge_coin_ledger WHERE user_id = @u`, { u: userId });
  return { earned: Number(r?.earned || 0), spent: Number(r?.spent || 0) };
}

export function coinHistory(userId, limit = 20) {
  return all(
    `SELECT delta, reason, ref, created_at AS "createdAt" FROM forge_coin_ledger
      WHERE user_id=@u ORDER BY created_at DESC LIMIT @l`, { u: userId, l: limit });
}

/** Where an order is while it still counts as a sale. */
const SALE_STATUSES = ['payment_received', 'processing', 'awaiting_fulfillment', 'completed'];

/**
 * Award coins for a paid order — idempotent: the unique (reason,ref) index means
 * a retried payment never double-awards. €10 → 1 coin (floor).
 *
 * Under the buyer's lock, and only while the order is still a sale: this runs
 * in the background after the payment, and a refund that got there first found
 * nothing to take back — the coins would have landed after it, for good.
 */
export async function awardCoinsForOrder(order) {
  if (!order?.userId) return 0;
  const coins = Math.floor(Number(order.total || 0) / COINS_PER_EURO_CENTS);
  if (coins <= 0) return 0;
  try {
    return await tx(async () => {
      await lockUser(order.userId);
      const live = await get('SELECT status FROM orders WHERE id=@id', { id: order.id });
      if (!SALE_STATUSES.includes(live?.status)) return 0;
      await run(
        `INSERT INTO forge_coin_ledger (id, user_id, delta, reason, ref, created_at)
         VALUES (@id, @u, @d, 'order', @ref, @at)`,
        { id: newId('coin'), u: order.userId, d: coins, ref: order.id, at: nowIso() });
      return coins;
    });
  } catch { return 0; } // unique-index clash = already awarded
}

/**
 * Take back the coins an order earned once it stops being a sale — refunded,
 * charged back, or cancelled after payment. Without this, paying and having
 * the order refunded before delivery left the coins behind, again every round.
 *
 * One negative 'order_reversal' row per order: checked here, and backed by the
 * unique index from migration 063, so a second path undoing the same order
 * takes nothing more. Coins already spent leave the balance below zero — owed,
 * the same as a reversed referral commission. The lock is taken BEFORE looking,
 * the same one the award holds, so an award still in flight is either found
 * here or sees the refund itself and awards nothing.
 */
export async function reverseCoinsForOrder(order) {
  if (!order?.id || !order.userId) return 0;
  try {
    return await tx(async () => {
      await lockUser(order.userId);
      const earned = await get(
        `SELECT user_id, delta FROM forge_coin_ledger WHERE reason='order' AND ref=@o AND delta > 0`, { o: order.id });
      if (!earned) return 0;
      const done = await get(`SELECT 1 AS x FROM forge_coin_ledger WHERE reason='order_reversal' AND ref=@o`, { o: order.id });
      if (done) return 0;
      await run(
        `INSERT INTO forge_coin_ledger (id, user_id, delta, reason, ref, created_at)
         VALUES (@id, @u, @d, 'order_reversal', @ref, @at)`,
        { id: newId('coin'), u: earned.user_id, d: -Number(earned.delta), ref: order.id, at: nowIso() });
      return Number(earned.delta);
    });
  } catch (e) {
    if (e?.code === '23505') return 0;   // the unique index: another path reversed it first
    throw e;
  }
}

/**
 * Spend coins on something other than a Forge Shop reward (e.g. a Forge+
 * membership). Debits inside a transaction so concurrent spends can't overspend.
 */
export async function spendCoins(userId, amount, reason = 'spend', ref = null) {
  const cost = Math.round(Number(amount));
  if (!(cost > 0)) throw badRequest('Invalid coin amount.');
  return tx(async () => {
    await lockUser(userId);
    const balance = await coinBalance(userId);
    if (balance < cost) throw badRequest(`Not enough Forge Coins — you need ${cost}, you have ${balance}.`);
    await run(
      `INSERT INTO forge_coin_ledger (id, user_id, delta, reason, ref, created_at)
       VALUES (@id, @u, @d, @reason, @ref, @at)`,
      { id: newId('coin'), u: userId, d: -cost, reason, ref, at: nowIso() });
    return { balance: await coinBalance(userId) };
  });
}

/** Admin: grant (or deduct) coins. Negative grants never take a balance below 0. */
export async function grantCoins(userId, amount, grantedBy = null) {
  const delta = Math.round(Number(amount));
  if (!delta) throw badRequest('Amount must be a non-zero whole number.');
  return tx(async () => {
    if (delta < 0) {
      await lockUser(userId);
      const balance = await coinBalance(userId);
      if (balance + delta < 0) throw badRequest(`Balance is ${balance} — can't deduct ${-delta}.`);
    }
    // ref stays NULL: the (reason,ref) unique index is for order-earn dedupe
    // and would otherwise block a second grant by the same admin. Attribution
    // lives in the audit log.
    await run(
      `INSERT INTO forge_coin_ledger (id, user_id, delta, reason, ref, created_at)
       VALUES (@id, @u, @d, 'grant', NULL, @at)`,
      { id: newId('coin'), u: userId, d: delta, at: nowIso() });
    return { balance: await coinBalance(userId) };
  });
}

/** Spend coins on a Forge Shop reward. Returns { reward, couponCode? }. */
export async function redeemReward(userId, rewardId) {
  const reward = await findReward(rewardId);
  if (!reward) throw badRequest('Unknown reward.');
  return tx(async () => {
    await lockUser(userId);
    const balance = await coinBalance(userId);
    if (balance < reward.cost) throw badRequest(`Not enough Forge Coins — you need ${reward.cost}, you have ${balance}.`);
    // For coupons, the generated code doubles as the ledger ref so the buyer
    // can always find it back in their history (a toast is easy to miss).
    const code = reward.kind === 'coupon'
      ? `FORGE${Math.random().toString(36).slice(2, 7).toUpperCase()}` : null;
    // Debit first (inside the transaction) so concurrent redeems can't overspend.
    await run(
      `INSERT INTO forge_coin_ledger (id, user_id, delta, reason, ref, created_at)
       VALUES (@id, @u, @d, 'redeem', @ref, @at)`,
      { id: newId('coin'), u: userId, d: -reward.cost, ref: code || reward.id, at: nowIso() });

    if (code) {
      await createCoupon({
        code, kind: reward.couponKind || 'fixed', value: reward.value, perUserLimit: 1, maxRedemptions: 1,
        // The order the code is worth its whole value on — see FORGE_SHOP.
        minSubtotal: reward.minSubtotal || 0,
        active: true, announce: false,
      }, userId);
      return { reward, couponCode: code };
    }
    /* A boost becomes a ROW, not a promise.
       It used to debit the coins and return — nothing was written, no staff
       member was told, and the giveaway keeps its entrants in a Set, so the
       extra entry could not have been honoured even by hand. The coins bought
       nothing. */
    if (reward.kind === 'boost') {
      const boostRef = newId('gbst');
      await run(
        `INSERT INTO giveaway_boosts (id, user_id, source_ref, created_at)
         VALUES (@id, @u, @ref, @at)`,
        { id: boostRef, u: userId, ref: reward.id, at: nowIso() });
      return { reward, boostId: boostRef };
    }
    return { reward };
  });
}

/**
 * Give somebody a boost without charging for it.
 *
 * The paid path debits coins and then writes the row; a milestone has already
 * been earned by other means, so it writes the row alone. Separate function
 * rather than a flag on the paid one, because "charge them or do not" is
 * exactly the sort of parameter that eventually gets passed the wrong way
 * round by a caller that was not thinking about money.
 */
export async function redeemBoostFor(userId, sourceRef = 'granted') {
  const id = newId('gbst');
  await run(
    `INSERT INTO giveaway_boosts (id, user_id, source_ref, created_at)
     VALUES (@id, @u, @ref, @at)`,
    { id, u: userId, ref: sourceRef, at: nowIso() });
  return { boostId: id };
}

/** Unconsumed boosts a member is holding. */
export async function openBoosts(userId) {
  if (!userId) return 0;
  const r = await get(
    `SELECT COUNT(*) AS n FROM giveaway_boosts WHERE user_id=@u AND consumed_at IS NULL`,
    { u: userId });
  return Number(r?.n || 0);
}

/**
 * Claim boosts for a draw — atomically, and once.
 *
 * Takes the entrants of one giveaway and consumes at most one boost each,
 * stamped with that giveaway's id. The stamp is what makes a retry safe: a bot
 * that reconnects mid-draw and asks again gets the boosts it already claimed
 * for THAT giveaway rather than eating a second one, so nobody ends up with two
 * extra entries for one purchase.
 */
export async function claimBoosts(userIds = [], giveawayRef) {
  if (!giveawayRef || !userIds.length) return {};
  return tx(async () => {
    const out = {};
    for (const userId of [...new Set(userIds)]) {
      const already = await all(
        `SELECT id FROM giveaway_boosts WHERE user_id=@u AND consumed_ref=@ref`,
        { u: userId, ref: giveawayRef });
      if (already.length) { out[userId] = already.length; continue; }
      const open = await get(
        `SELECT id FROM giveaway_boosts
          WHERE user_id=@u AND consumed_at IS NULL
          ORDER BY created_at ASC LIMIT 1`, { u: userId });
      if (!open) continue;
      await run(
        `UPDATE giveaway_boosts SET consumed_at=@at, consumed_ref=@ref WHERE id=@id`,
        { at: nowIso(), ref: giveawayRef, id: open.id });
      out[userId] = 1;
    }
    return out;
  });
}

/**
 * Where a member stands, computed once.
 *
 * The account page worked this out in the browser — the next reward, how far
 * off it is, which reward is the best value per coin — and `/balance` in
 * Discord showed a bare number. Two surfaces answering the same question, one
 * of them not answering it, and the arithmetic living in a React component
 * where the bot could not reach it.
 *
 * Here, so both read the same answer and neither can drift from the other.
 */
export async function coinProgress(userId) {
  const [balance, shop, totals, boosts] = await Promise.all([
    coinBalance(userId), forgeShopCatalog(), coinTotals(userId), openBoosts(userId),
  ]);
  const sorted = [...shop].sort((a, b) => a.cost - b.cost);
  const next = sorted.find((r) => r.cost > balance) || null;

  /* Which reward gives the most discount per coin. The €25 card's blurb says
     "best value" in prose; this works it out, so the claim cannot outlive the
     numbers — and it moves on its own when the owner adds an item. A boost has
     no euro value and is left OUT rather than scored zero, which would make it
     the worst by arithmetic on a quantity it does not have. */
  const priced = sorted.filter((r) => r.kind === 'coupon' && r.value > 0 && r.cost > 0);
  const bestValueId = priced.length > 1
    ? priced.reduce((a, b) => (b.value / b.cost > a.value / a.cost ? b : a)).id
    : null;

  return {
    balance, shop: sorted, totals, boosts,
    perCoinCents: COINS_PER_EURO_CENTS,
    bestValueId,
    next: next ? {
      id: next.id, label: next.label, cost: next.cost,
      coinsAway: next.cost - balance,
      /* The same distance in the currency a shopper thinks in. "46 to go" is a
         number nobody can act on; €460 of spending is. */
      spendAwayCents: (next.cost - balance) * COINS_PER_EURO_CENTS,
    } : null,
  };
}

// ── Admin: manage custom Forge Shop items ────────────────────────────────────
export async function listAllShopItems() {
  return all(`SELECT * FROM forge_shop_items ORDER BY created_at DESC`);
}

export async function createShopItem({ label, blurb = null, cost, couponKind = 'fixed', value }) {
  const c = Math.round(Number(cost));
  const v = Math.round(Number(value));
  const kind = couponKind === 'percent' ? 'percent' : 'fixed';
  if (!label?.trim()) throw badRequest('Give the reward a name.');
  if (!(c > 0)) throw badRequest('Cost must be at least 1 coin.');
  if (kind === 'percent' ? !(v > 0 && v <= 90) : !(v > 0)) {
    throw badRequest(kind === 'percent' ? 'Percent must be 1–90.' : 'Value must be above €0.');
  }
  const id = newId('fsi');
  await run(
    `INSERT INTO forge_shop_items (id, label, blurb, cost, coupon_kind, value, active, created_at)
     VALUES (@id, @label, @blurb, @cost, @kind, @value, 1, @at)`,
    { id, label: label.trim().slice(0, 80), blurb: blurb ? String(blurb).slice(0, 160) : null,
      cost: c, kind, value: v, at: nowIso() });
  return get('SELECT * FROM forge_shop_items WHERE id=@id', { id });
}

export async function setShopItemActive(id, active) {
  await run('UPDATE forge_shop_items SET active=@a WHERE id=@id', { a: active ? 1 : 0, id });
  return get('SELECT * FROM forge_shop_items WHERE id=@id', { id });
}

export async function deleteShopItem(id) {
  const r = await run('DELETE FROM forge_shop_items WHERE id=@id', { id });
  return !!r.changes;
}
