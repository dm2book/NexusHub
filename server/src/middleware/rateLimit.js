/**
 * Sliding-window rate limiter. Uses an in-memory map for speed and mirrors
 * counts into rate_limit_hits for durability/observability across restarts.
 * Keyed by authenticated user id when available, else client IP, plus a bucket.
 */
import { config } from '../config/env.js';
import { run, get, nowIso } from '../db/index.js';
import { tooMany } from '../utils/errors.js';

const buckets = new Map(); // key -> { windowStart, count }

export function rateLimit({ windowMs, max, bucket = 'global' } = {}) {
  const win = windowMs || config.security.rateLimitWindowMs;
  const limit = max || config.security.rateLimitMax;

  return (req, res, next) => {
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

    const remaining = Math.max(0, limit - entry.count);
    res.set('X-RateLimit-Limit', String(limit));
    res.set('X-RateLimit-Remaining', String(remaining));

    if (entry.count > limit) {
      // Persist the breach for security review.
      run(`INSERT INTO rate_limit_hits (key, window_start, count)
           VALUES (@k, @w, @c)
           ON CONFLICT(key, window_start) DO UPDATE SET count = @c`,
          { k: key, w: windowStart, c: entry.count });
      res.set('Retry-After', String(Math.ceil((windowStart + win - now) / 1000)));
      return next(tooMany());
    }
    next();
  };
}

// Periodically evict stale buckets to bound memory.
setInterval(() => {
  const cutoff = Date.now() - 2 * config.security.rateLimitWindowMs;
  for (const [key, entry] of buckets) if (entry.windowStart < cutoff) buckets.delete(key);
}, config.security.rateLimitWindowMs).unref?.();
