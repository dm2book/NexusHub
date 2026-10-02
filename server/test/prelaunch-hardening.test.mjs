/**
 * Three fixes read out of a week of production logs, before launch.
 *
 *   1. "[boot] background upkeep: Query read timeout" ×44 — a hundred queries
 *      on every cold start. Now once per deploy, claimed in one statement, and
 *      given back if it fails so the next cold start retries.
 *   2. pg's SECURITY WARNING about sslmode=require ×390 — written as the
 *      verify-full it already means, so pg 9 cannot quietly weaken it; and the
 *      no-sslmode fallback checks the certificate instead of skipping it.
 *   3. "Task timed out after 30 seconds" on the night the weekly backup ran —
 *      the backup has its own cron and its own time budget now.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const fs = await import('node:fs');
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { get, run } = await import('../src/db/index.js');
const { pgConnectionString } = await import('../src/db/index.js');
const boot = await import('../src/services/bootUpkeep.js');
const maint = await import('../src/services/maintenanceService.js');

console.log('\n— 1. Upkeep once per deploy —');
{
  ok('the deploy is Vercel\'s deployment id', boot.deployKey({ VERCEL_DEPLOYMENT_ID: 'dpl_1', VERCEL_GIT_COMMIT_SHA: 'abc' }) === 'dpl_1');
  ok('…or the commit', boot.deployKey({ VERCEL_GIT_COMMIT_SHA: 'abc' }) === 'abc');
  ok('…or nothing off Vercel', boot.deployKey({}) === null);

  await run(`DELETE FROM kv WHERE key = 'boot_upkeep_deploy'`);
  ok('off Vercel, every boot runs it, as before', (await boot.claimUpkeep(null)) && (await boot.claimUpkeep(null)));
  ok('the first cold start of a deploy runs it', await boot.claimUpkeep('dpl_A'));
  ok('…the next ones skip it', !(await boot.claimUpkeep('dpl_A')) && !(await boot.claimUpkeep('dpl_A')));
  ok('a new deploy runs it again', await boot.claimUpkeep('dpl_B'));

  const both = await Promise.all([boot.claimUpkeep('dpl_C'), boot.claimUpkeep('dpl_C'), boot.claimUpkeep('dpl_C')]);
  ok('three instances starting together: exactly one wins', both.filter(Boolean).length === 1, JSON.stringify(both));

  await boot.releaseUpkeep('dpl_C');
  ok('a failed run gives the claim back, so the next cold start retries', await boot.claimUpkeep('dpl_C'));
  await boot.releaseUpkeep('dpl_OTHER');
  ok('…and releasing another deploy\'s claim does nothing', !(await boot.claimUpkeep('dpl_C')));

  const app = read('src/app.js');
  ok('the boot path claims before working and releases on failure',
    /claimUpkeep\(deploy\)/.test(app) && /releaseUpkeep\(deploy\)/.test(app) && app.indexOf('claimUpkeep(deploy)') < app.indexOf('syncCatalogImages'));
}

console.log('\n— 1b. Background work is kept alive, and runs once for the whole shop —');
{
  /* Read live: "Query read timeout" on random tables, empty ones too, all
     from [maintenance:auto] — work left running after the response, frozen
     with the function, timing out on the thaw; and one sweep per instance. */
  await run(`DELETE FROM kv WHERE key = 'interval:test_sweep'`);
  const t0 = Date.now();
  ok('the first instance in an hour gets the sweep', await boot.claimInterval('test_sweep', 3_600_000, { now: t0 }));
  ok('…another one ten minutes later does not', !(await boot.claimInterval('test_sweep', 3_600_000, { now: t0 + 600_000 })));
  ok('…an hour later one does again', await boot.claimInterval('test_sweep', 3_600_000, { now: t0 + 3_700_000 }));
  const race = await Promise.all([1, 2, 3, 4].map(() => boot.claimInterval('test_sweep', 3_600_000, { now: t0 + 7_400_000 })));
  ok('four instances at once: exactly one runs it', race.filter(Boolean).length === 1, JSON.stringify(race));

  const app = read('src/app.js');
  const sweep = app.slice(app.indexOf('let lastMaintenanceAt'), app.indexOf('// Structured request logging'));
  ok('the traffic sweep is wrapped in waitUntil', /waitUntil\(/.test(sweep) && /runMaintenance\(\)/.test(sweep));
  ok('…and claims its hour in the database first', sweep.indexOf("claimInterval('maintenance_auto'") < sweep.indexOf('runMaintenance()'));
  ok('the boot upkeep is kept alive too', /waitUntil\(Promise\.resolve\(\)\.then\(async/.test(app));
  ok('waitUntil comes from Vercel\'s own package, a dependency of the deployed bundle',
    /from '@vercel\/functions'/.test(app) && /"@vercel\/functions"/.test(read('../package.json')));
  const { waitUntil } = await import('@vercel/functions');
  ok('…and is harmless off Vercel', waitUntil(Promise.resolve()) === undefined);
}

console.log('\n— 2. TLS to the database —');
{
  const U = 'postgres://u:p@ep-x.eu-central-1.aws.neon.tech/db';
  ok('sslmode=require becomes verify-full', new URL(pgConnectionString(`${U}?sslmode=require`)).searchParams.get('sslmode') === 'verify-full');
  ok('…prefer and verify-ca too', ['prefer', 'verify-ca'].every((m) =>
    new URL(pgConnectionString(`${U}?sslmode=${m}`)).searchParams.get('sslmode') === 'verify-full'));
  ok('other parameters are kept', new URL(pgConnectionString(`${U}?sslmode=require&channel_binding=require`)).searchParams.get('channel_binding') === 'require');
  ok('verify-full, disable and libpq-compat are left alone',
    [`${U}?sslmode=verify-full`, `${U}?sslmode=disable`, `${U}?uselibpqcompat=true&sslmode=require`].every((u) => pgConnectionString(u) === u));
  ok('no sslmode, and nothing, are left alone', pgConnectionString(U) === U && pgConnectionString('') === '' && pgConnectionString('not a url') === 'not a url');

  /* What pg itself makes of it: the same verification as before, minus the warning. */
  const { parse } = await import('pg-connection-string');
  const warnings = [];
  const onWarn = (w) => warnings.push(String(w.message));
  process.on('warning', onWarn);
  const cfg = parse(pgConnectionString(`${U}?sslmode=require`));
  await new Promise((r) => setTimeout(r, 20));
  process.off('warning', onWarn);
  ok('pg still verifies the certificate', cfg.ssl && cfg.ssl.rejectUnauthorized !== false, JSON.stringify(cfg.ssl));
  ok('…and no longer warns', !warnings.some((w) => /SSL modes/.test(w)), warnings.join(' | '));

  const db = read('src/db/index.js');
  ok('the fallback checks the certificate unless explicitly told not to',
    /rejectUnauthorized: process\.env\.DATABASE_SSL_INSECURE !== 'true'/.test(db) && !/rejectUnauthorized: false\s*}/.test(db));
  ok('the pool uses the normalised string', /connectionString: pgConnectionString\(connectionString\)/.test(db));
}

console.log('\n— 3. The backup on its own clock —');
{
  const vercel = JSON.parse(read('../vercel.json'));
  const cron = (vercel.crons || []).find((c) => c.path === maint.BACKUP_CRON.path);
  ok('vercel.json schedules the backup', cron?.schedule === maint.BACKUP_CRON.expression, JSON.stringify(vercel.crons));
  ok('…half an hour after the sweep, not at the same time',
    (vercel.crons || []).find((c) => c.path.includes('maintenance'))?.schedule === '0 4 * * *' && cron?.schedule === '30 4 * * *');

  await run(`DELETE FROM kv WHERE key = 'backup_last_at'`);
  const sweep = await maint.runMaintenance();
  ok('the sweep no longer takes a backup', sweep.backupBytes === undefined && sweep.backupError === undefined, JSON.stringify(Object.keys(sweep)));
  ok('…not even when one is due', !(await get(`SELECT 1 FROM kv WHERE key='backup_last_at'`)));

  const srv = createApp().listen(0);
  const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/cron/backup`);
  const body = await res.json();
  srv.close();
  ok('the backup job takes one when due', res.status === 200 && body.due === true && body.backupRows > 0, JSON.stringify(body));
  const again = await maint.runScheduledBackup();
  ok('…and not again the next day', again.due === false && again.backupRows === undefined);
  ok('it is protected like the sweep', /router\.get\('\/cron\/backup'[\s\S]{0,80}assertCron\(req\)/.test(read('src/routes/cron.js')));
}

console.log(`\n${fail ? '❌' : '✅'} prelaunch-hardening: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
