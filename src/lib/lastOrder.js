/**
 * The last manual order, kept where a phone cannot lose it.
 *
 * The manual pay screen asks the buyer to leave: open Tikkie, switch to their
 * banking app, type an amount and a reference. iOS routinely discards a
 * backgrounded tab and reloads it on return, and the Back gesture is the primary
 * way people navigate a phone. Measured at 390px: after a reload the amount and
 * the reference were both gone and the page read "Nothing to check out".
 *
 * For a shop where payment is matched by hand, that reference IS the order. It
 * is also emailed, but the email may not have arrived yet — and the buyer is
 * standing in their banking app right now.
 *
 * Deliberately narrow: only what the pay screen needs to redraw, only the most
 * recent order, and dropped as soon as the order stops being pending. No
 * personal data beyond the email the buyer just typed themselves.
 */
const KEY = 'fm_last_order';
/** A pending order is worth remembering for a day; after that the email wins. */
const TTL_MS = 24 * 60 * 60 * 1000;

export function rememberOrder(order) {
  if (!order?.number) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), order }));
  } catch { /* private mode / full quota — the URL and the email still carry it */ }
}

/**
 * @param {string|null} wantNumber order number from the URL.
 * @returns the cached order, or null.
 *
 * Returns nothing unless the URL names this exact order — so a stale cache can
 * never hijack a fresh checkout, and never appear under another order's link.
 */
export function recallOrder(wantNumber = null) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { at, order } = JSON.parse(raw);
    if (!order?.number || Date.now() - at > TTL_MS) { localStorage.removeItem(KEY); return null; }
    // The URL is the source of truth; the cache only accelerates it. Without this
    // rule, opening /checkout to buy something NEW would restore the previous
    // order's pay screen instead of a fresh form.
    if (!wantNumber || order.number !== wantNumber) return null;
    return order;
  } catch { return null; }
}

export function forgetOrder() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clean up */ }
}
