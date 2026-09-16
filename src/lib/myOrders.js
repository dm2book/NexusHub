/**
 * The order numbers placed on this device.
 *
 * Checkout here is guest-first: no account is needed, and most buyers do not
 * make one. Their order number therefore lives in exactly two places — the URL
 * they were redirected to, and the confirmation email. Close the tab, and the
 * only way back to "where is my order" is to find that email.
 *
 * The track page assumed they still had the number. It is a heading, a line of
 * text and an input box: eight words for a page people open precisely because
 * something is unclear, and nothing at all for someone who no longer has the
 * one thing it asks for.
 *
 * Deliberately not lastOrder.js. That one holds a whole pending order for a day
 * so the manual pay screen can redraw itself after iOS discards the tab, and
 * drops it the moment the order stops being pending. This is the opposite: the
 * numbers only, kept for months, precisely so an order the buyer has stopped
 * thinking about is still findable.
 *
 * Numbers only — no email, no total, no items. An order number by itself is
 * what the buyer already has in their URL bar and their inbox, and the lookup
 * it opens is the same public one anyone holding that number can already use.
 * Nothing here is worth stealing that the address bar did not already show.
 */
const KEY = 'fm_my_orders';
/** Long enough to outlive the question "did I ever buy this?". */
const TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** More than this and it stops being a shortcut and becomes a list to read. */
const MAX = 6;

const read = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    const now = Date.now();
    return raw
      .filter((e) => e && typeof e.number === 'string' && now - (e.at || 0) < TTL_MS)
      .slice(0, MAX);
  } catch { return []; } // private mode, blocked storage, or someone else's JSON
};

const write = (list) => {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); }
  catch { /* the email still has it */ }
};

/** Newest first, capped, deduped. */
export function rememberMyOrder(number) {
  const n = String(number || '').trim().toUpperCase();
  if (!n) return;
  const list = read().filter((e) => e.number !== n);
  write([{ number: n, at: Date.now() }, ...list]);
}

/** @returns {string[]} order numbers placed on this device, newest first. */
export function myOrders() {
  return read().map((e) => e.number);
}

/** For the buyer who wants it gone — their device, their list. */
export function forgetMyOrder(number) {
  const n = String(number || '').trim().toUpperCase();
  write(read().filter((e) => e.number !== n));
}
