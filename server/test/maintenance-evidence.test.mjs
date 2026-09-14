/**
 * Did the sweep RUN — not "is a secret configured".
 *
 * Everything this shop does on its own happens in the hourly maintenance run:
 * paid orders swept for delivery, the supplier queue drained so a Kinguin
 * purchase has its key collected, failed emails retried, payment reminders and
 * review requests sent, IP addresses forgotten for the GDPR. All fire and
 * forget. All silent when it stops.
 *
 * ── WHAT WAS BEING REPORTED, AND WHY IT WAS WRONG ─────────────────────────
 * The health check answered a configuration question — `status: 'open'` when
 * CRON_SECRET was unset, with a note about locking the endpoint down. Both
 * halves were wrong:
 *
 *   Without the secret the endpoint is not OPEN, it REFUSES EVERYTHING in
 *   production, including Vercel's own cron — Vercel sends the Authorization
 *   header only when the secret exists. Verified against the live site:
 *   GET /api/cron/maintenance → 403 Bad cron secret, hourly, since deployment.
 *
 *   And "is a secret set" says nothing about whether the work happened. The
 *   shop survives on a fallback that rides live traffic, so a quiet shop simply
 *   goes without and every dashboard still reads green.
 *
 * So the sweep now records that it finished, and the checks read that record.
 */
import { migrate } from '../src/db/migrate.js';
import { run, get } from '../src/db/index.js';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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
const { runMaintenance, lastMaintenanceRun, LAST_RUN_KEY } =
  await import('../src/services/maintenanceService.js');
const { setSetting } = await import('../src/services/settingsService.js');

const forget = () => run('DELETE FROM kv WHERE key = @k', { k: LAST_RUN_KEY });
const backdate = (hoursAgo, errors = []) => setSetting(LAST_RUN_KEY, {
  at: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
  finishedAt: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
  errors,
});

/* The launch check reads config, which is read once at import — so each case
   is its own process, the same trap the Stripe suite documents. */
const checkUnder = (env) => {
  const r = spawnSync(process.execPath, ['-e', `
    const { launchChecks } = await import('${join(ROOT, 'server/src/services/launchCheckService.js')}');
    const out = await launchChecks();
    const rows = Array.isArray(out) ? out : (out.checks || []);
    console.log(JSON.stringify(rows.find((c) => c.id === 'maintenance') || {}));
    process.exit(0);
  `, '--input-type=module'], {
    encoding: 'utf8',
    env: { ...process.env, CRON_SECRET: '', NODE_ENV: 'development', ...env },
  });
  try { return JSON.parse((r.stdout || '').trim().split('\n').pop()); }
  catch { return { status: '?', detail: r.stderr }; }
};

