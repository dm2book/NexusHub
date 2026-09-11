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
import { VARIANTS, variantById, tokensFor, fill, blockedReason } from './variants.mjs';
import { HOOKS, hookById, eligibleHooks, hookBlockedReason } from './hooks.mjs';
/* The twenty-five brand concepts are the same kind of thing as a variant —
   same scene grammar, same needs gate — so --concept resolves through the
   same lookup and everything downstream is unchanged. */
import { CONCEPTS, conceptById } from './concepts.mjs';
/* Ten cuts of one purchase, composed from a pace and a focus — see cuts.mjs. */
import { CUTS, cutById } from './cuts.mjs';
/* Score every cut against this recording and render only the ones worth it. */
import { rank, best, scorecard } from './score.mjs';
import { gatherEvidence } from './claims.mjs';

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
  'tagline', 'variant', 'variants', 'concept', 'concepts', 'cut', 'cuts',
  'sound', 'sounds', 'score', 'best']);
const passthrough = process.argv.slice(2)
  .filter((a) => a.startsWith('--') && !MINE.has(a.slice(2).split('=')[0]));

/* Which mix. Passed to every compose call rather than to the recorder — the
   sound is an edit decision, and `--sounds=all` gives four mixes of one video. */
const SOUND = arg('sounds') ? [`--sounds=${arg('sounds')}`]
  : arg('sound') ? [`--sound=${arg('sound')}`] : [];

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

/* 2. The purchase.
 *
 * Reused when this directory already holds one. Buying something and filming it
 * is the expensive half of this pipeline — it costs money, it consumes a code,
 * and it trips the shop's own order limiter if you do it repeatedly — while
 * changing the first two seconds costs nothing. `--reuse` (implied by any
 * `--hooks=` run) cuts again from the footage that is already there.
 *
 * Refused rather than assumed when the directory is empty: an advert built on
 * a recording that does not exist is the one failure this toolkit must never
 * produce quietly. */
const alreadyRecorded = fs.existsSync(path.join(OUT, 'beats.json'))
  && fs.existsSync(path.join(OUT, 'raw.webm'));
/* Scoring and picking the best both work off a recording that already exists —
   that is the entire point of scoring from the plan. Neither should ever buy
   something to answer a question about the edit. */
const REUSE = process.argv.includes('--reuse') || process.argv.includes('--score')
  || !!(arg('hooks') || arg('hook') || arg('cuts') || arg('cut') || arg('score') || arg('best'));

if (REUSE && alreadyRecorded) {
  console.log(`\n♻  reusing the recording in ${OUT} — nothing is bought or filmed again`);
} else {
  if (REUSE) {
    console.error(`\n✖ nothing to reuse in ${OUT} — no recording there yet.\n`);
    process.exit(1);
  }
  step('recording a real purchase', 'record.mjs',
    [`--base=${BASE}`, `--sku=${SKU}`, `--out=${OUT}`, ...passthrough]);
}

// 3. Cards, named from the product the recorder actually bought.
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'beats.json'), 'utf8'));
const p = manifest.product;
// Same formatting as the storefront and the captions — see variants.mjs.
const money = new Intl.NumberFormat('en-IE',
  { style: 'currency', currency: p.currency || 'EUR' }).format((p.price || 0) / 100);
if (!(REUSE && fs.existsSync(path.join(OUT, 'endcard.png')))) step('cards', 'cards.mjs', [
  `--out=${OUT}`, `--base=${BASE}`,
  `--name=${arg('name') || p.name}`,
  `--price=${arg('price') || money}`,
  /* The product's own artwork, straight off the row the recorder bought. A
     product without one simply gets no hero — nothing is drawn to stand in. */
  ...(p.image ? [`--image=${p.image}`] : []),
  ...(arg('cta') ? [`--cta=${arg('cta')}`] : []),
  ...(arg('tagline') ? [`--tagline=${arg('tagline')}`] : []),
]);

/* 4. The edits.
   One recording, many cuts. `--variants=all` walks the whole set; a variant
   that cannot honestly be made from this footage skips itself with a reason
   (exit code 2) and the run carries on — one product without a published
   review should not cost you the other seven adverts. */
const conceptsWanted = arg('concepts') === 'all' ? CONCEPTS.map((c) => c.id)
  : (arg('concepts') || arg('concept') || '').split(',').map((x) => x.trim()).filter(Boolean);
const want = [
  ...(arg('variants') === 'all' ? VARIANTS.map((v) => v.id)
    : (arg('variants') || arg('variant') || '').split(',').map((x) => x.trim()).filter(Boolean)),
  ...conceptsWanted,
];

