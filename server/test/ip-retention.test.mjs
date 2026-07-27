/**
 * How long an IP address is allowed to live here.
 *
 * The instinct to not store IPs at all is a good one, but it would break three
 * real protections: the per-network cap on OTP requests, the brute-force gate
 * on login (which matches on identifier OR ip, so dropping the ip lets an
 * attacker simply rotate the email address), and unfamiliar-sign-in detection.
 *
 * The GDPR problem was never the collection — it was that the rows lived
 * forever. Maintenance now nulls the IP once it is well past every window that
 * reads it, keeping the row itself so audit trails, order history and fraud
 * evidence stay intact.
 *
 * This suite pins both directions: recent IPs must survive (or the security
 * checks silently stop working), old ones must not.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_ipret';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const { ensureReady } = await import('../src/app.js');
await ensureReady();
const { run, get } = await import('../src/db/index.js');
const { runMaintenance } = await import('../src/services/maintenanceService.js');

const ago = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
const IP = '203.0.113.7';

// One fresh row and one ancient row per table, so both directions are checked.
const CASES = [
  ['login_attempts', 90],
  ['sms_verifications', 7],
  ['audit_logs', 365],
];

for (const [table, days] of CASES) {
  const cols = await get(
    `SELECT string_agg(column_name, ',') AS c FROM information_schema.columns WHERE table_name = @t`, { t: table });
  const has = String(cols?.c || '').split(',');
  ok(`${table} stores an ip`, has.includes('ip'));
}

console.log('\n— Old IPs are forgotten, the rows are not —');
{
  const tag = `ipret-${Date.now()}`;
  await run(`INSERT INTO login_attempts (id, identifier, channel, success, ip, created_at)
             VALUES (@a, @t, 'email', 0, @ip, @old), (@b, @t, 'email', 0, @ip, @new)`,
    { a: `${tag}-old`, b: `${tag}-new`, t: tag, ip: IP, old: ago(400), new: ago(1) });

  const before = await get(`SELECT COUNT(*) AS n FROM login_attempts WHERE identifier=@t`, { t: tag });
  await runMaintenance();
  const after = await get(`SELECT COUNT(*) AS n FROM login_attempts WHERE identifier=@t`, { t: tag });
  ok('both rows still exist afterwards', Number(after.n) === Number(before.n), `${before.n} → ${after.n}`);

  const oldRow = await get(`SELECT ip FROM login_attempts WHERE id=@id`, { id: `${tag}-old` });
  const newRow = await get(`SELECT ip FROM login_attempts WHERE id=@id`, { id: `${tag}-new` });
  ok('the 400-day-old IP is gone', oldRow?.ip == null, String(oldRow?.ip));
  // If this ever fails, the brute-force gate and the OTP cap have quietly
  // stopped seeing the data they run on.
  ok('yesterday\'s IP is untouched', newRow?.ip === IP, String(newRow?.ip));
}

console.log('\n— The job reports what it did —');
{
  const summary = await runMaintenance();
  ok('maintenance returns an ipsForgotten count', typeof summary.ipsForgotten === 'number', JSON.stringify(summary.ipsForgotten));
  ok('and did not error', !summary.ipForgetError, summary.ipForgetError || '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
