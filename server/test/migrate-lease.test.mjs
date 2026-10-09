/**
 * Migrations: one instance migrates, the others wait or say "updating" — never
 * serve on a schema that is not there, and never get stuck behind a lock a
 * pooler forgot (db/migrate.js).
 */
import './_selling-shop.mjs';   // must come first — see that file
import { ensureReady } from '../src/app.js';
import { get, run } from '../src/db/index.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
await ensureReady();
const { migrate } = await import('../src/db/migrate.js');
const { MIGRATIONS } = await import('../src/db/migrations.js');
const stamp = Date.now().toString(36);
const applied = async (id) => !!(await get('SELECT 1 AS x FROM schema_migrations WHERE id=@id', { id }));

console.log('— Two instances, one pending migration —');
{
  const id = `zz_lease_${stamp}_a`;
  MIGRATIONS.push({ id, sql: `SELECT pg_sleep(1); CREATE TABLE IF NOT EXISTS zz_lease_${stamp} (x INT);
    INSERT INTO zz_lease_${stamp} (x) VALUES (1);` });
  const [a, b] = await Promise.all([migrate(), migrate()]);
  const rows = await get(`SELECT COUNT(*)::int AS n FROM zz_lease_${stamp}`);
  ok('the migration ran exactly once', rows.n === 1, `${rows.n} runs`);
  ok('…one instance applied it, the other waited for it', a + b === 1, `${a} + ${b}`);
  ok('…and it is recorded', await applied(id));
  ok('the lease is gone afterwards', !(await get('SELECT 1 AS x FROM schema_migration_lock WHERE id = 1')));
}

console.log('— A lease held by another instance —');
{
  const id = `zz_lease_${stamp}_b`;
  MIGRATIONS.push({ id, sql: 'SELECT 1' });
  await run(`INSERT INTO schema_migration_lock (id, holder, taken_at) VALUES (1, 'someone', @at)
             ON CONFLICT (id) DO UPDATE SET holder='someone', taken_at=@at`, { at: new Date().toISOString() });
  const t = Date.now();
  let err = null;
  try { await migrate({ waitMs: 1_500 }); } catch (e) { err = e; }
  ok('a pending migration behind a live lease is a 503, not "proceed anyway"', err?.status === 503, err?.message || 'no error');
  ok('…after waiting about as long as it was told', Date.now() - t >= 1_400 && Date.now() - t < 6_000, `${Date.now() - t} ms`);
  ok('…and nothing was applied', !(await applied(id)));
  ok('…nor was the other holder’s lease touched', (await get('SELECT holder FROM schema_migration_lock WHERE id = 1'))?.holder === 'someone');

  // The holder was frozen or killed: its lease ages out and the next start takes over.
  await run(`UPDATE schema_migration_lock SET taken_at=@old WHERE id = 1`, { old: new Date(Date.now() - 5 * 60_000).toISOString() });
  const n = await migrate({ waitMs: 1_500 });
  ok('a stale lease is taken over and the migration applied', n === 1 && await applied(id), `${n}`);
}

console.log('— Up to date —');
{
  await run(`INSERT INTO schema_migration_lock (id, holder, taken_at) VALUES (1, 'someone', @at)
             ON CONFLICT (id) DO UPDATE SET holder='someone', taken_at=@at`, { at: new Date().toISOString() });
  const t = Date.now();
  const n = await migrate({ waitMs: 5_000 });
  ok('nothing pending: answered at once, whoever holds the lease', n === 0 && Date.now() - t < 1_000, `${Date.now() - t} ms`);
  await run('DELETE FROM schema_migration_lock WHERE id = 1');
}

console.log(`\n${fail ? '❌' : '✅'} migrate-lease: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
