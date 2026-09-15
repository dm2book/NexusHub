/**
 * Runs every *.test.mjs beside this file.
 *
 * These eight suites — 279 assertions covering the funnel, permissions, the
 * scam guard, tickets and the server blueprint — were reachable only by naming
 * a file by hand. `discord/package.json` had no test script and the server's
 * runner scans `server/test/` only, so nothing in any normal run touched them.
 *
 * One of them had been failing: a funnel assertion pinned to a call signature
 * that changed when the shop button gained attribution arguments. A test nobody
 * runs is not a safety net, it is a note claiming there is one.
 *
 * No database here, unlike the server's runner: the bot's suites read source
 * and exercise pure functions, so they are plain subprocesses.
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort();
if (!files.length) { console.error('No *.test.mjs files found'); process.exit(1); }

const results = [];
for (const file of files) {
  console.log(`\n━━ discord/${file} ━━`);
  const r = spawnSync(process.execPath, [join(here, file)], {
    stdio: 'inherit', env: process.env, timeout: 2 * 60_000,
  });
  results.push({ file, ok: r.status === 0 });
}

console.log('\n═════════ DISCORD SUMMARY ═════════');
for (const r of results) console.log(`  ${r.ok ? '✅' : '❌'} ${r.file}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} discord suite(s) FAILED` : '\nAll discord suites passed');
process.exit(failed ? 1 : 0);
