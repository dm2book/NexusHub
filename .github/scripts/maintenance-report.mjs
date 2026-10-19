// Reduce the maintenance summary to what is safe in a public Actions log:
// numeric counts, and the names of the steps that reported an error. No string
// value from the response is ever printed — error messages, product names and
// anything else free-form stay out. Keys are printed only if they look like
// the code identifiers the summary uses.
import { readFileSync } from 'node:fs';

const KEY = /^[A-Za-z][A-Za-z0-9_]{0,60}$/;
let summary;
try {
  summary = JSON.parse(readFileSync(process.argv[2], 'utf8'));
} catch {
  console.log('Summary could not be read (not printed).');
  process.exit(0);
}
if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
  console.log('Summary had an unexpected shape (not printed).');
  process.exit(0);
}

const counts = [];
const failed = [];
for (const [key, value] of Object.entries(summary)) {
  if (!KEY.test(key)) continue;
  if (/Error$/.test(key)) { failed.push(key); continue; }
  if (typeof value === 'number' && Number.isFinite(value)) counts.push(`${key}=${value}`);
  else if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [sub, v] of Object.entries(value)) {
      if (KEY.test(sub) && typeof v === 'number' && Number.isFinite(v)) counts.push(`${key}.${sub}=${v}`);
    }
  }
}
console.log(counts.length ? `Counts: ${counts.join(' ')}` : 'Counts: none');
if (failed.length) {
  console.log(`::warning::Maintenance steps that reported an error: ${failed.join(', ')} — details are in the admin (last maintenance run) and the Vercel logs.`);
}
