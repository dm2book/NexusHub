/* Same cache, same reason, as src/lib/catalog.js — this copy is the one the
   admin pages use, and a table of two hundred orders builds two hundred
   formatters without it. */
const FORMATTERS = new Map();
const formatter = (cur) => {
  let f = FORMATTERS.get(cur);
  if (!f) {
    f = new Intl.NumberFormat('en-IE', { style: 'currency', currency: cur });
    FORMATTERS.set(cur, f);
  }
  return f;
};

export const money = (cents, cur = 'EUR') => formatter(cur).format((cents || 0) / 100);

export const date = (iso) => (iso ? new Date(iso).toLocaleString() : '—');
export const dateShort = (iso) => (iso ? new Date(iso).toLocaleDateString() : '—');
