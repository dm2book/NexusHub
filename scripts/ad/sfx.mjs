#!/usr/bin/env node
/**
 * The sound design, generated rather than sourced.
 *
 * Every sound an advert like this needs — a click, a whoosh, a notification, a
 * low bed to sit on — is a shape you can describe to ffmpeg. Doing that means
 * the repository ships no audio it does not own, there is no licence to track
 * per platform, and the pack is identical on every machine that builds it.
 *
 *   node scripts/ad/sfx.mjs              # writes scripts/ad/sfx/*.wav
 *   node scripts/ad/sfx.mjs --force      # rebuild even if they exist
 *
 * These are deliberately short and dry. TikTok, Shorts and Reels all re-encode
 * and normalise, and a long reverb tail is the first thing that turns to mud.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let FFMPEG;
try { FFMPEG = require('ffmpeg-static'); }
catch { FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'; }

const OUT = path.resolve(path.join('scripts', 'ad', 'sfx'));
const force = process.argv.includes('--force');
fs.mkdirSync(OUT, { recursive: true });

const ff = (args) => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

/**
 * A comma inside the expression is a comma to ffmpeg's OPTION parser first.
 * `pow(x,2)` reads as the end of one filter and the start of another, and the
 * error it produces names neither. Escaped, the expression parser sees it.
 */
const lavfi = (expr) => expr.replace(/,/g, '\\,').replace(/\s+/g, '');

/**
 * Each sound is one lavfi expression.
 *
 * `aevalsrc` lets the waveform be written as maths, which is the only way to
 * get a pitch sweep and an amplitude envelope in one pass without shipping a
 * sample. `t` is seconds.
 */
const SOUNDS = {
  /* A UI click: a very short burst with a fast decay, high enough to cut
     through a music bed on a phone speaker but not sharp enough to clip. */
  click: {
    dur: 0.09,
    expr: "0.55*exp(-t*70)*sin(2*PI*1800*t) + 0.25*exp(-t*120)*sin(2*PI*3200*t)",
  },
  /* A softer tap for the cursor landing, so not every touch is the same sound. */
  tap: {
    dur: 0.07,
    expr: "0.38*exp(-t*90)*sin(2*PI*1200*t)",
  },
  /* Whoosh: filtered noise with a swell, for cuts between scenes. */
  whoosh: {
    dur: 0.42,
    expr: "0.5*sin(2*PI*(180+900*t)*t)*exp(-pow((t-0.16)/0.13,2)) + 0.30*random(0)*exp(-pow((t-0.18)/0.11,2))",
  },
  /* The email landing. Two notes, the second higher — the shape every phone
     uses for "something good arrived", without being any particular phone's. */
  notify: {
    dur: 0.65,
    expr: "0.42*exp(-t*7)*sin(2*PI*880*t) + 0.42*exp(-max(t-0.13,0)*7)*sin(2*PI*1318*max(t-0.13,0))*gt(t,0.13)",
  },
  /* A short riser under a speed ramp. */
  riser: {
    dur: 0.7,
    expr: "0.28*(t/0.7)*sin(2*PI*(220+1400*(t/0.7)*(t/0.7))*t)",
  },
  /* Impact for the end card. */
  impact: {
    dur: 0.9,
    expr: "0.7*exp(-t*9)*sin(2*PI*70*t) + 0.35*exp(-t*26)*sin(2*PI*150*t) + 0.2*random(0)*exp(-t*40)",
  },
};

/**
 * The bed: a slow pulse on a low root with a fifth above it.
 *
 * Not a tune — a tune is what makes an advert feel like somebody else's advert,
 * and it is the part most likely to collide with a platform's music rights
 * system. This is a texture that fills the bottom of the mix and gets out of the
 * way of the sound effects.
 */
function bed(seconds) {
  const pulse = '(0.5+0.5*sin(2*PI*2*t))';
  return `0.10*${pulse}*sin(2*PI*55*t) + 0.06*${pulse}*sin(2*PI*82.5*t) `
    + `+ 0.03*sin(2*PI*110*t)*(0.5+0.5*sin(2*PI*0.5*t))`;
}

const made = [];
for (const [name, { dur, expr }] of Object.entries(SOUNDS)) {
  const file = path.join(OUT, `${name}.wav`);
  if (fs.existsSync(file) && !force) { made.push(`${name} (kept)`); continue; }
  ff(['-f', 'lavfi', '-i', `aevalsrc=${lavfi(expr)}:d=${dur}:s=48000`,
    '-af', 'alimiter=limit=0.95,afade=t=out:st=' + Math.max(0, dur - 0.02) + ':d=0.02',
    '-ac', '2', '-ar', '48000', file]);
  made.push(name);
}

const bedSeconds = Number((process.argv.find((a) => a.startsWith('--bed=')) || '--bed=30').slice(6));
const bedFile = path.join(OUT, 'bed.wav');
if (!fs.existsSync(bedFile) || force) {
  ff(['-f', 'lavfi', '-i', `aevalsrc=${lavfi(bed(bedSeconds))}:d=${bedSeconds}:s=48000`,
    '-af', 'alimiter=limit=0.6', '-ac', '2', '-ar', '48000', bedFile]);
  made.push(`bed (${bedSeconds}s)`);
}

console.log(`\n🔊 ${OUT}`);
console.log(`   ${made.join(', ')}`);
console.log('   All generated from waveform maths — nothing sampled, nothing licensed.\n');
