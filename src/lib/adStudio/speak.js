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
  if (lang !== 'nl' || mode === 'plain') return String(text || '');
  let out = String(text || '');
  for (const t of ENGLISH_TERMS) out = out.replace(t.re, mode === 'phonemes' ? `[[ ${t.ipa} ]]` : t.respell);
  return out;
}
