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

const DE_UNITS = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun',
  'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
const DE_TENS = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];
/* In a compound "eins" is "ein": einundzwanzig, einhundert, eintausend. */
const deUnit = (u) => (u === 1 ? 'ein' : DE_UNITS[u]);
function deBelow100(n) {
  if (n < 20) return DE_UNITS[n];
  const t = Math.floor(n / 10), u = n % 10;
  return u ? `${deUnit(u)}und${DE_TENS[t]}` : DE_TENS[t];
}
function deBelow1000(n) {
  if (n < 100) return deBelow100(n);
  const h = Math.floor(n / 100), r = n % 100;
  return `${deUnit(h)}hundert${r ? deBelow100(r) : ''}`;
}
/** 0 … 999 999 in German words: 13500 → "dreizehntausendfünfhundert". */
export function deNumber(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n < 1000) return deBelow1000(n);
  const th = Math.floor(n / 1000), r = n % 1000;
  return `${th === 1 ? 'ein' : deBelow1000(th)}tausend${r ? deBelow1000(r) : ''}`;
}

const FR_UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const FR_TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];
function frBelow100(n) {
  if (n < 20) return FR_UNITS[n];
  const t = Math.floor(n / 10), u = n % 10;
  if (t === 7 || t === 9) {                                   // soixante-dix…, quatre-vingt-dix…
    const base = t === 7 ? 'soixante' : 'quatre-vingt';
    return `${base}${t === 7 && u === 1 ? '-et-' : '-'}${FR_UNITS[10 + u]}`;
  }
  if (t === 8) return u ? `quatre-vingt-${FR_UNITS[u]}` : 'quatre-vingts';
  if (!u) return FR_TENS[t];
  return `${FR_TENS[t]}${u === 1 ? '-et-' : '-'}${FR_UNITS[u]}`;
}
function frBelow1000(n, last = true) {
  if (n < 100) return frBelow100(n);
  const h = Math.floor(n / 100), r = n % 100;
  /* "deux cents", but "deux cent un"; and "deux cent mille", never "cents mille". */
  const cent = h === 1 ? 'cent' : `${FR_UNITS[h]} cent${!r && last ? 's' : ''}`;
  return r ? `${cent} ${frBelow100(r)}` : cent;
}
/** 0 … 999 999 in French words: 13500 → "treize mille cinq cents". */
export function frNumber(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n < 1000) return frBelow1000(n);
  const th = Math.floor(n / 1000), r = n % 1000;
  return `${th === 1 ? '' : `${frBelow1000(th, false)} `}mille${r ? ` ${frBelow1000(r)}` : ''}`;
}

export const LANG_NUMBER = { nl: nlNumber, en: enNumber, de: deNumber, fr: frNumber };
export const number = (n, lang = 'nl') => (LANG_NUMBER[lang] || enNumber)(n);

/**
 * A price in cents, spoken: 999 → "negen euro negenennegentig" /
 * "nine euros ninety-nine" / "neun Euro neunundneunzig" / "neuf euros quatre-vingt-dix-neuf".
 */
export function price(cents, lang = 'nl') {
  const c = Math.round(Number(cents) || 0);
  const e = Math.floor(c / 100), ct = c % 100;
  if (lang === 'nl') return `${nlNumber(e)} euro${ct ? ` ${nlNumber(ct)}` : ''}`;
  if (lang === 'de') return `${e === 1 ? 'ein' : deNumber(e)} Euro${ct ? ` ${deNumber(ct)}` : ''}`;
  if (lang === 'fr') return `${frNumber(e)} euro${e > 1 ? 's' : ''}${ct ? ` ${frNumber(ct)}` : ''}`;
  return `${enNumber(e)} euro${e === 1 ? '' : 's'}${ct ? ` ${enNumber(ct)}` : ''}`;
}

/**
 * A price in cents, written the way each language writes it:
 * "€9,99" (nl), "€9.99" (en), "9,99 €" (de, fr). The space before a trailing
 * € is a no-break space, so the price never splits over two lines or captions.
 */
export const priceText = (cents, lang = 'nl') => {
  const s = (Math.round(Number(cents) || 0) / 100).toFixed(2);
  if (lang === 'en') return `€${s}`;
  if (lang === 'de' || lang === 'fr') return `${s.replace('.', ',')}\u00a0€`;
  return `€${s.replace('.', ',')}`;
};

