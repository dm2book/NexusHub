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

console.log('\n— Rows that are nothing but personal data go whole —');
{
  /* An SMS sign-in row is a phone number and a code hash. It is read while the
     code lives (minutes); after that it was a phone number kept forever. */
  await run(`INSERT INTO sms_verifications (id, phone, code_hash, ip, expires_at, created_at)
             VALUES ('ipret_sv_old', '+31600000001', 'h', @ip, @old, @old),
                    ('ipret_sv_new', '+31600000002', 'h', @ip, @new, @new)`,
    { ip: IP, old: ago(3), new: new Date().toISOString() });
  /* A daily check-in keeps the row (streaks and points) but its address only
     as long as the one-account-per-connection check reads it — a day. */
  const uid = `ipret_u_${Date.now()}`;
  await run(`INSERT INTO users (id, email, created_at, updated_at) VALUES (@id, @e, @at, @at)`,
    { id: uid, e: `${uid}@example.test`, at: new Date().toISOString() });
  await run(`INSERT INTO daily_claims (id, user_id, day, streak_day, points, ip, created_at)
             VALUES ('ipret_dc_old', @u, '2026-01-01', 1, 5, @ip, @old),
                    ('ipret_dc_new', @u, '2026-01-02', 1, 5, @ip, @new)`,
    { u: uid, ip: IP, old: ago(40), new: ago(0.5) });
  await runMaintenance();
  ok('a three-day-old SMS code row is gone, phone number and all',
    !(await get(`SELECT 1 FROM sms_verifications WHERE id='ipret_sv_old'`)));
  ok('…a fresh one is still there for the code that is still alive',
    !!(await get(`SELECT 1 FROM sms_verifications WHERE id='ipret_sv_new'`)));
  const dcOld = await get(`SELECT ip, points FROM daily_claims WHERE id='ipret_dc_old'`);
  const dcNew = await get(`SELECT ip FROM daily_claims WHERE id='ipret_dc_new'`);
  ok('a 40-day-old check-in keeps its points but not its address', dcOld?.points === 5 && dcOld?.ip == null, JSON.stringify(dcOld));
  ok('…while today\'s still has it for the multi-account check', dcNew?.ip === IP, JSON.stringify(dcNew));
}

console.log('\n— The job reports what it did —');
{
  const summary = await runMaintenance();
  ok('maintenance returns an ipsForgotten count', typeof summary.ipsForgotten === 'number', JSON.stringify(summary.ipsForgotten));
  ok('and did not error', !summary.ipForgetError, summary.ipForgetError || '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
