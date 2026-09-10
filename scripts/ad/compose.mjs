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
import { planCuts, resolveTiming, timeline } from './timing.mjs';
import {
  SW_W, stopwatchFrames, stopwatchBlockedReason, clockZero, renderStopwatch, formatClock,
} from './stopwatch.mjs';
import { variantById, tokensFor, fill, blockedReason } from './variants.mjs';
import { HOOKS, hookById, hookBlockedReason } from './hooks.mjs';
import { conceptById } from './concepts.mjs';
import { CUTS, cutById } from './cuts.mjs';
import { renderCaptions } from './captions.mjs';
import { gatherEvidence, validateLines, validateText, report } from './claims.mjs';

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
/* `--cut=` addresses cuts.mjs, `--variant=` addresses variants.mjs and
   concepts.mjs. Kept apart because A–H and J exist in both tables, and a run
   that asks for the 8-second cut and silently gets the 16-second price-hook
   variant is the kind of quiet wrong answer this toolkit exists to avoid. */
const CUT = arg('cut', null);
const variant = CUT ? cutById(CUT)
  : (VARIANT ? (variantById(VARIANT) || conceptById(VARIANT)) : null);
if (CUT && !variant) {
  console.error(`No cut "${CUT}". Known: ${CUTS.map((c) => c.id).join(', ')}`);
  process.exit(1);
}
if (!CUT && VARIANT && !variant) { console.error(`No variant "${VARIANT}".`); process.exit(1); }
const TARGET = Number(arg('target', String(variant?.target || 20)));
// Named after the variant so eight of them can live side by side.
/* Which opening line to use. Empty means the variant's own. Declared here
   because the output filename carries it. */
const HOOK_ID = arg('hook', '');

/* The filename says what the footage is.
 *
 * Two things put text on screen that must never reach a feed: footage filmed
 * against anything but the live shop bakes that host into the delivery email's
 * footer (`© 2026 ForgeMarket — localhost:3000`, legible for a second and a
 * half) and a demo payment makes the checkout say so, in Dutch, on camera.
 * Both used to be console warnings — a note to whoever ran the command, and
 * nothing at all to whoever uploads the file a week later. A `preview-` prefix
 * and a burnt-in marker travel with the file. */
const provenance = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(IN, 'beats.json'), 'utf8')).provenance || {}; }
  catch { return {}; }
})();
const PUBLISHABLE = provenance.live === true && provenance.realPayment === true;
/* The hook is in the filename: a batch writes one file per opening line, and
   which one you are looking at has to survive being dragged into a folder. */
const hookTag = HOOK_ID ? `-${HOOK_ID}` : '';
const family = variant?.family ? `${variant.family}-` : '';
const baseName = variant ? `ad-${family}${variant.id}-${variant.slug}${hookTag}.mp4` : `ad${hookTag}.mp4`;
const OUT = path.join(IN, arg('name', PUBLISHABLE ? baseName : `preview-${baseName}`));
const W = 1080; const H = 1920;
/* The domain painted in the corner for most of the advert. A variant may set
   its own; this is the fallback for a plain run. */
const CTA_TEXT = arg('cta', 'forgemarket.nl');
/* How hard this cut moves.
   ZOOM scales every push; BLUR_AT is the speed a scene has to reach before its
   frames are averaged. Both default to what the older variants were tuned
   against, so nothing that existed before this changes. */
const ZOOM = Number(arg('zoom', String(variant?.zoomScale ?? 1)));
const BLUR_AT = Number(arg('blurAt', String(variant?.blurAt ?? 2)));
/* How hard a cut lands. The white frame pair was fixed at 0.55 for every edit,
   which is fine at ten seconds and wrong at both ends: an eight-second cut
   wants it harder, and a cinematic one wants it barely there or not at all.
   Zero switches the flashes off entirely. */
const FLASH = Math.max(0, Math.min(1, Number(arg('flash', String(variant?.flash ?? 0.55)))));

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
  /* A variant may be written for a specific placement. The Dutch cut needs the
     Dutch delivery sentence, or its captions and its tokens end up in two
     languages in the same frame. */
  lang: variant?.lang || arg('lang', 'en'),
  /* So a hook that times the delivery can refuse to exist on a demo purchase. */
  provenance,
});

