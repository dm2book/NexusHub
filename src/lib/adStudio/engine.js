/**
 * The Ad Studio video engine: one storyboard in, one finished ad out.
 *
 * Pure canvas 2D and Web Audio — no React, no server. The same code runs in
 * the owner's browser (preview, and a real-time recording to MP4/WebM) and in
 * a headless browser when an ad is rendered frame by frame. A frame is a pure
 * function of the time, so a preview, a recording and an offline render of
 * the same storyboard are the same video.
 *
 *   assets   = await loadAssets(board)
 *   timeline = layout(board, voiceDurations)        // seconds per scene
 *   drawFrame(ctx, timeline, assets, t, opts)       // any t, any order
 *   scheduleAudio(audioCtx, dest, timeline, voices, t0, opts)
 *   play(canvas, timeline, assets, voices, { record }) → { done: Promise<Blob> }
 *
 * The look, in the order a viewer meets it:
 *   frame 0 is a finished composition — the hook is already on screen and
 *   settles in, because the first frame is also the thumbnail;
 *   words arrive one at a time, everything in place within ~0.6 s;
 *   scenes hand over with a zoom-blur, never a white flash;
 *   a slow gradient field with grain and a vignette instead of a grid;
 *   glass cards with an accent edge; a light sweep across every price.
 */

import { makeUgcScenes, UGC_CUES, UGC_TYPES } from './ugc.js';

