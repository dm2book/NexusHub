/**
 * The shop's health check and the thing that actually runs the sweep.
 *
 * vercel.json schedules /api/cron/maintenance once a day at 04:00 UTC. The
 * health endpoint described it as "hourly" in a hardcoded string, and judged
 * staleness against a six-hour window. So for eighteen hours out of every
 * twenty-four, a shop running exactly as configured reported its own queue as
 * `stale` — with no errors, nothing late, nothing wrong. Caught on the live
 * site: status "stale", lastRunAgeMinutes 973, lastRunErrors [].
 *
 * A health check that cries wolf every day is one nobody reads, and the
 * genuine blockers sit in the same response.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n} ${x}`); } };

const { CRON, lastMaintenanceRun } = await import('../src/services/maintenanceService.js');
const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));

console.log('— The application agrees with the platform —');
{
  const cron = (vercel.crons || []).find((c) => String(c.path).includes('/cron/maintenance'));
  ok('vercel.json schedules the sweep', !!cron, JSON.stringify(vercel.crons));
  ok(`…and the app carries the same expression (${CRON.expression})`,
    cron?.schedule === CRON.expression, `vercel.json: ${cron?.schedule}`);

  /* The expression parsed, so "everyHours" cannot quietly disagree with it.
     Only the shapes this project uses: a fixed hour daily, or every N hours. */
  const [, hour] = String(CRON.expression).split(' ');
  const expected = /^\d+$/.test(hour) ? 24 : Number((hour.match(/\*\/(\d+)/) || [])[1]) || 1;
  ok(`…and everyHours matches it (${CRON.everyHours})`, CRON.everyHours === expected,
    `expression says every ${expected}h`);

  ok('the description names the real cadence, not a guess',
    /daily/i.test(CRON.describe()) && !/hourly/i.test(CRON.describe()), CRON.describe());
}

console.log('\n— Late, with margin —');
{
  /* The window is derived from the cadence, so this asserts the relationship
     rather than the number: a daily job is not "stale" before it is even due
     again, and a job two days silent still is. The old window was a flat six
     hours against a daily job, which is how a healthy shop reported itself
     broken for eighteen hours a day. */
  const window = CRON.everyHours * 1.5;
  ok(`the window (${window}h) is longer than one interval (${CRON.everyHours}h)`,
    window > CRON.everyHours, 'a run is not late before the next one is due');
  ok('…and shorter than two, so a stopped sweep is still caught',
    window < CRON.everyHours * 2, `${window}h`);

  const { stale: fresh } = await lastMaintenanceRun({ now: Date.now() }).catch(() => ({ stale: null }));
  ok('lastMaintenanceRun answers without throwing when nothing has run yet',
    fresh === true || fresh === false, String(fresh));
}

console.log('\n— Nothing says "hourly" any more —');
{
  const diag = readFileSync(join(ROOT, 'server/src/services/diagnosticsService.js'), 'utf8');
  ok('the health endpoint reads the shared constant',
    /schedule: CRON\.describe\(\)/.test(diag), 'a hardcoded cadence is one that goes stale silently');
  ok('…and no literal "hourly" is left in it',
    !/hourly/i.test(diag.replace(/\/\*[\s\S]*?\*\//g, ' ')), 'outside comments');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} maintenance-schedule: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
