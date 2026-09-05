#!/usr/bin/env node
/**
 * The storyboard for a variant, with the timing it will actually get.
 *
 *   node scripts/ad/storyboard.mjs --variant=W
 *   node scripts/ad/storyboard.mjs --variant=W --in=scripts/ad/out/robux-4500
 *
 * ── WHY THIS IS GENERATED AND NOT WRITTEN DOWN ────────────────────────────
 * Scene lengths are not chosen. Each one is a span between two beats the
 * recorder actually marked, given a share of the target by weight and floored
 * at real time — so the same variant is a different edit on a fast recording
 * than on a slow one, and any timing typed into a document is wrong the moment
 * the site changes. This runs the resolver compose.mjs runs, so the numbers are
 * the numbers.
 *
 * With `--in` it reads the real beats.json from a recording. Without one it
 * uses the reference recording below and says so — useful for planning a shoot
 * before there is footage, and honest about being a model rather than a
 * measurement.
 */
import fs from 'node:fs';
import path from 'node:path';
import { planCuts, resolveTiming, timeline, FPS } from './timing.mjs';
import { variantById, tokensFor, fill } from './variants.mjs';
import { conceptById } from './concepts.mjs';

const arg = (k, d = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};

/**
 * A reference recording, in milliseconds from the start.
 *
 * Measured from the shop as it stands: a page that takes 1.4s to settle takes
 * 1.4s here. It is a MODEL — the header says so on every run that uses it — and
 * exists so a storyboard can be read before a shoot rather than after one.
 */
const REFERENCE = {
  open: 0, shop: 2100, browse: 3400, select: 5200,
  product: 6100, 'price-onscreen': 7000, buy: 10400,
  checkout: 11600, consent: 12400, 'order-placed': 16900,
  confirmed: 20800, delivery: 23100, 'delivered-detail': 25400,
  'email-open': 27900, 'email-detail': 31200, end: 34600,
};

const ID = (arg('variant') || arg('concept') || 'W').toUpperCase();
const v = variantById(ID) || conceptById(ID);
if (!v) { console.error(`No variant or concept "${ID}".`); process.exit(1); }

const IN = arg('in');
let beats = REFERENCE; let source = 'the reference recording (a model, not a measurement)';
if (IN) {
  const f = path.join(path.resolve(IN), 'beats.json');
  if (!fs.existsSync(f)) { console.error(`No beats.json in ${IN}`); process.exit(1); }
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  beats = Object.fromEntries((raw.beats || raw).map((b) => [b.name || b.label, b.t ?? b.at]));
  source = f;
}
const at = (name) => (beats[name] === undefined ? null : beats[name]);

const cuts = planCuts(v.scenes, at);
if (!cuts.length) { console.error('None of this variant\'s beats are in the recording.'); process.exit(1); }
const { card } = resolveTiming(cuts, { target: v.target || 20, card: 2.6, min: 15 });
const tl = timeline(cuts, card);

/* Captions resolve against a product so the storyboard shows the words that
   will be burnt in, not the templates. Sample values are labelled as such. */
const sample = { name: '4,500 Robux', price: '€38.99', currency: 'EUR' };
const tokens = {
  ...tokensFor({ product: { name: sample.name, price: 3899, currency: 'EUR', instant: false } }),
  orderNumber: 'FM-1042',
};

const sec = (n) => `${n.toFixed(2)}s`;
const frame = (n) => `f${Math.round(n * FPS)}`;

console.log(`\n${v.id} · ${v.name} — ${sec(tl.total)} at ${FPS}fps (${Math.round(tl.total * FPS)} frames)`);
console.log(`timing from: ${source}`);
console.log(`captions shown with sample product "${sample.name} · ${sample.price}"\n`);

const EFFECT = {
  in: 'slow push in 1.00 → 1.06',
  punch: 'punch out 1.09 → 1.00',
  drift: 'held at 1.03, drifting down',
};

for (const [i, r] of tl.rows.entries()) {
  const caps = (v.captions || [])
    .filter((c) => c.at === r.label)
    .map((c) => ({ ...c, text: fill(c.text, tokens) }))
    .filter((c) => c.text);
  console.log(`${String(i + 1).padStart(2)}. ${r.label.toUpperCase()}`);
  console.log(`    ${sec(r.in)} → ${sec(r.out)}   (${sec(r.played)}, ${frame(r.in)}–${frame(r.out)})`);
  console.log(`    source ${sec(r.srcLen)} played at ${r.speed.toFixed(2)}× · ${EFFECT[r.zoom] || 'no zoom'}`);
  if (r.speed > 1.15) console.log('    motion blur: frames averaged after the ramp');
  if (i === 0 && fill(v.hook, tokens)) {
    console.log(`    HOOK  0.06s  “${fill(v.hook, tokens)}”`);
  }
  for (const c of caps) {
    if (c.style === 'notify') {
      const start = r.in + 0.10;
      console.log(`    ARRIVAL ${sec(start)} → ${sec(start + 0.34)}  card slides in from off-frame,`);
      console.log(`            overshoots 26px and settles by ${sec(start + 0.44)}`);
      console.log(`            frame under it lifts +6% brightness ${sec(start)} → ${sec(start + 0.20)}`);
      console.log(`            notify sound at ${sec(r.in + 0.12)}`);
      console.log(`            “${c.text}”${c.sub ? ` · “${c.sub}”` : ''}`);
    } else {
      const start = c.late ? r.in + Math.min(r.played * 0.55, Math.max(0.2, r.played - 0.9)) : r.in + 0.18;
      console.log(`    caption ${sec(start)}  [${c.style}]  “${c.text}”`);
    }
  }
  if (i < tl.rows.length - 1) {
    console.log(`    ── cut at ${sec(r.out)}: white flash (1 frame pair) + whoosh at ${sec(r.out - 0.12)}`);
  }
  console.log('');
}
console.log(`${String(tl.rows.length + 1).padStart(2)}. END CARD`);
console.log(`    ${sec(tl.card.in)} → ${sec(tl.card.out)}   (${sec(card)})`);
console.log(`    fades in over 0.25s · “${v.cta}”\n`);
console.log(`cursor: painted throughout, following the real click coordinates (record.mjs)`);
console.log(`flashes at: ${tl.flashes.map(sec).join(', ')}`);