console.log('— The sweep leaves a receipt —');
{
  await forget();
  const none = await lastMaintenanceRun();
  ok('before anything runs, it says so', none.everRan === false && none.at === null);
  /* Never run and long ago are different problems — "never wired up" versus
     "it stopped" — so they stay distinguishable. */
  ok('…and that counts as stale', none.stale === true);

  const summary = await runMaintenance();
  ok('a run reports no thrown steps on a healthy database',
    Object.keys(summary).filter((k) => /Error$/.test(k)).length === 0,
    Object.keys(summary).filter((k) => /Error$/.test(k)).join(','));

  const after = await lastMaintenanceRun();
  ok('afterwards the run is recorded', after.everRan === true && !!Date.parse(after.at));
  ok('…as fresh', after.stale === false && after.ageMinutes === 0);
  ok('…with the steps that threw, if any', Array.isArray(after.errors));

  const row = await get('SELECT value FROM kv WHERE key = @k', { k: LAST_RUN_KEY });
  ok('it lives in the kv table rather than a new one', !!row);

  /* Bookkeeping must never break the work it records. */
  const svc = codeOf('server/src/services/maintenanceService.js');
  ok('writing the receipt cannot fail the sweep',
    /setSetting\(LAST_RUN_KEY[\s\S]{0,400}\} catch \{/.test(svc));
}

console.log('\n— Stale is stale —');
{
  await backdate(9);
  const s = await lastMaintenanceRun();
  ok('nine hours ago is stale on an hourly schedule', s.stale === true, String(s.ageMinutes));
  ok('…and the age is reported in minutes', s.ageMinutes >= 540, String(s.ageMinutes));

  await backdate(1);
  ok('an hour ago is not', (await lastMaintenanceRun()).stale === false);

  ok('the window is a parameter, not a magic number',
    (await lastMaintenanceRun({ staleAfterHours: 0.5 })).stale === true);
}

console.log('\n— The health check reports evidence, not configuration —');
{
  const { healthSummary } = await import('../src/services/diagnosticsService.js');
  await forget();
  const never = (await healthSummary()).queue;
  ok('never run says never_run', never.status === 'never_run', never.status);
  ok('…and no longer claims the endpoint is "open"', never.status !== 'open');

  await runMaintenance();
  const now = (await healthSummary()).queue;
  ok('after a run it says running', now.status === 'running', now.status);
  ok('…with the timestamp attached', !!Date.parse(now.lastRunAt));
  ok('…and the age', now.lastRunAgeMinutes === 0);

  await backdate(9);
  ok('a stopped sweep says stale', (await healthSummary()).queue.status === 'stale');

  /* The storefront footer polls /api/health for its status dot. A sweep an
     hour late is not an outage, so ok stays true and the LAUNCH report is
     where this gets shouted about. */
  ok('a stale sweep does not turn the public status dot red',
    (await healthSummary()).queue.ok === true);
}

console.log('\n— What an unset CRON_SECRET actually does —');
{
  /* In production the guard evaluates to `!isProd` → false, so every caller is
     refused, Vercel's own cron included. That is the opposite of "open". */
  const route = codeOf('server/src/routes/cron.js');
  ok('the endpoint refuses everything in production without a secret',
    /: !config\.isProd;/.test(route));
  ok('…and the health note says that rather than calling it open',
    /REFUSED \(403\)/.test(read('server/src/services/diagnosticsService.js')));

  await runMaintenance();
  const noSecret = checkUnder({ NODE_ENV: 'production', APP_URL: 'https://www.forgemarket.nl' });
  ok('running only thanks to live traffic is a warning, not an ok',
    noSecret.status === 'warn', `${noSecret.status}: ${noSecret.detail}`);
  ok('…and it names the 403', /403/.test(noSecret.detail));
  ok('…and what to do about it', /CRON_SECRET/.test(noSecret.detail));

  const withSecret = checkUnder({ NODE_ENV: 'production', CRON_SECRET: 's3cret', APP_URL: 'https://www.forgemarket.nl' });
  ok('with the secret set and a fresh run, it is ok', withSecret.status === 'ok',
    `${withSecret.status}: ${withSecret.detail}`);
}

console.log('\n— A stopped sweep is a launch blocker —');
{
  await forget();
  const never = checkUnder({});
  ok('never having run is a FAIL', never.status === 'fail', never.status);
  /* The detail has to say what actually breaks, or it reads as housekeeping. */
  ok('…naming what stops: delivery', /swept for delivery/.test(never.detail));
  ok('…supplier keys', /keys collected/.test(never.detail));
  ok('…and the mails', /review request/.test(never.detail));

  await backdate(9);
  const stopped = checkUnder({});
  ok('having stopped is a FAIL too', stopped.status === 'fail', stopped.status);
  ok('…and says how long ago', /9h ago/.test(stopped.detail), stopped.detail);

  await backdate(0.2, ['emailRetryError', 'marketError']);
  const noisy = checkUnder({});
  ok('running but throwing is a warning', noisy.status === 'warn', noisy.status);
  ok('…naming the steps that threw',
    /emailRetryError/.test(noisy.detail) && /marketError/.test(noisy.detail), noisy.detail);

  await runMaintenance();
  ok('a healthy sweep is ok', checkUnder({}).status === 'ok');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} maintenance-evidence: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
