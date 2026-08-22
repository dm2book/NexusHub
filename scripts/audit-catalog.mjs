#!/usr/bin/env node
/**
 * Can every product on the shelf actually be delivered?
 *
 *   DATABASE_URL=postgres://… node scripts/audit-catalog.mjs
 *   DATABASE_URL=…             node scripts/audit-catalog.mjs --json
 *   DATABASE_URL=…             node scripts/audit-catalog.mjs --strict   # warnings block too
 *
 * Exit code 1 when anything FAILs (or, with --strict, when anything WARNs), so
 * it can gate a deploy or run as the last step before launch.
 *
 * The checks live in server/src/services/catalogAuditService.js, because the
 * readiness dashboard shows the same blockers and the two must never disagree.
 * What is here is the part a person reads: grouping, ordering, and an exit code.
 */
import { auditCatalog, CATALOG_CHECKS } from '../server/src/services/catalogAuditService.js';

const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');
const strict = args.has('--strict');

const result = await auditCatalog();
const { findings, checked } = result;
const { active, inactive, bundles, drops } = checked;
const fails = findings.filter((f) => f.level === 'FAIL');
const warns = findings.filter((f) => f.level === 'WARN');
const blocked = fails.length > 0 || (strict && warns.length > 0);

if (asJson) {
  console.log(JSON.stringify({
    ok: !blocked,
    checked,
    fail: fails.length, warn: warns.length, findings,
  }, null, 2));
} else {
  const C = process.stdout.isTTY
    ? { FAIL: '\x1b[31m', WARN: '\x1b[33m', PASS: '\x1b[32m', dim: '\x1b[2m', off: '\x1b[0m' }
    : { FAIL: '', WARN: '', PASS: '', dim: '', off: '' };

  console.log(`\nForgeMarket catalogue — ${active} active product(s)`
    + `${inactive ? `, ${inactive} inactive (not checked)` : ''}`
    + `${bundles ? `, ${bundles} bundle(s)` : ''}`
    + `${drops ? `, ${drops} upcoming drop(s)` : ''}\n`);

  /* One line per distinct problem, with the products underneath. The same
     finding on every product in the catalogue is one fact about the shop, not
     seventy-two facts about products. */
  const groups = new Map();
  for (const f of findings) {
    const k = `${f.level}|${f.code}`;
    if (!groups.has(k)) groups.set(k, { ...f, subjects: [] });
    groups.get(k).subjects.push(f.subject);
  }

  const SHOW = 8;
  for (const level of ['FAIL', 'WARN']) {
    const group = [...groups.values()].filter((g) => g.level === level)
      .sort((a, b) => b.subjects.length - a.subjects.length);
    if (!group.length) continue;
    const items = group.reduce((n, g) => n + g.subjects.length, 0);
    console.log(`${C[level]}${level}${C.off}  ${group.length} problem(s) across ${items} item(s)\n`);
    for (const g of group) {
      const n = g.subjects.length;
      const everything = n === active && active > 1;
      console.log(`  ${C[level]}${level}${C.off} ${C.dim}[${g.check}]${C.off} `
        + (everything ? 'every active product' : n > 1 ? `${n} products` : g.subjects[0]));
      // The message is per-product only when it names the product; a shared one
      // is printed once, which is the whole point of grouping.
      console.log(`       ${n > 1 ? g.detail.replace(/^\S/, (c) => c.toUpperCase()) : g.detail}`);
      if (n > 1 && !everything) {
        console.log(`       ${C.dim}${g.subjects.slice(0, SHOW).join(', ')}`
          + `${n > SHOW ? `, and ${n - SHOW} more` : ''}${C.off}`);
      }
      console.log(`       ${C.dim}→ ${g.fix}${C.off}\n`);
    }
  }

  /* Name what was checked, not just what broke. "No output" and "twelve checks
     ran and every product passed all of them" look identical otherwise, and
     only one of them is a reason to launch. */
  const hit = new Set(findings.map((f) => f.check));
  const clean = CATALOG_CHECKS.filter((c) => !hit.has(c));
  if (clean.length) console.log(`${C.PASS}PASS${C.off}  ${clean.join(', ')}\n`);

  console.log(blocked
    ? `${C.FAIL}NOT READY${C.off} — ${fails.length} blocker(s), ${warns.length} warning(s)`
      + `${strict && !fails.length ? ' (warnings block under --strict)' : ''}\n`
    : warns.length
      ? `${C.WARN}READY${C.off} — no blockers, ${warns.length} warning(s) worth reading\n`
      : `${C.PASS}READY${C.off} — every product on the shelf can be delivered\n`);
}

process.exit(blocked ? 1 : 0);
