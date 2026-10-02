/**
 * Numbers and prices, as a voice should say them.
 *
 * A text-to-speech engine reads "€9,99" as "euro nine comma nine nine" or
 * skips the sign, and "13.500" as "thirteen point five". So every number a
 * voice-over speaks is written out here first — in Dutch with Dutch rules
 * (eenentwintig, tweeëntwintig, dertienduizend vijfhonderd) and in English.
 *
 * Shared by the server (which writes the voice lines) and the browser (which
 * shows them as captions), so the caption and the voice never disagree.
 */

const NL_UNITS = ['nul', 'een', 'twee', 'drie', 'vier', 'vijf', 'zes', 'zeven', 'acht', 'negen',
  'tien', 'elf', 'twaalf', 'dertien', 'veertien', 'vijftien', 'zestien', 'zeventien', 'achttien', 'negentien'];
const NL_TENS = ['', '', 'twintig', 'dertig', 'veertig', 'vijftig', 'zestig', 'zeventig', 'tachtig', 'negentig'];

function nlBelow100(n) {
  if (n < 20) return NL_UNITS[n];
  const t = Math.floor(n / 10), u = n % 10;
  if (!u) return NL_TENS[t];
  /* twee + en + twintig → tweeëntwintig: the diaeresis when the unit ends in e. */
  const unit = NL_UNITS[u];
  return `${unit}${unit.endsWith('e') ? 'ën' : 'en'}${NL_TENS[t]}`;
}
function nlBelow1000(n) {
  if (n < 100) return nlBelow100(n);
  const h = Math.floor(n / 100), r = n % 100;
  return `${h === 1 ? '' : NL_UNITS[h]}honderd${r ? nlBelow100(r) : ''}`;
}
/** 0 … 999 999 in Dutch words. */
export function nlNumber(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n < 1000) return nlBelow1000(n);
  const th = Math.floor(n / 1000), r = n % 1000;
  /* "duizend", not "eenduizend"; the rest after a space reads naturally. */
  return `${th === 1 ? '' : nlBelow1000(th)}duizend${r ? ` ${nlBelow1000(r)}` : ''}`;
}

const EN_UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function enBelow1000(n) {
  const h = Math.floor(n / 100), r = n % 100;
  const tail = r < 20 ? (r || h ? (r ? EN_UNITS[r] : '') : 'zero')
    : `${EN_TENS[Math.floor(r / 10)]}${r % 10 ? `-${EN_UNITS[r % 10]}` : ''}`;
  return [h ? `${EN_UNITS[h]} hundred` : '', tail].filter(Boolean).join(' ');
}
/** 0 … 999 999 in English words. */
export function enNumber(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n < 1000) return enBelow1000(n);
  const th = Math.floor(n / 1000), r = n % 1000;
  return `${enBelow1000(th)} thousand${r ? ` ${enBelow1000(r)}` : ''}`;
}

export const number = (n, lang = 'nl') => (lang === 'nl' ? nlNumber(n) : enNumber(n));

/** A price in cents, spoken: 999 → "negen euro negenennegentig" / "nine euros ninety-nine". */
export function price(cents, lang = 'nl') {
  const c = Math.round(Number(cents) || 0);
  const e = Math.floor(c / 100), ct = c % 100;
  if (lang === 'nl') return `${nlNumber(e)} euro${ct ? ` ${nlNumber(ct)}` : ''}`;
  return `${enNumber(e)} euro${e === 1 ? '' : 's'}${ct ? ` ${enNumber(ct)}` : ''}`;
}

/** A price in cents, written: 999 → "€9,99" (nl) / "€9.99" (en). */
export const priceText = (cents, lang = 'nl') => {
  const s = (Math.round(Number(cents) || 0) / 100).toFixed(2);
  return `€${lang === 'nl' ? s.replace('.', ',') : s}`;
};

/** A count, written: 13500 → "13.500" (nl) / "13,500" (en). */
export const countText = (n, lang = 'nl') => Number(n).toLocaleString(lang === 'nl' ? 'nl-NL' : 'en-GB');

/** The shop's address, spoken. */
export const domain = (lang = 'nl') => (lang === 'nl' ? 'forgemarket punt n l' : 'forgemarket dot n l');
