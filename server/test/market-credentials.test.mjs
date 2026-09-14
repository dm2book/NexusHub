/**
 * The key is in the admin. The half of the system that could use it never saw it.
 *
 * An owner adds their Kinguin key through Suppliers. The connector buys with it
 * happily — orders are placed, keys are collected. Meanwhile the Market page
 * reports "no Kinguin Integration API key (KINGUIN_API_KEY)" and every price
 * recommendation stays blocked, because `credentialsFor` read the environment
 * for Kinguin and Eneba while reading the supplier row for Eldorado and G2A.
 *
 * The comment above that function promised the supplier row would win. It said
 * so for all four and did it for two, which is the worst kind of documentation:
 * accurate enough that nobody re-reads the code under it.
 *
 * Nothing about the Kinguin price source was missing — `fetchOffers` is fully
 * written, against the same `/v1/products?name=` endpoint the catalogue picker
 * uses. It simply never received credentials.
 */
import { migrate } from '../src/db/migrate.js';
import { run, nowIso } from '../src/db/index.js';
import { newId } from '../src/utils/ids.js';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const codeOf = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

await migrate();
const { credentialsFor } = await import('../src/services/market/sources.js');

const at = nowIso();
const supplier = async (kind, config, { status = 'active' } = {}) => {
  const id = newId('sup');
  await run(`INSERT INTO suppliers (id, name, connector_kind, status, config, created_at, updated_at)
             VALUES (@id,@n,@k,@st,@c,@at,@at)`,
    { id, n: `${kind} co`, k: kind, st: status, c: JSON.stringify(config), at });
  return id;
};
const wipe = () => run('DELETE FROM suppliers');

/* config reads process.env once at import, so anything about environment
   fallbacks has to be its own process. */
const credsUnder = (env, key) => {
  const r = spawnSync(process.execPath, ['-e', `
    const { credentialsFor } = await import('${join(ROOT, 'server/src/services/market/sources.js')}');
    process.stdout.write(JSON.stringify(await credentialsFor('${key}') ?? null));
    process.exit(0);
  `, '--input-type=module'], {
    encoding: 'utf8',
    env: { ...process.env, KINGUIN_API_KEY: '', ELDORADO_API_KEY: '', ENEBA_API_KEY: '',
      G2A_API_HASH: '', G2A_API_KEY: '', G2A_EMAIL: '', ...env },
  });
  try { return JSON.parse((r.stdout || '').trim()); } catch { return { parseError: r.stderr }; }
};

console.log('— A key added in the admin reaches Market —');
{
  await wipe();
  await supplier('kinguin', { apiKey: 'KG-LIVE', autoDeliver: true });
  const c = await credentialsFor('kinguin');
  ok('the Kinguin supplier row is read', c?.apiKey === 'KG-LIVE', JSON.stringify(c));

  /* This was the whole bug: Eldorado and G2A read the row, Kinguin and Eneba
     did not. All four now behave the same way. */
  await wipe();
  for (const kind of ['kinguin', 'eldorado', 'g2a']) {
    // eslint-disable-next-line no-await-in-loop
    await supplier(kind, { apiKey: `${kind}-key` });
  }
  for (const kind of ['kinguin', 'eldorado', 'g2a']) {
    // eslint-disable-next-line no-await-in-loop
    const got = await credentialsFor(kind);
    ok(`${kind}: the supplier row wins, like the comment always claimed`,
      got?.apiKey === `${kind}-key`, JSON.stringify(got));
  }
}