/* ── Easing ────────────────────────────────────────────────────────────── */
const cl = (x) => Math.max(0, Math.min(1, x));
const eo = (x) => 1 - Math.pow(1 - cl(x), 3);
const eio = (x) => { x = cl(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const back = (x) => { x = cl(x); const c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const at = (u, s, d = 0.32) => cl((u - s) / d);

/* ── Assets ────────────────────────────────────────────────────────────── */
export const FONTS = [
  ['Bric', '/fonts/bricolage-800.woff2', '800'],
  ['Bric', '/fonts/bricolage-700.woff2', '700'],
  ['Inter', '/fonts/inter-400.woff2', '400'],
  ['Inter', '/fonts/inter-600.woff2', '600'],
  ['Inter', '/fonts/inter-700.woff2', '700'],
  ['Raj', '/fonts/rajdhani-600.woff2', '600'],
];

const loadImage = (src) => new Promise((resolve) => {
  if (!src) return resolve(null);
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = src;
});

/** Fonts, every image the storyboard names, and a grain tile. Missing images draw as nothing. */
export async function loadAssets(board, { base = '' } = {}) {
  await Promise.all(FONTS.map(async ([family, url, weight]) => {
    const f = new FontFace(family, `url(${base}${url})`, { weight });
    await f.load().then((ff) => document.fonts.add(ff)).catch(() => {});
  }));
  const urls = new Set();
  for (const s of board.scenes) {
    if (s.data?.image) urls.add(s.data.image);
    for (const u of s.data?.images || []) urls.add(u);
  }
  const images = {};
  await Promise.all([...urls].map(async (u) => { images[u] = await loadImage(base + u); }));
  return { images, grain: grainTile() };
}

/* A seeded noise tile: film grain that is the same on every machine. */
function grainTile() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  let seed = 7;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const v = seed % 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/* ── Timeline ──────────────────────────────────────────────────────────── */
export const VOICE_AT = 0.15;      // a scene's line starts this long after its cut
const TAIL = 0.65;                 // and the scene holds this long after the line
const XFADE = 0.32;                // the hand-over between two scenes

/** Seconds per scene: its animation's minimum, or as long as its line needs. */
export function layout(board, voiceDurations = {}) {
  let t = 0;
  const scenes = board.scenes.map((s) => {
    /* A scene may speak its line a little faster (`voiceRate`, e.g. 1.1 for a
       free voice in a 15-second UGC ad): the line then takes less time. */
    const v = (voiceDurations[s.id] || 0) / (s.voiceRate || 1);
    const dur = Math.max(s.minDur, v ? VOICE_AT + v + (s.tail ?? TAIL) : 0);
    const out = { ...s, start: t, dur, voiceDur: v };
    t += dur;
    return out;
  });
  return { ...board, scenes, total: t };
}

/** Where a time falls: the scene and the seconds into it. */
export function sceneAt(timeline, t) {
  const s = timeline.scenes.find((x) => t >= x.start && t < x.start + x.dur) || timeline.scenes[timeline.scenes.length - 1];
  return { scene: s, u: t - s.start };
}

/* ── Geometry and type ─────────────────────────────────────────────────── */
function geometry(W, H, platform) {
  const k = W / 1080;
  const left = 84 * k;
  const right = W - Math.max(84 * k, (platform?.safeRight || 0.06) * W);
  const top = 190 * k;
  const bottom = H * (1 - (platform?.safeBottom || 0.06)) - 40 * k;
  const u = Math.min(k, (bottom - top) / 1330);
  return { W, H, k, u, left, right, top, bottom, width: right - left, height: bottom - top };
}
const fontOf = (px, family = 'Bric', weight = '800') => `${weight} ${px}px ${family}`;

function fit(ctx, text, px, maxW, family = 'Bric', weight = '800', letter = 0) {
  let size = px;
  for (let i = 0; i < 40; i++) {
    ctx.font = fontOf(size, family, weight);
    ctx.letterSpacing = `${letter}px`;
    if (ctx.measureText(text).width <= maxW) break;
    size *= 0.95;
  }
  ctx.letterSpacing = '0px';
  return size;
}

/**
 * A headline, word by word: each word rises and sharpens in, 70 ms apart.
 * `p0` is when the first word starts. Returns the fitted size and width.
 */
function words(ctx, G, text, y, { px, color = '#f7f5ff', family = 'Bric', weight = '800', u, p0 = 0, stagger = 0.07, align = 'left', x = G.left, maxW = G.width, shadow = true, scale = 1 } = {}) {
  if (!text) return null;
  const size = fit(ctx, text, px * G.u, maxW, family, weight);
  ctx.save();
  ctx.font = fontOf(size, family, weight);
  ctx.textBaseline = 'alphabetic';
  const parts = String(text).split(' ');
  const space = ctx.measureText(' ').width;
  const widths = parts.map((w) => ctx.measureText(w).width);
  const total = widths.reduce((a, b) => a + b, 0) + space * (parts.length - 1);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  if (scale !== 1) { ctx.translate(cx, y); ctx.scale(scale, scale); ctx.translate(-cx, -y); }
  parts.forEach((w, i) => {
    const p = at(u, p0 + i * stagger, 0.34);
    if (p > 0) {
      ctx.save();
      ctx.globalAlpha *= eo(p);
      ctx.fillStyle = color;
      if (shadow) { ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 24 * G.u; ctx.shadowOffsetY = 6 * G.u; }
      ctx.translate(cx, y + (1 - eo(p)) * 34 * G.u);
      ctx.fillText(w, 0, 0);
      ctx.restore();
    }
    cx += widths[i] + space;
  });
  ctx.restore();
  return { size, w: total };
}

/** A small caps label (Rajdhani, tracked). */
function label(ctx, G, text, y, { u, p0 = 0, color = '#a9a3c9', px = 40, align = 'left', x = G.left } = {}) {
  const p = at(u, p0);
  if (p <= 0 || !text) return;
  ctx.save();
  ctx.globalAlpha *= eo(p);
  ctx.font = fontOf(px * G.u, 'Raj', '600');
  ctx.letterSpacing = `${5 * G.u}px`;
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.fillText(String(text).toUpperCase(), x + (1 - eo(p)) * -16 * G.u, y);
  ctx.restore();
}

/** Body copy, faded in. */
function body(ctx, G, text, y, { u, p0 = 0, px = 46, color = '#c9c3e8', align = 'left', x = G.left } = {}) {
  const p = at(u, p0, 0.45);
  if (p <= 0 || !text) return;
  const size = fit(ctx, text, px * G.u, G.width, 'Inter', '600');
  ctx.save();
  ctx.globalAlpha *= eo(p);
  ctx.font = fontOf(size, 'Inter', '600'); ctx.fillStyle = color; ctx.textAlign = align;
  ctx.fillText(text, x, y + (1 - eo(p)) * 18 * G.u);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A diagonal light sweep across a rect, once, between s and s+0.7. */
function sweep(ctx, x, y, w, h, u, s, r) {
  const k = cl((u - s) / 0.7);
  if (k <= 0 || k >= 1) return;
  ctx.save();
  roundRect(ctx, x, y, w, h, r); ctx.clip();
  const sx = x - w * 0.4 + (w * 1.8) * eio(k);
  const g = ctx.createLinearGradient(sx - 120, y, sx + 120, y + h);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** A glass card: label left, value right, accent edge, a sweep across the value. */
function glass(ctx, G, y, left, right, { u, p0 = 0, accent = '#a855f7', strong = false } = {}) {
  const p = at(u, p0, 0.4);
  if (p <= 0) return;
  const h = 132 * G.u, x = G.left, w = G.width, r = 30 * G.u;
  ctx.save();
  ctx.globalAlpha *= eo(p);
  const s = 0.94 + 0.06 * back(p);
  ctx.translate(x + w / 2, y + h / 2 + (1 - eo(p)) * 26 * G.u); ctx.scale(s, s); ctx.translate(-(x + w / 2), -(y + h / 2));
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 40 * G.u; ctx.shadowOffsetY = 14 * G.u;
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = strong ? 'rgba(30,24,70,0.82)' : 'rgba(255,255,255,0.06)';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  const edge = ctx.createLinearGradient(x, y, x + w, y + h);
  edge.addColorStop(0, `${accent}cc`); edge.addColorStop(0.5, 'rgba(255,255,255,0.12)'); edge.addColorStop(1, `${accent}55`);
  ctx.strokeStyle = edge; ctx.lineWidth = 2.5 * G.u; ctx.stroke();
  ctx.textBaseline = 'middle';
  ctx.font = fontOf(44 * G.u, 'Inter', '600'); ctx.fillStyle = '#d9d4f2';
  ctx.fillText(left, x + 38 * G.u, y + h / 2);
  const vs = fit(ctx, right, 86 * G.u, w * 0.46);
  ctx.font = fontOf(vs); ctx.fillStyle = '#ffffff'; ctx.textAlign = 'right';
  ctx.fillText(right, x + w - 38 * G.u, y + h / 2 + 4 * G.u);
  ctx.restore();
  sweep(ctx, x, y, w, h, u, p0 + 0.35, r);
}

/** An image with a soft accent glow, floating gently; dropped or popped in. */
function hero(ctx, G, img, cx, cy, size, { u, p0 = 0, accent = '#a855f7', drop = 0, pop = false, t = 0 } = {}) {
  if (!img) return;
  const p = at(u, p0, 0.5);
  if (p <= 0) return;
  const b = back(p);
  const s = pop ? 0.4 + 0.6 * b : 1;
  const ratio = img.naturalWidth && img.naturalHeight ? img.naturalHeight / img.naturalWidth : 1;
  const w = size * G.u * s, h = w * ratio;
  const float = Math.sin(t * 1.6 + cx * 0.01) * 10 * G.u;
  ctx.save();
  ctx.globalAlpha *= eo(p);
  ctx.translate(cx, cy - (1 - b) * drop * G.u + float);
  ctx.rotate(Math.sin(t * 0.9 + cy * 0.01) * 0.04);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.9);
  glow.addColorStop(0, `${accent}55`); glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow; ctx.fillRect(-w, -w, w * 2, w * 2);
  ctx.shadowColor = `${accent}aa`; ctx.shadowBlur = 60 * G.u; ctx.shadowOffsetY = 22 * G.u;
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

/* ── Scenes ────────────────────────────────────────────────────────────── */
/* y positions are fractions of the content box: one layout for 9:16, 4:5, 1:1. */
/* A 7% lead-in from the top: the block sits in the visual middle of the frame,
   not up against the logo. */
const Y = (G, f) => G.top + G.height * (0.07 + f * 0.93);

const SCENES = {
  hook(ctx, G, d, u, A) {
    /* On screen from frame 0 — the thumbnail — and settling in, not arriving. */
    const settle = 1 + 0.18 * (1 - eo(u / 0.45));
    words(ctx, G, d.big, Y(G, 0.40), { px: 270, color: A.accent, u: u + 10, scale: settle });
    words(ctx, G, d.l1, Y(G, 0.555), { px: 112, u, p0: 0.22 });
    const k = u - 1.55, shake = k > 0 && k < 0.35 ? Math.sin(k * 80) * 12 * G.u * (1 - k / 0.35) : 0;
    ctx.save(); ctx.translate(shake, 0);
    const r = words(ctx, G, d.l2, Y(G, 0.665), { px: 142, color: A.accent, u, p0: 0.42 });
    ctx.restore();
    if (d.strike && r && u > 1.5) {
      ctx.save();
      ctx.fillStyle = '#ffffff'; ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 12 * G.u;
      ctx.fillRect(G.left - 8 * G.u, Y(G, 0.665) - r.size * 0.36, (r.w + 16 * G.u) * eio(at(u, 1.5, 0.22)), 13 * G.u);
      ctx.restore();
    }
  },
  myth(ctx, G, d, u, A) {
    hero(ctx, G, A.img(d.image), G.right - 170 * G.u, Y(G, 0.13), 300, { u, accent: A.accent, drop: 220, t: A.t });
    label(ctx, G, A.lang === 'nl' ? 'Mythe' : 'Myth', Y(G, 0.06), { u, color: A.accent });
    const n = Math.floor(cl((u - 0.12) / 0.75) * d.title.length);
    if (n) {
      const size = fit(ctx, d.title, 132 * G.u, G.width);
      ctx.save(); ctx.font = fontOf(size); ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 24 * G.u;
      ctx.fillText(d.title.slice(0, n), G.left, Y(G, 0.45));
      if (n < d.title.length && Math.floor(u * 6) % 2 === 0) ctx.fillRect(G.left + ctx.measureText(d.title.slice(0, n)).width + 6 * G.u, Y(G, 0.45) - size * 0.75, 8 * G.u, size * 0.8);
      ctx.restore();
    }
    const ps = at(u, 1.05, 0.28);
    if (ps > 0) {
      ctx.save();
      ctx.globalAlpha = eo(at(u, 1.05, 0.1));
      const s = 1 + 1.4 * (1 - back(ps));
      ctx.translate(G.left + 250 * G.u, Y(G, 0.60)); ctx.rotate(-0.15); ctx.scale(s, s);
      ctx.font = fontOf(180 * G.u);
      const w = ctx.measureText(d.stamp).width;
      ctx.shadowColor = `${A.accent}88`; ctx.shadowBlur = 40 * G.u;
      ctx.strokeStyle = A.accent; ctx.lineWidth = 13 * G.u;
      roundRect(ctx, -w / 2 - 38 * G.u, -142 * G.u, w + 76 * G.u, 190 * G.u, 22 * G.u); ctx.stroke();
      ctx.fillStyle = A.accent; ctx.textAlign = 'center'; ctx.fillText(d.stamp, 0, 18 * G.u);
      ctx.restore();
    }
    body(ctx, G, d.sub, Y(G, 0.80), { u, p0: 1.6 });
  },
  trust(ctx, G, d, u, A) {
    label(ctx, G, d.label, Y(G, 0.05), { u, color: A.accent });
    hero(ctx, G, A.img(d.image), G.right - 200 * G.u, Y(G, 0.25), 340, { u, p0: 0.05, accent: A.accent, drop: 280, t: A.t });
    words(ctx, G, d.l1, Y(G, 0.52), { px: 122, u, p0: 0.2 });
    words(ctx, G, d.l2, Y(G, 0.625), { px: 132, color: A.accent, u, p0: 0.38 });
    glass(ctx, G, Y(G, 0.71), d.card[0], d.card[1], { u, p0: 0.75, accent: A.accent, strong: true });
  },
  math(ctx, G, d, u, A) {
    label(ctx, G, d.chip, Y(G, 0.05), { u, color: A.accent });
    hero(ctx, G, A.img(d.image), G.right - 150 * G.u, Y(G, 0.06), 250, { u, accent: A.accent, t: A.t });
    glass(ctx, G, Y(G, 0.17), d.rows[0][0], d.rows[0][1], { u, p0: 0.1, accent: '#ffffff' });
    glass(ctx, G, Y(G, 0.29), d.rows[1][0], d.rows[1][1], { u, p0: 0.3, accent: A.accent, strong: true });
    if (u > 0.9) {
      const k = cl((u - 0.9) / 2.2);
      const v = Math.round(d.from - (d.from - d.to) * eio(k));
      const pulse = k >= 1 ? 1 + 0.08 * (1 - eo(at(u, 3.1, 0.3))) : 1;
      words(ctx, G, A.money(v), Y(G, 0.64), { px: 240, color: k >= 1 ? A.accent : '#ffffff', u: u + 10, scale: pulse });
      if (k >= 1) sweep(ctx, G.left, Y(G, 0.64) - 220 * G.u, G.width * 0.8, 240 * G.u, u, 3.1, 20 * G.u);
    }
    label(ctx, G, d.label, Y(G, 0.715), { u, p0: 0.95, color: '#ffffff', px: 46 });
    body(ctx, G, d.sub, Y(G, 0.80), { u, p0: 3.3 });
  },
  beforeafter(ctx, G, d, u, A) {
    const row = (y, name, value, p0, color = '#ffffff', pop = false) => {
      const p = at(u, p0, 0.4);
      if (p <= 0) return;
      ctx.save(); ctx.globalAlpha *= eo(p);
      ctx.translate(0, (1 - eo(p)) * 30 * G.u);
      ctx.font = fontOf(40 * G.u, 'Raj', '600'); ctx.letterSpacing = `${5 * G.u}px`; ctx.fillStyle = '#a9a3c9';
      ctx.fillText(name.toUpperCase(), G.left, y);
      ctx.letterSpacing = '0px';
      const size = fit(ctx, value, 124 * G.u, G.width * 0.74);
      ctx.font = fontOf(size); ctx.fillStyle = color; ctx.textAlign = 'right';
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 24 * G.u;
      const s = pop ? 1 + 0.35 * (1 - back(p)) : 1;
      ctx.save(); ctx.translate(G.right, y); ctx.scale(s, s); ctx.fillText(value, 0, 0); ctx.restore();
      ctx.shadowColor = 'transparent';
      const line = ctx.createLinearGradient(G.left, 0, G.right, 0);
      line.addColorStop(0, 'rgba(255,255,255,0.22)'); line.addColorStop(1, `${A.accent}66`);
      ctx.fillStyle = line; ctx.fillRect(G.left, y + 30 * G.u, G.width, 3 * G.u);
      ctx.restore();
    };
    const n = Math.round(d.n * eio(cl((u - 0.55) / 1.8)));
    row(Y(G, 0.28), d.rows[0], `0 ${d.unit}`, 0.05);
    row(Y(G, 0.46), d.rows[1], `${A.count(n)} ${d.unit}`, 0.4);
    row(Y(G, 0.64), d.rows[2], d.price, 2.45, A.accent, true);
    if (u > 2.6) sweep(ctx, G.left, Y(G, 0.64) - 120 * G.u, G.width, 150 * G.u, u, 2.7, 16 * G.u);
  },
  guest(ctx, G, d, u, A) {
    const imgs = (d.images || []).map((x) => A.img(x)).filter(Boolean).slice(0, 3);
    imgs.forEach((im, i) => hero(ctx, G, im, G.left + (120 + i * 280) * G.u, Y(G, 0.14), 200,
      { u, p0: 0.05 + i * 0.12, accent: A.accent, pop: true, t: A.t + i }));
    words(ctx, G, d.l1, Y(G, 0.48), { px: 132, u, p0: 0.3 });
    words(ctx, G, d.l2, Y(G, 0.595), { px: 140, color: A.accent, u, p0: 0.55 });
    body(ctx, G, d.sub, Y(G, 0.70), { u, p0: 1.0 });
  },
  refund(ctx, G, d, u, A) {
    hero(ctx, G, A.img(d.image), G.right - 190 * G.u, Y(G, 0.16), 300, { u, accent: A.accent, t: A.t });
    words(ctx, G, d.l1, Y(G, 0.50), { px: 126, u, p0: 0.1 });
    const p = at(u, 0.55, 0.3);
    if (p > 0) words(ctx, G, d.l2, Y(G, 0.62), { px: 152, color: A.accent, u: u + 10, scale: 1 + 0.45 * (1 - back(p)) });
    body(ctx, G, d.sub, Y(G, 0.72), { u, p0: 1.1 });
  },
  end(ctx, G, d, u, A) {
    const cx = G.W / 2;
    const p = at(u, 0.05, 0.55);
    if (p > 0) {
      ctx.save(); ctx.globalAlpha *= eo(p);
      const s = 0.85 + 0.15 * back(p);
      ctx.translate(cx, Y(G, 0.36)); ctx.scale(s, s);
      const size = fit(ctx, 'FORGEMARKET', 124 * G.u, G.W - 160 * G.u, 'Raj', '600', 14 * G.u);
      ctx.font = fontOf(size, 'Raj', '600'); ctx.letterSpacing = `${14 * G.u}px`;
      const w1 = ctx.measureText('FORGE').width, w2 = ctx.measureText('MARKET').width;
      ctx.shadowColor = `${A.accent}aa`; ctx.shadowBlur = 50 * G.u;
      ctx.fillStyle = '#ffffff'; ctx.fillText('FORGE', -(w1 + w2) / 2, 0);
      ctx.fillStyle = A.accent; ctx.fillText('MARKET', -(w1 + w2) / 2 + w1, 0);
      ctx.restore();
    }
    const pc = at(u, 0.45, 0.45);
    if (pc > 0) {
      const pulse = 1 + 0.025 * Math.sin(Math.max(0, u - 0.9) * 5);
      const w = G.W - 280 * G.u, h = 132 * G.u, x = cx - w / 2, y = Y(G, 0.50);
      ctx.save(); ctx.globalAlpha *= eo(pc);
      ctx.translate(cx, y + h / 2 + (1 - eo(pc)) * 30 * G.u); ctx.scale(pulse, pulse); ctx.translate(-cx, -(y + h / 2));
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, '#6366f1'); g.addColorStop(0.55, '#a855f7'); g.addColorStop(1, '#ec4899');
      ctx.shadowColor = '#a855f799'; ctx.shadowBlur = 70 * G.u; ctx.shadowOffsetY = 16 * G.u;
      roundRect(ctx, x, y, w, h, 66 * G.u); ctx.fillStyle = g; ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = '#fff'; ctx.font = fontOf(58 * G.u, 'Inter', '700'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(d.cta, cx, y + h / 2 + 3 * G.u);
      ctx.restore();
      sweep(ctx, x, y, w, h, u, 1.0, 66 * G.u);
      if (u > 2.2) sweep(ctx, x, y, w, h, u, 3.2, 66 * G.u);
    }
    label(ctx, G, d.tag, Y(G, 0.66), { u, p0: 0.85, color: '#ffffff', px: 50, align: 'center', x: cx });
  },
};

/* The UGC beats (see ugc.js), drawn with the helpers above. */
Object.assign(SCENES, makeUgcScenes({ cl, eo, eio, back, at, fit, fontOf, roundRect, sweep, hero, Y, VOICE_AT }));

/* ── Captions ──────────────────────────────────────────────────────────── */
/** Word-by-word caption for the voice line, the spoken word lit — no box, an outline. */
function captions(ctx, G, scene, u, accent) {
  const text = scene.voice;
  if (!text || !scene.voiceDur) return;
  const k = (u - VOICE_AT) / scene.voiceDur;
  if (k < 0 || k > 1.04) return;
  const all = text.split(/\s+/);
  const weights = all.map((w) => w.length + 2);
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0, current = all.length - 1;
  for (let i = 0; i < all.length; i++) { acc += weights[i] / total; if (k < acc) { current = i; break; } }
  ctx.save();
  const px = 52 * G.u;
  ctx.font = fontOf(px, 'Inter', '700');
  /* The outline is drawn on both sides of every letter, so the gap between
     words has to carry it too — or "Voor negenendertig euro" reads as one word. */
  const outline = 9 * G.u;
  const space = ctx.measureText(' ').width + outline * 1.4;
  const maxW = G.W - 170 * G.k;
  /* Chunks of up to four words that fit, the way TikTok pages its captions. */
  let n = 4, start, shown, widths, lineW;
  do {
    start = Math.floor(current / n) * n;
    shown = all.slice(start, start + n);
    widths = shown.map((w) => ctx.measureText(w).width);
    lineW = widths.reduce((a, b) => a + b, 0) + space * (shown.length - 1);
  } while (lineW > maxW && --n > 1);
  const y = G.bottom - 6 * G.u;
  let x = G.W / 2 - lineW / 2;
  ctx.lineJoin = 'round';
  shown.forEach((w, i) => {
    const on = start + i === current;
    ctx.save();
    ctx.translate(x + widths[i] / 2, y - (on ? 4 * G.u : 0));
    ctx.textAlign = 'center';
    ctx.lineWidth = outline; ctx.strokeStyle = 'rgba(5,4,12,0.85)'; ctx.strokeText(w, 0, 0);
    ctx.fillStyle = on ? accent : '#ffffff'; ctx.fillText(w, 0, 0);
    ctx.restore();
    x += widths[i] + space;
  });
  ctx.restore();
}

/* ── Background ────────────────────────────────────────────────────────── */
function background(ctx, G, t, accent, grain, frame) {
  const { W, H } = G;
  ctx.fillStyle = '#06050d'; ctx.fillRect(0, 0, W, H);
  const blobs = [
    [0.78 + 0.06 * Math.sin(t * 0.35), 0.24 + 0.04 * Math.cos(t * 0.3), 1.0, `${accent}5c`],
    [0.12 + 0.05 * Math.cos(t * 0.27), 0.86 + 0.03 * Math.sin(t * 0.33), 1.05, '#7c3aed38'],
    [0.30 + 0.05 * Math.sin(t * 0.22 + 1), 0.52 + 0.05 * Math.cos(t * 0.25), 0.7, `${accent}1f`],
  ];
  for (const [x, y, r, c] of blobs) {
    const g = ctx.createRadialGradient(x * W, y * H, 0, x * W, y * H, r * W);
    g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  if (grain) {
    ctx.save();
    ctx.globalAlpha = 0.045; ctx.globalCompositeOperation = 'overlay';
    const ox = (frame * 73) % 256, oy = (frame * 151) % 256;
    ctx.translate(-ox, -oy);
    ctx.fillStyle = ctx.createPattern(grain, 'repeat'); ctx.fillRect(0, 0, W + 256, H + 256);
    ctx.restore();
  }
}

/* ── Your own footage ─────────────────────────────────────────────────── */
/**
 * A clip the owner filmed, full-bleed under everything (cover, centred), with
 * a dark wash top and bottom so white boxes and cards read on any picture.
 * The video element's current frame is drawn: during playback it plays in
 * step; when scrubbing, the studio seeks it first.
 */
function footageLayer(ctx, G, video, accent) {
  const { W, H } = G;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const vw = video.videoWidth || W, vh = video.videoHeight || H;
  const s = Math.max(W / vw, H / vh);
  try { ctx.drawImage(video, (W - vw * s) / 2, (H - vh * s) / 2, vw * s, vh * s); } catch { /* not ready yet */ }
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0.45)'); g.addColorStop(0.3, 'rgba(0,0,0,0.12)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = `${accent}14`; ctx.fillRect(0, 0, W, H);
}

/* ── The frame ─────────────────────────────────────────────────────────── */
const money = (lang) => (c) => `€${(c / 100).toFixed(2).replace('.', lang === 'nl' ? ',' : '.')}`;

function drawScene(ctx, G, timeline, assets, scene, u, t) {
  const A = {
    accent: scene.accent || '#a855f7', t, lang: timeline.lang, footage: !!assets.footage,
    img: (url) => assets.images?.[url] || null,
    money: money(timeline.lang),
    count: (n) => Number(n).toLocaleString(timeline.lang === 'nl' ? 'nl-NL' : 'en-GB'),
  };
  (SCENES[scene.type] || SCENES.trust)(ctx, G, scene.data, u, A, scene);
}

/** Draw the frame at t seconds. Pure: depends only on (timeline, assets, t, opts). */
export function drawFrame(ctx, timeline, assets, t, { captions: showCaptions = true } = {}) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const G = geometry(W, H, timeline.platform);
  const { scene, u } = sceneAt(timeline, t);
  const i = timeline.scenes.indexOf(scene);
  const accent = scene.accent || '#a855f7';
  ctx.save();
  ctx.letterSpacing = '0px';
  if (assets.footage) footageLayer(ctx, G, assets.footage, accent);
  else background(ctx, G, t, accent, assets.grain, Math.round(t * 30));

  /* Hand-over: the last scene zooms past and blurs out while this one
     settles in out of a blur. */
  const xf = UGC_TYPES.includes(scene.type) ? 0.2 : XFADE;
  const k = i > 0 ? eio(u / xf) : 1;
  if (i > 0 && k < 1) {
    const prev = timeline.scenes[i - 1];
    ctx.save();
    ctx.globalAlpha = 1 - k;
    if ('filter' in ctx) ctx.filter = `blur(${Math.round(14 * k * G.k)}px)`;
    const s = 1 + 0.14 * k;
    ctx.translate(W / 2, H / 2); ctx.scale(s, s); ctx.translate(-W / 2, -H / 2);
    drawScene(ctx, G, timeline, assets, prev, prev.dur, t);
    ctx.restore();
  }
  ctx.save();
  ctx.globalAlpha = k;
  if (k < 1 && 'filter' in ctx) ctx.filter = `blur(${Math.round(12 * (1 - k) * G.k)}px)`;
  const push = (0.92 + 0.08 * k) * (1 + 0.02 * cl(u / Math.max(1, scene.dur)));
  ctx.translate(W / 2, H / 2); ctx.scale(push, push); ctx.translate(-W / 2, -H / 2);
  drawScene(ctx, G, timeline, assets, scene, u, t);
  ctx.restore();
  if ('filter' in ctx) ctx.filter = 'none';

  if (scene.type !== 'end') {
    ctx.save();
    ctx.font = fontOf(36 * G.k, 'Raj', '600'); ctx.letterSpacing = `${8 * G.k}px`; ctx.textBaseline = 'top';
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = '#ffffff'; ctx.fillText('FORGE', 84 * G.k, 76 * G.k);
    ctx.fillStyle = accent; ctx.fillText('MARKET', 84 * G.k + ctx.measureText('FORGE').width, 76 * G.k);
    ctx.restore();
  }
  if ((scene.type === 'end' || scene.type === 'ugc-cta') && timeline.disclaimer) {
    ctx.save();
    ctx.globalAlpha = eo(at(u, 1.2, 0.5)) * 0.5;
    const size = fit(ctx, timeline.disclaimer, 22 * G.u, W - 170 * G.k, 'Inter', '400');
    ctx.font = fontOf(size, 'Inter', '400'); ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center';
    ctx.fillText(timeline.disclaimer, W / 2, G.bottom);
    ctx.restore();
  }

  /* UGC beats carry their own line in caption boxes, in step with the voice. */
  if (showCaptions && scene.type !== 'end' && !UGC_TYPES.includes(scene.type)) captions(ctx, G, scene, u, accent);
  ctx.restore();
}

/* ── Sound ─────────────────────────────────────────────────────────────── */
/* Relative cue times per scene type: what the eye sees, the ear hears. */
const CUES = {
  hook: [['impact', 0.0], ['swish', 0.22], ['swish', 0.42], ['impact', 1.5]],
  myth: [['drop', 0.05], ...Array.from({ length: 14 }, (_, i) => ['tick', 0.12 + i * 0.054]), ['impact', 1.05]],
  trust: [['drop', 0.05], ['swish', 0.2], ['pop', 0.75], ['shine', 1.1]],
  math: [['pop', 0.1], ['pop', 0.3], ...Array.from({ length: 18 }, (_, i) => ['tick', 0.9 + i * 0.12]), ['impact', 3.1], ['shine', 3.1]],
  beforeafter: [['pop', 0.05], ['pop', 0.4], ...Array.from({ length: 15 }, (_, i) => ['tick', 0.55 + i * 0.12]), ['impact', 2.45], ['shine', 2.7]],
  guest: [['pop', 0.05], ['pop', 0.17], ['pop', 0.29], ['swish', 0.3], ['swish', 0.55]],
  refund: [['swish', 0.1], ['impact', 0.55]],
  end: [['impact', 0.05], ['ding', 0.5], ['shine', 1.0]],
};

/** Every sound cue on the timeline, in seconds from the start. */
export function cuesOf(timeline) {
  const out = [];
  for (const s of timeline.scenes) {
    if (s.start > 0) out.push(['whoosh', s.start]);
    if (s.type === 'end' || s.type === 'ugc-cta') out.push(['riser', Math.max(0, s.start - 0.9)]);
    for (const [kind, rel] of CUES[s.type] || UGC_CUES[s.type] || []) if (rel < s.dur) out.push([kind, s.start + rel]);
  }
  return out.sort((a, b) => a[1] - b[1]);
}

const noiseCache = new WeakMap();
function noise(ctx) {
  if (noiseCache.has(ctx)) return noiseCache.get(ctx);
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = b.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < d.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[i] = (seed / 0x7fffffff) * 2 - 1; }
  noiseCache.set(ctx, b);
  return b;
}
function env(g, t, peak, attack, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}
let nOff = 0;
function noiseHit(ctx, out, t, { type = 'bandpass', f0 = 1000, f1 = 1000, q = 1, peak = 0.5, attack = 0.005, decay = 0.2 }) {
  const src = ctx.createBufferSource(); src.buffer = noise(ctx);
  const filt = ctx.createBiquadFilter(); filt.type = type; filt.Q.value = q;
  filt.frequency.setValueAtTime(f0, t); filt.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
  const g = ctx.createGain(); env(g, t, peak, attack, decay);
  src.connect(filt).connect(g).connect(out);
  nOff = (nOff + 0.137) % 1.5;
  src.start(Math.max(0, t), nOff); src.stop(Math.max(0, t) + attack + decay + 0.05);
}
function tone(ctx, out, t, { f0, f1 = f0, type = 'sine', peak = 0.4, attack = 0.005, decay = 0.3, detune = 0 }) {
  const o = ctx.createOscillator(); o.type = type; o.detune.value = detune;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + attack + decay);
  const g = ctx.createGain(); env(g, t, peak, attack, decay);
  o.connect(g).connect(out); o.start(t); o.stop(t + attack + decay + 0.05);
}
const SFX = {
  impact(ctx, out, t) { tone(ctx, out, t, { f0: 95, f1: 32, peak: 0.85, decay: 0.7 }); noiseHit(ctx, out, t, { type: 'lowpass', f0: 1800, f1: 120, peak: 0.22, decay: 0.4 }); },
  whoosh(ctx, out, t) { noiseHit(ctx, out, Math.max(0, t - 0.18), { f0: 300, f1: 3500, q: 0.7, peak: 0.22, attack: 0.18, decay: 0.22 }); },
  swish(ctx, out, t) { noiseHit(ctx, out, t, { f0: 2500, f1: 6000, q: 1.2, peak: 0.06, attack: 0.02, decay: 0.09 }); },
  drop(ctx, out, t) { noiseHit(ctx, out, t, { f0: 2500, f1: 250, q: 0.8, peak: 0.12, attack: 0.06, decay: 0.28 }); tone(ctx, out, t + 0.28, { f0: 80, f1: 42, peak: 0.45, decay: 0.3 }); },
  tick(ctx, out, t) { tone(ctx, out, t, { f0: 3200, f1: 2600, type: 'triangle', peak: 0.035, attack: 0.002, decay: 0.025 }); },
  pop(ctx, out, t) { tone(ctx, out, t, { f0: 420, f1: 980, peak: 0.12, decay: 0.1 }); },
  shine(ctx, out, t) { [2093, 2637, 3136].forEach((f, i) => tone(ctx, out, t + i * 0.045, { f0: f, peak: 0.05, decay: 0.5 })); },
  ding(ctx, out, t) { tone(ctx, out, t, { f0: 1318, peak: 0.12, decay: 0.9 }); tone(ctx, out, t + 0.05, { f0: 1976, peak: 0.08, decay: 1.0 }); },
  buzz(ctx, out, t) { tone(ctx, out, t, { f0: 110, f1: 92, type: 'square', peak: 0.12, decay: 0.32 }); tone(ctx, out, t, { f0: 116, f1: 96, type: 'square', peak: 0.08, decay: 0.32 }); },
  type(ctx, out, t) { for (let i = 0; i < 6; i++) noiseHit(ctx, out, t + i * 0.075, { f0: 3800, f1: 2600, q: 2, peak: 0.05, attack: 0.001, decay: 0.03 }); },
  check(ctx, out, t) { tone(ctx, out, t, { f0: 880, peak: 0.1, decay: 0.12 }); tone(ctx, out, t + 0.09, { f0: 1320, peak: 0.1, decay: 0.3 }); },
  riser(ctx, out, t) { noiseHit(ctx, out, t, { type: 'highpass', f0: 400, f1: 7000, peak: 0.16, attack: 0.85, decay: 0.06 }); },
};

/* A minor progression for the pad and bass: Am, F, C, G — one chord a bar. */
const CHORDS = [[220, 261.63, 329.63], [174.61, 220, 261.63], [261.63, 329.63, 392], [196, 246.94, 293.66]];
const ROOTS = [55, 43.65, 65.41, 49];

/**
 * The whole soundtrack, scheduled on an AudioContext (or OfflineAudioContext)
 * from t0: a 120 BPM groove that drops at the first cut — kick, clap, hats,
 * bass and a pad that pumps with the kick — every cue, and the voice lines;
 * the music ducks under each line.
 */
export function scheduleAudio(ctx, destination, timeline, voices = {}, t0 = 0, { music = true } = {}) {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.1;
  limiter.connect(destination);
  const master = ctx.createDynamicsCompressor();
  master.threshold.value = -16; master.ratio.value = 3; master.connect(limiter);
  const sfx = ctx.createGain(); sfx.gain.value = 0.75; sfx.connect(master);
  const T = timeline.total;

  if (music) {
    const bus = ctx.createGain(); bus.gain.value = 0.5; bus.connect(master);
    for (const s of timeline.scenes) {
      if (!voices[s.id]) continue;
      const a = t0 + s.start + VOICE_AT, b = a + s.voiceDur;
      bus.gain.setTargetAtTime(0.2, Math.max(0, a - 0.08), 0.05);
      bus.gain.setTargetAtTime(0.5, b, 0.25);
    }
    const drop = timeline.scenes[1]?.start ?? 2.5;
    const end = T - 0.4;
    /* Pad: two detuned saws per chord note through a low-pass, pumping on the beat. */
    const padF = ctx.createBiquadFilter(); padF.type = 'lowpass'; padF.frequency.value = 1200; padF.Q.value = 0.5;
    const pad = ctx.createGain(); pad.gain.value = 0; padF.connect(pad).connect(bus);
    pad.gain.setValueAtTime(0, t0); pad.gain.linearRampToValueAtTime(0.05, t0 + 1.2);
    for (let bar = 0; bar * 2 < end; bar++) {
      const st = t0 + bar * 2, ch = CHORDS[bar % 4];
      for (const f of ch) for (const det of [-7, 7]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(0.18, st + 0.25);
        g.gain.setValueAtTime(0.18, st + 1.75); g.gain.exponentialRampToValueAtTime(0.0001, st + 2.05);
        o.connect(g).connect(padF); o.start(st); o.stop(st + 2.1);
      }
    }
    for (let b = drop; b < end; b += 0.5) {
      const beat = Math.round((b - drop) / 0.5);
      const bar = Math.floor(b / 2) % 4;
      pad.gain.setValueAtTime(0.012, t0 + b); pad.gain.linearRampToValueAtTime(0.05, t0 + b + 0.32);
      tone(ctx, bus, t0 + b, { f0: 130, f1: 42, peak: 0.95, attack: 0.002, decay: 0.32 });                          // kick
      if (beat % 2 === 1) {                                                                                          // clap on 2 and 4
        for (const d of [0, 0.012, 0.024]) noiseHit(ctx, bus, t0 + b + d, { f0: 1500, f1: 1100, q: 0.9, peak: 0.16, attack: 0.001, decay: 0.12 });
      }
      for (const h of [0.25, 0.375]) noiseHit(ctx, bus, t0 + b + h, { type: 'highpass', f0: 8000, f1: 9500, peak: h === 0.25 ? 0.07 : 0.035, attack: 0.001, decay: 0.035 });
      tone(ctx, bus, t0 + b + 0.02, { f0: ROOTS[bar], type: 'triangle', peak: 0.32, attack: 0.01, decay: 0.42 });    // bass
    }
  }
  for (const [kind, when] of cuesOf(timeline)) SFX[kind]?.(ctx, sfx, t0 + when);
  for (const s of timeline.scenes) {
    const buf = voices[s.id];
    if (!buf) continue;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const rate = s.voiceRate || 1;
    src.playbackRate.value = rate;
    const len = buf.duration / rate;
    /* A 15 ms fade in and 40 ms out: no click at the start or end of a line. */
    const g = ctx.createGain();
    const a = t0 + s.start + VOICE_AT;
    g.gain.setValueAtTime(0, a); g.gain.linearRampToValueAtTime(1.3, a + 0.015);
    g.gain.setValueAtTime(1.3, a + Math.max(0.02, len - 0.04)); g.gain.linearRampToValueAtTime(0, a + len);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
    src.connect(hp).connect(g).connect(master);
    src.start(a);
  }
  return master;
}

/** The soundtrack rendered offline to an AudioBuffer (for frame-by-frame renders). */
export async function renderAudio(timeline, voices = {}, opts = {}) {
  const sr = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(sr * timeline.total), sr);
  scheduleAudio(ctx, ctx.destination, timeline, voices, 0, opts);
  return ctx.startRendering();
}

/** An AudioBuffer as a 16-bit WAV. */
export function wav(buffer) {
  const ch = buffer.numberOfChannels, sr = buffer.sampleRate, n = buffer.length;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, sr, true);
  out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); w(36, 'data');
  out.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, data[c][i])); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
  return new Blob([out.buffer], { type: 'audio/wav' });
}

