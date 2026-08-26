#!/usr/bin/env node
/**
 * Where is ForgeMarket in its launch, and what is stopping it?
 *
 *   DATABASE_URL=postgres://… node scripts/launch-status.mjs
 *   DATABASE_URL=…             node scripts/launch-status.mjs --json
 *
 * Two lists, because there are two shops. What must be true TODAY — Discord
 * running, the checkout shut — and what must be true ON THE DAY. Both are
 * checked every time, so the day's list is not discovered on the day.
 *
 * Exit code 1 when something is wrong for the phase the shop is actually in.
 * Launch-day items do not fail the command before launch; they are printed as
 * what is left to do, which is the difference between a checklist and a nag.
 *
 * This reads the environment it runs in. On a laptop that means laptop
 * defaults, and the header says so — the same caveat as audit-compliance.
 */
import { launchPlan, PHASE } from '../server/src/services/launchPlanService.js';

const args = new Set(process.argv.slice(2));
const plan = await launchPlan();

if (args.has('--json')) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(plan.prelaunch ? (plan.blockingNow ? 1 : 0) : (plan.blockingOnTheDay ? 1 : 0));
}

const C = process.stdout.isTTY
  ? { fail: '\x1b[31m', warn: '\x1b[33m', ok: '\x1b[32m', b: '\x1b[1m', dim: '\x1b[2m', off: '\x1b[0m' }
  : { fail: '', warn: '', ok: '', b: '', dim: '', off: '' };
const TAG = { fail: 'FAIL ', warn: 'WARN ', ok: 'ok   ' };

const wrap = (s, indent = 9, width = 86) => {
  const words = String(s).split(/\s+/);
  const lines = []; let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width - indent) { lines.push(line.trim()); line = w; }
    else line += ` ${w}`;
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join(`\n${' '.repeat(indent)}`);
};

const env = process.env.NODE_ENV || 'development';
console.log(`\n${C.b}ForgeMarket — launch status${C.off}`);
console.log(`${C.dim}NODE_ENV=${env}${plan.launchAt ? ` · opens ${plan.launchAt}` : ' · no LAUNCH_DATE set'}${C.off}`);
if (env !== 'production') {
  console.log(`${C.warn}  ⚠ Not production. Payment, email and Discord below read this shell's`);
  console.log(`    settings, not what is deployed.${C.off}`);
}

console.log(`\n  ${plan.prelaunch ? `${C.ok}CLOSED to the public${C.off}` : `${C.warn}OPEN to the public${C.off}`}`
  + ` ${C.dim}— ${plan.reason}${C.off}`);

const section = (phase, title, note) => {
  const rows = plan.items.filter((i) => i.phase === phase);
  if (!rows.length) return;
  console.log(`\n${C.b}${title}${C.off}`);
  if (note) console.log(`${C.dim}  ${note}${C.off}`);
  for (const r of rows) {
    console.log(`  ${C[r.status]}${TAG[r.status]}${C.off} ${r.label}`);
    if (r.detail) console.log(`         ${C.dim}${wrap(r.detail)}${C.off}`);
    if (r.action) console.log(`         → ${wrap(r.action)}`);
  }
};

section(PHASE.BEFORE, 'Now — Discord live, checkout shut',
  'Everything here must be true today.');
section(PHASE.DAY, `On the day — ${plan.launchAt ? plan.launchAt.slice(0, 10) : 'launch'}`,
  plan.prelaunch
    ? 'Not yet required. Checked anyway, because finding this out on the morning is too late.'
    : 'Required now — the shop is open.');

console.log(`\n${'─'.repeat(86)}`);
const nowBad = plan.blockingNow;
const dayBad = plan.blockingOnTheDay;

if (plan.prelaunch) {
  console.log(nowBad
    ? `  ${C.fail}${nowBad} thing(s) wrong for TODAY.${C.off} ${dayBad} still to do before the day.`
    : `  ${C.ok}Nothing wrong for today.${C.off} ${dayBad
      ? `${dayBad} thing(s) still to do before the day.` : 'The day\'s list is clear too.'}`);
  console.log(`\n  ${C.dim}The checkout is shut. To open it: set LAUNCH_DATE and let it lift by`);
  console.log(`  itself, or set LAUNCH_MODE=open deliberately. Nothing opens by accident —`);
  console.log(`  with neither set, a shop that has never taken a payment stays closed.${C.off}`);
} else {
  console.log(dayBad
    ? `  ${C.fail}The shop is OPEN and ${dayBad} thing(s) needed to serve a customer are wrong.${C.off}`
    : `  ${C.ok}Open, and the launch-day checks pass.${C.off}`);
}
console.log('');

process.exit(plan.prelaunch ? (nowBad ? 1 : 0) : (dayBad ? 1 : 0));
