#!/usr/bin/env node
/**
 * Before against after, with the noise shown.
 *
 *   node scripts/perf/compare.mjs scripts/perf/results/before.json \
 *                                 scripts/perf/results/after.json
 *
 * A change smaller than the spread of the runs it came from is not a result,
 * and this prints the spread next to every number so that cannot be glossed
 * over. Anything inside the noise is marked `~` rather than given an arrow.
 */
import fs from 'node:fs';

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error('Pass two result files: compare.mjs before.json after.json');
  process.exit(1);
}
const A = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
const B = JSON.parse(fs.readFileSync(afterPath, 'utf8'));

/** Lower is better for all of these. */
const METRICS = [
  { key: 'fcp', label: 'FCP', unit: 'ms' },
  { key: 'lcp', label: 'LCP', unit: 'ms' },
  { key: 'tbt', label: 'TBT', unit: 'ms' },
  { key: 'cls', label: 'CLS', unit: '' },
  { key: 'jsBytes', label: 'JS', unit: 'KB', div: 1024 },
  { key: 'bytes', label: 'total', unit: 'KB', div: 1024 },
];

const n = (v, div) => (v == null ? null : Math.round((v / (div || 1)) * (div ? 1 : 1000)) / (div ? 1 : 1000));

function delta(before, after, spread) {
  if (before == null || after == null) return { text: '—', tone: 'flat' };
  const d = after - before;
  if (d === 0) return { text: '=', tone: 'flat' };
  if (!before) return { text: `+${after}`, tone: 'worse' };
  const pct = Math.round((d / before) * 100);
  // Inside the run-to-run spread, a difference is not a finding.
  if (spread != null && Math.abs(d) <= spread) return { text: `~ ${pct > 0 ? '+' : ''}${pct}%`, tone: 'flat' };
  return { text: `${d > 0 ? '+' : ''}${pct}%`, tone: d < 0 ? 'better' : 'worse' };
}

const MARK = { better: '↓', worse: '↑', flat: ' ' };

for (const profile of Object.keys(B.profiles)) {
  const pa = A.profiles[profile];
  const pb = B.profiles[profile];
  if (!pa || !pb) continue;
  console.log(`\n━━ ${pb.label} ━━`);

  for (const m of METRICS) {
    const rows = [];
    for (const page of Object.keys(pb.pages)) {
      const before = pa.pages[page]?.cold?.[m.key];
      const after = pb.pages[page]?.cold?.[m.key];
      if (before == null && after == null) continue;
      const spread = pb.pages[page]?.cold?.[`${m.key}Spread`];
      const fmt = (v) => (v == null ? '—'
        : m.div ? Math.round(v / m.div) : v);
      const d = delta(before, after, spread);
      rows.push({ page, before: fmt(before), after: fmt(after), d });
    }
    if (!rows.length) continue;
    console.log(`\n  ${m.label}${m.unit ? ` (${m.unit})` : ''}`);
    for (const r of rows) {
      console.log(`    ${r.page.padEnd(10)} ${String(r.before).padStart(7)} → ${String(r.after).padStart(7)}`
        + `   ${MARK[r.d.tone]} ${r.d.text}`);
    }
  }
}

console.log('\n  ↓ better · ↑ worse · ~ inside the run-to-run spread, so not a result\n');