/* ── Recording ─────────────────────────────────────────────────────────── */
/** The best container this browser can record: MP4 with H.264 where it can, WebM otherwise. */
export function recorderType() {
  /* H.264 + AAC in MP4 first: the one every platform takes, Instagram included.
     A bare "video/mp4" is NOT next — in a browser without an H.264 encoder it
     records VP9 in an MP4 box, which some platforms refuse. WebM says what it is. */
  const types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.4D401F,mp4a.40.2',
    'video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4;codecs=avc3,mp4a',
    'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return types.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) || '';
}

/**
 * Play the ad in real time on `canvas` — and record it when `record` is set.
 * Resolves with the recorded Blob (or null). `onTime` reports progress;
 * calling the returned `stop` ends early.
 */
export function play(canvas, timeline, assets, voices, { record = false, monitor = true, music = true, captions: showCaptions = true, footageAudio = false, onTime } = {}) {
  const ctx2d = canvas.getContext('2d');
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  const dest = ac.createMediaStreamDestination();
  const out = ac.createGain();
  out.connect(dest);
  if (monitor) out.connect(ac.destination);
  const t0 = ac.currentTime + 0.25;
  scheduleAudio(ac, out, timeline, voices, t0, { music });
  /* Your own clip plays in step from the first frame; its sound (your own
     voice) joins the mix when asked for. */
  const clip = assets.footage;
  if (clip) {
    clip.pause(); clip.currentTime = 0; clip.loop = true;
    /* The element plays its own sound to the speakers; a capture of it goes
       only into the recording, so you do not hear it twice. */
    clip.muted = !footageAudio;
    if (footageAudio && record) {
      try {
        const st = (clip.captureStream || clip.mozCaptureStream)?.call(clip);
        if (st?.getAudioTracks().length) ac.createMediaStreamSource(st).connect(dest);
      } catch { /* no sound from this clip */ }
    }
    setTimeout(() => { clip.play().catch(() => {}); }, 250);
  }
  let recorder = null; const chunks = [];
  const type = recorderType();
  if (record) {
    const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 14_000_000, audioBitsPerSecond: 192_000 });
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.start(250);
  }
  let raf = 0, stopped = false, resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const finish = () => {
    if (stopped) return; stopped = true;
    cancelAnimationFrame(raf);
    assets.footage?.pause();
    const close = () => ac.close().catch(() => {});
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = () => { close(); resolveDone(new Blob(chunks, { type: type.split(';')[0] || 'video/webm' })); };
      recorder.stop();
    } else { close(); resolveDone(null); }
  };
  const tick = () => {
    const t = ac.currentTime - t0;
    drawFrame(ctx2d, timeline, assets, Math.max(0, Math.min(t, timeline.total - 1e-3)), { captions: showCaptions });
    onTime?.(Math.max(0, t));
    if (t >= timeline.total + 0.15) return finish();
    raf = requestAnimationFrame(tick);
  };
  tick();
  return { done, stop: finish, type };
}
