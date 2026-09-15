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
const files = walk(join(ROOT, 'src')).filter((f) => /\.jsx?$/.test(f));

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

  const maps = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file);
    for (const found of mapsIn(src)) {
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

console.log(`\n${fail === 0 ? '✅' : '❌'} i18n-content: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
