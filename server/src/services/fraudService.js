/**
 * Lightweight, explainable fraud scoring run at order placement.
 *
 * Rather than a black box, each rule contributes a weighted signal; the total
 * score maps to a decision (ok | review | block) using configurable thresholds.
 * Signals are persisted to fraud_signals for review and audit.
 */
import { config } from '../config/env.js';
import { run, get, all, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';

const RULES = [
  {
    id: 'high_value',
    weight: 25,
    test: ({ order }) => order.total >= 50_000, // >= 500.00
    detail: 'Order total is unusually high',
  },
  {
    id: 'velocity',
    weight: 30,
    test: ({ email }) => {
      const since = new Date(Date.now() - 3600_000).toISOString();
      const n = get(`SELECT COUNT(*) AS n FROM orders WHERE email=@e AND created_at>@since`,
        { e: email, since }).n;
      return n >= 3;
    },
    detail: '3+ orders from this email in the last hour',
  },
  {
    id: 'new_account_high_value',
    weight: 20,
    test: ({ order, user }) => {
      if (!user) return order.total >= 20_000; // guest + high value
      const ageMs = Date.now() - new Date(user.created_at).getTime();
      return ageMs < 3600_000 && order.total >= 20_000;
    },
    detail: 'High-value order on a brand-new / guest account',
  },
  {
    id: 'email_mismatch',
    weight: 15,
    test: ({ order }) => {
      const billingEmail = order.billing?.email;
      return billingEmail && billingEmail.toLowerCase() !== order.email.toLowerCase();
    },
    detail: 'Billing email differs from account email',
  },
  {
    id: 'disposable_email',
    weight: 20,
    test: ({ email }) => /@(?:mailinator|guerrillamail|10minutemail|tempmail|trashmail)\./i.test(email),
    detail: 'Disposable email domain',
  },
  {
    id: 'prior_chargeback',
    weight: 40,
    test: ({ email }) => get(
      `SELECT COUNT(*) AS n FROM orders WHERE email=@e AND status='refunded'`,
      { e: email }).n >= 2,
    detail: 'Multiple prior refunds for this email',
  },
];

/** Evaluate fraud rules for an order context. Returns {score, decision, signals}. */
export function scoreOrder({ order, user, email }) {
  const ctx = { order, user, email: (email || order.email || '').toLowerCase() };
  const signals = [];
  let score = 0;
  for (const rule of RULES) {
    let hit = false;
    try { hit = rule.test(ctx); } catch { hit = false; }
    if (hit) {
      score += rule.weight;
      signals.push({ rule: rule.id, weight: rule.weight, detail: rule.detail });
    }
  }
  score = Math.min(100, score);
  const decision = score >= config.security.fraudBlockThreshold ? 'block'
    : score >= config.security.fraudReviewThreshold ? 'review' : 'ok';

  if (order?.id) {
    run(`INSERT INTO fraud_signals (id, order_id, user_id, score, decision, signals, created_at)
         VALUES (@id, @oid, @uid, @score, @dec, @sig, @at)`,
        { id: newId('frd'), oid: order.id, uid: user?.id || null,
          score, dec: decision, sig: JSON.stringify(signals), at: nowIso() });
  }
  return { score, decision, signals };
}

export function listFlaggedOrders() {
  return all(`SELECT o.*, f.score AS fraud_score_latest, f.signals
                FROM orders o
                JOIN fraud_signals f ON f.order_id = o.id
               WHERE f.decision IN ('review','block')
               ORDER BY o.created_at DESC LIMIT 100`);
}
