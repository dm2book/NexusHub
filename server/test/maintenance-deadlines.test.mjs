/**
 * The maintenance sweep keeps to its deadline, and never rides on a payment
 * notification.
 *
 * The sweep checked its time budget only BETWEEN steps. A step that hung inside
 * one call — here a table lock, live it could be a mail or supplier server that
 * accepts the connection and never answers — held the whole run until the
 * database gave up (25 s). On Vercel's 30 s that is the end of the invocation:
 * every later step, and the receipt the health check reads, never happened.
 *
 * And the sweep was started by whatever request came in first in an hour —
 * a Pay. exchange call or a Stripe/Mollie webhook included, the one request
 * that has to settle an order inside its own time limit.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { ensureReady, createApp } = await import('../src/app.js');
await ensureReady();
const { run, get } = await import('../src/db/index.js');
const { runMaintenance, lastMaintenanceRun } = await import('../src/services/maintenanceService.js');

console.log('— A step that hangs is cut off at its deadline —');
{
  /* One expired sign-in code, and a trigger that makes deleting it hang. */
  await run(`INSERT INTO otp_codes (id, email, code_hash, expires_at, created_at)
             VALUES ('otp_hang', 'hang@test.local', 'x', @old, @old)`,
    { old: new Date(Date.now() - 3 * 86_400_000).toISOString() });
  await run(`CREATE OR REPLACE FUNCTION fm_test_hang() RETURNS trigger AS $$
             BEGIN PERFORM pg_sleep(60); RETURN OLD; END; $$ LANGUAGE plpgsql`);
  await run(`CREATE TRIGGER fm_test_hang BEFORE DELETE ON otp_codes FOR EACH ROW EXECUTE FUNCTION fm_test_hang()`);

  const t0 = Date.now();
  const deadline = t0 + 12_000;
  const s = await runMaintenance({ deadline });
  const took = Date.now() - t0;
  ok('the run returns by its deadline, not when the database gives up', took <= 12_500, `took ${took} ms`);
  ok('…the hung step is recorded as an error that says it was cut off',
    /step time limit/.test(s.otpError || ''), String(s.otpError));
  const rec = await lastMaintenanceRun();
  ok('…and the receipt is written, naming that step', rec.errors.includes('otpError'), JSON.stringify(rec.errors));
}

console.log('\n— A payment notification never carries the sweep —');
{
  const srv = createApp().listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const claimed = async () => !!(await get(`SELECT 1 AS x FROM kv WHERE key = 'interval:maintenance_auto'`));
  await run(`DELETE FROM kv WHERE key = 'interval:maintenance_auto'`);

  await fetch(`${base}/api/payments/paynl/exchange`, { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'action=new_ppt&order_id=none' }).catch(() => {});
  await fetch(`${base}/api/payments/stripe/webhook`, { method: 'POST', body: '{}' }).catch(() => {});
  await fetch(`${base}/api/payments/mollie/webhook`, { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'id=tr_none' }).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
  ok('Pay. exchange and Stripe/Mollie webhooks do not start it', !(await claimed()));

  await fetch(`${base}/api/health`).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
  ok('…the next ordinary request does', await claimed());
  srv.close();
}

console.log(`\n${fail ? '❌' : '✅'} maintenance-deadlines: ${pass} passed, ${fail} failed`);
// The hung DELETE is still sleeping in the database; nothing to wait for.
process.exit(fail ? 1 : 0);
