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
 *  €1 of discount or you give margin away. */
export const FORGE_SHOP = [
  { id: 'coupon5', kind: 'coupon', cost: 15, value: 500, label: '€5 discount code', blurb: '€5 off your next order.' },
  { id: 'coupon10', kind: 'coupon', cost: 28, value: 1000, label: '€10 discount code', blurb: '€10 off your next order — saves you a coin.' },
  { id: 'coupon25', kind: 'coupon', cost: 65, value: 2500, label: '€25 discount code', blurb: '€25 off any order — best value.' },
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
  const r = await get(
    `SELECT COALESCE(SUM(delta) FILTER (WHERE delta > 0), 0) AS earned,
            COALESCE(SUM(-delta) FILTER (WHERE delta < 0), 0) AS spent
       FROM forge_coin_ledger WHERE user_id = @u`, { u: userId });
  return { earned: Number(r?.earned || 0), spent: Number(r?.spent || 0) };
}

export function coinHistory(userId, limit = 20) {
  return all(
    `SELECT delta, reason, ref, created_at AS "createdAt" FROM forge_coin_ledger
      WHERE user_id=@u ORDER BY created_at DESC LIMIT @l`, { u: userId, l: limit });
}

/**
 * Award coins for a paid order — idempotent: the unique (reason,ref) index means
 * a retried payment never double-awards. €10 → 1 coin (floor).
 */
export async function awardCoinsForOrder(order) {
  if (!order?.userId) return 0;
  const coins = Math.floor(Number(order.total || 0) / COINS_PER_EURO_CENTS);
  if (coins <= 0) return 0;
  try {
    await run(
      `INSERT INTO forge_coin_ledger (id, user_id, delta, reason, ref, created_at)
       VALUES (@id, @u, @d, 'order', @ref, @at)`,
      { id: newId('coin'), u: order.userId, d: coins, ref: order.id, at: nowIso() });
    return coins;
  } catch { return 0; } // unique-index clash = already awarded
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