if (variant) {
  const why = blockedReason(variant, { tokens, order, review: extras.review, mystery: extras.mystery })
    /* A variant whose whole premise is a timed delivery, cut from a recording
       where nothing was delivered, is not a weaker version of the idea — it is
       a different claim. Refused before a frame is rendered. */
    || stopwatchBlockedReason(variant.stopwatch, at);
  if (why) {
    console.error(`\n⏭  ${variant.id} ${variant.name}: skipped — ${why}.\n`);
    process.exit(2);                    // 2 = honestly skipped, not broken
  }
}

const PLAN = variant ? variant.scenes : SCENES;

/* Resolve each scene against the beats that actually exist, and give each one
   its length. Both live in timing.mjs so storyboard.mjs gets the same answer —
   two copies of this maths is how an edit and its storyboard drift apart. */
const cuts = planCuts(PLAN, at);
if (!cuts.length) { console.error('No usable scenes in beats.json.'); process.exit(1); }
/* The floor follows the target rather than sitting at a hardcoded fifteen.
   A variant asking for twelve seconds was being padded back up to fifteen, and
   the padding came out of the slowest footage — so shortening the advert made
   it MORE static, which is the opposite of the point. */
const CARD_LEN = Number(arg('card', String(variant?.card ?? 2.6)));

/* ── The product, in the first second ───────────────────────────────────────
 *
 * Every cut opened on a SCREEN RECORDING of a product page — a browser, a
 * header, a breadcrumb, and somewhere inside all of that, small, the thing
 * being sold. In a feed that is a second spent working out what you are looking
 * at, and the second is the entire budget.
 *
 * `hero` puts the shop's own product artwork, name and price full-frame at t=0,
 * then hands off to the footage. It is a still rather than a scene because
 * there is no footage of it: cards.mjs draws it from the product row.
 *
 * It comes out of the FOOTAGE budget, not on top of the running time, so a cut
 * asking for ten seconds still gets ten. */
const heroCard = path.join(IN, 'hero.png');
const HERO = Number(arg('hero', String(variant?.hero ?? 0))) > 0 && fs.existsSync(heroCard)
  ? Number(arg('hero', String(variant?.hero ?? 0)))
  : 0;
if ((variant?.hero ?? 0) > 0 && !HERO) {
  console.warn(`\n⚠ no hero.png in ${IN} — this product has no artwork, so the cut opens on the footage.`);
}

const resolved = resolveTiming(cuts, {
  target: TARGET - HERO, card: CARD_LEN, min: Math.min(15, TARGET - HERO - 1),
});
let CARD = resolved.card;
const total = HERO + resolved.total;

console.log(`\n🎬 ${cuts.length} scenes · ${total.toFixed(1)}s (target ${TARGET}s)`);
for (const c of cuts) console.log(`   ${c.played.toFixed(2)}s  ${c.label} (${c.speed.toFixed(1)}×)`);

/* ── The clock ──────────────────────────────────────────────────────────────
   Planned here, before the captions, because the measured total is a caption
   token: a variant can say how long the delivery took and the line disappears
   by itself when nothing was measured.

   `timeline()` is asked for the rows rather than the accumulation being written
   out a second time. Two copies of where a scene starts is precisely how the
   clock and the picture would end up disagreeing about the same frame. */
const swSpec = variant?.stopwatch || null;
/* Offset by the hero: the clock is overlaid on the finished body, and the
   footage does not start at zero when a still is in front of it. Before the
   offset the clock read the footage a hero's length early — and a clock that is
   wrong is the one thing that file exists to prevent. */
const swRows = swSpec ? timeline(cuts, CARD).rows.map((r) => ({ ...r, in: r.in + HERO, out: r.out + HERO })) : [];
const swBody = HERO + cuts.reduce((a, c) => a + c.played, 0);
const swZero = swSpec ? clockZero(swSpec, swRows) : null;
if (swZero?.error) { console.error(`\n✖ ${swZero.error}\n`); process.exit(1); }
const sw = swSpec ? stopwatchFrames({
  rows: swRows,
  t0: swZero.t0,
  /* The instant the shop delivered. `outputAt` returns null when this cut
     skipped over that instant, and the clock then simply never stops — no
     total, no claim. */
  freezeSrc: at(swSpec.freeze) / 1000,
  fps: 30, until: swBody, lang: variant?.lang || arg('lang', 'nl'),
}) : null;
if (sw) {
  console.log(sw.freezeAt === null
    ? '   ⏱  running — the delivery is not inside this cut, so no total is shown'
    : `   ⏱  ${formatClock(sw.total, variant?.lang || 'nl')}s measured, frozen at ${sw.freezeAt.toFixed(2)}s`);
  /* The measured figure, offered to the captions the same way every other fact
     is: as a token that is null when it does not exist. */
  const swLang = variant?.lang || 'nl';
  const UNIT = { nl: 'seconden', en: 'seconds', de: 'Sekunden', fr: 'secondes' };
  /* The unit belongs to the token, not to the caption: past a minute the clock
     reads 1:12,4 and "1:12,4 seconden" is not a thing anybody says. */
  tokens.measured = sw.total === null ? null
    : `${formatClock(sw.total, swLang)}${sw.total < 60 ? ` ${UNIT[swLang] || UNIT.en}` : ''}`;
}

