#!/usr/bin/env node
/**
 * Cut the recording into a 15–25 second vertical advert.
 *
 * The edit is driven by beats.json, not by fixed timecodes: the recorder marks
 * the frame where each thing actually happened, so a slow page produces a
 * slower cut rather than a cut in the wrong place. Change the site's layout and
 * the next advert still lands on the right frames.
 *
 *   node scripts/ad/compose.mjs --in=scripts/ad/out/robux-1000
 *
 * The grammar, in the order the platforms reward:
 *   scenes are chosen from the beats, each with its own speed
 *   the ones that carry no information are ramped hard; the ones that do, less
 *   a white flash + whoosh on every cut, a push-in on the product and the price
 *   the delivery beat lands on the notification sound
 *   an end card holds long enough to be read and not long enough to be skipped
 *
 * PRIVACY. Anything that looks like a delivered code is covered before the
 * frame is written. A working code read off a phone screen is a code somebody
 * else redeems, and no advert is worth that.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { variantById, tokensFor, fill, blockedReason } from './variants.mjs';
import { renderCaptions } from './captions.mjs';

const require = createRequire(import.meta.url);
let FFMPEG; let FFPROBE;
try { FFMPEG = require('ffmpeg-static'); } catch { FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'; }
try { FFPROBE = require('ffprobe-static').path; } catch { FFPROBE = process.env.FFPROBE_PATH || 'ffprobe'; }

const arg = (k, d = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};

const IN = path.resolve(arg('in') || path.join('scripts', 'ad', 'out'));
const SFX = path.resolve(arg('sfx') || path.join('scripts', 'ad', 'sfx'));
const RAW = path.join(IN, 'raw.webm');
const VARIANT = arg('variant', null);
const variant = VARIANT ? variantById(VARIANT) : null;
if (VARIANT && !variant) { console.error(`No variant "${VARIANT}".`); process.exit(1); }
const TARGET = Number(arg('target', String(variant?.target || 20)));
// Named after the variant so eight of them can live side by side.
const OUT = path.join(IN, arg('name', variant ? `ad-${variant.id}-${variant.slug}.mp4` : 'ad.mp4'));
const W = 1080; const H = 1920;

for (const f of [RAW, path.join(IN, 'beats.json')]) {
  if (!fs.existsSync(f)) { console.error(`Missing ${f} — run record.mjs first.`); process.exit(1); }
}
const manifest = JSON.parse(fs.readFileSync(path.join(IN, 'beats.json'), 'utf8'));
const beats = manifest.beats;
const at = (label) => beats.find((b) => b.label === label)?.atMs ?? null;

const ff = (args, label) => {
  try {
    return execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args],
      { maxBuffer: 1 << 28 });
  } catch (e) {
    console.error(`\n✖ ffmpeg failed${label ? ` (${label})` : ''}\n${e.stderr?.toString().slice(0, 1500) || e.message}\n`);
    process.exit(1);
  }
};

/* ffmpeg-static ships no ffprobe, so ask ffmpeg instead: it prints the duration
   on stderr while refusing to encode to nowhere. Uglier than ffprobe and it
   works with the one binary the toolkit already needs. */
