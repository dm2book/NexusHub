/**
 * What a product's price history can honestly be said to show.
 *
 * Its own module with no imports, so the server tests can run it. History is
 * GET /api/products/:id/price-history: [{ price, at }], oldest first, one
 * point per price change. A point is the price in effect from its moment
 * until the next point — so a window of time also holds the price that was
 * ALREADY in effect when it opened, the last point before it. The product page
 * used to leave that one out: €6 for weeks, then €10 for a few days, then €8
 * read "Lowest price of the last 30 days" while €6 was asked inside those 30.
 */
const DAY = 86_400_000;

const sorted = (history) => (Array.isArray(history) ? history : [])
  .map((h) => ({ price: Number(h?.price), at: Date.parse(h?.at) }))
  .filter((h) => Number.isFinite(h.price) && Number.isFinite(h.at))
  .sort((a, b) => a.at - b.at);

/* On points already sorted: the price in effect when `from` came, and every one after it before `to`. */
const inEffect = (pts, from, to) => {
  const before = pts.filter((h) => h.at <= from);
  const inside = pts.filter((h) => h.at > from && h.at < to);
  return [...(before.length ? [before[before.length - 1].price] : []), ...inside.map((h) => h.price)];
};

/** Every price in effect at some moment in [from, to) (epoch ms). */
export const pricesInEffect = (history, from, to) => inEffect(sorted(history), from, to);

/* The history has to end on the price on the button; if it does not, it
   cannot speak for that price at all. */
const endsOn = (pts, price) => pts.length > 0 && pts[pts.length - 1].price === Number(price);

/**
 * "Lowest price of the last 30 days": true only when the price now is at or
 * below every price in effect during the last 30 days, and something in that
 * window was higher — an unchanged price is not a low point, it is just a price.
 */
export function isLowestOf30Days(history, price, now = Date.now()) {
  const pts = sorted(history).filter((h) => h.at <= now);
  if (!endsOn(pts, price)) return false;
  const window = inEffect(pts, now - 30 * DAY, now + 1);
  return window.every((p) => p >= Number(price)) && window.some((p) => p > Number(price));
}

/**
 * The prior price a price reduction may be announced against (EU Omnibus rule,
 * Prijzenbesluit art. 6a): the LOWEST price in effect during the 30 days
 * before the current price took effect. Null when the history cannot show one
 * that is higher than today's — and then no reduction is announced, whatever
 * "was" price was typed in by hand.
 */
export function priorPrice(history, price, now = Date.now()) {
  const pts = sorted(history).filter((h) => h.at <= now);
  if (!endsOn(pts, price)) return null;
  // When the current price started: the first point of the run the history ends on.
  let i = pts.length - 1;
  while (i > 0 && pts[i - 1].price === Number(price)) i -= 1;
  const start = pts[i].at;
  const prior = inEffect(pts, start - 30 * DAY, start);
  if (!prior.length) return null;
  const lowest = Math.min(...prior);
  return lowest > Number(price) ? lowest : null;
}
