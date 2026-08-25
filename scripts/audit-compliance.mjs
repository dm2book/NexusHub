#!/usr/bin/env node
/**
 * Can this shop legally open?
 *
 *   DATABASE_URL=postgres://… node scripts/audit-compliance.mjs
 *   DATABASE_URL=…             node scripts/audit-compliance.mjs --json
 *
 * Exit code 1 when anything FAILs. OWNER items never change the exit code:
 * they are questions only the person running the business can answer, and
 * blocking on them would either stop the deploy forever or teach everyone to
 * pass a flag that skips them.
 *
 * WHAT THIS DOES NOT DO. It does not certify anything. Every check is a
 * specific, stated fact about configuration or source — "the terms claim VAT is
 * included and no VAT rate exists", not "VAT: compliant". A clear run means the
 * automated checks found nothing left to flag, and the report says exactly that
 * rather than the thing you would rather read.
 *
 * The checks live in server/src/services/complianceCheckService.js so the
 * admin readiness panel and this command can never disagree.
 */
import { auditCompliance, COMPLIANCE_AREAS } from '../server/src/services/complianceCheckService.js';

const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');

const { checks, summary, automatedChecksClear } = await auditCompliance();

if (asJson) {
  console.log(JSON.stringify({ automatedChecksClear, summary, checks }, null, 2));
  process.exit(summary.fail ? 1 : 0);
}

const C = process.stdout.isTTY
  ? { FAIL: '\x1b[31m', WARN: '\x1b[33m', OWNER: '\x1b[36m', PASS: '\x1b[32m', b: '\x1b[1m', dim: '\x1b[2m', off: '\x1b[0m' }
  : { FAIL: '', WARN: '', OWNER: '', PASS: '', b: '', dim: '', off: '' };
const TAG = { FAIL: 'FAIL ', WARN: 'WARN ', OWNER: 'YOU  ', PASS: 'ok   ' };

const wrap = (s, indent = 9, width = 84) => {
  const words = String(s).split(/\s+/);
  const lines = []; let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width - indent) { lines.push(line.trim()); line = w; }
    else line += ` ${w}`;
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join(`\n${' '.repeat(indent)}`);
};

/* WHICH configuration is being audited.

   Half of these checks read environment variables, so this command audits the
   environment it is run in — not the one that will be live. Run on a laptop it
   reads development defaults: DEMO_PAYMENTS is on, no Resend key is set, and
   the report shows blockers that are artefacts of the shell rather than
   properties of the deployment. Run it where production runs, or read the
   header and discount accordingly. */
const env = process.env.NODE_ENV || 'development';
const appUrl = process.env.APP_URL || '(APP_URL unset)';
console.log(`\n${C.b}ForgeMarket — launch compliance${C.off}`);
console.log(`${C.dim}auditing NODE_ENV=${env} · APP_URL=${appUrl}${C.off}`);
if (env !== 'production') {
  console.log(`${C.WARN}  ⚠ Not a production environment. Anything below that reads an environment`);
  console.log(`    variable — payments, email, the database host — is reporting this shell's`);
  console.log(`    defaults, not what will be live. Run this against production configuration`);
  console.log(`    before trusting the payment and email sections.${C.off}`);
}
console.log('');

for (const [area, label] of Object.entries(COMPLIANCE_AREAS)) {
  const rows = checks.filter((c) => c.area === area);
  if (!rows.length) continue;
  console.log(`${C.b}${label}${C.off}`);
  for (const r of rows) {
    console.log(`  ${C[r.level]}${TAG[r.level]}${C.off} ${r.title}`);
    if (r.detail) console.log(`         ${C.dim}${wrap(r.detail)}${C.off}`);
    if (r.action) console.log(`         → ${wrap(r.action)}`);
  }
  console.log('');
}

console.log('─'.repeat(84));
console.log(`  ${C.FAIL}${summary.fail} blocking${C.off}   ${C.WARN}${summary.warn} warning${C.off}`
  + `   ${C.OWNER}${summary.owner} need your real business information${C.off}`
  + `   ${C.PASS}${summary.pass} verified${C.off}`);

if (summary.fail) {
  console.log(`\n  ${C.FAIL}Do not open the shop until the blocking items are resolved.${C.off}`);
} else {
  /* The most important six lines in this file. A green run is the absence of
     detected problems, and saying anything stronger would make this tool worse
     than useless — it would be a document someone points at later. */
  console.log(`\n  The automated checks found nothing left to flag.`);
  console.log(`  ${C.dim}That is not a statement that this shop is legally compliant. These checks`);
  console.log(`  read configuration and source; they cannot see whether you are registered,`);
  console.log(`  whether the identity you published is real, whether your processing`);
  console.log(`  agreements exist, or whether the terms suit your business. The ${summary.owner} items`);
  console.log(`  marked YOU above are exactly the ones no audit can close for you.${C.off}`);
}
console.log('');
process.exit(summary.fail ? 1 : 0);
