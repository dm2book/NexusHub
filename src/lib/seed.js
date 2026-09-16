/**
 * Data baked into the HTML at build time, so the first paint needs no network.
 *
 * ── What this is for ──────────────────────────────────────────────────────
 *
 * earlyFetch already starts the catalogue request while the HTML is parsing,
 * which removes the wait for React to boot before ASKING. It cannot remove the
 * request itself: the shelves still cannot paint until a round trip to a
 * serverless function and a database in another datacentre comes back. On a
 * phone that is most of the second a visitor spends looking at nothing.
 *
 * The catalogue is small, changes rarely, and is already known at build time.
 * So it is written into the HTML, the shelves paint from the first byte, and
 * the live request still runs and replaces it — usually before anyone notices
 * there were two versions.
 *
 * ── Why this is safe to show before it is confirmed ───────────────────────
 *
 * Because nothing here is ever acted on. The server prices every order from
 * its own row (orderService: `const unit = product.price`) and refuses one for
 * a product that is inactive or out of stock. A seeded price that has since
 * changed is a wrong LABEL for a few hundred milliseconds, corrected by the
 * live fetch, and it can never become a wrong charge.
 *
 * ── Why it never breaks anything when it is missing ───────────────────────
 *
 * A build with no database produces no seed, and every caller falls back to
 * exactly what it did before. Same for an old cached HTML file, a browser that
 * blocked the inline script, or a route that was never seeded. This layer can
 * only ever remove waiting.
 */

/**
 * Read a seeded value, synchronously, at first render.
 *
 * Synchronous is the whole point: a promise, however fast, still costs a paint
 * where the page has nothing in it. This has to be readable in a useState
 * initialiser.
 */
export function readSeed(key) {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.__FM_SEED?.[key];
    return v == null ? null : v;
  } catch {
    /* A page that cannot read its own inline data is a page that fetches, not
       a page that crashes. */
    return null;
  }
}

/** How old the seed is, in ms, or null when there is none. */
export function seedAge() {
  const at = readSeed('builtAt');
  if (!at) return null;
  const t = Date.parse(at);
  return Number.isFinite(t) ? Date.now() - t : null;
}