/* 4b. The openings.
   `--hooks=all` emits one advert per hook the footage can honestly support,
   from the SAME recording — the expensive half of this pipeline is buying
   something and filming it, and swapping the first two seconds does not need
   either done again. `--hooks=list` says which are possible and stops.

   A hook the footage cannot support exits 2 and the batch carries on, exactly
   like a variant that cannot be made: a product with no published review should
   not cost you the eight other openings. */
const hooksArg = arg('hooks') || arg('hook') || '';
/* The same two side files compose reads, so a hook is judged against exactly
   the facts the advert would be built from. */
const readSide = (f, d) => {
  try { return JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')); } catch { return d; }
};
const order = readSide('order.json', null);
const extras = readSide('extras.json', {});
const hookTokens = tokensFor({
  product: { ...manifest.product, instant: extras.instant },
  order, review: extras.review, stock: extras.stockLeft, mystery: extras.mystery,
  lang: arg('lang', 'nl'), provenance: manifest.provenance,
});
const eligible = eligibleHooks(hookTokens, fill);

if (hooksArg === 'list') {
  console.log(`\n🪝 ${eligible.length} of ${HOOKS.length} hooks are possible for ${p.name}\n`);
  for (const h of HOOKS) {
    const why = hookBlockedReason(h, hookTokens);
    const line = fill(h.text, hookTokens);
    console.log(why
      ? `   ✗ ${h.id.padEnd(15)} ${h.type.padEnd(18)} ${why}`
      : `   ✓ ${h.id.padEnd(15)} ${h.type.padEnd(18)} ${line}`);
  }
  console.log('');
  process.exit(0);
}
const wantHooks = hooksArg === 'all' ? eligible.map((h) => h.id)
  : hooksArg.split(',').map((x) => x.trim()).filter(Boolean);

/* 4d. Scoring.
   Every cut is scored from its PLAN — no rendering needed — which is what makes
   "the best three for this product" cheap: score twenty-three, render three.
   An advert carrying a claim the shop cannot prove is rejected outright and
   never reaches a file. */
const at = (label) => manifest.beats.find((b) => b.label === label)?.atMs ?? null;
const evidence = gatherEvidence({
  product: { ...manifest.product, instant: extras.instant, deliveryLine: hookTokens.delivery },
  extras, review: extras.review, stats: extras.stats, lang: arg('lang', 'nl'),
});
const ALL = [...VARIANTS, ...CUTS];
const scoreCtx = { at, tokens: hookTokens, evidence };

if (process.argv.includes('--score') || arg('score')) {
  const rows = rank(ALL, scoreCtx);
  const one = arg('score');
  console.log(`\n📊 ${p.name} — ${rows.filter((r) => r.verdict === 'ok').length} of ${rows.length} can be made\n`);
  for (const r of rows) {
    if (one && one !== 'all' && r.id !== one && r.slug !== one) continue;
    for (const l of scorecard(r, { detail: !!one })) console.log(l);
  }
  console.log('');
  process.exit(0);
}

const BEST = Number(arg('best', '0')) || 0;
const made = []; const skipped = [];

if (BEST) {
  const { picked, alsoTied, rejected } = best(ALL, scoreCtx, BEST);
  console.log(`\n📊 best ${picked.length} of ${ALL.length} for ${p.name}\n`);
  for (const r of picked) for (const l of scorecard(r, { detail: false })) console.log(l);
  if (alsoTied.length) {
    console.log(`\n   ${alsoTied.length} more tied at ${picked.at(-1).total}: `
      + `${alsoTied.map((r) => r.slug).join(', ')}`);
    console.log('   Not broken by a coin toss — they prove the same things and differ only in pace.');
  }
  const refused = rejected.filter((r) => r.verdict === 'rejected');
  if (refused.length) {
    console.log(`\n   ${refused.length} rejected for claims this shop cannot prove:`);
    for (const r of refused) console.log(`   ✗ ${r.slug} — ${r.why}`);
  }
  for (const r of picked) {
    console.log(`\n━━ ${r.id} · ${r.name} — ${r.total}/100`);
    const flag = r.family === 'cut' ? `--cut=${r.id}` : `--variant=${r.id}`;
    const res = spawnSync(process.execPath,
      [path.join('scripts', 'ad', 'compose.mjs'), `--in=${OUT}`, flag, `--base=${BASE}`, ...SOUND],
      { stdio: 'inherit' });
    if (res.status === 0) {
      made.push({ id: r.id, name: `${r.name} (${r.total}/100)`,
        file: path.join(OUT, `ad-${r.family === 'cut' ? 'cut-' : ''}${r.id}-${r.slug}.mp4`) });
    } else if (res.status === 2) skipped.push({ id: r.id, name: r.name });
    else { console.error(`\n✖ ${r.id} failed to render.\n`); process.exit(1); }
  }
}


/* 4c. The ten cuts.
   Same recording, same beats, same order — only the montage, the opening, the
   timing, the zooms, the transitions, the captions and the closing line differ.
   `--cuts=all` walks the set; one that cannot honestly be made from this
   footage skips itself with a reason and the run carries on. */
const cutsArg = arg('cuts') || arg('cut') || '';
if (cutsArg === 'list') {
  console.log(`\n🎞  ${CUTS.length} cuts of one recording\n`);
  for (const c of CUTS) {
    const why = blockedReason(c, { tokens: hookTokens, order, review: extras.review, mystery: extras.mystery });
    console.log(`   ${why ? '✗' : '✓'} ${c.id}  ${c.slug.padEnd(14)} ${String(c.target).padStart(2)}s  `
      + `${c.pace.padEnd(9)} ${c.focus.padEnd(9)} ${why || fill(c.hook, hookTokens) || ''}`);
  }
  console.log('');
  process.exit(0);
}
const wantCuts = cutsArg === 'all' ? CUTS.map((c) => c.id)
  : cutsArg.split(',').map((x) => x.trim()).filter(Boolean);

if (BEST) { /* already rendered above */ }
else if (wantCuts.length) {
  console.log(`\n🎞  ${wantCuts.length} cut(s) of one purchase`);
  for (const id of wantCuts) {
    const c = cutById(id);
    if (!c) { console.warn(`\n⚠ no cut "${id}"`); continue; }
    console.log(`\n━━ ${c.id} · ${c.name} — ${c.pace}, on ${c.focus}`);
    const r = spawnSync(process.execPath,
      [path.join('scripts', 'ad', 'compose.mjs'),
        `--in=${OUT}`, `--cut=${c.id}`, `--base=${BASE}`, ...SOUND],
      { stdio: 'inherit' });
    if (r.status === 0) made.push({ id: c.id, name: c.name, file: path.join(OUT, `ad-cut-${c.id}-${c.slug}.mp4`) });
    else if (r.status === 2) skipped.push({ id: c.id, name: c.name });
    else { console.error(`\n✖ cut ${c.id} failed to render.\n`); process.exit(1); }
  }
} else if (wantHooks.length) {
  /* One variant, many openings. Everything after the first two seconds is
     identical by construction — same recording, same cuts, same sound. */
  const v = variantById(arg('variant') || 'K') || VARIANTS[0];
  console.log(`\n🪝 ${wantHooks.length} opening(s) · ${v.id} ${v.name}`);
  for (const id of wantHooks) {
    const h = hookById(id);
    if (!h) { console.warn(`\n⚠ no hook "${id}"`); continue; }
    console.log(`\n━━ hook ${h.id} · ${h.type}`);
    const r = spawnSync(process.execPath,
      [path.join('scripts', 'ad', 'compose.mjs'),
        `--in=${OUT}`, `--variant=${v.id}`, `--hook=${h.id}`, `--base=${BASE}`, ...SOUND,
        ...(arg('target') ? [`--target=${TARGET}`] : [])],
      { stdio: 'inherit' });
    if (r.status === 0) made.push({ id: h.id, name: h.type, file: path.join(OUT, `ad-${v.id}-${v.slug}-${h.id}.mp4`) });
    else if (r.status === 2) skipped.push({ id: h.id, name: h.type });
    else { console.error(`\n✖ hook ${h.id} failed to render.\n`); process.exit(1); }
  }
} else if (!want.length) {
  step('composing', 'compose.mjs', [`--in=${OUT}`, `--target=${TARGET}`, `--base=${BASE}`, ...SOUND]);
  made.push({ id: '—', file: path.join(OUT, 'ad.mp4') });
} else {
  for (const id of want) {
    const v = variantById(id) || conceptById(id);
    if (!v) { console.warn(`\n⚠ no variant or concept "${id}"`); continue; }
    console.log(`\n━━ ${v.id} · ${v.name}`);
    const r = spawnSync(process.execPath,
      [path.join('scripts', 'ad', 'compose.mjs'),
        `--in=${OUT}`, `--variant=${v.id}`, `--base=${BASE}`, ...SOUND,
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
