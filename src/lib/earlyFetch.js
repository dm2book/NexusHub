/**
 * Requests started while the HTML is still parsing, handed to React later.
 *
 * ── The problem, measured ─────────────────────────────────────────────────
 *
 * Every API call this shop makes is issued from inside a `useEffect`, which
 * cannot run until the bundle has downloaded, parsed and executed. On a phone
 * on Slow 4G that is a fixed ~1.4 s of doing nothing before the first byte of
 * *content* is even asked for. The waterfall from a real run:
 *
 *     172 ms   JS + CSS start downloading
 *    1381 ms   the last chunk lands
 *    1400 ms   React mounts, effects run
 *    1420 ms   /api/products is finally requested   ← nothing was waiting on it
 *    1534 ms   the first product image starts
 *    3024 ms   LCP
 *
 * The network sat idle from 1.4 s onward for a request whose URL was known
 * before the page existed. Starting it during HTML parse costs nothing and
 * removes that serialisation entirely.
 *
 * ── Why not <link rel="preload" as="fetch"> ───────────────────────────────
 *
 * Because a preload only matches a later request if the credentials mode
 * matches too, and this app sends `credentials: 'include'` on some calls and
 * not others. A mismatch does not fail loudly — it silently fetches twice,
 * which is worse than not preloading at all. A real `fetch()` whose promise is
 * handed over has no such trap: there is exactly one request and the consumer
 * gets the same one.
 *
 * ── The contract ──────────────────────────────────────────────────────────
 *
 * index.html fills `window.__FM_EARLY` with promises for the routes it knows
 * are coming. This module takes them once, so a second consumer cannot be
 * handed a promise the first one already unwrapped, and a route the shell did
 * not prefetch simply gets null and fetches normally. Nothing here is required
 * for correctness — it only ever removes waiting.
 */

/** Take a prefetched response, or null when the shell did not start one. */
export function takeEarly(key) {
  if (typeof window === 'undefined') return null;
  const bag = window.__FM_EARLY;
  if (!bag || !bag[key]) return null;
  const p = bag[key];
  // Once only: two callers must not both believe they own the result, and a
  // stale promise outliving its route would serve one page's data to another.
  delete bag[key];
  return p;
}

/**
 * Run `fallback` unless the shell already started this request.
 *
 * A rejected early fetch falls back rather than failing the page — the whole
 * point is that this layer can only help.
 */
export function withEarly(key, fallback) {
  const early = takeEarly(key);
  if (!early) return fallback();
  return early.then((v) => (v == null ? fallback() : v)).catch(() => fallback());
}
