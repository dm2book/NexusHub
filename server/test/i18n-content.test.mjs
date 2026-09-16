/**
 * Content maps keyed by language, and the rule that they cover every language
 * the shop is read in.
 *
 * The dictionaries in src/lib/i18n are already guarded — languages.test checks
 * that German and French carry every key the shop renders. What nothing
 * checked was the OTHER shape this codebase uses for copy: a plain object with
 * one entry per language, read as `CONTENT[lang] || CONTENT.en`.
 *
 * That fallback is what a reader actually meets, and it is silent. Six of
 * these maps carried English and Dutch only, so a German or French visitor got:
 *
 *   · the whole "How it works" page in English — every step, every promise;
 *   · the whole help centre in English;
 *   · the delivery terms of their own order in English, including the
 *     sentence promising we never ask for their password;
 *   · an assistant that answered in English on a page written in German.
 *
 * Nothing failed, because a fallback is not an error. This is the check that
 * makes it one.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { LANG_CODES } = await import(join(ROOT, 'src/lib/i18n/registry.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

/**
 * The documents a dispute is decided on.
 *
 * These are deliberately published in Dutch and English only, and a reader on
 * another language is told so in their own language — see languages.test and
 * LegalDoc.jsx. A machine translation of a refund policy is a legal claim
 * nobody here can verify, so this is an exemption with a reason rather than a
 * list of things not got round to.
 */
const DELIBERATELY_UNTRANSLATED = new Set([
  'src/content/legal.js',
  'src/content/refunds.js',
]);

const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

/**
 * Three trees, not one.
 *
 * This walked `src` only, and the note at the top of this file listed "an
 * assistant that answered in English on a page written in German" among the
 * things it had caught. It had not: the assistant's copy lives in
 * server/src/services/assistantService.js, outside everything this scanned, and
 * it was still nl + en — which turned out to be worse than an English answer.
 * The widget's own chrome had German and French, so the shop showed a fully
 * German assistant whose endpoint rejected `lang: "de"` as an invalid enum
 * value. Every message a German or French visitor sent was a 400.
 *
 * The bot's copy lives in a third tree again, and answers the same buyer.
 */
const files = ['src', 'server/src', 'discord/src']
  .flatMap((d) => walk(join(ROOT, d)))
  .filter((f) => /\.jsx?$/.test(f));

