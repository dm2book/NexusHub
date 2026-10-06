/**
 * The account area speaks the shop's four languages.
 *
 * It was English-only, and the new Community page was hard-coded Dutch: one
 * page in two languages. Every string now goes through t('acc.…', English),
 * and the Dutch, German and French live in src/lib/i18n/account.{nl,de,fr}.js,
 * loaded by AccountLayout for the language being read.
 *
 * What must hold: every acc.* key the pages use exists in all three files
 * (template keys expanded through the ids they are built from), no file
 * invents keys, none is blank or still English, placeholders match, and no
 * account page carries hard-coded Dutch any more.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const files = [
  'src/layouts/AccountLayout.jsx',
  ...readdirSync(join(ROOT, 'src/pages/account')).map((f) => `src/pages/account/${f}`),
  ...readdirSync(join(ROOT, 'src/components/account')).map((f) => `src/components/account/${f}`),
];
const code = Object.fromEntries(files.map((f) => [f, read(f)]));
const DICT = {};
for (const l of ['nl', 'de', 'fr']) DICT[l] = (await import(join(ROOT, `src/lib/i18n/account.${l}.js`))).default;

const literal = new Set();
for (const src of Object.values(code)) for (const m of src.matchAll(/\bt\(\s*'(acc\.[^']+)'/g)) literal.add(m[1]);

console.log('— Every key the pages use exists in every language —');
for (const l of ['nl', 'de', 'fr']) {
  const missing = [...literal].filter((k) => !DICT[l][k]);
  ok(`${l}: all ${literal.size} literal keys present`, missing.length === 0, missing.slice(0, 8).join(', '));
}
{
  /* Keys built at runtime, expanded through the ids they come from. */
  const { LEVELS, REFERRAL_LEVELS, XP_RULES, ACHIEVEMENTS } = await import(join(ROOT, 'server/src/services/communityService.js'));
  const built = [
    ...LEVELS.map((x) => `acc.community.level.${x.level}`),
    ...REFERRAL_LEVELS.map((x) => `acc.community.ref.${x.id}`),
    ...XP_RULES.map((x) => `acc.community.xp.${x.id}`),
    ...ACHIEVEMENTS.flatMap((a) => [`acc.community.ach.${a.id}.name`, `acc.community.ach.${a.id}.desc`]),
    ...['open', 'pending', 'resolved', 'closed'].map((s) => `acc.ticket.status.${s}`),
    ...(await import(join(ROOT, 'server/src/services/membershipService.js'))).FORGE_PLUS.perks.map((p) => `acc.rewards.perk.${p.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`),
  ];
  for (const l of ['nl', 'de', 'fr']) {
    const missing = built.filter((k) => !DICT[l][k]);
    ok(`${l}: every level, referral level, XP rule, achievement, ticket status and Forge+ perk`, missing.length === 0, missing.slice(0, 8).join(', '));
  }
}

console.log('\n— The three files agree —');
{
  const keys = (l) => Object.keys(DICT[l]).sort().join('|');
  ok('nl, de and fr have exactly the same keys', keys('nl') === keys('de') && keys('de') === keys('fr'));
  for (const l of ['nl', 'de', 'fr']) {
    const blank = Object.entries(DICT[l]).filter(([, v]) => !String(v).trim());
    ok(`${l}: none blank`, blank.length === 0, blank.slice(0, 5).map(([k]) => k).join(', '));
  }
  const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const mismatch = Object.keys(DICT.nl).filter((k) => ph(DICT.nl[k]) !== ph(DICT.de[k]) || ph(DICT.nl[k]) !== ph(DICT.fr[k]));
  ok('placeholders ({n}, {date}…) identical in every language', mismatch.length === 0, mismatch.slice(0, 5).join(', '));
  ok('the Community page is not English in Dutch', DICT.nl['acc.community.level.1'] === 'Nieuwkomer');
}

console.log('\n— No hard-coded Dutch left on the account pages —');
{
  const DUTCH = /['>"]\s*(Kon je|Nog \d|Behaald|Vandaag inchecken|Alle levels|vrienden bestelden|Maanden op rij|Hoogste level)/;
  const hits = Object.entries(code).filter(([, src]) => DUTCH.test(src.replace(/\/\*[\s\S]*?\*\//g, '')));
  ok('no account page renders hard-coded Dutch', hits.length === 0, hits.map(([f]) => f).join(', '));
}

console.log('\n— Loaded only where it is needed —');
{
  const layout = code['src/layouts/AccountLayout.jsx'];
  ok('AccountLayout loads the dictionary for the language being read', /import\('\.\.\/lib\/i18n\/account\.nl\.js'\)/.test(layout) && /extendDictionary\(lang/.test(layout));
  const i18n = read('src/lib/i18n.jsx');
  ok('the storefront dictionary does not import the account strings', !/account\.(nl|de|fr)\.js/.test(i18n));
}

console.log(`\n${fail ? '❌' : '✅'} account-i18n: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
