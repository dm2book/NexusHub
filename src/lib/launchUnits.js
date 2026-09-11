/**
 * Which parts of a countdown are worth putting on screen.
 *
 * Its own module, with no imports at all, for the same reason legalIdentity.js
 * is one: the hook that produces the breakdown pulls in React and a .jsx
 * dictionary, and nothing in server/test can load either. A rule that cannot be
 * tested is a rule that drifts, and this one is a judgement about what a
 * visitor should be reading.
 */
/**
 * Which units are worth showing, largest first, at most three.
 *
 * Four boxes counting down to the second made the banner read as a sale timer:
 * at twelve days out the seconds digit is the loudest thing on the page and the
 * least useful, and the DATE is what a visitor actually needs to keep. Under an
 * hour the seconds are the only thing that matters, so they appear then.
 *
 * Returns [] when there is nothing left, which is also when the banner goes.
 */
export const UNITS = ['days', 'hours', 'minutes', 'seconds'];

export function visibleUnits(remaining) {
  if (!remaining) return [];
  const first = UNITS.findIndex((u) => remaining[u] > 0);
  // All zero means under a second — show the seconds rather than nothing.
  return UNITS.slice(first < 0 ? UNITS.length - 1 : first).slice(0, 3);
}
