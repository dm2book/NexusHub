/**
 * Per-member cooldowns and the daily AI budget.
 *
 * Every AI answer costs real money and every ticket costs a person's time, and
 * none of the commands that spend either had any limit at all: one member
 * holding down enter in #ask-the-bot could run the Anthropic bill up, and a
 * bored one could open a ticket, close it and open another all afternoon.
 *
 * A token bucket rather than a fixed cooldown, because real use is bursty — a
 * member asking three quick follow-ups is normal, the same member asking fifty
 * is not. Pure (no discord.js) so the limits can be tested; bot.js holds the
 * buckets in memory, which is the right place: a restart forgiving everyone's
 * budget is harmless.
 */

/**
 * The budgets. `capacity` requests, refilled evenly over `perMs`.
 * /ask and #ask-the-bot share the `ask` bucket on purpose: they are the same
 * model call reached by two doors.
 */
export const LIMITS = {
  ask: { capacity: 5, perMs: 10 * 60_000 },
  recommend: { capacity: 3, perMs: 10 * 60_000 },
  suggest: { capacity: 2, perMs: 60 * 60_000 },
  poll: { capacity: 2, perMs: 30 * 60_000 },
  order: { capacity: 10, perMs: 10 * 60_000 },
  price: { capacity: 10, perMs: 10 * 60_000 },
  ticket: { capacity: 3, perMs: 60 * 60_000 },
};

export function createLimiter(limits = LIMITS, { now = () => Date.now() } = {}) {
  const buckets = new Map(); // `${name}:${userId}` -> { tokens, at }
  return {
    /**
     * Spend one token. Returns { ok: true } or { ok: false, retryMs } — the
     * wait until the next token, so the reply can say when to come back
     * instead of just "no".
     */
    take(name, userId) {
      const spec = limits[name];
      if (!spec) return { ok: true };
      const key = `${name}:${userId}`;
      const t = now();
      const rate = spec.capacity / spec.perMs; // tokens per ms
      const b = buckets.get(key) || { tokens: spec.capacity, at: t };
      b.tokens = Math.min(spec.capacity, b.tokens + (t - b.at) * rate);
      b.at = t;
      if (b.tokens < 1) {
        buckets.set(key, b);
        return { ok: false, retryMs: Math.ceil((1 - b.tokens) / rate) };
      }
      b.tokens -= 1;
      buckets.set(key, b);
      // Keep the map from growing forever on a busy server.
      if (buckets.size > 5000) {
        for (const [k, v] of buckets) if (t - v.at > 3_600_000) buckets.delete(k);
      }
      return { ok: true };
    },
  };
}

/**
 * At most `cap` AI calls per UTC day, across the whole server.
 *
 * The per-member buckets stop one person; this stops a hundred people, or one
 * person with a hundred accounts. When it is spent the bot answers from the
 * rule-based FAQ and says why, rather than going silent.
 */
export function createDailyCap(cap, { now = () => Date.now() } = {}) {
  const limit = Number.isFinite(Number(cap)) && Number(cap) >= 0 ? Number(cap) : 300;
  let day = null;
  let used = 0;
  const today = () => new Date(now()).toISOString().slice(0, 10);
  return {
    limit,
    /** Claim one call. False when today's budget is gone. */
    take() {
      const d = today();
      if (d !== day) { day = d; used = 0; }
      if (used >= limit) return false;
      used += 1;
      return true;
    },
    get used() { return day === today() ? used : 0; },
  };
}

/**
 * Remember the last `size` ids seen, oldest forgotten first.
 *
 * Used for outbox events the bot has already posted: if the ack to the store
 * fails, the store offers the same event again after its lease, and without
 * this the server would see the same sale ping or restock twice.
 */
export function createRecentIds(size = 500) {
  const seen = new Map();
  return {
    has: (id) => seen.has(String(id)),
    add(id) {
      const k = String(id);
      seen.delete(k);
      seen.set(k, true);
      while (seen.size > size) seen.delete(seen.keys().next().value);
    },
    get size() { return seen.size; },
  };
}

/** Minimum age of a Discord account before it may verify or enter a giveaway. */
export const MIN_ACCOUNT_AGE_MS = 7 * 24 * 60 * 60_000;

/** Is this account old enough? `createdTimestamp` is the user's snowflake time. */
export const accountOldEnough = (createdTimestamp, now = Date.now(), minMs = MIN_ACCOUNT_AGE_MS) =>
  Number.isFinite(createdTimestamp) && now - createdTimestamp >= minMs;
