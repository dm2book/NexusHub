/**
 * Store credit / wallet. An append-only ledger (credit_transactions): a user's
 * balance is the SUM of their signed amounts. Every entry stores the running
 * balance so a statement is exact and auditable. All mutations go through
 * `addEntry`, which is transaction-safe (locks the user's rows while computing
 * the new balance) so concurrent credits/debits can't race.
 */
import { run, get, all, nowIso, tx } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { badRequest } from '../utils/errors.js';

export const TX_TYPES = ['referral', 'refund', 'grant', 'spend', 'adjustment', 'mystery_prize'];

/** Current balance in cents (0 if no entries). */
export async function balanceOf(userId) {
  const r = await get('SELECT COALESCE(SUM(amount),0) AS bal FROM credit_transactions WHERE user_id=@u', { u: userId });
  return Number(r?.bal || 0);
}

/**
 * Append a ledger entry. `amount` is signed (positive = credit, negative =
 * debit). Debits cannot take the balance below zero. Returns the entry.
 */
export async function addEntry({ userId, amount, type, description, orderId = null, createdBy = null, tag = null }) {
  const amt = Math.round(Number(amount));
  if (!userId || !amt) throw badRequest('A wallet entry needs a user and a non-zero amount');
  if (!TX_TYPES.includes(type)) throw badRequest(`Unknown wallet transaction type: ${type}`);
  return tx(async () => {
    // Serialize concurrent wallet writes for this user by locking their user row
    // (Postgres forbids FOR UPDATE with an aggregate, so we lock here then sum).
    await get('SELECT id FROM users WHERE id=@u FOR UPDATE', { u: userId });
    // One-time tagged grants are idempotent.
    if (tag) {
      const dupe = await get('SELECT id FROM credit_transactions WHERE user_id=@u AND tag=@t', { u: userId, t: tag });
      if (dupe) return { id: dupe.id, deduped: true };
    }
    const cur = await get(
      'SELECT COALESCE(SUM(amount),0) AS bal FROM credit_transactions WHERE user_id=@u', { u: userId });
    const balance = Number(cur?.bal || 0);
    if (amt < 0 && balance + amt < 0) throw badRequest('Insufficient store credit');
    const after = balance + amt;
    const id = newId('ctx');
    const at = nowIso();
    await run(
      `INSERT INTO credit_transactions (id, user_id, amount, balance_after, type, description, order_id, created_by, tag, created_at)
       VALUES (@id, @u, @amt, @after, @type, @desc, @oid, @by, @tag, @at)`,
      { id, u: userId, amt, after, type, desc: description || null, oid: orderId, by: createdBy, tag, at });
    return { id, amount: amt, balanceAfter: after, type, description, orderId, createdAt: at };
  });
}

/** Has this user already received a one-time tagged grant? */
export async function hasUserGrant(userId, tag) {
  if (!userId || !tag) return false;
  const r = await get('SELECT id FROM credit_transactions WHERE user_id=@u AND tag=@t LIMIT 1', { u: userId, t: tag });
  return !!r;
}

/** Convenience helpers. */
export const credit = (userId, amount, type, description, opts = {}) =>
  addEntry({ userId, amount: Math.abs(amount), type, description, ...opts });
export const debit = (userId, amount, type, description, opts = {}) =>
  addEntry({ userId, amount: -Math.abs(amount), type, description, ...opts });

/** Has this order already produced an entry of `type`? (idempotency guard) */
export async function hasOrderEntry(orderId, type) {
  if (!orderId) return false;
  const r = await get('SELECT id FROM credit_transactions WHERE order_id=@o AND type=@t LIMIT 1', { o: orderId, t: type });
  return !!r;
}

export async function listTransactions(userId, { limit = 50 } = {}) {
  return all(
    `SELECT id, amount, balance_after AS "balanceAfter", type, description, order_id AS "orderId", created_at AS "createdAt"
       FROM credit_transactions WHERE user_id=@u ORDER BY created_at DESC LIMIT @limit`,
    { u: userId, limit: Math.min(200, Math.max(1, limit)) });
}

/** Wallet summary for the dashboard: balance + lifetime earned/spent + history. */
export async function walletSummary(userId) {
  const agg = await get(
    `SELECT
        COALESCE(SUM(amount),0) AS balance,
        COALESCE(SUM(amount) FILTER (WHERE amount > 0),0) AS earned,
        COALESCE(-SUM(amount) FILTER (WHERE amount < 0),0) AS spent
       FROM credit_transactions WHERE user_id=@u`, { u: userId });
  return {
    balance: Number(agg?.balance || 0),
    lifetimeEarned: Number(agg?.earned || 0),
    lifetimeSpent: Number(agg?.spent || 0),
    transactions: await listTransactions(userId, { limit: 50 }),
  };
}
