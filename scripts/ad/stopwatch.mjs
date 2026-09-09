#!/usr/bin/env node
/**
 * A stopwatch that shows the recording's own clock.
 *
 * The concept is a test: "ik ga kijken hoe snel ForgeMarket dit levert", with a
 * clock running from the first frame. Which makes the clock the whole advert —
 * and a clock is the easiest thing in a video to fake, so this file is mostly
 * about what it refuses to show.
 *
 * THE RULE:
 *
 *   the clock shows REAL seconds from the recording, never seconds of video.
 *
 * The cut is speed-ramped: two seconds of screen time can cover eight seconds
 * of a real purchase. A clock counting video time would therefore claim a
 * purchase took twelve seconds when it took fifty. So every frame is mapped
 * back through its scene's own ramp to the moment in the session it came from,
 * and the clock shows the distance from the start of the cut to that moment.
 * The number jumps as the ramp speeds up. That is the honest artefact of a
 * compressed recording, and it is left visible rather than smoothed away.
 *
 * AND THE SECOND RULE:
 *
 *   no delivery in the footage, no time on the clock.
 *
 * The clock freezes on the beat where the shop delivered, and the frozen figure
 * is the claim. If that beat is not in the recording at all, the variant is
 * refused outright; if it is in the recording but falls in footage this cut
 * skipped, the clock keeps running and no total is ever shown. Nothing is
 * rounded down, extrapolated, or filled in from a promise.
 *
 * What the number includes is stated on the badge itself rather than left to
 * the viewer: the label reads "productpagina → code", because that is the span
 * being timed and it is longer than the part the shop controls, not shorter.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

/** The badge, in the language the cut is in. */
export const CLOCK_COPY = {
  nl: { span: 'productpagina → code', done: 'geleverd' },
  en: { span: 'product page → code', done: 'delivered' },
  de: { span: 'produktseite → code', done: 'geliefert' },
  fr: { span: 'page produit → code', done: 'livré' },
};

export const SW_W = 620;
export const SW_H = 224;

/**
 * The moment in the recording that output time `t` is showing.
 *
 * This is the inverse of the ramp: a scene playing at 3× covers three source
 * seconds for every second on screen. Null outside the body — the end card is
 * not footage of anything.
 */
export function sourceAt(rows, t) {
  for (const r of rows) {
    if (t >= r.in && t < r.out) return r.start + (t - r.in) * r.speed;
  }
  return null;
}

/**
 * Where a moment from the recording appears in the finished cut, or null when
 * this cut skipped over it. Null is the answer that matters: it is how "the
 * delivery is not in this video" reaches the renderer.
 */
export function outputAt(rows, srcSec) {
  for (const r of rows) {
    if (srcSec >= r.start && srcSec <= r.start + r.srcLen) {
      return r.in + (srcSec - r.start) / (r.speed || 1);
    }
  }
  return null;
}

