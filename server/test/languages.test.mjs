/**
 * The storefront speaks more than two languages, and says so honestly.
 *
 * It used to be a hardcoded pair. `lang === 'nl' ? NL[key] : en` in four
 * places, an EN⇄NL toggle with no way to reach a third, and a stored value
 * validated against exactly two strings — so adding a language meant editing
 * every place that asked "is this Dutch?" rather than adding a file.
 *
 * What this pins is the part that quietly rots: that every language has every
 * key, that no two languages accidentally share a string, and that the things
 * deliberately NOT translated stay that way for a stated reason.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { LANGUAGES, LANG_CODES, localeOf } = await import(join(ROOT, 'src/lib/i18n/registry.js'));
const DE = (await import(join(ROOT, 'src/lib/i18n/de.js'))).default;
const FR = (await import(join(ROOT, 'src/lib/i18n/fr.js'))).default;

const i18n = read('src/lib/i18n.jsx');
const nlBlock = i18n.slice(i18n.indexOf('const NL = {'), i18n.indexOf('const LanguageContext'));
const NL_KEYS = [...nlBlock.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]);
const NON_LEGAL = NL_KEYS.filter((k) => !k.startsWith('legal.'));

console.log('— More than two languages —');
{
  ok('the shop offers more than Dutch and English', LANG_CODES.length > 2, LANG_CODES.join(','));
  ok('…and they are the ones its payment methods and shipping region support',
    ['nl', 'en', 'de', 'fr'].every((c) => LANG_CODES.includes(c)), LANG_CODES.join(','));
  ok('every language names itself in its own language',
    LANGUAGES.every((l) => l.label && l.short && l.locale));
  ok('each carries a real BCP-47 locale for dates and money',
    LANGUAGES.every((l) => /^[a-z]{2}-[A-Z]{2}$/.test(l.locale)), LANGUAGES.map((l) => l.locale).join(','));
  ok('localeOf falls back rather than returning undefined', localeOf('zz') === 'en-GB');
}

console.log('\n— Nothing is half-translated —');
{
  /* An unknown key falls back to English, so a gap renders an English line on a
     German page. That is safe, and it is also exactly the kind of thing nobody
     notices until a buyer does. */
  for (const [code, dict] of [['de', DE], ['fr', FR]]) {
    const missing = NON_LEGAL.filter((k) => !dict[k]);
    ok(`${code} covers every key the shop renders`, missing.length === 0,
      `${missing.length} missing: ${missing.slice(0, 6).join(', ')}`);
    const stray = Object.keys(dict).filter((k) => !NL_KEYS.includes(k));
    ok(`…and invents none`, stray.length === 0, stray.slice(0, 6).join(', '));
    const blank = Object.entries(dict).filter(([, v]) => !String(v).trim());
    ok(`…and leaves none blank`, blank.length === 0, blank.slice(0, 4).map(([k]) => k).join(', '));
  }
  /* Two languages that agree on a long sentence means one was copied. Short
     strings legitimately match (Support, FAQ, Discord, Menu), so only sentences
     are compared. */
  const copied = Object.keys(DE).filter((k) => DE[k] === FR[k] && DE[k].length > 40);
  ok('no long string is identical in German and French', copied.length === 0,
    copied.slice(0, 4).join(', '));
}

console.log('\n— The legal documents are deliberately not translated —');
{
  /* These are the documents a dispute is decided on. A machine translation of
     them is a legal claim nobody here can verify, so a German or French reader
     gets the English text and is told why. */
  const legalKeys = NL_KEYS.filter((k) => k.startsWith('legal.'));
  ok('there are legal strings to leave alone', legalKeys.length > 50, String(legalKeys.length));
  const translatedLegal = legalKeys.filter((k) => (DE[k] || FR[k]) && k !== 'legal.langNote');
  ok('none of the legal text was machine-translated', translatedLegal.length === 0,
    translatedLegal.slice(0, 5).join(', '));
  const doc = read('src/components/LegalDoc.jsx');
  ok('…and the page says so to a reader who is not on nl or en',
    /legal\.langNote/.test(doc) && /lang === 'nl' \|\| lang === 'en'/.test(doc));
  ok('the note itself exists in every language',
    !!DE['legal.langNote'] && !!FR['legal.langNote']);
}

console.log('\n— Nothing still asks "is this Dutch?" —');
{
  /* The failure this guards against: a fifth language is added, and one of
     these keeps treating it as English because it only ever knew two. */
  const nav = read('src/components/store/StoreNav.jsx');
  ok('the chooser lists the languages instead of toggling two',
    /LANGUAGES\.map/.test(nav) && !/setLang\(lang === 'nl' \? 'en' : 'nl'\)/.test(nav));
  const banner = read('src/components/store/LaunchBanner.jsx');
  ok('the launch date is formatted in the reader’s own locale',
    /localeOf\(lang\)/.test(banner) && !/lang === 'nl' \? 'nl-NL' : 'en-GB'/.test(banner));
  const chat = read('src/components/ChatWidget.jsx');
  ok('the assistant falls back to English, not to Dutch',
    /COPY\[lang\] \|\| COPY\.en/.test(chat));
  ok('the dictionary lookup is a map, not a ternary',
    /DICTS\[lang\]\?\.\[key\] \?\? en/.test(i18n) && !/lang === 'nl' \? \(NL\[key\]/.test(i18n));
  ok('a stored language is validated against the registry, not two strings',
    /LANG_CODES\.includes\(stored\)/.test(i18n));
  ok('a regional tag like fr-BE or de-AT still matches',
    /navigator\.language \|\| ''\)\.toLowerCase\(\)\.split\('-'\)\[0\]/.test(i18n));
}

console.log('\n— German and French are loaded on demand —');
{
  /* Together they are about as much text again as the whole entry chunk. A
     Dutch buyer must not download them to read a Dutch page. */
  ok('they are dynamic imports', /import\('\.\/i18n\/de\.js'\)/.test(i18n)
    && /import\('\.\/i18n\/fr\.js'\)/.test(i18n));
  ok('Dutch is bundled, because it is the shop’s own language',
    /const DICTS = \{ nl: NL \}/.test(i18n));
  ok('a failed chunk falls back to English rather than breaking the page',
    /falling back to English/.test(i18n));
}

console.log('\n— The buyer’s language reaches the person who answers them —');
{
  /* The order emails are Dutch: one set of templates, one language. Recording
     the language does not translate anything — it tells whoever answers the
     ticket which language to answer in. */
  const checkout = read('src/pages/Checkout.jsx');
  ok('the checkout sends the language it was read in', /\n\s+lang,\n/.test(checkout));
  const orders = read('server/src/services/orderService.js');
  ok('…and the server stores only a language it actually offers',
    /\['nl', 'en', 'de', 'fr'\]\.includes\(billing\.lang\)/.test(orders));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} languages: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