console.log('— …and a key set in the environment still works —');
{
  await wipe();
  ok('no row, no env: nothing, rather than an empty object that looks configured',
    (await credentialsFor('kinguin')) === null);
  ok('the environment is the fallback',
    credsUnder({ KINGUIN_API_KEY: 'FROM-ENV' }, 'kinguin')?.apiKey === 'FROM-ENV');

  /* The other direction of the same bug: an empty supplier config must not
     mask a working environment key. */
  await supplier('kinguin', {});
  ok('an empty supplier config does not hide the environment key',
    credsUnder({ KINGUIN_API_KEY: 'FROM-ENV' }, 'kinguin')?.apiKey === 'FROM-ENV');

  await wipe();
  await supplier('kinguin', { apiKey: 'FROM-ROW' });
  ok('…but a row that has something wins over the environment',
    credsUnder({ KINGUIN_API_KEY: 'FROM-ENV' }, 'kinguin')?.apiKey === 'FROM-ROW');
}

console.log('\n— A key the owner switched off is not a permission —');
{
  await wipe();
  await supplier('kinguin', { apiKey: 'PAUSED-KEY' }, { status: 'paused' });
  ok('a paused supplier does not supply market credentials',
    (await credentialsFor('kinguin')) === null);
  ok('…and it falls through to the environment instead',
    credsUnder({ KINGUIN_API_KEY: 'FROM-ENV' }, 'kinguin')?.apiKey === 'FROM-ENV');

  await wipe();
  await run(`INSERT INTO suppliers (id, name, connector_kind, status, config, created_at, updated_at)
             VALUES (@id,'broken','kinguin','active','{not json',@at,@at)`, { id: newId('sup'), at });
  ok('a malformed config is not a reason to ignore the environment',
    credsUnder({ KINGUIN_API_KEY: 'FROM-ENV' }, 'kinguin')?.apiKey === 'FROM-ENV');
}

console.log('\n— Having the key is not the same as switching the source on —');
{
  /* Deliberate: a source only runs when the owner lists it in MARKET_SOURCES,
     because using somebody's API is an agreement, not a discovery. */
  const statusUnder = (env) => {
    const r = spawnSync(process.execPath, ['-e', `
      const { sourceStatuses } = await import('${join(ROOT, 'server/src/services/market/sources.js')}');
      const rows = await sourceStatuses();
      process.stdout.write(JSON.stringify(rows.find((x) => x.key === 'kinguin')));
      process.exit(0);
    `, '--input-type=module'], {
      encoding: 'utf8',
      env: { ...process.env, KINGUIN_API_KEY: '', MARKET_SOURCES: '', ...env },
    });
    try { return JSON.parse((r.stdout || '').trim()); } catch { return { status: '?', err: r.stderr }; }
  };

  await wipe();
  await supplier('kinguin', { apiKey: 'KG-LIVE' });
  const off = statusUnder({});
  ok('with the key but not listed, the source is disabled, not unavailable',
    off.status === 'disabled', `${off.status}: ${off.statusReason || off.err}`);
  ok('…and says it has to be switched on deliberately',
    /MARKET_SOURCES/.test(off.statusReason || ""), off.statusReason);

  const on = statusUnder({ MARKET_SOURCES: 'kinguin' });
  ok('listed and credentialed, it is available', on.status === 'available', `${on.status}: ${on.statusReason}`);

  await wipe();
  const noKey = statusUnder({ MARKET_SOURCES: 'kinguin' });
  ok('listed without a key is unavailable, not available',
    noKey.status === 'unavailable', noKey.status);
  /* The public storefront is never a fallback — that is the constraint the
     whole market engine is built around. */
  ok('…and says the public pages are not a fallback',
    /NOT a fallback/.test(noKey.statusReason || ""), noKey.statusReason);
}

console.log('\n— The code and its comment agree now —');
{
  const src = read('server/src/services/market/sources.js');
  ok('no marketplace is special-cased out of the supplier lookup',
    !/key === 'kinguin' \|\| key === 'eneba'/.test(src));
  ok('the row query excludes paused suppliers',
    /connector_kind = @k AND status = 'active'/.test(codeOf('server/src/services/market/sources.js')));
  ok('the Kinguin price source was already implemented — only the key was missing',
    /key: 'kinguin'/.test(src) && /v1\/products\?name=/.test(src));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} market-credentials: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
