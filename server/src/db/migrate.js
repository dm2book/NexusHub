/**
 * Forward-only migration runner. Applies any embedded migration (see
 * migrations.js) not yet recorded in schema_migrations, in order. Idempotent and
 * safe to call on serverless cold start.
 */
import { pool, run, all, get, nowIso } from './index.js';
import { MIGRATIONS } from './migrations.js';
import { randomBytes } from 'node:crypto';

const allApplied = async () => {
  const applied = new Set((await all('SELECT id FROM schema_migrations')).map((r) => r.id));
  return MIGRATIONS.every((m) => applied.has(m.id));
};

/* Who is migrating, as a row rather than a session lock.
   This used to be pg_try_advisory_lock on one pooled connection. A session
   lock assumes the same server connection for the lock and the unlock, which
   a transaction-mode pooler (Neon's) does not promise: the unlock could land
   on another backend and do nothing, and a lock left behind that way kept
   every later deploy from migrating at all. A row with a time on it works
   through any pooler, and a holder that was frozen or killed mid-way (Vercel
   stops a function at 30 s) simply ages out. Each migration is its own
   transaction, so taking over from a dead holder never sees half of one. */
const LEASE_MS = 60_000;
async function takeLease(token) {
  await run(`CREATE TABLE IF NOT EXISTS schema_migration_lock (
    id INTEGER PRIMARY KEY, holder TEXT NOT NULL, taken_at TEXT NOT NULL)`);
  const row = await get(
    `INSERT INTO schema_migration_lock (id, holder, taken_at) VALUES (1, @t, @at)
     ON CONFLICT (id) DO UPDATE SET holder = @t, taken_at = @at
       WHERE schema_migration_lock.taken_at < @stale
     RETURNING holder`,
    { t: token, at: nowIso(), stale: new Date(Date.now() - LEASE_MS).toISOString() });
  return row?.holder === token;
}
const dropLease = (token) => run('DELETE FROM schema_migration_lock WHERE id = 1 AND holder = @t', { t: token })
  .catch(() => {});

/**
 * Apply pending migrations. Exactly one instance migrates; the others wait up to
 * `waitMs` for it and then refuse to serve on a schema that is not there yet —
 * a 503 the next request retries (ensureReady forgets a failed start), instead
 * of the "proceed, the schema is likely ready" that answered with errors about
 * missing columns until the migrating instance had finished.
 */
export async function migrate({ waitMs = 10_000 } = {}) {
  // Fast path — the common case on every serverless cold start. Check whether
  // any migration is still pending WITHOUT taking the lease. If the schema is
  // already current we return immediately.
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

  // There is real work to do. Never block on it: poll for the lease, and for the
  // schema to become ready because another instance finished first.
  const token = randomBytes(12).toString('hex');
  const until = Date.now() + waitMs;
  let got = await takeLease(token);
  while (!got) {
    if (await allApplied()) return 0;            // another instance finished
    if (Date.now() >= until) {
      const err = new Error('The shop is being updated — try again in a moment.');
      err.status = 503;
      throw err;
    }
    await new Promise((r) => setTimeout(r, 500));
    got = await takeLease(token);
  }

  try {
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
    await dropLease(token);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(() => { console.log('Migrations complete.'); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