/* ── Captions ───────────────────────────────────────────────────────────────
   Most of these are watched with the sound off, so the captions carry the copy.
   Each line is pinned to a SCENE rather than to a timecode, so it stays put when
   a scene's length changes — which it does on every recording. */
const capLines = [];
if (variant) {
  /* The first two seconds.
   *
   * `--hook=<id>` picks one out of the catalogue (scripts/ad/hooks.mjs), which
   * is how one recording produces a set of adverts that differ only in their
   * opening line. Without it the variant's own hook is used, so every cut that
   * existed before this behaves exactly as it did.
   *
   * A named hook that this footage cannot support is refused rather than
   * quietly falling back — asking for the review hook on a shop with no reviews
   * should fail loudly, not hand back a different advert wearing that name. */
  let hookText = variant.hook; let hookSubText = variant.hookSub;
  if (HOOK_ID) {
    const chosen = hookById(HOOK_ID);
    if (!chosen) {
      console.error(`\n✖ no hook "${HOOK_ID}". Known: ${HOOKS.map((h) => h.id).join(', ')}\n`);
      process.exit(1);
    }
    const why = hookBlockedReason(chosen, tokens);
    if (why) {
      console.error(`\n⏭  hook ${chosen.id}: skipped — ${why}.\n`);
      process.exit(2);                 // 2 = honestly skipped, not broken
    }
    hookText = chosen.text; hookSubText = chosen.sub;
  }
  const hook = fill(hookText, tokens);
  const hookSub = fill(hookSubText, tokens);
  if (hook) {
    capLines.push({
      text: hook, style: variant.hookStyle || (hookSub ? 'lede' : 'hook'),
      scene: 0, hook: true, sub: hookSub || null,
    });
  }
  for (const c of variant.captions || []) {
    const text = fill(c.text, tokens);
    if (!text) continue;                          // a token had no real value
    const scene = cuts.findIndex((x) => x.label === c.at);
    if (scene < 0) continue;                      // that beat is not in this cut
    capLines.push({ text, style: c.style || 'small', scene, late: !!c.late, sub: fill(c.sub, tokens) || null });
  }
}

/* ── The claim gate ─────────────────────────────────────────────────────────
 * Everything above resolves TOKENS. This checks what the words actually say.
 *
 * A caption with no tokens in it — "4.9/5, 24/7 support, instant delivery" —
 * passes fill() untouched, because there is nothing in it to resolve. Until
 * this gate the only thing that ever caught a line like that was a test
 * grepping a hardcoded list of source files, which never saw `--cta=`,
 * `--tagline=` or `--name=` at all.
 *
 * Unproven claims are rewritten to a form the evidence supports, or the line
 * goes. Both are printed: a layer that silently edits an advert is one nobody
 * knows is there. */