/** 7,4 — or 1:12,4 once a purchase runs past the minute. */
export function formatClock(secs, lang = 'nl') {
  const t = Math.max(0, Number(secs) || 0);
  const dec = new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (t < 60) return dec.format(t);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${dec.format(s)}`;
}

/**
 * Why this footage cannot carry a stopwatch — for the operator, not the advert.
 *
 * The variant is refused rather than rendered without its clock: an advert
 * whose whole premise is a timed delivery, cut from a recording where nothing
 * was delivered, is not a weaker version of the idea. It is a different claim.
 */
export function stopwatchBlockedReason(spec, at) {
  if (!spec) return null;
  if (at(spec.from) === null) return `no ${spec.from} beat to start the clock on`;
  if (at(spec.freeze) === null) return `nothing was delivered in this recording (no ${spec.freeze} beat)`;
  return null;
}

/**
 * Zero on the clock is the advert's first frame.
 *
 * Not the `from` beat, and the difference is not pedantry: the opening scene
 * SETTLES past the first 350ms of its beat, because a beat fires when a
 * navigation resolves rather than when the page has painted. Timing from the
 * beat would therefore open on "0,4" — a stopwatch that starts late reads as a
 * broken stopwatch, and adjusting the display instead would be the one thing
 * this file exists to prevent. So the zero is the frame the viewer sees first,
 * and `from` is the beat that frame has to belong to. Mismatched, that is a
 * variant-authoring error and it is worth saying so out loud.
 */
export function clockZero(spec, cuts) {
  const first = cuts[0];
  if (!first) return null;
  if (first.from !== spec.from) {
    return { error: `variant starts on "${first.from}" but its stopwatch times from "${spec.from}"` };
  }
  return { t0: first.start };
}

/**
 * One entry per frame of the body: what the clock reads and how it is drawn.
 *
 * `intro` and `pop` are the only animation, and both are computed here rather
 * than in ffmpeg so the badge can be drawn in the shop's own type: a scale-in
 * over the first third of a second, and a snap on the frame the clock stops.
 */
export function stopwatchFrames({ rows, t0, freezeSrc, fps = 30, until, lang = 'nl' }) {
  const freezeAt = freezeSrc === null || freezeSrc === undefined ? null : outputAt(rows, freezeSrc);
  const count = Math.max(1, Math.round(until * fps));
  /* "Start onmiddellijk met een stopwatch" — so the badge lands in under a
     fifth of a second rather than easing in while the hook is already being
     read. POP is the snap on the frame the clock stops. */
  const INTRO = 0.18; const POP = 0.22;
  const frames = [];
  for (let i = 0; i < count; i++) {
    const t = i / fps;
    const frozen = freezeAt !== null && t >= freezeAt - 1e-9;
    /* Before the first scene starts there is no footage to read a time off, so
       the clock sits at zero rather than guessing backwards. */
    const src = frozen ? freezeSrc : sourceAt(rows, t);
    const secs = Math.max(0, (src === null ? t0 : src) - t0);
    frames.push({
      n: i,
      t: +t.toFixed(4),
      secs: +secs.toFixed(3),
      text: formatClock(secs, lang),
      frozen,
      intro: Math.min(1, t / INTRO),
      pop: frozen && freezeAt !== null ? Math.max(0, 1 - (t - freezeAt) / POP) : 0,
    });
  }
  return { frames, freezeAt, total: freezeAt === null ? null : Math.max(0, freezeSrc - t0) };
}

/* ── Drawing ────────────────────────────────────────────────────────────────
   In a browser, for the reason every other overlay in this toolkit is: ffmpeg's
   drawtext needs a TTF and this shop's faces are woff2, so a clock drawn by
   ffmpeg would be set in a font that belongs to nobody. Tabular figures matter
   more here than anywhere else — a clock whose digits change width jitters
   thirty times a second, and that is the difference between strak and cheap. */
const PAGE = (span, done) => `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face{font-family:'Bricolage Grotesque';src:url('__BASE__/fonts/bricolage-800.woff2') format('woff2');font-weight:800;font-display:block}
  @font-face{font-family:'Inter';src:url('__BASE__/fonts/inter-700.woff2') format('woff2');font-weight:700;font-display:block}
  @font-face{font-family:'Inter';src:url('__BASE__/fonts/inter-600.woff2') format('woff2');font-weight:600;font-display:block}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${SW_W}px;height:${SW_H}px;background:transparent;overflow:hidden}
  .stage{width:100%;height:100%;display:flex;align-items:center;justify-content:center}
  .pill{--a:#d946ef;--n:#fff;
    width:${SW_W - 16}px;padding:22px 30px 26px;border-radius:30px;
    background:linear-gradient(165deg,rgba(10,8,22,.94),rgba(18,14,40,.90));
    box-shadow:0 0 0 2px rgba(168,85,247,.34) inset,0 22px 60px rgba(0,0,0,.55);
    transform:scale(var(--s,1));transform-origin:50% 50%;opacity:var(--o,1)}
  .pill.done{--a:#34d399;
    box-shadow:0 0 0 2px rgba(52,211,153,.55) inset,0 22px 60px rgba(0,0,0,.55)}
  .lbl{display:flex;align-items:center;gap:14px;
    font-family:'Inter',system-ui,sans-serif;font-weight:700;font-size:25px;
    letter-spacing:.13em;text-transform:uppercase;color:#cabfff}
  .pill.done .lbl{color:#a9f2d6}
  .dot{width:16px;height:16px;border-radius:50%;background:var(--a);
    box-shadow:0 0 18px var(--a);flex:none}
  .num{display:flex;align-items:baseline;gap:10px;padding-top:8px;
    font-family:'Bricolage Grotesque','Inter',sans-serif;font-weight:800;
    font-size:104px;line-height:1;letter-spacing:-.03em;color:var(--n);
    font-variant-numeric:tabular-nums;font-feature-settings:'tnum' 1}
  .u{font-family:'Inter',system-ui,sans-serif;font-weight:700;font-size:40px;color:#9d94c4}
  .ck{margin-left:auto;font-size:44px;color:#34d399;opacity:0}
  .pill.done .ck{opacity:1}
  .pill.done .u{color:#7fd8b7}
</style></head><body><div class="stage">
  <div class="pill" id="p"><div class="lbl"><i class="dot"></i><span id="l">${span}</span></div>
  <div class="num"><span id="v">0,0</span><span class="u" id="u">s</span><span class="ck">✓</span></div></div>
</div><script>window.__done=${JSON.stringify(done)};window.__span=${JSON.stringify(span)}</script></body></html>`;

/**
 * Render the sequence ffmpeg overlays, one PNG per frame of the body.
 *
 * Frames that would draw exactly the same badge are rendered once and copied —
 * which is most of the tail, because the clock stops moving the moment it
 * freezes and everything after it is the same picture.
 */
export async function renderStopwatch({ frames, out, base, chrome, lang = 'nl' }) {
  const copy = CLOCK_COPY[lang] || CLOCK_COPY.en;
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const browser = await chromium.launch({ executablePath: chrome,
    args: ['--default-background-color=00000000'] });
  const ctx = await browser.newContext({ viewport: { width: SW_W, height: SW_H }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  /* Same origin as the shop so the webfonts load, then the page is replaced —
     exactly what cards.mjs and captions.mjs do. */
  await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.evaluate((h) => {
    document.open(); document.write(h); document.close();
    document.documentElement.style.setProperty('background', 'transparent', 'important');
    document.body.style.setProperty('background', 'transparent', 'important');
  }, PAGE(copy.span, copy.done).replaceAll('__BASE__', base));
  await p.evaluate(async () => {
    await Promise.all([
      document.fonts.load('800 104px "Bricolage Grotesque"'),
      document.fonts.load('700 25px "Inter"'),
    ]).catch(() => {});
    await document.fonts.ready;
  }).catch(() => {});

  const seen = new Map();
  let drawn = 0;
  for (const f of frames) {
    /* Two frames that would draw the same badge share one screenshot. The
       animation is bucketed for the same reason — a twelfth of a second of
       scale is not visible, and it is a browser round-trip. */
    const key = [f.text, f.frozen, Math.round(f.intro * 12), Math.round(f.pop * 12)].join('|');
    const file = path.join(out, `${String(f.n).padStart(5, '0')}.png`);
    const hit = seen.get(key);
    if (hit) { fs.copyFileSync(hit, file); continue; }

    await p.evaluate((s) => {
      const pill = document.getElementById('p');
      document.getElementById('v').textContent = s.text;
      document.getElementById('l').textContent = s.frozen ? window.__done : window.__span;
      document.getElementById('u').textContent = s.unit;
      pill.classList.toggle('done', s.frozen);
      /* The two moves this badge makes: it lands, and it snaps when it stops. */
      pill.style.setProperty('--s', String(1 + 0.10 * s.pop - 0.12 * (1 - s.intro)));
      pill.style.setProperty('--o', String(Math.min(1, s.intro * 1.6)));
    }, { text: f.text, frozen: f.frozen, intro: f.intro, pop: f.pop, unit: f.text.includes(':') ? '' : 's' });
    await p.screenshot({ path: file, omitBackground: true });
    seen.set(key, file);
    drawn++;
  }

  await browser.close();
  return { dir: out, frames: frames.length, drawn };
}
