#!/usr/bin/env node
/**
 * One command: a real purchase in, a finished vertical advert out.
 *
 *   DATABASE_URL=… node scripts/ad/make-ad.mjs \
 *     --base=https://forgemarket.nl --sku=ROBUX-1000 --email=ads@yourdomain
 *
 * Runs the four steps in order and stops at the first one that fails, because
 * every later step would otherwise produce an advert for something that did not
 * happen:
 *
 *   1. sfx      generate the sound pack (skipped if it is already there)
 *   2. record   drive a REAL purchase and film it
 *   3. cards    render the price badge and end card in the shop's own fonts
 *   4. compose  cut, ramp, mask, mix, and encode for TikTok/Shorts/Reels
 *
 * Every flag not listed here is passed straight through to record.mjs, so
 * `--pay=`, `--slow=`, `--chrome=` and the rest work the same way.
 *
 * To make one advert per product, loop it — the output directory is derived
 * from the SKU, so they do not collide:
 *
 *   for sku in ROBUX-1000 VBUCKS-2800 VAL-1000; do
 *     DATABASE_URL=… node scripts/ad/make-ad.mjs --base=… --sku=$sku --email=… || break
 *   done
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { VARIANTS, variantById } from './variants.mjs';

const arg = (k, d = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};

const SKU = arg('sku') || arg('product');
const BASE = (arg('base') || process.env.AD_BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');
const TARGET = arg('target', '20');
if (!SKU) { console.error('Pass --sku=ROBUX-1000 (or --product=prd_xxx)'); process.exit(1); }

const slug = SKU.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const OUT = path.resolve(arg('out') || path.join('scripts', 'ad', 'out', slug));

/* Anything the wrapper does not consume itself belongs to the recorder. Listing
   the pass-throughs instead would mean this file needing an edit every time
   record.mjs grows a flag. */
const MINE = new Set(['sku', 'product', 'base', 'target', 'out', 'name', 'price', 'cta',
  'tagline', 'variant', 'variants']);
const passthrough = process.argv.slice(2)
  .filter((a) => a.startsWith('--') && !MINE.has(a.slice(2).split('=')[0]));

const step = (label, file, args) => {
  console.log(`\n━━ ${label}`);
  try {
    execFileSync(process.execPath, [path.join('scripts', 'ad', file), ...args], { stdio: 'inherit' });
  } catch {
    console.error(`\n✖ ${label} failed — stopping here rather than building an advert on top of it.\n`);
    process.exit(1);
  }
};

// 1. Sound. Cheap to check, and a missing pack fails compose at the very end.
if (!fs.existsSync(path.join('scripts', 'ad', 'sfx', 'notify.wav'))) {
  step('sound pack', 'sfx.mjs', []);
}

// 2. The purchase.
step('recording a real purchase', 'record.mjs',
  [`--base=${BASE}`, `--sku=${SKU}`, `--out=${OUT}`, ...passthrough]);

// 3. Cards, named from the product the recorder actually bought.
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'beats.json'), 'utf8'));
const p = manifest.product;
// Same formatting as the storefront and the captions — see variants.mjs.
const money = new Intl.NumberFormat('en-IE',
  { style: 'currency', currency: p.currency || 'EUR' }).format((p.price || 0) / 100);
step('cards', 'cards.mjs', [
  `--out=${OUT}`, `--base=${BASE}`,
  `--name=${arg('name') || p.name}`,
  `--price=${arg('price') || money}`,
  ...(arg('cta') ? [`--cta=${arg('cta')}`] : []),
  ...(arg('tagline') ? [`--tagline=${arg('tagline')}`] : []),
]);

/* 4. The edits.
   One recording, many cuts. `--variants=all` walks the whole set; a variant
   that cannot honestly be made from this footage skips itself with a reason
   (exit code 2) and the run carries on — one product without a published
   review should not cost you the other seven adverts. */
const want = arg('variants') === 'all' ? VARIANTS.map((v) => v.id)
  : (arg('variants') || arg('variant') || '').split(',').map((x) => x.trim()).filter(Boolean);

const made = []; const skipped = [];
if (!want.length) {
  step('composing', 'compose.mjs', [`--in=${OUT}`, `--target=${TARGET}`, `--base=${BASE}`]);
  made.push({ id: '—', file: path.join(OUT, 'ad.mp4') });
} else {
  for (const id of want) {
    const v = variantById(id);
    if (!v) { console.warn(`\n⚠ no variant "${id}"`); continue; }
    console.log(`\n━━ ${v.id} · ${v.name}`);
    const r = spawnSync(process.execPath,
      [path.join('scripts', 'ad', 'compose.mjs'),
        `--in=${OUT}`, `--variant=${v.id}`, `--base=${BASE}`,
        ...(arg('target') ? [`--target=${TARGET}`] : [])],
      { stdio: 'inherit' });
    if (r.status === 0) made.push({ id: v.id, name: v.name, file: path.join(OUT, `ad-${v.id}-${v.slug}.mp4`) });
    else if (r.status === 2) skipped.push(v);      // honestly not possible
    else {
      console.error(`\n✖ ${v.id} failed to render.\n`);
      process.exit(1);
    }
  }
}

const orderNumber = manifest.beats.find((b) => b.orderNumber)?.orderNumber || '?';
console.log('\n' + '─'.repeat(64));
console.log(`🎥 ${p.name} · ${money} · order ${orderNumber}`);
for (const m of made) console.log(`   ${String(m.id).padEnd(2)} ${path.basename(m.file)}`);
if (skipped.length) {
  console.log(`\n   skipped, because the footage does not support the claim:`);
  for (const v of skipped) console.log(`   ${v.id}  ${v.name}`);
}
console.log(manifest.realPayment
  ? '\n   Real payment. Caption it as you like.'
  : `\n   TEST purchase (${manifest.payment}). The delivery was real; the payment was not —\n`
    + '   do not caption this as a live sale.');
console.log('─'.repeat(64) + '\n');
