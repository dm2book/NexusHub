#!/usr/bin/env node
/**
 * Every active product, and whether its picture is fit to launch with.
 *
 * Run it against whichever database you point DATABASE_URL at — including the
 * live one, which is the only place the real answer lives. Product art is
 * owner-supplied (an uploaded image, a pasted link, or a built-in icon), so the
 * catalogue in this repo is a sample, not the truth.
 *
 *   DATABASE_URL=postgres://… node scripts/audit-product-art.mjs
 *   DATABASE_URL=… node scripts/audit-product-art.mjs --json   # machine-readable
 *
 * It reports, per product:
 *   MISSING    no image at all, and no built-in icon for its category
 *   BROKEN     points at a same-origin file that is not in public/
 *   SHARED     the same picture as N other products
 *   MISMATCH   the icon belongs to a different category than the product
 *   HEAVY      an uploaded image large enough to hurt on a phone
 *   REMOTE     an external link — outside our control, checked but not fetched
 *
 * Exit code 1 when anything is MISSING or BROKEN, so it can gate a deploy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const asJson = process.argv.includes('--json');

/** Intrinsic size of a file we ship, without an image library. */
function intrinsic(file) {
  const buf = fs.readFileSync(file);
  if (file.endsWith('.svg')) {
    const head = buf.subarray(0, 600).toString('utf8');
    const w = head.match(/\bwidth="(\d+(?:\.\d+)?)"/);
    const h = head.match(/\bheight="(\d+(?:\.\d+)?)"/);
    const vb = head.match(/viewBox="[\d.\s-]*?([\d.]+)\s+([\d.]+)"/);
    if (w && h) return { w: +w[1], h: +h[1], sized: true };
    if (vb) return { w: +vb[1], h: +vb[2], sized: false };   // no intrinsic size
    return { w: 0, h: 0, sized: false };
  }
  if (file.endsWith('.webp')) {
    // RIFF….WEBP VP8[ L X]; enough of the header to read the canvas size.
    if (buf.subarray(8, 12).toString('ascii') !== 'WEBP') return { w: 0, h: 0, sized: true };
    const fourcc = buf.subarray(12, 16).toString('ascii');
    if (fourcc === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3), sized: true };
    if (fourcc === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff, sized: true };
    if (fourcc === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1, sized: true };
    }
  }
  return { w: 0, h: 0, sized: true };
}

const { all } = await import('../server/src/db/index.js');
const { iconFor } = await import('../src/lib/sampleCatalog.js');

const rows = await all(
  `SELECT id, name, category, metadata FROM products WHERE active = 1 ORDER BY category, name`);

const findings = [];
const usage = new Map();          // image src → [product names]

for (const r of rows) {
  let meta = {}; try { meta = JSON.parse(r.metadata || '{}'); } catch { /* keep {} */ }
  const own = meta.image || null;
  const fallback = iconFor(r.category);
  const src = own || fallback;
  const flags = [];
  let detail = '';

  if (!src) {
    flags.push('MISSING');
    detail = `no image set and no built-in icon for category "${r.category}"`;
  } else if (src.startsWith('data:')) {
    const bytes = Math.round(src.length * 0.75);
    detail = `uploaded, ~${Math.round(bytes / 1024)} KB`;
    if (bytes > 300_000) flags.push('HEAVY');
  } else if (/^https?:/i.test(src)) {
    flags.push('REMOTE');
    detail = new URL(src).host;
  } else if (src.startsWith('/')) {
    const file = path.join(PUBLIC, src.replace(/^\//, '').split('?')[0]);
    if (!fs.existsSync(file)) {
      flags.push('BROKEN');
      detail = `${src} is not in public/`;
    } else {
      const { w, h, sized } = intrinsic(file);
      const kb = Math.round(fs.statSync(file).size / 1024);
      detail = `${w || '?'}×${h || '?'}, ${kb} KB`;
      if (!sized) { flags.push('UNSIZED'); detail += ' — no width/height attribute'; }
      if (kb > 200) flags.push('HEAVY');
      // A product in category X wearing category Y's icon.
      const m = src.match(/\/products\/icons\/([a-z0-9-]+)\./i);
      if (m && !own && m[1] !== r.category) flags.push('MISMATCH');
    }
  }

  const list = usage.get(src) || [];
  list.push(r.name);
  usage.set(src, list);
  findings.push({ id: r.id, name: r.name, category: r.category, src, own: !!own, flags, detail });
}

// Sharing is only worth flagging when products that are NOT variants of one
// another wear the same picture — three Robux tiers sharing the Robux icon is
// the system working; a gift card and a battle pass sharing one is not.
for (const f of findings) {
  const sharers = usage.get(f.src) || [];
  if (sharers.length > 1) {
    const cats = new Set(findings.filter((x) => x.src === f.src).map((x) => x.category));
    if (cats.size > 1) f.flags.push('SHARED');
    f.shared = sharers.length;
  }
}

const bad = findings.filter((f) => f.flags.includes('MISSING') || f.flags.includes('BROKEN'));

if (asJson) {
  console.log(JSON.stringify({ total: findings.length, findings }, null, 2));
} else {
  const counts = {};
  for (const f of findings) for (const fl of f.flags) counts[fl] = (counts[fl] || 0) + 1;
  console.log(`\n${findings.length} active products\n`);
  const flagged = findings.filter((f) => f.flags.length);
  if (!flagged.length) console.log('  Nothing broken: every active product resolves to a file that exists.\n');
  for (const f of flagged) {
    console.log(`  ${f.flags.join(',').padEnd(16)} ${f.name.slice(0, 34).padEnd(36)} ${f.detail}${f.shared ? ` · shared with ${f.shared - 1}` : ''}`);
  }
  console.log('\n  ' + (Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  ') || 'nothing flagged'));
  console.log(`  ${findings.filter((f) => f.own).length} products use their own artwork, ` +
    `${findings.filter((f) => !f.own).length} fall back to a category icon.`);

  /* Duplication, reported whether or not it is "wrong".
     Five Robux tiers sharing the Robux icon is the mapping working exactly as
     designed — and it still means a shopper scrolling the Robux category sees
     five identical pictures with different prices under them. That is the
     "duplicated imagery" worth knowing about before launch, so it is counted
     rather than hidden behind a rule about whether it is a defect. */
  const dupes = [...usage.entries()]
    .filter(([, names]) => names.length > 1)
    .sort((a, b) => b[1].length - a[1].length);
  if (dupes.length) {
    const affected = dupes.reduce((n, [, names]) => n + names.length, 0);
    console.log(`\n  ${dupes.length} pictures are shared by ${affected} products:`);
    for (const [src, names] of dupes.slice(0, 20)) {
      const label = src.startsWith('data:') ? 'uploaded image' : src.replace('/products/icons/', '');
      console.log(`    ${String(names.length).padStart(2)}× ${label.slice(0, 34).padEnd(36)} ${names.slice(0, 3).join(', ').slice(0, 60)}${names.length > 3 ? ' …' : ''}`);
    }
    if (dupes.length > 20) console.log(`    …and ${dupes.length - 20} more`);
  }
  console.log('');
}

process.exit(bad.length ? 1 : 0);
