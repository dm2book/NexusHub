/**
 * Test runner: executes every *.test.mjs in this directory sequentially, each
 * against its own freshly-created Postgres database, so suites can never
 * pollute each other (test connectors, seeded rows, kv state).
 *
 * Usage:  node test/run-all.mjs        (from server/)
 * Env:    PG_ADMIN_URL  admin connection for CREATE/DROP DATABASE
 *                       (default postgres://postgres:postgres@127.0.0.1:5432/postgres)
 */
import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const ADMIN = process.env.PG_ADMIN_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres';

const files = readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort();
if (!files.length) { console.error('No *.test.mjs files found'); process.exit(1); }

const admin = new pg.Client({ connectionString: ADMIN });
await admin.connect();

const results = [];
for (const file of files) {
  const db = `fmtest_${file.replace(/[^a-z0-9]+/gi, '_').replace(/_test_mjs$/, '')}`.toLowerCase();
  await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${db}`);
  const url = new URL(ADMIN);
  url.pathname = `/${db}`;

  console.log(`\n━━ ${file} (db: ${db}) ━━`);
  const r = spawnSync(process.execPath, [join(here, file)], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: 'development' },
    timeout: 5 * 60_000,
  });
  results.push({ file, ok: r.status === 0 });
}

await admin.end();

/* The Discord bot's suites, in the same run.
 *
 * They live in discord/test and needed no database, so they were never in this
 * loop — and discord/package.json had no test script either, which meant 279
 * assertions were reachable only by naming a file by hand. One of them had been
 * failing: an assertion pinned to a call signature that changed when the shop
 * button gained attribution arguments. Nothing reported it, because nothing ran
 * it. A test nobody runs is not a safety net, it is a note claiming there is
 * one.
 *
 * Run as ONE entry in the summary rather than eight: this runner's unit is a
 * suite file, the bot's runner has its own, and flattening them would mean this
 * file knowing what is inside that directory. */
const discordDir = join(here, '..', '..', 'discord');
if (existsSync(join(discordDir, 'test', 'run-all.mjs'))) {
  console.log('\n━━ discord/test ━━');
  const r = spawnSync(process.execPath, [join(discordDir, 'test', 'run-all.mjs')], {
    stdio: 'inherit', env: process.env, timeout: 5 * 60_000,
  });
  results.push({ file: 'discord/test (8 suites)', ok: r.status === 0 });
}

console.log('\n══════════ SUMMARY ══════════');
for (const r of results) console.log(`  ${r.ok ? '✅' : '❌'} ${r.file}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} suite(s) FAILED` : '\nAll suites passed');
process.exit(failed ? 1 : 0);
