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

/* A refund sends real money back through Stripe or Mollie and cannot be
   undone — so it takes the order number, typed, not one stray click. */
export const confirmRefund = (o) => (window.prompt(
  `Terugbetalen: ${money(o.total, o.currency)} voor ${o.number}.\nDit stuurt het geld echt terug en kan niet ongedaan worden.\n\nTyp het bestelnummer om te bevestigen:`,
) || '').trim().toUpperCase() === String(o.number).toUpperCase();
