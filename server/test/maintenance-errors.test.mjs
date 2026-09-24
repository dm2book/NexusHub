/**
 * A sweep step that fails has to fail small, and say why.
 *
 * Seen live on 24 September 2026: /api/health reported
 * `lastRunErrors: ["ipForgetError"]` and nothing else. The step that forgets
 * old IP addresses ran every table in one loop inside one try, so whichever
 * table threw first left every table after it holding addresses it should have
 * let go — and the message itself lived only in a runtime log that the hosting
 * plan keeps for an hour. By the time anybody looked, there was nothing to read.
 *
 * So: one table failing must not stop the others, the error must name the
 * table, and the message must be kept where the admin can read it — but never
 * printed on the public health endpoint.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { ensureReady } = await import('../src/app.js');
await ensureReady();
const { run, get } = await import('../src/db/index.js');
const { runMaintenance, lastMaintenanceRun } = await import('../src/services/maintenanceService.js');

const old = new Date(Date.now() - 400 * 86_400_000).toISOString();
await run(`INSERT INTO login_attempts (id, identifier, channel, ip, created_at)
           VALUES ('la_old', 'x@test.local', 'email', '203.0.113.7', @at)`, { at: old });
await run(`INSERT INTO sms_verifications (id, phone, code_hash, ip, expires_at, created_at)
           VALUES ('sv_old', '+31600000000', 'h', '203.0.113.8', @at, @at)`, { at: old });

/* The failure, reproduced: one table refuses the update. */
await run(`CREATE OR REPLACE FUNCTION fm_test_refuse() RETURNS trigger AS $$
           BEGIN RAISE EXCEPTION 'simulated lock timeout'; END; $$ LANGUAGE plpgsql`);
await run(`CREATE TRIGGER fm_test_refuse BEFORE UPDATE ON login_attempts
           FOR EACH ROW EXECUTE FUNCTION fm_test_refuse()`);

const s = await runMaintenance();

console.log('\n— One table fails, the rest still forget —');
{
  ok('the failing table is named in the error', /login_attempts: .*simulated lock timeout/.test(s.ipForgetError || ''),
    String(s.ipForgetError));
  const sms = await get(`SELECT ip FROM sms_verifications WHERE id='sv_old'`);
  ok('…and a table after it still has its old address forgotten', sms.ip === null, String(sms.ip));
  const la = await get(`SELECT ip FROM login_attempts WHERE id='la_old'`);
  ok('…while the failing one is left as it was, not half-written', la.ip === '203.0.113.7');
}

console.log('\n— The message outlives the log —');
{
  const last = await lastMaintenanceRun();
  ok('the run records which step failed', last.errors.includes('ipForgetError'), JSON.stringify(last.errors));
  ok('…and what it threw', /simulated lock timeout/.test(last.errorDetail?.ipForgetError || ''),
    JSON.stringify(last.errorDetail));

  const { launchChecks } = await import('../src/services/launchCheckService.js');
  const { checks } = await launchChecks();
  const sweep = checks.find((c) => c.id === 'maintenance');
  ok('the admin readiness check shows the message', /simulated lock timeout/.test(sweep?.detail || ''),
    sweep?.detail);

  /* The public health endpoint: which step, never what it said. */
  const { healthSummary } = await import('../src/services/diagnosticsService.js');
  const pub = JSON.stringify(await healthSummary());
  ok('the public health output still names the step', /ipForgetError/.test(pub), pub.slice(0, 200));
  ok('…but never carries the message', !/simulated lock timeout/.test(pub));
}

await run(`DROP TRIGGER IF EXISTS fm_test_refuse ON login_attempts`);
await run(`DROP FUNCTION IF EXISTS fm_test_refuse()`);

console.log(`\n${fail ? '❌' : '✅'} maintenance-errors: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