const LOCALE = { nl: 'nl-NL', en: 'en-GB', de: 'de-DE', fr: 'fr-FR' };
/** A count, written: 13500 → "13.500" (nl, de) / "13,500" (en) / "13 500" (fr, no-break space). */
export const countText = (n, lang = 'nl') => Number(n).toLocaleString(LOCALE[lang] || 'en-GB').replace(/[\u202f\u00a0 ]/g, '\u00a0');

const DOT = { nl: 'punt', en: 'dot', de: 'Punkt', fr: 'point' };
/** The shop's address, spoken. */
export const domain = (lang = 'nl') => `forgemarket ${DOT[lang] || 'dot'} n l`;

/** Any address, spoken: "forgemarket.nl/refunds" → "forgemarket punt n l slash refunds". */
export function spokenSite(s, lang = 'nl') {
  return String(s)
    .replace(/vbuckscard/gi, 'V-Bucks card')
    .replace(/\.nl\b/g, ` ${DOT[lang] || 'dot'} n l`).replace(/\.com\b/g, ` ${DOT[lang] || 'dot'} com`)
    .replace(/\//g, ' slash ')
    .replace(/\s+/g, ' ').trim();
}

/* ── English words in a Dutch voice-over ──────────────────────────────────
   A Dutch voice reads "ForgeMarket" with a Dutch G (fˈɔrɣə…) and "V-Bucks"
   as "vee-buks". Each brand word here has its English pronunciation twice:
     ipa      exact English phonemes, for engines that take [[ phonemes ]]
              (Piper on a server); measured with espeak en-us
     respell  a Dutch spelling that a Dutch phonemizer turns into nearly the
              same sounds, for engines that only take text (Piper in the
              browser); each checked against espeak nl
   Premium voices (ElevenLabs, OpenAI) are multilingual and get the text as is. */
export const ENGLISH_TERMS = [
  { re: /\bforge\s?market\b/gi, ipa: 'fˈɔːɹdʒ mˈɑːɹkɪt', respell: 'Fordsjmarkit' },
  { re: /\blink in bio\b/gi, ipa: 'lˈɪŋk ɪn bˈaɪoʊ', respell: 'Link in bai-oo' },
  { re: /\bgift ?card\b/gi, ipa: 'ɡˈɪft kˈɑːɹd', respell: 'Gift kaard' },
  { re: /\bv-?bucks\b/gi, ipa: 'vˈiː bˈʌks', respell: 'Viebaks' },
  { re: /\broblox\b/gi, ipa: 'ɹˈoʊblɑːks', respell: 'Rooblaks' },
  { re: /\brobux\b/gi, ipa: 'ɹˈoʊbʌks', respell: 'Roobaks' },
  { re: /\bsteam\b/gi, ipa: 'stˈiːm', respell: 'Stiem' },
  { re: /\bwallet\b/gi, ipa: 'wˈɔlɪt', respell: 'Wollit' },
  { re: /\bdiscord\b/gi, ipa: 'dˈɪskɔːɹd', respell: 'Diskord' },
  { re: /\bnitro\b/gi, ipa: 'nˈaɪtɹoʊ', respell: 'Naitro' },
  { re: /\bfortnite\b/gi, ipa: 'fˈɔːɹtnaɪt', respell: 'Fortnait' },
  { re: /\bminecraft\b/gi, ipa: 'mˈaɪŋkɹæft', respell: 'Mainkraft' },
  { re: /\bgems\b/gi, ipa: 'dʒˈɛmz', respell: 'Djems' },
  { re: /\bcoins\b/gi, ipa: 'kˈɔɪnz', respell: 'Kojns' },
  { re: /\bpoints\b/gi, ipa: 'pˈɔɪnts', respell: 'Pojnts' },
  { re: /\bdiamonds\b/gi, ipa: 'dˈaɪəməndz', respell: 'Daajmonds' },
];

/**
 * The text a voice engine should be given for `text`.
 *   mode 'phonemes'  English words as [[ IPA ]] (Piper with phoneme input)
 *   mode 'respell'   English words respelt for a Dutch phonemizer
 *   mode 'plain'     unchanged (multilingual premium voices, English voices)
 */
export function forVoice(text, lang = 'nl', mode = 'plain') {
  /* English needs nothing. The IPA works for any voice that takes phonemes;
     the respellings are Dutch spellings, so only a Dutch voice gets them. */
  if (lang === 'en' || mode === 'plain' || (mode === 'respell' && lang !== 'nl')) return String(text || '');
  let out = String(text || '');
  for (const t of ENGLISH_TERMS) out = out.replace(t.re, mode === 'phonemes' ? `[[ ${t.ipa} ]]` : t.respell);
  return out;
}