const duration = (() => {
  const parse = (out) => {
    const m = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(out || '');
    return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : null;
  };
  try {
    return Number(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=nw=1:nk=1', RAW]).toString().trim()) || null;
  } catch { /* no ffprobe — fall through */ }
  try {
    // Succeeds when the file is readable, and prints the header either way.
    const r = spawnSync(FFMPEG, ['-hide_banner', '-i', RAW, '-f', 'null', '-'], { encoding: 'utf8' });
    return parse(r.stderr);
  } catch (e) { return parse(e.stderr?.toString() || e.stdout?.toString()); }
})();

/**
 * The scenes.
 *
 * Each is a window into the recording plus how fast to play it. `speed` above 1
 * is a ramp: the parts of a purchase that carry no information — scrolling,
 * waiting for a page — are the parts an advert should spend the least time on.
 * The product page and the delivery are where the eye needs to rest, so they
 * run closest to real time.
 */
const SCENES = [
  { from: 'open', to: 'shop', speed: 3.2, weight: 0.8, zoom: 'in', label: 'open' },
  { from: 'shop', to: 'select', speed: 3.6, weight: 1.1, zoom: 'drift', label: 'browse' },
  { from: 'select', to: 'product', speed: 1.6, weight: 0.7, zoom: 'punch', label: 'open product' },
  // The shot the whole advert exists for.
  { from: 'product', to: 'buy', speed: 1.2, weight: 2.0, zoom: 'in', label: 'the product', price: true },
  { from: 'buy', to: 'checkout', speed: 2.2, weight: 0.7, zoom: 'punch', label: 'buy' },
  { from: 'checkout', to: 'order-placed', speed: 3.0, weight: 1.0, zoom: 'in', label: 'checkout' },
  /* The confirmation. `order-placed` → `confirmed` is milliseconds when stock is
     on the shelf — the pipeline is that fast — so the shot that shows the order
     number is the hold AFTER it, not the gap before. Reading the gap instead
     dropped beat 8 of the brief out of the advert entirely. */
  { from: 'confirmed', to: 'delivery', speed: 1.4, weight: 1.2, zoom: 'punch', label: 'confirmed' },
  // The proof: it actually arrived.
  { from: 'delivery', to: 'delivered-detail', speed: 1.2, weight: 1.5, zoom: 'in', label: 'delivered' },
  { from: 'delivered-detail', to: 'email-open', speed: 1.4, weight: 0.9, zoom: 'in', label: 'the goods' },
  /* The email landing. This is the beat the notification sound belongs to and
     the one that answers the only question a first-time buyer has. */
  { from: 'email-open', to: 'email-detail', speed: 1.2, weight: 1.8, zoom: 'punch', label: 'the email', notify: true },
  { from: 'email-detail', to: 'end', speed: 1.2, weight: 1.4, zoom: 'in', label: 'the code' },
];

/* A variant supplies its own scene list; without one this is the full walk. */
/**
 * Everything a caption is allowed to say, read back from what actually happened.
 *
 * order.json is the real order the recorder placed; extras.json is anything the
 * recorder could only learn from the shop (a published review, a mystery prize,
 * the stock count at the moment of purchase). A fact that is not here does not
 * get said — variants.mjs drops the line rather than filling the gap.
 */
const readJson = (f, d = null) => {
  try { return JSON.parse(fs.readFileSync(path.join(IN, f), 'utf8')); } catch { return d; }
};
const order = readJson('order.json');
const extras = readJson('extras.json', {});
const tokens = tokensFor({
  product: { ...manifest.product, instant: extras.instant },
  order, review: extras.review, stock: extras.stockLeft, mystery: extras.mystery,
});

if (variant) {
  const why = blockedReason(variant, { tokens, order, review: extras.review, mystery: extras.mystery });
  if (why) {
    console.error(`\n⏭  ${variant.id} ${variant.name}: skipped — ${why}.\n`);
    process.exit(2);                    // 2 = honestly skipped, not broken
  }
}

const PLAN = variant ? variant.scenes : SCENES;

/* Resolve each scene against the beats that actually exist. A recording that
   skipped a step (a product with no cart step, say) simply has fewer scenes
   rather than an edit full of frozen frames. */
const cuts = [];
for (const s of PLAN) {
  let a = at(s.from); let b = at(s.to);
  /* A run without DATABASE_URL has no email beats, and the scene that bridges
     to them would vanish with them — so the last scene falls back to `end`.
     The advert then finishes on the order page, which is still a real
     delivery, rather than losing its final shot. */
  if (s.from === 'delivered-detail' && b === null) b = at('end');
  if (a === null || b === null || b <= a) continue;
  const rawLen = (b - a) / 1000;
  if (rawLen < 0.12) continue;                       // nothing happened here
  cuts.push({ ...s, start: a / 1000, srcLen: rawLen });
}
if (!cuts.length) { console.error('No usable scenes in beats.json.'); process.exit(1); }

/* Fill the target rather than shrink towards it.
   The first version capped every scene and then scaled down, which on a fast
   recording produced a seven-second advert with the product shot missing — it
   had been on screen for 236ms, below the floor, so the one frame the whole
   thing exists to show was the frame that got dropped. Now the budget is
   DISTRIBUTED: each scene gets a share of the target by weight, and a scene
   with little footage is slowed rather than cut. */
let CARD = 2.6;
const MIN = 15;                                       // the floor the brief allows
const room = Math.max(MIN - CARD, TARGET - CARD);
const totalWeight = cuts.reduce((n, c) => n + (c.weight || 1), 0);

/* Nothing is ever played slower than real time.
   The first attempt distributed the whole budget by weight, which on a
   seventeen-second recording meant every scene ran at 0.5–0.8× — a "fast-paced"
   advert entirely in slow motion. Real time is the floor: a scene gets its
   share of the target, but never more seconds than it has frames for. If that
   leaves the advert short, the advert is short — fifteen seconds is inside the
   brief and a padded twenty is not. */
for (const c of cuts) {
  const share = room * ((c.weight || 1) / totalWeight);
  const fastest = c.srcLen / (c.speed || 1);          // the ramp this scene wants
  c.played = Math.min(Math.max(fastest, share), c.srcLen);
  c.speed = c.srcLen / c.played;
}

/* Still over? Take it back from the fastest-ramping scenes first — the ones
   already carrying the least information per second. */
let used = cuts.reduce((n, c) => n + c.played, 0);
if (used > room) {
  const k = room / used;
  for (const c of cuts) {
    c.played = Math.max(c.srcLen / 6, c.played * k);
    c.speed = c.srcLen / c.played;
  }
  used = cuts.reduce((n, c) => n + c.played, 0);
}

/* A variant with little footage — a showcase has no checkout to film — would
   otherwise come in under the fifteen seconds the brief asks for. The end card
   takes up the slack rather than the footage being stretched: brand time is
   honest time, and half a second of slow motion on a screen recording is not. */
const footageTotal = cuts.reduce((n, c) => n + c.played, 0);
if (footageTotal + CARD < MIN) CARD = Math.min(4.5, MIN - footageTotal);

const total = cuts.reduce((n, c) => n + c.played, 0) + CARD;
console.log(`\n🎬 ${cuts.length} scenes · ${total.toFixed(1)}s (target ${TARGET}s)`);
for (const c of cuts) console.log(`   ${c.played.toFixed(2)}s  ${c.label} (${c.speed.toFixed(1)}×)`);

/* ── Captions ───────────────────────────────────────────────────────────────
   Most of these are watched with the sound off, so the captions carry the copy.
   Each line is pinned to a SCENE rather than to a timecode, so it stays put when
   a scene's length changes — which it does on every recording. */
const capLines = [];
if (variant) {
  const hook = fill(variant.hook, tokens);
  // The first two seconds, over whatever the variant opens on.
  if (hook) capLines.push({ text: hook, style: 'hook', scene: 0, hook: true });
  for (const c of variant.captions || []) {
    const text = fill(c.text, tokens);
    if (!text) continue;                          // a token had no real value
    const scene = cuts.findIndex((x) => x.label === c.at);
    if (scene < 0) continue;                      // that beat is not in this cut
    capLines.push({ text, style: c.style || 'small', scene, late: !!c.late });
  }
}

const caps = capLines.length
  ? await renderCaptions({
    lines: capLines,
    out: path.join(IN, 'captions'),
    base: (arg('base') || manifest.base || 'http://localhost:5000').replace(/\/+$/, ''),
    chrome: arg('chrome') || process.env.AD_CHROME
      || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  })
  : [];
if (caps.length) console.log(`   ${caps.length} caption(s)`);

// ── Video graph ─────────────────────────────────────────────────────────────
const priceCard = path.join(IN, 'price.png');
const endCard = path.join(IN, 'endcard.png');
const hasPrice = fs.existsSync(priceCard);
if (!fs.existsSync(endCard)) { console.error(`Missing ${endCard} — run cards.mjs first.`); process.exit(1); }

/* Input indices are counted, not inferred.
   They were derived from inputs.length/2, which is only right when every input
   is exactly two arguments — and the end card is six (`-loop 1 -t N -i file`).
   Every caption and every sound then addressed a stream that was not there, and
   ffmpeg answered with a two-thousand-character filtergraph and "matches no
   streams". */
const inputs = [];
let nInputs = 0;
const addInput = (...args) => { inputs.push(...args); return nInputs++; };

const rawIdx = addInput('-i', RAW);
const endIdx = addInput('-loop', '1', '-t', String(CARD), '-i', endCard);
const priceIdx = hasPrice ? addInput('-loop', '1', '-i', priceCard) : null;

// One input per caption; each is overlaid onto the scene it belongs to.
const capIdx = caps.map((c) => addInput('-loop', '1', '-i', c.file));

const FPS = 30;
const parts = [];
const names = [];

cuts.forEach((c, i) => {
  const n = `v${i}`;
  /* zoompan works in output frames, so the count has to match what setpts
     leaves behind — get this wrong and the zoom freezes halfway or runs off
     the end of the clip. */
  const frames = Math.max(2, Math.round(c.played * FPS));
  const zoom = {
    // A slow push in. `on` is the output frame number.
    in: `zoompan=z='min(1.0+0.055*on/${frames},1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS}`,
    // Starts pushed in and settles — reads as landing on something.
    punch: `zoompan=z='max(1.09-0.09*on/${frames},1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS}`,
    // Barely moves; for scrolling, where the content is already moving.
    drift: `zoompan=z='1.03':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)+${Math.round(20)}*on/${frames}':d=1:s=${W}x${H}:fps=${FPS}`,
  }[c.zoom] || '';

  parts.push(
    `[${rawIdx}:v]trim=start=${c.start.toFixed(3)}:duration=${c.srcLen.toFixed(3)},setpts=PTS-STARTPTS,`
    + `setpts=${(1 / c.speed).toFixed(5)}*PTS,fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,`
    + `crop=${W}:${H},`
    /* Motion blur. Averaging frames after a speed ramp is what stops a 3×
       section reading as a slideshow — the smear is the point. Only on the
       fast scenes; on a slow one it just softens the type. */
    + (c.speed >= 2 ? 'tmix=frames=3:weights=1 2 1,' : '')
    + (zoom ? `${zoom},` : '')
    + `trim=duration=${c.played.toFixed(3)},setpts=PTS-STARTPTS,format=yuv420p[${n}]`);
  names.push(n);
});

/* The price badge rides the scene that shows the product page, punching in and
   holding. It is the one number the whole advert exists to communicate. */
/* The price badge and a caption on the same scene fight for the same third of
   the frame — the customer quote in F landed straight on top of it. A variant
   that already says something there turns the badge off. */
const wantsPriceCard = variant ? variant.priceCard !== false : true;
if (hasPrice && wantsPriceCard) {
  const idx = cuts.findIndex((c) => c.price);
  if (idx >= 0) {
    const d = cuts[idx].played;
    parts.push(`[${priceIdx}:v]scale=${W}:${H},format=rgba,`
      + `fade=t=in:st=0.10:d=0.22:alpha=1,fade=t=out:st=${Math.max(0.4, d - 0.30).toFixed(2)}:d=0.28:alpha=1,`
      + `trim=duration=${d.toFixed(3)},setpts=PTS-STARTPTS[pricecard]`);
    parts.push(`[${names[idx]}][pricecard]overlay=0:0:format=auto,format=yuv420p[v${idx}p]`);
    names[idx] = `v${idx}p`;
  }
}

/* Captions, laid over the scene each belongs to.
   Faded rather than cut in: a caption that appears on the same frame as the
   flash competes with it, and both lose. `late` holds the line back so two
   captions on one scene read one after the other instead of on top of each
   other. */
caps.forEach((c, ci) => {
  const i = c.scene;
  if (i < 0 || i >= cuts.length) return;
  const d = cuts[i].played;
  const start = c.late ? Math.min(d * 0.55, Math.max(0.2, d - 0.9)) : (c.hook ? 0.06 : 0.18);
  const hold = Math.max(0.45, d - start - 0.16);
  const nm = `cap${ci}`;
  parts.push(`[${capIdx[ci]}:v]scale=${W}:${H},format=rgba,`
    + `fade=t=in:st=0:d=0.18:alpha=1,fade=t=out:st=${Math.max(0.2, hold - 0.20).toFixed(2)}:d=0.20:alpha=1,`
    + `trim=duration=${hold.toFixed(3)},setpts=PTS-STARTPTS+${start.toFixed(3)}/TB[${nm}]`);
  const src = names[i];
  const dst = `${src}c${ci}`;
  parts.push(`[${src}][${nm}]overlay=0:0:enable='between(t,${start.toFixed(3)},${(start + hold).toFixed(3)})':`
    + `format=auto,format=yuv420p[${dst}]`);
  names[i] = dst;
});

// The end card, held and faded in.
parts.push(`[${endIdx}:v]scale=${W}:${H},fps=${FPS},trim=duration=${CARD},setpts=PTS-STARTPTS,`
  + `fade=t=in:st=0:d=0.25,format=yuv420p[vend]`);
names.push('vend');

/* Concat, then the flash. A cut in this kind of advert is a single white frame
   pair — cheap, and the thing the ear is already expecting because the whoosh
   lands on the same frame. */
parts.push(`${names.map((n) => `[${n}]`).join('')}concat=n=${names.length}:v=1:a=0[cat]`);

let acc = 0;
const flashes = [];
for (let i = 0; i < cuts.length; i++) {
  acc += cuts[i].played;
  if (i < names.length - 1) flashes.push(acc);
}
const flashExpr = flashes
  .map((t) => `between(t,${(t - 0.045).toFixed(3)},${(t + 0.045).toFixed(3)})`)
  .join('+');
parts.push(`[cat]${flashes.length
  ? `drawbox=x=0:y=0:w=iw:h=ih:color=white@0.55:t=fill:enable='${flashExpr}',`
  : ''}format=yuv420p[vout]`);

// ── Audio graph ─────────────────────────────────────────────────────────────
const sfx = (n) => path.join(SFX, `${n}.wav`);
const need = ['click', 'whoosh', 'notify', 'impact', 'bed'];
const missing = need.filter((n) => !fs.existsSync(sfx(n)));
if (missing.length) {
  console.error(`Missing sounds: ${missing.join(', ')} — run: node scripts/ad/sfx.mjs`);
  process.exit(1);
}

const aInputs = [];
const aParts = [];
const aNames = [];
/* Audio inputs are appended after every video input, so they continue the same
   count rather than guessing where the video ones stopped. */
const addAudio = (file) => { aInputs.push('-i', file); return nInputs++; };

const bedIdx = addAudio(sfx('bed'));
aParts.push(`[${bedIdx}:a]atrim=duration=${total.toFixed(3)},asetpts=PTS-STARTPTS,`
  + `volume=0.34,afade=t=out:st=${(total - 0.6).toFixed(2)}:d=0.6[bed]`);

/** Put one sound at one moment. */
const place = (file, tSec, vol) => {
  const idx = addAudio(file);
  const nm = `s${idx}`;
  aParts.push(`[${idx}:a]adelay=${Math.max(0, Math.round(tSec * 1000))}|${Math.max(0, Math.round(tSec * 1000))},`
    + `volume=${vol}[${nm}]`);
  aNames.push(`[${nm}]`);
};

// A whoosh on every cut, a click where the recording says a click happened.
let cursor = 0;
cuts.forEach((c, i) => {
  if (i > 0) place(sfx('whoosh'), cursor - 0.12, 0.5);
  // Clicks inside this scene, mapped from real time into edited time.
  for (const b of beats) {
    if (!b.click) continue;
    const rel = b.atMs / 1000 - c.start;
    if (rel < 0 || rel > c.srcLen) continue;
    place(sfx('click'), cursor + rel / c.speed, 0.62);
  }
  if (c.notify) place(sfx('notify'), cursor + 0.12, 0.85);
  cursor += c.played;
});
place(sfx('impact'), cursor - 0.05, 0.7);

aParts.push(`[bed]${aNames.join('')}amix=inputs=${aNames.length + 1}:duration=first:dropout_transition=0,`
  + `alimiter=limit=0.92,aresample=48000[aout]`);

// ── Render ──────────────────────────────────────────────────────────────────
const filter = [...parts, ...aParts].join(';');
fs.writeFileSync(path.join(IN, 'filter.txt'), filter);

console.log(`   rendering → ${OUT}`);
ff([...inputs, ...aInputs,
  '-filter_complex', filter,
  '-map', '[vout]', '-map', '[aout]',
  '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'medium', '-crf', '19',
  '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', String(FPS * 2),
  // Every one of the three platforms re-encodes; -movflags puts the index at
  // the front so their first pass does not have to read the whole file.
  '-movflags', '+faststart',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
  '-t', total.toFixed(3),
  OUT], 'render');

const size = fs.statSync(OUT).size;
console.log(`\n✅ ${OUT}`);
console.log(`   ${total.toFixed(1)}s · ${W}×${H} · ${(size / 1048576).toFixed(1)} MB`);
console.log(`   source recording: ${duration ? `${duration.toFixed(1)}s` : 'unknown'} of a real purchase`);
console.log(`   payment: ${manifest.payment}${manifest.realPayment ? '' : ' (TEST — do not caption this as a live sale)'}\n`);
