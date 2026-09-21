/**
 * Who is selling, and how that gets published.
 *
 * Dutch and EU consumer law require a name and a geographic address before
 * somebody may buy. Those four values lived as constants in a source file,
 * which meant that the day the KvK paperwork came back, publishing it needed a
 * code change, a commit and a deploy by somebody who can do all three — a
 * developer standing between a legal obligation and the shop meeting it.
 *
 * They come from the environment now, and the awkward part is that they have to
 * arrive through TWO doors:
 *
 *   · Vite bakes `import.meta.env.VITE_*` into the browser bundle at build time;
 *   · prerender.mjs imports this same module in plain Node to render the legal
 *     pages, where only `process.env` exists.
 *
 * Miss either and the pre-rendered page and the live app disagree about who is
 * selling, which is worse than neither of them knowing. And Vite only
 * substitutes a LITERAL `import.meta.env.VITE_X`, so a tidy loop over key names
 * comes back empty in the browser while working everywhere it was tested.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const src = read('src/lib/legalIdentity.js');

console.log('\n— Unset is empty, never a placeholder —');
{
  const { LEGAL, legalComplete } = await import('../../src/lib/legalIdentity.js');
  ok('nothing is invented when nothing is set',
    LEGAL.legalName === '' && LEGAL.address === '' && LEGAL.postcode === '' && LEGAL.city === '',
    JSON.stringify(LEGAL));
  ok('…and the shop knows it is incomplete', legalComplete() === false);
  ok('the trading name and country still have sensible defaults',
    LEGAL.tradeName === 'ForgeMarket' && LEGAL.country === 'Nederland');
}

console.log('\n— The environment fills it in, in plain Node —');
{
  /* A child process, because the module is already evaluated in this one and
     these values are read once at import. */
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', `
    const m = await import(${JSON.stringify(join(ROOT, 'src/lib/legalIdentity.js'))});
    process.stdout.write(JSON.stringify({ legal: m.LEGAL, complete: m.legalComplete(),
      line: m.legalAddressLine() }));
  `], {
    env: {
      ...process.env,
      VITE_LEGAL_NAME: 'M. El Hannouti', VITE_LEGAL_ADDRESS: 'Teststraat 1',
      VITE_LEGAL_POSTCODE: '1234 AB', VITE_LEGAL_CITY: 'Amsterdam',
      VITE_LEGAL_KVK: '12345678', VITE_LEGAL_VAT: 'NL001234567B01',
    },
  }).toString();
  const got = JSON.parse(out);
  ok('the name arrives', got.legal.legalName === 'M. El Hannouti');
  ok('the address arrives', got.legal.address === 'Teststraat 1'
    && got.legal.postcode === '1234 AB' && got.legal.city === 'Amsterdam');
  ok('the KvK and BTW numbers arrive',
    got.legal.kvk === '12345678' && got.legal.vat === 'NL001234567B01');
  ok('…and the shop is legally complete', got.complete === true);
  ok('…with one readable address line',
    got.line === 'Teststraat 1, 1234 AB Amsterdam, Nederland', got.line);
}

console.log('\n— Whitespace is not an address —');
{
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', `
    const m = await import(${JSON.stringify(join(ROOT, 'src/lib/legalIdentity.js'))});
    process.stdout.write(JSON.stringify({ complete: m.legalComplete(), name: m.LEGAL.legalName }));
  `], { env: { ...process.env, VITE_LEGAL_NAME: '   ', VITE_LEGAL_ADDRESS: '  ' } }).toString();
  const got = JSON.parse(out);
  ok('a value of spaces counts as unset', got.name === '' && got.complete === false,
    JSON.stringify(got));
}

console.log('\n— Both doors, and the literal accesses Vite needs —');
{
  ok('the browser door is read', /import\.meta\.env/.test(src));
  ok('the Node door is read', /process\.env/.test(src));
  /* The trap: Vite substitutes only a literal `import.meta.env.VITE_X`. A loop
     over key names returns undefined in the bundle and works in every test that
     runs under Node. */
  for (const key of ['VITE_LEGAL_NAME', 'VITE_LEGAL_ADDRESS', 'VITE_LEGAL_POSTCODE',
    'VITE_LEGAL_CITY', 'VITE_LEGAL_KVK', 'VITE_LEGAL_VAT']) {
    ok(`${key} is accessed literally`, src.includes(`viteEnv.${key}`), key);
  }
  ok('and nothing reaches for it dynamically',
    !/import\.meta\.env\s*\[/.test(src) && !/viteEnv\s*\[/.test(src));
}

console.log('\n— The launch check names what to set —');
{
  const { LEGAL_ENV } = await import('../../src/lib/legalIdentity.js');
  ok('the variable names are exported for it', !!LEGAL_ENV?.legalName && !!LEGAL_ENV?.kvk);
  /* Asserted on what the panel RENDERS, not on the source file: the file also
     contains a comment quoting the old wording, and a grep over it fails on the
     explanation of the fix rather than on the fix. */
  /* launchChecks reads real tables, so the schema has to exist first. */
  const { ensureReady } = await import('../src/app.js');
  await ensureReady();
  const { launchChecks } = await import('../src/services/launchCheckService.js');
  const { checks } = await launchChecks();
  const identity = checks.find((c) => c.id === 'identity');
  ok('the identity row is there', !!identity, JSON.stringify(checks.map((c) => c.id)));
  ok('…and with nothing set it fails', identity.status === 'fail', identity.status);
  ok('…naming the variables to set', /VITE_LEGAL_NAME/.test(identity.detail)
    && /VITE_LEGAL_ADDRESS/.test(identity.detail), identity.detail);
  ok('…and not telling the owner to edit a source file',
    !/legalIdentity\.js/.test(identity.detail), identity.detail);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} legal-identity-env: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
