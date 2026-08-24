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
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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
const MINE = new Set(['sku', 'product', 'base', 'target', 'out', 'name', 'price', 'cta', 'tagline']);
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
const money = new Intl.NumberFormat('nl-NL',
  { style: 'currency', currency: p.currency || 'EUR' }).format((p.price || 0) / 100);
step('cards', 'cards.mjs', [
  `--out=${OUT}`, `--base=${BASE}`,
  `--name=${arg('name') || p.name}`,
  `--price=${arg('price') || money}`,
  ...(arg('cta') ? [`--cta=${arg('cta')}`] : []),
  ...(arg('tagline') ? [`--tagline=${arg('tagline')}`] : []),
]);

// 4. The edit.
step('composing', 'compose.mjs', [`--in=${OUT}`, `--target=${TARGET}`]);

const file = path.join(OUT, 'ad.mp4');
console.log('\n' + '─'.repeat(60));
console.log(`🎥 ${file}`);
console.log(`   ${p.name} · ${money} · order ${manifest.beats.find((b) => b.orderNumber)?.orderNumber || '?'}`);
console.log(manifest.realPayment
  ? '   Real payment. Caption it as you like.'
  : `   TEST purchase (${manifest.payment}). The delivery was real; the payment was not —\n`
    + '   do not caption this as a live sale.');
console.log('─'.repeat(60) + '\n');
