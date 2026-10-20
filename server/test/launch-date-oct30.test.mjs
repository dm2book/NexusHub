/**
 * The shop opens on Friday 30 October 2026 at 00:00 Amsterdam time.
 *
 * The owner moved the opening from 24 October to "volgende week vrijdag".
 * Summer time ends on 25 October, so Amsterdam midnight on the 30th is
 * 29 October 23:00 UTC (CET, UTC+1) — not 22:00 as it was for the 24th.
 * The site default and the bot's announcement default must agree.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const EXPECTED = '2026-10-29T23:00:00Z';

// The production default, read the way production reads it (no LAUNCH_DATE set).
const env = { ...process.env, NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(64) };
delete env.LAUNCH_DATE;
const prodDefault = execFileSync(process.execPath, ['--input-type=module', '-e',
  `const { config } = await import('${new URL('../src/config/env.js', import.meta.url).pathname}');
   process.stdout.write(String(config.launch.date));`], { env, encoding: 'utf8' }).trim();
ok('production opens at 29 Oct 23:00 UTC by default', prodDefault === EXPECTED, prodDefault);

const local = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', weekday: 'long',
  day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(EXPECTED));
ok('…which is Friday 30 October, 00:00 in Amsterdam', /vrijdag 30 oktober.*00:00/.test(local), local);

const panels = readFileSync(new URL('../../discord/src/panels.js', import.meta.url), 'utf8');
ok('the bot announces at the same moment', panels.includes(`DEFAULT_LAUNCH_DATE = '${EXPECTED}'`));

console.log(`\n${fail ? '❌' : '✅'} launch-date-oct30: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
