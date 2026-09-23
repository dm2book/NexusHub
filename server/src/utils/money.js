/** Money helpers. Amounts are integer minor units (cents). */

export function formatMoney(minor, currency = 'EUR') {
  const major = (Number(minor || 0) / 100);
  try {
    return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency}`;
  }
}

/**
 * A money string as cents.
 *
 * Accepts what people actually paste: "€1,23", "1.23", "1,23", " 12 ", "1.234,56"
 * and "1,234.56". The last two are the ambiguous ones, and they are decided by
 * which separator comes LAST — that is the decimal one in both conventions.
 * Anything else returns null rather than a number that looks plausible.
 */
export function parseMoney(raw) {
  let s = String(raw ?? '').trim()
    .replace(/[€$£\s]/g, '')
    .replace(/^"+|"+$/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    /* Whichever is last is the decimal separator; the other groups thousands. */
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    /* A lone comma is a decimal separator here, unless it is grouping three
       digits at the end ("1,234") — in which case reading it as 1.234 would
       turn twelve hundred into one. */
    s = /,\d{3}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
