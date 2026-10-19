/**
 * The hourly maintenance workflow must not publish anything sensitive.
 *
 * The repository is public, so every GitHub Actions log is readable by anyone.
 * The workflow printed the first 2000 bytes of the maintenance response — the
 * whole run summary, raw error messages included (SQL errors with table names,
 * supplier and payment-provider error text). Nothing had leaked yet only
 * because every run was skipped for want of CRON_SECRET; setting that secret
 * was on the launch checklist, and would have started publishing it hourly.
 *
 * This runs the workflow's own `run:` block — extracted from the YAML, run with
 * bash exactly as the runner would — against a stand-in shop that answers with
 * representative sensitive text, and checks what reaches the log.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const yml = readFileSync(join(root, '.github/workflows/maintenance.yml'), 'utf8');

/* The `run: |` block of the maintenance step, de-indented. */
function runBlock(text) {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => /^\s*run:\s*\|\s*$/.test(l));
  if (i < 0) return '';
  const indent = (lines[i + 1].match(/^\s*/) || [''])[0].length;
  const out = [];
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    if (l.trim() && (l.match(/^\s*/) || [''])[0].length < indent) break;
    out.push(l.slice(indent));
  }
  return out.join('\n');
}
const script = runBlock(yml);

const SECRET = 'cron-secret-VALUE-0b3f9c2e7d1a';
const SENSITIVE = [
  'relation "users" does not exist', 'password authentication failed for user "neondb_owner"',
  'buyer@example.com', 'sk_live_51HsecretSTRIPEkey', 'Bearer eyJhbGciOiJIUzI1NiJ9', 'FM-2026-ABCD1234',
  'Supplier API error: invalid apiKey k_9f8e7d', 'at Object.<anonymous> (/var/task/server/src/services/x.js:12:3)',
];
const summary = {
  otpPurged: 3, ordersCancelled: 2, remindersSent: 1, at: '2026-10-18T10:00:00.000Z',
  ipForgetError: `login_attempts: ${SENSITIVE[0]}; ${SENSITIVE[1]}`,
  supplierQueueError: SENSITIVE[6], emailRetryError: `smtp refused ${SENSITIVE[2]}`,
  paynlReconciled: { checked: 2, paid: 1, errors: 0 }, paynlReconcileError: `token ${SENSITIVE[4]}`,
  discoveryArtworkNone: `${SENSITIVE[5]}, Steam 50`, logosRefreshed: ['roblox', SENSITIVE[3]],
  supplierQueueSkipped: SENSITIVE[7],
};

let mode = 'ok';
let seenAuth = null;
const srv = http.createServer((req, res) => {
  seenAuth = req.headers.authorization || null;
  if (mode === 'hang') return; // never answers
  const body = mode === 'ok' ? JSON.stringify(summary)
    : JSON.stringify({ error: { message: `${SENSITIVE[1]} — got ${req.headers.authorization}` }, stack: SENSITIVE[7] });
  res.writeHead(mode === 'ok' ? 200 : mode === 'auth' ? 403 : 500, { 'content-type': 'application/json',
    'x-debug-token': SENSITIVE[4] });
  res.end(body);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${srv.address().port}`;

/* Asynchronous on purpose: the stand-in shop runs in this process, and a
   blocking spawn would stop it from ever answering. */
const exec = (env) => new Promise((resolve) => {
  const child = spawn('bash', ['-e', '-c', script], {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, SITE, GITHUB_RUN_ID: '4242', GITHUB_RUN_ATTEMPT: '1',
      MAINTENANCE_MAX_TIME: '3', ...env },
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const killer = setTimeout(() => child.kill('SIGKILL'), 30_000);
  child.on('close', (code) => { clearTimeout(killer); resolve({ code, out }); });
});
const clean = (out) => !out.includes(SECRET) && SENSITIVE.every((s) => !out.includes(s));
const leaked = (out) => [SECRET, ...SENSITIVE].filter((s) => out.includes(s)).join(' | ');

console.log('— A successful run —');
{
  mode = 'ok';
  const r = await exec({ CRON_SECRET: SECRET });
  ok('the secret reaches the shop as a Bearer token', seenAuth === `Bearer ${SECRET}`, String(seenAuth));
  ok('the log contains no secret and no raw error text', clean(r.out), leaked(r.out));
  ok('…but says it succeeded, with the status code and the run', /HTTP 200/.test(r.out) && /4242/.test(r.out), r.out);
  ok('…the counts', /ordersCancelled=2/.test(r.out) && /otpPurged=3/.test(r.out), r.out);
  ok('…and which steps reported an error, by name only', /ipForgetError/.test(r.out) && /supplierQueueError/.test(r.out), r.out);
  ok('the run passes', r.code === 0, String(r.code));
}

console.log('\n— Failed runs —');
for (const [m, label, cat] of [['auth', 'wrong secret (403)', /auth/], ['error', 'server error (500)', /server/], ['hang', 'no answer', /timeout|network/]]) {
  mode = m;
  const r = await exec({ CRON_SECRET: SECRET });
  ok(`${label}: the run fails`, r.code !== 0, String(r.code));
  ok(`${label}: no secret, body or header in the log`, clean(r.out), leaked(r.out));
  ok(`${label}: a short category is given`, cat.test(r.out), r.out);
}

console.log('\n— No secret configured —');
{
  mode = 'ok';
  seenAuth = null;
  const r = await exec({ CRON_SECRET: '' });
  ok('it skips quietly and calls nothing', r.code === 0 && /CRON_SECRET is not set/.test(r.out) && seenAuth === null, r.out);
}

console.log('\n— The workflow file —');
{
  ok('no shell trace (set -x)', !/set\s+-x/.test(yml) && !/set\s+-[a-z]*x/.test(script));
  ok('the response body is never printed raw', !/head\s+-c|cat\s+[^|]*body|body\.json/.test(script));
  ok('the token is not passed on the command line', !/-H\s+"Authorization: Bearer \$CRON_SECRET"/.test(script));
  const helper = join(root, '.github/scripts/maintenance-report.mjs');
  ok('the summary is reduced by a checked-in helper', existsSync(helper));
}

srv.close();
console.log(`\n${fail ? '❌' : '✅'} maintenance-workflow-log: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
