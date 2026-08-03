/**
 * Sliding-window rate limiter, keyed by user id when there is one and by IP
 * otherwise, plus a bucket name so each route gets its own budget.
 *
 * Two tiers, because the two jobs are genuinely different:
 *
 *  MEMORY (default) — a counter in this process. Instant, free, and the right
 *  tool for what rate limiting is mostly for: stopping one client hammering one
 *  server. It does have a real hole on serverless, where each cold instance
 *  starts with an empty map, so an attacker who lands on ten instances gets ten
 *  budgets. For a browse endpoint that is a fair trade.
 *
 *  SHARED (`shared: true`) — the same window counted in Postgres, so every
 *  instance sees one total. Costs a round trip per request, which is why it is
 *  opt-in rather than the default, and it is reserved for the routes where the
 *  hole above actually costs money: placing orders, starting payments, logging
 *  in. On those, "twenty attempts a minute" has to mean twenty, not twenty per
 *  instance that happens to be warm.
 *
 * The shared counter fails OPEN. If the database is unreachable the request is
 * allowed through on the in-memory count alone — a shop that stops taking orders
 * because a rate-limit table is unavailable has turned a nuisance into an
 * outage.
 */
import { config } from '../config/env.js';
import { run, get, all } from '../db/index.js';
import { tooMany } from '../utils/errors.js';

const buckets = new Map(); // key -> { windowStart, count }

export function rateLimit({ windowMs, max, bucket = 'global', shared = false } = {}) {
  const win = windowMs || config.security.rateLimitWindowMs;
  const limit = max || config.security.rateLimitMax;

  return async (req, res, next) => {
    const id = req.user?.id || req.ip || 'anon';
    const key = `${bucket}:${id}`;
    const now = Date.now();
    const windowStart = now - (now % win);

    let entry = buckets.get(key);
    if (!entry || entry.windowStart !== windowStart) {
      entry = { windowStart, count: 0 };
      buckets.set(key, entry);
    }
    entry.count++;

    let count = entry.count;

    if (shared) {
      try {
        // One statement: increment and read back the shared total. Two
        // statements would let concurrent requests both read the old value and
        // both be allowed through — exactly the race this is here to prevent.
        const row = await get(
          `INSERT INTO rate_limit_hits (key, window_start, count)
                VALUES (@k, @w, 1)
           ON CONFLICT (key, window_start)
                DO UPDATE SET count = rate_limit_hits.count + 1
             RETURNING count`,
          { k: key, w: windowStart });
        if (row?.count) count = Math.max(count, Number(row.count));
      } catch (e) {
        // Fail open, loudly. The in-memory count still applies.
        console.error('[ratelimit] shared counter unavailable:', e.message);
      }
    }

    const remaining = Math.max(0, limit - count);
    res.set('X-RateLimit-Limit', String(limit));
    res.set('X-RateLimit-Remaining', String(remaining));

    if (count > limit) {
      if (!shared) {
        // Already recorded above when shared. Best-effort; never blocks.
        run(`INSERT INTO rate_limit_hits (key, window_start, count)
             VALUES (@k, @w, @c)
             ON CONFLICT(key, window_start) DO UPDATE SET count = @c`,
            { k: key, w: windowStart, c: count }).catch(() => {});
      }
      res.set('Retry-After', String(Math.ceil((windowStart + win - now) / 1000)));
      return next(tooMany());
    }
    next();
  };
}

/**
 * Which keys have breached their limit recently — the raw material for spotting
 * a scripted attack, which shows up as one key across many buckets long before
 * any single order looks suspicious.
 */
export async function recentAbuse({ minutes = 60, limit = 50 } = {}) {
  const since = Date.now() - minutes * 60_000;
  return all(
    `SELECT key, SUM(count) AS hits, MAX(window_start) AS last_seen
       FROM rate_limit_hits WHERE window_start > @since
      GROUP BY key ORDER BY hits DESC LIMIT @lim`,
    { since, lim: limit });
}

// Periodically evict stale buckets to bound memory.
setInterval(() => {
  const cutoff = Date.now() - 2 * config.security.rateLimitWindowMs;
  for (const [key, entry] of buckets) if (entry.windowStart < cutoff) buckets.delete(key);
}, config.security.rateLimitWindowMs).unref?.();
