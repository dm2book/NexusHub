/**
 * Fraud scoring, and the decision it drives.
 *
 * Every rule contributes a weighted, named signal and the total maps to one of
 * three outcomes. The scoring was already here; what was missing was anything
 * reading the result. An order scored 100, was written to the database as
 * `blocked`, and its codes went out automatically anyway.
 *
 *   ok      deliver normally
 *   review  the order is placed and paid, but NO code leaves the shop until a
 *           person has looked at it
 *   block   refused at checkout, before any money is asked for
 *
 * Why `review` holds the delivery rather than just colouring a row: a digital
 * code is irreversible. Once it is read it cannot be un-read, resold stock is
 * gone, and the chargeback arrives weeks later with nothing to reclaim. A
 * physical shop can stop a parcel; this is the equivalent, and it is the only
 * moment where stopping is still possible.
 *
 * Every rule stays explainable on purpose. A score with no reasons attached is
 * something staff learn to click past, and a buyer whose order is held deserves
 * an answer better than "our system flagged you".
 */
import { config } from '../config/env.js';
import { run, get, all, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { assessIp } from '../utils/netRisk.js';
import { chargebackCountForEmail, chargebackCountForIp } from './chargebackService.js';

/** Countries the shop actually sells into. Anything else is worth a look. */
const HOME_COUNTRIES = new Set(['NL', 'BE', 'DE', 'LU', 'FR', 'AT', 'IE', 'ES', 'IT', 'PT', 'DK', 'SE', 'FI', 'PL']);

const HOUR = 3_600_000;
const DAY = 86_400_000;

const RULES = [
  {
    id: 'high_value',
    weight: 25,
    test: ({ order }) => order.total >= 50_000, // >= €500
    detail: 'Order total is unusually high',
  },
  {
    id: 'velocity',
    weight: 30,
    test: async ({ email }) => {
      const since = new Date(Date.now() - HOUR).toISOString();
      const row = await get('SELECT COUNT(*) AS n FROM orders WHERE email=@e AND created_at>@since',
        { e: email, since });
      return Number(row?.n || 0) >= 3;
    },
    detail: '3+ orders from this email in the last hour',
  },
  {
    id: 'new_account_high_value',
    weight: 20,
    test: ({ order, user }) => {
      if (!user) return order.total >= 20_000; // guest + high value
      const ageMs = Date.now() - new Date(user.created_at).getTime();
      return ageMs < HOUR && order.total >= 20_000;
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
    test: ({ email }) => /@(?:mailinator|guerrillamail|10minutemail|tempmail|trashmail|yopmail|sharklasers|dispostable|maildrop|throwaway|getnada|temp-mail|mohmal|fakeinbox|spamgourmet)\./i.test(email),
    detail: 'Disposable email domain',
  },
  {
    id: 'prior_refunds',
    weight: 20,
    test: async ({ email }) => {
      const row = await get(
        "SELECT COUNT(*) AS n FROM orders WHERE email=@e AND status='refunded'", { e: email });
      return Number(row?.n || 0) >= 2;
    },
    detail: 'Multiple prior refunds for this email',
  },

  // ── Chargebacks ──────────────────────────────────────────────────────────
  // A refund is a decision the shop made. A chargeback is one made against it,
  // and it is the single best predictor there is: someone who has taken money
  // back once has demonstrated both the willingness and the method.
  {
    id: 'prior_chargeback',
    weight: 70,
    test: async ({ email }) => (await chargebackCountForEmail(email)) > 0,
    detail: 'This email has charged back before',
  },
  {
    id: 'chargeback_from_ip',
    // Lower than the email match because addresses are shared and reassigned —
    // but a new email from an address that has charged back is exactly what a
    // repeat attempt looks like.
    weight: 35,
    test: async ({ ip }) => (await chargebackCountForIp(ip)) > 0,
    detail: 'A chargeback has come from this IP address before',
  },

  // ── Network ──────────────────────────────────────────────────────────────
  {
    id: 'hosting_ip',
    weight: 25,
    test: ({ net }) => net?.hosting === true,
    detail: 'Ordered through a VPN, proxy or datacenter connection',
  },
  {
    id: 'ip_velocity',
    weight: 35,
    test: async ({ ip, email }) => {
      if (!ip) return false;
      const since = new Date(Date.now() - DAY).toISOString();
      const row = await get(
        'SELECT COUNT(DISTINCT email) AS n FROM orders WHERE ip=@ip AND created_at>@since AND email<>@e',
        { ip, since, e: email });
      return Number(row?.n || 0) >= 2;
    },
    detail: 'This IP has ordered under other email addresses today',
  },
  {
    id: 'foreign_country',
    weight: 15,
    test: ({ country }) => !!country && !HOME_COUNTRIES.has(country),
    detail: 'Ordered from outside the countries this shop sells to',
  },

  // ── Card testing ─────────────────────────────────────────────────────────
  // A stolen card is tested with small purchases before it is used for a big
  // one, and the failures are the tell: a real buyer whose payment fails twice
  // gives up or emails us, they do not queue up six more attempts.
  {
    id: 'failed_payment_attempts',
    weight: 30,
    test: async ({ email, order }) => {
      const since = new Date(Date.now() - 6 * HOUR).toISOString();
      const row = await get(
        `SELECT COUNT(*) AS n FROM orders
          WHERE email=@e AND id<>@id AND created_at>@since
            AND status IN ('failed','cancelled')`,
        { e: email, id: order?.id || '', since });
      return Number(row?.n || 0) >= 3;
    },
    detail: '3+ failed or cancelled orders from this email in the last 6 hours',
  },
];

/**
 * Score an order.
 *
 * Rules that need the network are given it once, resolved before the loop, so a
 * single DNS lookup covers every rule that asks about the connection instead of
 * one per rule.
 */
export async function scoreOrder({ order, user, email, ip = null, country = null }) {
  const addr = ip || order?.ip || null;
  // Never allowed to fail an order: a scorer that throws on a slow nameserver
  // would take the shop down for the sake of one signal.
  const net = addr
    ? await assessIp(addr).catch(() => null)
    : null;

  const ctx = {
    order, user, ip: addr, country, net,
    email: (email || order?.email || '').toLowerCase(),
  };

  const signals = [];
  let score = 0;
  for (const rule of RULES) {
    let hit = false;
    try { hit = await rule.test(ctx); } catch { hit = false; }
    if (hit) {
      score += rule.weight;
      signals.push({
        rule: rule.id,
        weight: rule.weight,
        // The network rule can say more than its static label, and "why is this
        // order held" is answered far better by the hostname than by a rule id.
        detail: rule.id === 'hosting_ip' && net?.reason ? `${rule.detail} — ${net.reason}` : rule.detail,
      });
    }
  }
  score = Math.min(100, score);

  const decision = score >= config.security.fraudBlockThreshold ? 'block'
    : score >= config.security.fraudReviewThreshold ? 'review' : 'ok';

  if (order?.id) {
    await run(`INSERT INTO fraud_signals (id, order_id, user_id, score, decision, signals, created_at)
         VALUES (@id, @oid, @uid, @score, @dec, @sig, @at)`,
        { id: newId('frd'), oid: order.id, uid: user?.id || null,
          score, dec: decision, sig: JSON.stringify(signals), at: nowIso() })
      .catch((e) => console.error('[fraud] could not record signals:', e.message));
  }
  return { score, decision, signals, net, country };
}

/**
 * A buyer-facing sentence for a held order.
 *
 * Deliberately vague about which rule fired. Telling someone exactly which
 * signal caught them is a free tuning loop for the next attempt — but saying
 * nothing at all reads as a broken shop, so it says what is true: a person is
 * looking, the money is safe, and roughly how long.
 */
export const holdMessage = () =>
  'This order is being checked by a person before it is delivered. '
  + 'Your payment is safe — if we cannot complete the order you get every cent back.';

// ── The review queue ───────────────────────────────────────────────────────

/**
 * Orders waiting on a human.
 *
 * Held orders first, because those are the ones where a buyer is waiting and
 * the delivery is actually stopped. Everything else flagged follows.
 */
export function listFlaggedOrders({ limit = 100 } = {}) {
  return all(
    `SELECT o.id, o.number, o.email, o.total, o.currency, o.status, o.created_at,
            o.fraud_score, o.fraud_status, o.fraud_hold, o.fraud_hold_reason,
            o.fraud_reviewed_at, o.fraud_reviewed_by,
            f.signals
       FROM orders o
       LEFT JOIN LATERAL (
         SELECT signals FROM fraud_signals
          WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1
       ) f ON TRUE
      WHERE o.fraud_hold = 1 OR o.fraud_status IN ('review','block')
      ORDER BY o.fraud_hold DESC, o.created_at DESC
      LIMIT @lim`, { lim: Math.min(limit, 500) });
}

/** How many orders are actually waiting — for the admin nav badge. */
export async function heldOrderCount() {
  const r = await get('SELECT COUNT(*) AS n FROM orders WHERE fraud_hold = 1');
  return Number(r?.n || 0);
}
