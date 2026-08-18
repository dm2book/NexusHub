/**
 * Forward-only migration runner. Applies any embedded migration (see
 * migrations.js) not yet recorded in schema_migrations, in order. Idempotent and
 * safe to call on serverless cold start.
 */
import { pool, run, all, nowIso } from './index.js';
import { MIGRATIONS } from './migrations.js';

const LOCK_ID = 778899;
const allApplied = async () => {
  const applied = new Set((await all('SELECT id FROM schema_migrations')).map((r) => r.id));
  return MIGRATIONS.every((m) => applied.has(m.id));
};

export async function migrate() {
  // Fast path — the common case on every serverless cold start. Check whether
  // any migration is still pending WITHOUT taking the advisory lock. If the
  // schema is already current we return immediately, so a cold start never
  // blocks on a lock that a frozen sibling instance might be holding.
  //
  // Ask first, and create only if the answer is "no such table". The
  // unconditional CREATE TABLE IF NOT EXISTS was a second serialized round trip
  // on every cold start — and a DDL statement against the primary — to discover
  // something the SELECT on the next line already answers. On a deployed shop
  // the table exists every single time.
  try {
    if (await allApplied()) return 0;
  } catch (err) {
    if (!/schema_migrations/.test(err.message)) throw err;   // a real failure
    await run(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  }

  // There is real work to do. Serialize with a NON-BLOCKING advisory lock: a
  // blocking pg_advisory_lock is dangerous on serverless because Vercel freezes
  // instances and Neon's pooler doesn't drop the session lock promptly, so
  // other instances would hang the full 30s (→ 504s). If another instance is
  // already migrating, poll for the schema to become ready instead of blocking.
  const lock = await pool.connect();
  try {
    let got = (await lock.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_ID])).rows[0]?.ok;
    for (let i = 0; !got && i < 20; i++) {
      if (await allApplied()) return 0;            // another instance finished
      await new Promise((r) => setTimeout(r, 500));
      got = (await lock.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_ID])).rows[0]?.ok;
    }
    if (!got) return 0; // couldn't get the lock in time — proceed; schema is likely ready

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
  } finally {
    await lock.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    lock.release();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(() => { console.log('Migrations complete.'); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
