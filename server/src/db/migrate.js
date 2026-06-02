/**
 * Forward-only migration runner. Applies any embedded migration (see
 * migrations.js) not yet recorded in schema_migrations, in order. Idempotent and
 * safe to call on serverless cold start.
 */
import { pool, run, all, nowIso } from './index.js';
import { MIGRATIONS } from './migrations.js';

export async function migrate() {
  await run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);

  const applied = new Set((await all('SELECT id FROM schema_migrations')).map((r) => r.id));

  let count = 0;
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(m.sql);
      await client.query('INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)',
        [m.id, nowIso()]);
      await client.query('COMMIT');
      count++;
      console.log(`✓ migrated ${m.id}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${m.id} failed: ${err.message}`);
    } finally {
      client.release();
    }
  }
  if (!count) console.log('Schema already up to date.');
  return count;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(() => { console.log('Migrations complete.'); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