const evidence = gatherEvidence({
  product: { ...manifest.product, instant: extras.instant, deliveryLine: tokens.delivery },
  extras,
  /* The one review this cut may quote, so its stars are judged against the row
     they came from rather than against a shop average that does not exist. */
  review: extras.review,
  // The shop's own figures, read off the site that was filmed — see record.mjs.
  stats: extras.stats,
  /* This recording's own payment → code gap, already refused by variants.mjs on
     anything but a real payment. */
  measuredSeconds: tokens.deliverySeconds === null ? null : Number(tokens.deliverySeconds),
  observations: extras.observations, suppliers: extras.suppliers, support: extras.support,
  lang: variant?.lang || arg('lang', 'en'),
});
{
  const checked = validateLines(capLines, evidence);
  const lines = report(checked);
  if (lines.length) {
    console.log(`\n⚖  claims: ${checked.rewritten.length} rewritten, ${checked.dropped.length} dropped`);
    for (const l of lines) console.log(l);
  }
  capLines.length = 0;
  capLines.push(...checked.lines);
}
/* The corner tag is command-line text and had never been checked by anything. */
const ctaChecked = validateText(variant?.cta || CTA_TEXT, evidence);
if (ctaChecked.changed) {
  console.log(`\n⚖  call to action: ${ctaChecked.dropped ? 'dropped' : `"${ctaChecked.text}"`}`);
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

/* Drawn in the browser for the same reason the captions are — and one PNG per
   frame, because the number changes on nearly every one of them. Frames that
   would draw an identical badge are rendered once and copied, which is most of
   the tail: the clock stops moving the moment it freezes. */
const swDir = path.join(IN, 'stopwatch');
if (sw) {
  const r = await renderStopwatch({
    frames: sw.frames, out: swDir,
    base: (arg('base') || manifest.base || 'http://localhost:5000').replace(/\/+$/, ''),
    chrome: arg('chrome') || process.env.AD_CHROME
      || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    lang: variant?.lang || arg('lang', 'nl'),
  });
  console.log(`   ${r.frames} clock frames (${r.drawn} drawn)`);
}

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
    /* A push in. `on` is the output frame number.
       6% was texture, not a move — on a phone it is invisible, and a screen
       recording has no parallax of its own to carry a scene. `PUSH` scales the
       whole set so a variant can ask for cinema without every other cut being
       rewritten. */
    in: `zoompan=z='min(1.0+${(0.055 * ZOOM).toFixed(3)}*on/${frames},${(1 + 0.06 * ZOOM).toFixed(3)})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS}`,
    // Starts pushed in and settles — reads as landing on something.
    punch: `zoompan=z='max(${(1 + 0.09 * ZOOM).toFixed(3)}-${(0.09 * ZOOM).toFixed(3)}*on/${frames},1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS}`,
    // Barely moves; for scrolling, where the content is already moving.
    drift: `zoompan=z='1.03':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)+${Math.round(20)}*on/${frames}':d=1:s=${W}x${H}:fps=${FPS}`,
    /* A real push, into the TOP of the frame.
       The other three move 3–9%, which is texture rather than emphasis — and
       the shot this advert exists for, the code arriving, was one of them: the
       code sat small and unmagnified near the top of a dense email while the
       caption talked about it at the bottom. This goes to 1.55× and tracks
       upward, so the thing being talked about is the thing filling the screen. */
    focus: `zoompan=z='min(1.06+0.49*on/${frames},1.55)'`
      + `:x='iw/2-(iw/zoom/2)'`
      + `:y='max(0, ih*0.20 - (ih/zoom/2) + ih*0.10*(1-on/${frames}))'`
      + `:d=1:s=${W}x${H}:fps=${FPS}`,
  }[c.zoom] || '';

  parts.push(
    `[${rawIdx}:v]trim=start=${c.start.toFixed(3)}:duration=${c.srcLen.toFixed(3)},setpts=PTS-STARTPTS,`
    + `setpts=${(1 / c.speed).toFixed(5)}*PTS,fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,`
    + `crop=${W}:${H},`
    /* Motion blur. Averaging frames after a speed ramp is what stops a 3×
       section reading as a slideshow — the smear is the point. Only on the
       fast scenes; on a slow one it just softens the type. */
    /* Motion blur. Averaging frames after a speed ramp is what stops a fast
       section reading as a slideshow. The threshold was a hard `>= 2`, and on
       the first finished cut NOTHING reached it — the effect was in the file and
       had never once been applied. A variant can lower it, and a scene can ask
       for it outright. */
    + (c.blur || c.speed >= BLUR_AT ? `tmix=frames=${c.speed >= 3 ? 5 : 3}:weights=${c.speed >= 3 ? '1 2 3 2 1' : '1 2 1'},` : '')
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

/* ── The product card, revealed on the beat it belongs to ───────────────────
 *
 * Two overlays drawn from the product row by cards.mjs, each pinned to the
 * scene that earns it:
 *
 *   productcard.png  the reveal — art, name and price over the product page
 *   productchip.png  the last beat, so the closing frame is a code that belongs
 *                    to something rather than an anonymous string
 *
 * Both RISE into place as they fade, which is what makes a card read as being
 * placed rather than as having always been there. Absent when the product has
 * no artwork: nothing stands in for it.
 *
 * The movement is an overlay offset rather than a scale-up. The obvious version
 * — `scale=w='iw*min(0.92+…*t,1)':eval=frame` followed by a `pad` back to the
 * frame — does not run: pad fixes its geometry at init, so a per-frame size
 * feeding it is an invalid argument and ffmpeg refuses the whole graph. An
 * overlay's x/y ARE evaluated per frame, which is why the email card already
 * animates that way. */
const RISE = 54;
const reveal = (file, sceneLabel, { at = 0.12, rise = RISE } = {}) => {
  const f = path.join(IN, file);
  const idx = cuts.findIndex((c) => c.label === sceneLabel);
  if (!fs.existsSync(f) || idx < 0) return;
  const d = cuts[idx].played;
  const hold = Math.max(0.5, d - at - 0.10);
  const i = addInput('-loop', '1', '-framerate', String(FPS), '-t', hold.toFixed(3), '-i', f);
  const nm = `pc${idx}`;
  parts.push(`[${i}:v]scale=${W}:${H},format=rgba,fps=${FPS},`
    + `fade=t=in:st=0:d=0.16:alpha=1,fade=t=out:st=${Math.max(0.3, hold - 0.22).toFixed(2)}:d=0.22:alpha=1,`
    + `trim=duration=${hold.toFixed(3)},setpts=PTS-STARTPTS+${at.toFixed(3)}/TB[${nm}]`);
  const t0 = at.toFixed(3);
  const y = `if(lt(t,${t0}+0.26),${rise}-${rise}*((t-${t0})/0.26),0)`;
  const src = names[idx]; const dst = `${src}${nm}`;
  parts.push(`[${src}][${nm}]overlay=0:'${y}':enable='between(t,${t0},${(at + hold).toFixed(3)})':`
    + `format=auto,format=yuv420p[${dst}]`);
  names[idx] = dst;
};
/* Opt-in. These files exist for every recording of a product that has artwork,
   and switching them on by default would have quietly redressed twelve
   variants, ten cuts and seventy-five concepts that were composed without
   them. */
if (variant?.productCard === true) {
  reveal('productcard.png', variant?.productCardAt || 'the product', { rise: 40 });
  reveal('productchip.png', variant?.productChipAt || 'the code', { at: 0.30, rise: 40 });
}

/* Captions, laid over the scene each belongs to.
   Faded rather than cut in: a caption that appears on the same frame as the
   flash competes with it, and both lose. `late` holds the line back so two
   captions on one scene read one after the other instead of on top of each
   other. */
/* The email arrival.
   Every other caption fades. This one SLIDES — a notification that dissolves
   into view is not an arrival, and the arrival is the whole beat. The card is
   rendered pinned to the top of a full-height transparent frame, so moving the
   overlay's y from -H to 0 walks it down from off-screen into place; a short
   overshoot past the rest position and back is what makes it read as landing
   rather than as being placed. The notify sound already fires 0.12s into this
   scene (see the audio pass below), so SLIDE is timed to meet it.
   The frame underneath lifts for two tenths at the same moment — the phone-lit
   flash you get when something actually arrives. */
const SLIDE = 0.34;
const OVERSHOOT = 26;

caps.forEach((c, ci) => {
  const i = c.scene;
  if (i < 0 || i >= cuts.length) return;
  const d = cuts[i].played;
  const arrival = c.style === 'notify';
  const start = arrival ? 0.10
    : c.late ? Math.min(d * 0.55, Math.max(0.2, d - 0.9)) : (c.hook ? 0.06 : 0.18);
  const hold = Math.max(0.45, d - start - (arrival ? 0.04 : 0.16));
  const nm = `cap${ci}`;

  if (arrival) {
    // Held at full alpha; the movement does the work the fade normally does.
    parts.push(`[${capIdx[ci]}:v]scale=${W}:${H},format=rgba,`
      + `trim=duration=${hold.toFixed(3)},setpts=PTS-STARTPTS+${start.toFixed(3)}/TB[${nm}]`);
    /* y walks -H → +OVERSHOOT → 0 across SLIDE, then sits. `min(...)` clamps the
       ramp so the expression stays put for the rest of the scene rather than
       running the card off the bottom of the frame. */
    const t0 = start.toFixed(3);
    const y = `if(lt(t,${t0}+${SLIDE}),`
      + `-h+(h+${OVERSHOOT})*((t-${t0})/${SLIDE}),`
      + `if(lt(t,${t0}+${(SLIDE + 0.10).toFixed(3)}),`
      + `${OVERSHOOT}-${OVERSHOOT}*((t-${t0}-${SLIDE})/0.10),0))`;
    const lit = `${names[i]}lit`;
    // The lift, on the recording rather than on the card.
    parts.push(`[${names[i]}]eq=brightness=0.06:enable='between(t,${t0},${(start + 0.20).toFixed(3)})'[${lit}]`);
    const dst = `${names[i]}c${ci}`;
    parts.push(`[${lit}][${nm}]overlay=0:'${y}':enable='between(t,${t0},${(start + hold).toFixed(3)})':`
      + `format=auto,format=yuv420p[${dst}]`);
    names[i] = dst;
    return;
  }

  parts.push(`[${capIdx[ci]}:v]scale=${W}:${H},format=rgba,`
    + `fade=t=in:st=0:d=0.18:alpha=1,fade=t=out:st=${Math.max(0.2, hold - 0.20).toFixed(2)}:d=0.20:alpha=1,`
    + `trim=duration=${hold.toFixed(3)},setpts=PTS-STARTPTS+${start.toFixed(3)}/TB[${nm}]`);
  const src = names[i];
  const dst = `${src}c${ci}`;
  parts.push(`[${src}][${nm}]overlay=0:0:enable='between(t,${start.toFixed(3)},${(start + hold).toFixed(3)})':`
    + `format=auto,format=yuv420p[${dst}]`);
  names[i] = dst;
});

/* The hero, in front of everything.
   A push-in on a still, so the first frame is already the product and the
   second frame is already moving. It ends on a hard cut into the footage,
   which shows the same artwork on the real page — the two read as one move. */
if (HERO) {
  const hf = Math.max(2, Math.round(HERO * FPS));
  const hIdx = addInput('-loop', '1', '-framerate', String(FPS), '-t', HERO.toFixed(3), '-i', heroCard);
  parts.push(`[${hIdx}:v]scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,`
    + `crop=${W}:${H},fps=${FPS},`
    + `zoompan=z='min(1.0+${(0.10 * ZOOM).toFixed(3)}*on/${hf},${(1 + 0.11 * ZOOM).toFixed(3)})'`
    + `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS},`
    + `trim=duration=${HERO.toFixed(3)},setpts=PTS-STARTPTS,format=yuv420p[vhero]`);
  names.unshift('vhero');
}

// The end card, held and faded in.
parts.push(`[${endIdx}:v]scale=${W}:${H},fps=${FPS},trim=duration=${CARD},setpts=PTS-STARTPTS,`
  + `fade=t=in:st=0:d=0.25,format=yuv420p[vend]`);
names.push('vend');

/* Concat, then the flash. A cut in this kind of advert is a single white frame
   pair — cheap, and the thing the ear is already expecting because the whoosh
   lands on the same frame. */
parts.push(`${names.map((n) => `[${n}]`).join('')}concat=n=${names.length}:v=1:a=0[cat]`);

/* The hero is the first thing in `names`, so every cut boundary — and every
   flash, whip and sound placed on one — is a hero later than the footage's own
   accumulation says. */
let acc = HERO;
const flashes = [];
if (HERO) flashes.push(HERO);          // the cut out of the hero is a cut too
for (let i = 0; i < cuts.length; i++) {
  acc += cuts[i].played;
  if (i < cuts.length - 1) flashes.push(acc);
}
const flashExpr = flashes
  .map((t) => `between(t,${(t - 0.045).toFixed(3)},${(t + 0.045).toFixed(3)})`)
  .join('+');

/* Whips.
 *
 * A single white flash on every cut means every cut has the same weight, which
 * is the opposite of pacing: the eye stops reading them as punctuation after
 * the third one. A whip is a directional throw — a hard horizontal blur that
 * peaks on the cut frame and is gone in a sixth of a second — and it belongs on
 * the cuts that are meant to feel like the camera being thrown rather than the
 * scene politely changing.
 *
 * `whipAt` on a variant names the cut indices; alternating direction matters,
 * because two throws the same way in a row read as one long stumble.
 *
 * Built with `boxblur` rather than a real motion blur because it has to run in
 * the same filtergraph as everything else — a horizontal-only box blur with a
 * vertical radius of zero is directional smear, which is the part the eye reads.
 */
const WHIP = 0.16;
const whipCuts = new Set(variant?.whipAt || []);
const whipExpr = flashes
  .map((t, i) => (whipCuts.has(i) ? `between(t,${(t - WHIP / 2).toFixed(3)},${(t + WHIP / 2).toFixed(3)})` : null))
  .filter(Boolean)
  .join('+');
/* The domain, in the corner, from the second scene until the end card.
 *
 * The advert this was written against puts its call to action at 15.0s of 20.7
 * — seventy-three per cent in — and everyone who left before that saw twenty
 * seconds of a shop whose name they now cannot type. A corner tag costs a
 * hundred and something pixels and means the address has been on screen since
 * the third second for every viewer, however early they go.
 *
 * It starts AFTER the first scene on purpose: the first two seconds are the
 * hook's, and a brand mark competing with it is the mistake being corrected,
 * not repeated. It ends when the end card starts, which says the same thing
 * bigger.
 */
const ctaText = ctaChecked.text;      // checked, not as typed — see the claim gate
const bodyEnd = HERO + cuts.reduce((a, c) => a + c.played, 0);
const tagFrom = HERO + Math.min(cuts[0]?.played ?? 1.5, 2.2);
const tagFile = path.join(IN, 'cta-tag.png');
let ctaChain = false;
if (ctaText && fs.existsSync(tagFile) && bodyEnd - tagFrom > 1.5) {
  /* The tag runs from the first frame and is simply INVISIBLE until it fades
     in. The obvious version — a stream that starts at `tagFrom` via setpts —
     leaves overlay with no second input for the first two seconds, and it
     stalls there rather than passing the first input through: the whole advert
     rendered black under the overlays, which is a filtergraph that runs, exits
     zero, and produces a file nobody would ship. */
  /* Bounded at the INPUT with -t and -framerate, the way the end card is, rather
     than trimmed inside the graph. A `-loop 1` still with no bound is an endless
     25fps stream, and overlaying that onto the concatenated 30fps body produced
     eighteen seconds of black under the overlays — a filtergraph that runs,
     exits zero, and writes a file nobody would ship. */
  const tagIdx = addInput('-loop', '1', '-framerate', String(FPS),
    '-t', bodyEnd.toFixed(3), '-i', tagFile);
  parts.push(`[${tagIdx}:v]scale=${W}:${H},fps=${FPS},format=rgba,setpts=PTS-STARTPTS,`
    + `fade=t=in:st=${tagFrom.toFixed(2)}:d=0.30:alpha=1,`
    + `fade=t=out:st=${Math.max(tagFrom + 0.5, bodyEnd - 0.35).toFixed(2)}:d=0.30:alpha=1[ctatag]`);
  ctaChain = true;
}

/* Two statements rather than one long chain: the tag is overlaid onto the
   finished body exactly the way the price badge is overlaid onto its scene,
   which is the pattern already known to work here. */
/* Preview footage carries a marker across the whole running time. Deliberately
   impossible to crop out of a 9:16 upload without cropping the advert, because
   the thing it is warning about (a dev host, a demo-mode notice) is legible in
   the picture and the person uploading it will not be the person who filmed
   it. drawtext needs a TTF and this shop's faces are woff2, so it is a box and
   a label rendered the only way ffmpeg can do it alone. */
const mark = PUBLISHABLE ? '' :
  `drawbox=x=0:y=${Math.round(H * 0.02)}:w=iw:h=64:color=black@0.55:t=fill,`
  + `drawbox=x=0:y=${Math.round(H * 0.02)}:w=8:h=64:color=0xd946ef@0.95:t=fill,`;

/* The clock, over the finished body.
 *
 * A PNG sequence rather than a still: the number changes on nearly every frame,
 * and this is the one overlay in the toolkit that has to. It is bounded by the
 * files that exist, and `eof_action=pass` lets the end card through untouched
 * rather than freezing the badge on top of the brand card.
 *
 * Top-centre, under the strip the preview marker occupies and well clear of
 * the bottom 420px the platforms fill with their own furniture. */
let swChain = false;
if (sw && fs.existsSync(path.join(swDir, '00000.png'))) {
  const swIdx = addInput('-framerate', String(FPS), '-start_number', '0',
    '-i', path.join(swDir, '%05d.png'));
  parts.push(`[${swIdx}:v]format=rgba,setpts=PTS-STARTPTS[sw]`);
  swChain = true;
}
const SW_X = Math.round((W - SW_W) / 2);
/* Under the corner tag, not on it. cards.mjs pins that tag at 150px from the
   top and it is about 67px tall, so anything above ~220 collides with it — the
   first cut of this variant had "forgemarket.nl" printed across the clock's own
   label. Still in the top fifth, still clear of the bottom 420px the platforms
   fill with their own furniture. */
const SW_Y = 252;

/* Everything that sits over the whole body, in order. Written as a chain so a
   second full-frame overlay does not mean rewriting the first: the corner tag
   used to be spliced in by hand, and the clock would have been the third copy
   of the same three lines. */
const post = [];
if (swChain) post.push(['sw', `${SW_X}:${SW_Y}:eof_action=pass`]);
if (ctaChain) post.push(['ctatag', '0:0']);

parts.push(`[cat]${whipExpr
  ? `boxblur=luma_radius=42:luma_power=2:chroma_radius=42:chroma_power=1:enable='${whipExpr}',`
  : ''}${flashes.length && FLASH > 0
  ? `drawbox=x=0:y=0:w=iw:h=ih:color=white@${FLASH.toFixed(2)}:t=fill:enable='${flashExpr}',`
  : ''}${mark}format=yuv420p${post.length ? '[body0]' : '[vout]'}`);
post.forEach(([label, xy], i) => {
  const dst = i === post.length - 1 ? 'vout' : `body${i + 1}`;
  parts.push(`[body${i}][${label}]overlay=${xy}:format=auto,format=yuv420p[${dst}]`);
});

// ── Audio graph ─────────────────────────────────────────────────────────────
const sfx = (n) => path.join(SFX, `${n}.wav`);
const need = ['click', 'whoosh', 'notify', 'impact', 'confirm', 'whip', 'bed'];
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

/* The sound follows the picture, beat for beat.
 *
 * Every cut used to get the same whoosh, which is the audio version of every cut
 * getting the same white flash: after three of them the ear stops hearing them
 * as punctuation. A cut the edit throws (see `whipAt`) gets the whip instead,
 * and it lands ON the cut rather than 120ms early, because a throw and its sound
 * arriving apart is what makes a transition feel cheap.
 *
 * Two beats get a sound of their own because they are the two the viewer is
 * waiting for: the money clearing, and the mail landing.
 */
let cursor = HERO;
cuts.forEach((c, i) => {
  if (i > 0 || HERO) {
    const thrown = whipCuts.has(i - 1);
    place(sfx(thrown ? 'whip' : 'whoosh'), cursor - (thrown ? 0.06 : 0.12), thrown ? 0.62 : 0.5);
  }
  // Clicks inside this scene, mapped from real time into edited time.
  for (const b of beats) {
    if (!b.click) continue;
    const rel = b.atMs / 1000 - c.start;
    if (rel < 0 || rel > c.srcLen) continue;
    place(sfx('click'), cursor + rel / c.speed, 0.62);
  }
  /* The payment clearing. Placed a beat INTO the scene rather than on its first
     frame: the cut is already carrying a whip or a whoosh, and two sounds on one
     frame is one muddy sound. */
  if (c.confirm) place(sfx('confirm'), cursor + 0.14, 0.8);
  if (c.notify) place(sfx('notify'), cursor + 0.12, 0.85);
  cursor += c.played;
});
place(sfx('impact'), cursor - 0.05, 0.7);

aParts.push(`[bed]${aNames.join('')}amix=inputs=${aNames.length + 1}:duration=first:dropout_transition=0,`
  /* Normalised to the loudness the platforms play at.
     Measured on the first finished cut: −33,6 LUFS integrated, about twenty
     decibels under the ~−14 LUFS TikTok, Reels and Shorts normalise to. In a
     feed that is either silent next to everything around it, or the platform
     lifts it and brings the noise floor up with it. The limiter stays: loudnorm
     sets the level, it does not stop a transient. */
  + `loudnorm=I=-14:TP=-1.5:LRA=11,alimiter=limit=0.95,aresample=48000[aout]`);

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
