/**
 * Switching to Dutch has to translate the whole page, not most of it.
 *
 * Two failure modes, both of which had happened:
 *  1. a `t('key', 'English')` call whose key is missing from the NL dictionary —
 *     the UI silently falls back to English, so nothing looks broken while half
 *     a page stays in the wrong language;
 *  2. copy that never goes through `t()` at all, which no dictionary can fix.
 *
 * This covers (1) statically. (2) is covered by rendering every page in Dutch
 * and looking for English — see the render check in the PR; keeping that in CI
 * would need a browser, so the static half runs here on every commit.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = join(ROOT, 'src');

const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.jsx?$/.test(f)) files.push(p);
  }
}(SRC));

// Every t('key', 'default') / tr('key', 'default') call in the storefront.
const used = new Map();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\b(?:t|tr)\(\s*'([^']+)'\s*,\s*'((?:[^'\\]|\\.)*)'/g)) {
    if (!used.has(m[1])) used.set(m[1], { def: m[2], file: f.replace(`${SRC}/`, '') });
  }
}

// The NL dictionary, read as text so this test never imports JSX.
const i18n = readFileSync(join(SRC, 'lib/i18n.jsx'), 'utf8');
const dict = i18n.slice(i18n.indexOf('const NL = {'), i18n.indexOf('\n};', i18n.indexOf('const NL = {')));
const translated = new Set([...dict.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]));

console.log('— Dutch coverage —');
{
  // 'x' is the example key inside the i18n doc comment, not a real string.
  const missing = [...used.keys()].filter((k) => k !== 'x' && !translated.has(k));
  ok(`every translated string has Dutch (${used.size} keys)`, missing.length === 0,
    missing.slice(0, 12).map((k) => `${k} (${used.get(k).file})`).join(', '));
  ok('the dictionary is not empty', translated.size > 300, `${translated.size}`);
}

console.log('\n— Honest copy in both languages —');
{
  const LIES = /instant delivery|delivered in seconds|binnen seconden|direct geleverd|24\/7|securely by card|met je creditcard/i;
  // English defaults live at the call site; the Dutch lives in the dictionary.
  const badEn = [...used.entries()].filter(([, v]) => LIES.test(v.def));
  ok('no English default makes a retired claim', badEn.length === 0,
    badEn.slice(0, 6).map(([k]) => k).join(', '));

  const badNl = [...dict.matchAll(/^\s*'([^']+)':\s*'((?:[^'\\]|\\.)*)'/gm)]
    .filter((m) => LIES.test(m[2])).map((m) => m[1]);
  ok('no Dutch string makes a retired claim', badNl.length === 0, badNl.slice(0, 6).join(', '));
}

console.log('\n— Dictionary hygiene —');
{
  const dupes = [...dict.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1])
    .filter((k, i, a) => a.indexOf(k) !== i);
  ok('no key is defined twice', dupes.length === 0, [...new Set(dupes)].slice(0, 8).join(', '));

  // A Dutch value identical to its English default is usually a forgotten
  // translation rather than a word that happens to be the same.
  const suspicious = [...dict.matchAll(/^\s*'([^']+)':\s*'((?:[^'\\]|\\.)*)'/gm)]
    .filter((m) => {
      const en = used.get(m[1])?.def;
      // Short phrases ("Mystery boxes", "Support via Discord") are the same
      // word in Dutch; only a long identical sentence is a forgotten one.
      return en && en.length > 30 && en === m[2];
    }).map((m) => m[1]);
  ok('no Dutch value is a copy of its English default', suspicious.length === 0, suspicious.slice(0, 8).join(', '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
