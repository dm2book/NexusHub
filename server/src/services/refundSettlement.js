/**
 * Applying a refund that has already happened at the payment provider.
 *
 * `transitionOrder` guards its UPDATE on the status it observed, so a caller
 * that loses a race gets the order back unchanged rather than an error. That is
 * the right behaviour — it is what stops an order being dispensed or emailed
 * twice — but for a refund it is dangerous to ignore: the money really has gone
 * back, and this is the only thing that records it.
 *
 * A refund webhook arriving while auto-dispense is still completing the order is
 * exactly that race, and it is not hypothetical: it fires whenever a payment is
 * refunded seconds after it settled. Every status that can still reach
 * `refunded` is re-read and retried, so the loser of one race wins the next.
 *
 * ── WHY IT LIVES HERE ─────────────────────────────────────────────────────
 * Mollie has had this since its webhook was written. Stripe's webhook handled
 * one event type and none of this, so a card refunded in the Stripe dashboard
 * left the order sitting at `completed` — the buyer has their money and their
 * code, and the shop believes it sold something. Giving Stripe its own copy
 * would have made two, and the two would have drifted the way every duplicated
 * routine in this codebase has: one gets the retry fix, the other keeps losing
 * the race.
 */
import { transitionOrder } from './orderService.js';

/* Retrying instantly loses to the same background step every time — the
   fulfilment pipeline is mid-flight, not finished. A short, widening pause lets
   it land so the refund can be applied on top of a settled order. */
export const REFUND_BACKOFF_MS = [0, 120, 350, 900];

/** Statuses from which `refunded` is unreachable, so retrying is pointless. */
const TERMINAL = ['cancelled', 'failed'];

export async function settleAsRefunded(orderId, reason, {
  actorId = 'psp', backoff = REFUND_BACKOFF_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  for (const wait of backoff) {
    if (wait) await sleep(wait);
    const result = await transitionOrder(orderId, 'refunded', { actorId, reason })
      .catch((e) => { console.warn(`[${actorId}] refund transition: ${e.message}`); return null; });
    if (result?.status === 'refunded') return true;
    if (result && TERMINAL.includes(result.status)) return false;
  }
  return false;
}