console.log('— Every language-keyed map covers every language —');
{
  ok(`the shop offers ${LANG_CODES.length} languages`, LANG_CODES.length >= 4, LANG_CODES.join(','));

  /**
   * Every language map in a file, checked one by one.
   *
   * The first version of this asked whether the FILE contained `de:` and `fr:`
   * at the right indent, which is not the same question. seo.js holds two maps
   * — the page metadata and the landing routes — and once the landing routes
   * had German, the file passed while all eighteen page titles were still
   * English. This walks each `en:` block's own siblings instead.
   */
  const mapsIn = (src) => {
    const out = [];
    const re = /^([ \t]*)en:\s*\{/gm;
    let m;
    while ((m = re.exec(src))) {
      const indent = m[1];
      const outer = indent.slice(0, -2);
      /* The WHOLE enclosing block, not the part after `en`. Scanning forward
         only was the first version's bug: seo.js writes `nl:` before `en:`, so
         from `en` onwards there is no Dutch sibling to be seen and the map was
         skipped as though it were not a language map at all. */
      const before = src.slice(0, m.index);
      const opens = [...before.matchAll(new RegExp(`^${outer}\\S.*\\{[ \t]*$`, 'gm'))];
      const start = opens.length ? opens[opens.length - 1].index : 0;
      const after = src.slice(m.index);
      const closeAt = after.search(new RegExp(`^${outer}\\}`, 'm'));
      const scope = src.slice(start, m.index + (closeAt > 0 ? closeAt : after.length));
      const siblings = new Set([...scope.matchAll(new RegExp(`^${indent}([a-z]{2}):\\s*\\{`, 'gm'))]
        .map((x) => x[1]));
      if (!siblings.has('nl')) continue;
      out.push({ line: src.slice(0, m.index).split('\n').length, siblings });
    }
    return out;
  };

  /**
   * The other shape: one entry per topic, each holding a short string per
   * language — `delivery: { nl: '…', en: '…' }`.
   *
   * mapsIn above only sees language keys that open a block, so every one of
   * these was invisible to it: the assistant's answers, its order statuses and
   * its redeem steps are all written this way, and all three were nl + en long
   * after the shop had four languages. A brace group with no nested braces of
   * its own, containing an `nl:` string, is one of these.
   */
  const inlineIn = (src) => {
    const out = [];
    for (const m of src.matchAll(/\{[^{}]*?\bnl:\s*['"`][^{}]*?\}/g)) {
      if (m[0].includes('${')) continue; // a template literal, not a copy table
      const langs = new Set([...m[0].matchAll(/\b([a-z]{2}):\s*['"`]/g)].map((x) => x[1])
        .filter((c) => LANG_CODES.includes(c)));
      /* Two languages before this counts as copy. A single `nl` is as likely to
         be a value that happens to be named after one — the query object
         `{ id: eventKey, nl: 'nl' }` that falls back to the Dutch email
         template is not a translation waiting to be finished. */
      if (langs.size < 2) continue;
      out.push({ line: src.slice(0, m.index).split('\n').length, siblings: langs });
    }
    return out;
  };

  const maps = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file);
    for (const found of [...mapsIn(src), ...inlineIn(src)]) {
      maps.push({ rel, line: found.line, missing: LANG_CODES.filter((c) => !found.siblings.has(c)) });
    }
  }

  ok(`found ${maps.length} language-keyed content maps`, maps.length >= 7, `${maps.length}`);

  const exempt = [...new Set(maps.filter((m) => DELIBERATELY_UNTRANSLATED.has(m.rel)).map((m) => m.rel))];
  ok('the legal documents are still the only exemption',
    exempt.length === DELIBERATELY_UNTRANSLATED.size,
    `${exempt.length} of ${DELIBERATELY_UNTRANSLATED.size} exempt files still look like language maps`);

  for (const m of maps) {
    if (DELIBERATELY_UNTRANSLATED.has(m.rel)) {
      ok(`${m.rel}:${m.line} is Dutch and English on purpose`, m.missing.length > 0,
        'it gained a translation — if that is deliberate, take it off the exemption list');
      continue;
    }
    ok(`${m.rel}:${m.line} covers every language`, m.missing.length === 0,
      `missing: ${m.missing.join(', ')}`);
  }
}

console.log('\n— …and so does the catalogue —');
{
  /* Product copy is generated per category rather than typed 72 times, so a
     missing language here is 72 English descriptions on a German page and not
     one. It happened: describeProduct knew en and nl, and every other reader
     got the English column. */
  const copy = readFileSync(join(ROOT, 'src', 'lib', 'productCopy.js'), 'utf8');
  const entries = [...copy.matchAll(/^  '?[a-z0-9-]+'?:\s*\{([\s\S]*?)^  \},/gm)].map((m) => m[1]);
  ok(`the copy table has ${entries.length} categories`, entries.length >= 20, `${entries.length}`);
  const short = entries.filter((e) => LANG_CODES.some((c) => !new RegExp(`^\\s*${c}:`, 'm').test(e)));
  ok('every category writes itself in every language', short.length === 0,
    `${short.length} categories are short a language`);

  const fallback = copy.match(/const FALLBACK = \{([\s\S]*?)\n\};/);
  ok('…and so does the fallback used by a category with no entry',
    !!fallback && LANG_CODES.every((c) => new RegExp(`^\\s*${c}:`, 'm').test(fallback[1])));

  /* One table, not two. The server generated Dutch for the API and the
     storefront kept its own copy for the fallback catalogue; they had already
     drifted apart — the client's had no `gta` entry, so the same Shark Card
     described itself differently depending on which one answered. */
  const server = readFileSync(join(ROOT, 'server', 'src', 'services', 'productCopy.js'), 'utf8');
  const client = readFileSync(join(ROOT, 'src', 'lib', 'catalog.js'), 'utf8');
  ok('the server reads the one copy table rather than keeping its own',
    /from '\.\.\/\.\.\/\.\.\/src\/lib\/productCopy\.js'/.test(server) && !/const COPY = \{/.test(server));
  ok('…and so does the storefront',
    /from '\.\/productCopy\.js'/.test(client) && !/const NL_TAIL = \{/.test(client));
}

console.log('\n— No entry says the same language twice —');
{
  /* The duplicate-key trap, in the file where I sprang it on myself.
   *
   * de.js and fr.js each carried every key twice and nothing broke, because
   * the last one silently wins. Having found that, I then wrote a script that
   * inserted German and French into seo.js and mis-parked five of them inside
   * the /robux landing route — forty lines of page titles sitting in a route
   * about Robux, invisible, because the correct blocks came after them and
   * won. Every rendered value was right. The file was wrong.
   *
   * An object literal cannot tell you this after it is parsed: by then the
   * losers are gone. So this reads the source. */
  const src = readFileSync(join(ROOT, 'src', 'content', 'seo.js'), 'utf8');
  const entries = [...src.matchAll(/^  ('(?:\/[a-z0-9-]*)'|[A-Za-z_$][\w$]*):\s*\{([\s\S]*?)^  \},/gm)];
  ok(`seo.js holds ${entries.length} routes`, entries.length >= 35, `${entries.length}`);

  const doubled = [];
  for (const [, name, body] of entries) {
    for (const code of LANG_CODES) {
      const n = (body.match(new RegExp(`^    ${code}:\\s*\\{`, 'gm')) || []).length;
      if (n > 1) doubled.push(`${name} has ${n} × ${code}`);
    }
  }
  ok('no route declares a language twice', doubled.length === 0, doubled.slice(0, 6).join('; '));
}

console.log('\n— …and so do the bundles —');
{
  /* A bundle has no category to generate copy from — it is a set somebody
     named and priced — so its description was whatever the owner typed, in
     whatever language they typed it. The one seeded bundle read "Top up both
     your shooters in one go and save 10%" on a German page.
     What a bundle does have is its members and its discount, and those make a
     sentence that is true in any language. */
  const { bundleCopy, BUNDLE_LANGS } = await import(join(ROOT, 'src/lib/bundleCopy.js'));
  ok('a bundle can describe itself in every language the shop offers',
    LANG_CODES.every((c) => BUNDLE_LANGS.includes(c)), BUNDLE_LANGS.join(','));

  const bundle = {
    name: 'FPS Duo Pack', description: 'Top up both your shooters and save 10%.',
    discountPercent: 10, products: [{ name: '1,000 Apex Coins' }, { name: '1,000 VP — Valorant' }],
  };
  /* Measured on a bundle with NOTHING typed, because that is what the
     generator is for. The first version of this used the seeded bundle, whose
     hand-written English wins for `en` — so "every language names its
     members" failed on the one language that was behaving correctly. */
  const bare = { ...bundle, description: null };
  const lines = LANG_CODES.map((c) => bundleCopy(bare, c).description);
  ok('every language gets a line', lines.every((l) => l && l.length > 10));
  ok('…and they are different lines', new Set(lines).size === lines.length,
    'two languages produced the same sentence');
  ok('the members are named in all of them',
    lines.every((l) => l.includes('1,000 Apex Coins')), lines.find((l) => !l.includes('1,000 Apex Coins')));
  ok('…and the saving is stated in all of them',
    lines.every((l) => l.includes('10%')));

  /* The NAME is somebody's invention, not a sentence. Machine-translating it
     is how a shop ends up calling its own promotion something nobody
     recognises — so it stays as typed unless the owner translated it. */
  ok('the name is left alone', LANG_CODES.every((c) => bundleCopy(bundle, c).name === 'FPS Duo Pack'));
  const typed = { ...bundle, copy: { nameDe: 'FPS-Duo-Paket', descriptionDe: 'Beide Shooter auf einmal.' } };
  ok('…unless the owner wrote one, and then it wins',
    bundleCopy(typed, 'de').name === 'FPS-Duo-Paket'
    && bundleCopy(typed, 'de').description === 'Beide Shooter auf einmal.');
  ok('…for that language only', bundleCopy(typed, 'fr').name === 'FPS Duo Pack');

  /* A bundle with no discount is a real state — it can exist purely to group
     things — and "0% cheaper together" is a worse sentence than none. */
  const plain = { ...bare, discountPercent: 0 };
  ok('a bundle at 0% does not claim a saving',
    LANG_CODES.every((c) => !/\d+\s*%/.test(bundleCopy(plain, c).description)),
    LANG_CODES.map((c) => bundleCopy(plain, c).description).find((l) => /\d+\s*%/.test(l)));
  ok('…but still says what is in it',
    LANG_CODES.every((c) => bundleCopy(plain, c).description.includes('1,000 Apex Coins')));

  /* One generator, both sides — the same arrangement product copy uses. */
  const svc = readFileSync(join(ROOT, 'server', 'src', 'services', 'bundleService.js'), 'utf8');
  const route = readFileSync(join(ROOT, 'server', 'src', 'routes', 'catalog.js'), 'utf8');
  ok('the server reads the shared generator', /bundleCopyAll/.test(svc));
  ok('…and the route no longer writes Dutch of its own', !/samen voordeliger/.test(route));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} i18n-content: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
