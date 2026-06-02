/**
 * Forward-only migration runner. Applies any .sql file in ./migrations that has
 * not yet been recorded in the schema_migrations table, in filename order.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, run, all, nowIso } from './index.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function migrate() {
  run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);

  const applied = new Set(all('SELECT id FROM schema_migrations').map((r) => r.id));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      run('INSERT INTO schema_migrations (id, applied_at) VALUES (@id, @at)', {
        id: file,
        at: nowIso(),
      });
      db.exec('COMMIT');
      count++;
      console.log(`✓ migrated ${file}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${err.message}`);
    }
  }
  if (!count) console.log('Schema already up to date.');
  return count;
}

// Allow `npm run migrate`.
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate();
  console.log('Migrations complete.');
}
