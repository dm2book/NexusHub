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
 *   await record(canvas, timeline, assets, voices, opts) → Blob
 */

/* ── Easing ────────────────────────────────────────────────────────────── */
const cl = (x) => Math.max(0, Math.min(1, x));
const eo = (x) => 1 - Math.pow(1 - cl(x), 3);
const back = (x) => { x = cl(x); const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const at = (u, s, d = 0.35) => cl((u - s) / d);

/* ── Assets ────────────────────────────────────────────────────────────── */
export const FONTS = [
  ['Bric', '/fonts/bricolage-800.woff2', '800'],
  ['Inter', '/fonts/inter-400.woff2', '400'],
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

/** Fonts and every image the storyboard names. Missing images draw as nothing, never as an error. */
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
  return { images };
}

/* ── Timeline ──────────────────────────────────────────────────────────── */
export const VOICE_AT = 0.15;      // a scene's line starts this long after its cut
const TAIL = 0.65;                 // and the scene holds this long after the line

/** Seconds per scene: its animation's minimum, or as long as its line needs. */
export function layout(board, voiceDurations = {}) {
  let t = 0;
  const scenes = board.scenes.map((s) => {
    const v = voiceDurations[s.id] || 0;
    const dur = Math.max(s.minDur, v ? VOICE_AT + v + TAIL : 0);
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

/* ── Drawing primitives ────────────────────────────────────────────────── */
function geometry(W, H, platform) {
  const k = W / 1080;
  const left = 80 * k;
  const right = W - Math.max(80 * k, (platform?.safeRight || 0.06) * W);
  const top = 170 * k;
  const bottom = H * (1 - (platform?.safeBottom || 0.06)) - 30 * k;
  /* One unit for type and spacing: shrinks for formats with less height. */
  const u = Math.min(k, (bottom - top) / 1350);
  return { W, H, k, u, left, right, top, bottom, width: right - left, height: bottom - top };
}

const fontOf = (px, family = 'Bric', weight = '800') => `${weight} ${px}px ${family}`;

/** The largest size ≤ px at which `text` fits in maxW. */
function fit(ctx, text, px, maxW, family = 'Bric', weight = '800') {
  let size = px;
  ctx.font = fontOf(size, family, weight);
  while (ctx.measureText(text).width > maxW && size > 12) {
    size *= 0.95;
    ctx.font = fontOf(size, family, weight);
  }
  return size;
}

/** One line of text, fitted, faded and lifted in by progress p (0→1). */
function line(ctx, G, text, y, { px, color = '#f5f3ff', family = 'Bric', weight = '800', p = 1, lift = 50, scale = 1, align = 'left', x = G.left, maxW = G.width, letter = 0, rotate = 0 } = {}) {
  if (p <= 0 || !text) return null;
  const size = fit(ctx, text, px * G.u, maxW, family, weight);
  ctx.save();
  ctx.globalAlpha *= eo(p);
  ctx.font = fontOf(size, family, weight);
  if (letter) ctx.letterSpacing = `${letter * G.u}px`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  const w = ctx.measureText(text).width;
  const ox = align === 'center' ? x : align === 'right' ? x - w : x;
  ctx.translate(ox, y + (1 - eo(p)) * lift * G.u);
  if (rotate) ctx.rotate(rotate);
  if (scale !== 1) ctx.scale(scale, scale);
  ctx.fillText(text, align === 'center' ? 0 : align === 'right' ? w : 0, 0);
  ctx.restore();
  return { size, w };
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

/** A price card: label left, price right. */
function card(ctx, G, y, label, value, { p = 1, scale = 1, accent = null } = {}) {
  if (p <= 0) return;
  const h = 130 * G.u;
  ctx.save();
  ctx.globalAlpha *= eo(p);
  const s = scale === 1 ? 1 : scale + (1 - scale) * back(p);
  ctx.translate(G.left, y + (1 - eo(p)) * 40 * G.u);
  ctx.scale(s, s);
  roundRect(ctx, 0, 0, G.width, h, 30 * G.u);
  ctx.fillStyle = 'rgba(23,18,54,0.92)';
  ctx.fill();
  ctx.strokeStyle = accent ? `${accent}88` : 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 2 * G.u;
  ctx.stroke();
  ctx.fillStyle = '#cfc9ee';
  ctx.font = fontOf(46 * G.u, 'Inter', '400');
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 36 * G.u, h / 2);
  const vs = fit(ctx, value, 84 * G.u, G.width * 0.45);
  ctx.font = fontOf(vs);
  ctx.fillStyle = '#f5f3ff';
  ctx.textAlign = 'right';
  ctx.fillText(value, G.width - 36 * G.u, h / 2 + 4 * G.u);
  ctx.restore();
}

/** An image with a coloured glow, dropped in with a bounce. */
function icon(ctx, G, img, cx, cy, size, { p = 1, accent = '#a855f7', drop = 0, rotate = 0, popScale = 0 } = {}) {
  if (!img || p <= 0) return;
  const b = back(p);
  const s = popScale ? popScale + (1 - popScale) * b : 1;
  const ratio = img.naturalWidth && img.naturalHeight ? img.naturalHeight / img.naturalWidth : 1;
  const w = size * G.u * s, h = w * ratio;
  ctx.save();
  ctx.globalAlpha *= eo(p);
  ctx.translate(cx, cy - (1 - b) * drop * G.u);
  ctx.rotate(rotate);
  ctx.shadowColor = `${accent}aa`;
  ctx.shadowBlur = 70 * G.u;
  ctx.shadowOffsetY = 24 * G.u;
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

/* ── Scenes ────────────────────────────────────────────────────────────── */
/* Each draws one scene at u seconds in. y positions are fractions of the
   content box, so the same scene works in 9:16, 4:5 and 1:1. */
const Y = (G, f) => G.top + G.height * f;

const SCENES = {
  hook(ctx, G, d, u, A) {
    const p0 = at(u, 0.05, 0.28);
    if (p0 > 0) {
      const s = 1 + 1.2 * (1 - back(p0));
      line(ctx, G, d.big, Y(G, 0.30), { px: 250, color: A.accent, p: p0, lift: 0, scale: s });
    }
    line(ctx, G, d.l1, Y(G, 0.47), { px: 108, p: at(u, 1.0) });
    const k = u - 2.0, shake = k > 0 && k < 0.4 ? Math.sin(k * 90) * 16 * G.u * (1 - k / 0.4) : 0;
    ctx.save(); ctx.translate(shake, 0);
    const r = line(ctx, G, d.l2, Y(G, 0.58), { px: 140, color: A.accent, p: at(u, 1.3) });
    ctx.restore();
    if (d.strike && r && u > 2.0) {
      ctx.fillStyle = '#f5f3ff';
      ctx.fillRect(G.left, Y(G, 0.58) - r.size * 0.36, r.w * eo(at(u, 2.0, 0.25)), 14 * G.u);
    }
  },
  myth(ctx, G, d, u, A) {
    icon(ctx, G, A.img(d.image), G.left + 150 * G.u, Y(G, 0.12), 280, { p: at(u, 0.1, 0.5), accent: A.accent, drop: 200 });
    const n = Math.floor(cl((u - 0.2) / 1.0) * d.title.length);
    line(ctx, G, d.title.slice(0, n), Y(G, 0.45), { px: 132, p: n ? 1 : 0, lift: 0 });
    const ps = at(u, 1.6, 0.3);
    if (ps > 0) {
      ctx.save();
      ctx.globalAlpha = eo(at(u, 1.6, 0.12));
      const s = 1 + 1.6 * (1 - back(ps));
      ctx.translate(G.left + 260 * G.u, Y(G, 0.60));
      ctx.rotate(-0.16);
      ctx.scale(s, s);
      ctx.font = fontOf(190 * G.u);
      const w = ctx.measureText(d.stamp).width;
      ctx.strokeStyle = A.accent; ctx.lineWidth = 14 * G.u;
      roundRect(ctx, -w / 2 - 40 * G.u, -150 * G.u, w + 80 * G.u, 200 * G.u, 24 * G.u);
      ctx.stroke();
      ctx.fillStyle = A.accent; ctx.textAlign = 'center';
      ctx.fillText(d.stamp, 0, 20 * G.u);
      ctx.restore();
    }
    line(ctx, G, d.sub, Y(G, 0.82), { px: 52, family: 'Inter', weight: '400', color: '#cfc9ee', p: at(u, 2.8) });
  },
  trust(ctx, G, d, u, A) {
    line(ctx, G, d.label, Y(G, 0.06), { px: 52, family: 'Raj', weight: '600', color: A.accent, p: at(u, 0.1), letter: 4 });
    icon(ctx, G, A.img(d.image), G.right - 190 * G.u, Y(G, 0.27), 330, { p: at(u, 0.3, 0.55), accent: A.accent, drop: 320 });
    line(ctx, G, d.l1, Y(G, 0.52), { px: 118, p: at(u, 1.0) });
    line(ctx, G, d.l2, Y(G, 0.62), { px: 128, color: A.accent, p: at(u, 1.3) });
    card(ctx, G, Y(G, 0.74), d.card[0], d.card[1], { p: at(u, 3.0, 0.35), scale: 0.6, accent: A.accent });
  },
  math(ctx, G, d, u, A) {
    const chipP = at(u, 0.1);
    if (chipP > 0) {
      ctx.save(); ctx.globalAlpha *= eo(chipP);
      ctx.font = fontOf(34 * G.u, 'Raj', '600'); ctx.letterSpacing = `${4 * G.u}px`;
      const w = ctx.measureText(d.chip.toUpperCase()).width + 52 * G.u;
      roundRect(ctx, G.left, Y(G, 0.0), w, 64 * G.u, 32 * G.u);
      ctx.strokeStyle = A.accent; ctx.lineWidth = 3 * G.u; ctx.stroke();
      ctx.fillStyle = A.accent; ctx.textBaseline = 'middle';
      ctx.fillText(d.chip.toUpperCase(), G.left + 26 * G.u, Y(G, 0.0) + 33 * G.u);
      ctx.restore();
    }
    icon(ctx, G, A.img(d.image), G.right - 160 * G.u, Y(G, 0.06), 280, { p: at(u, 0.2), accent: A.accent });
    card(ctx, G, Y(G, 0.22), d.rows[0][0], d.rows[0][1], { p: at(u, 0.4) });
    card(ctx, G, Y(G, 0.34), d.rows[1][0], d.rows[1][1], { p: at(u, 1.4), accent: A.accent });
    if (u > 2.6) {
      const k = cl((u - 2.6) / 2.4);
      const v = Math.round(d.from - (d.from - d.to) * eo(k));
      const txt = A.money(v);
      const pulse = k >= 1 ? 1 + 0.12 * (1 - eo(at(u, 5.0, 0.3))) : 1;
      line(ctx, G, txt, Y(G, 0.66), { px: 230, color: k >= 1 ? A.accent : '#f5f3ff', lift: 0, scale: pulse });
    }
    line(ctx, G, d.label.toUpperCase(), Y(G, 0.74), { px: 50, family: 'Raj', weight: '600', p: at(u, 2.7), letter: 3 });
    line(ctx, G, d.sub, Y(G, 0.84), { px: 54, family: 'Inter', weight: '400', color: '#cfc9ee', p: at(u, 5.4) });
  },
  beforeafter(ctx, G, d, u, A) {
    const row = (y, label, value, p, color = '#f5f3ff', scale = 1) => {
      if (p <= 0) return;
      ctx.save(); ctx.globalAlpha *= eo(p);
      ctx.translate(0, (1 - eo(p)) * 40 * G.u);
      ctx.font = fontOf(42 * G.u, 'Raj', '600'); ctx.letterSpacing = `${3 * G.u}px`;
      ctx.fillStyle = '#a9a3c9'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(label.toUpperCase(), G.left, y);
      ctx.letterSpacing = '0px';
      const size = fit(ctx, value, 118 * G.u, G.width * 0.72);
      ctx.font = fontOf(size); ctx.fillStyle = color; ctx.textAlign = 'right';
      ctx.save(); ctx.translate(G.right, y); ctx.scale(scale, scale); ctx.fillText(value, 0, 0); ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(G.left, y + 28 * G.u, G.width, 3 * G.u);
      ctx.restore();
    };
    const n = Math.round(d.n * eo(cl((u - 1.0) / 2.3)));
    row(Y(G, 0.30), d.rows[0], `0 ${d.unit}`, at(u, 0.1));
    row(Y(G, 0.48), d.rows[1], `${A.count(n)} ${d.unit}`, at(u, 0.9));
    const pp = at(u, 3.5, 0.3);
    row(Y(G, 0.66), d.rows[2], d.price, pp, A.accent, pp > 0 ? 1 + 0.5 * (1 - back(pp)) : 1);
  },
  guest(ctx, G, d, u, A) {
    const imgs = (d.images || []).map((x) => A.img(x)).filter(Boolean).slice(0, 3);
    imgs.forEach((im, i) => icon(ctx, G, im, G.left + (110 + i * 270) * G.u, Y(G, 0.12), 210,
      { p: at(u, 0.1 + i * 0.2, 0.35), accent: A.accent, popScale: 0.3 }));
    line(ctx, G, d.l1, Y(G, 0.48), { px: 128, p: at(u, 0.8) });
    line(ctx, G, d.l2, Y(G, 0.59), { px: 138, color: A.accent, p: at(u, 1.4) });
    line(ctx, G, d.sub, Y(G, 0.72), { px: 50, family: 'Inter', weight: '400', color: '#cfc9ee', p: at(u, 2.5) });
  },
  refund(ctx, G, d, u, A) {
    icon(ctx, G, A.img(d.image), G.right - 180 * G.u, Y(G, 0.16), 300, { p: at(u, 0.1), accent: A.accent });
    line(ctx, G, d.l1, Y(G, 0.50), { px: 124, p: at(u, 0.3) });
    const p = at(u, 1.0, 0.3);
    line(ctx, G, d.l2, Y(G, 0.62), { px: 150, color: A.accent, p, lift: 0, scale: p > 0 ? 1 + 0.6 * (1 - back(p)) : 1 });
    line(ctx, G, d.sub, Y(G, 0.74), { px: 48, family: 'Inter', weight: '400', color: '#cfc9ee', p: at(u, 2.0) });
  },
  end(ctx, G, d, u, A) {
    const cx = G.W / 2;
    const p = at(u, 0.2, 0.5);
    if (p > 0) {
      ctx.save(); ctx.globalAlpha *= eo(p);
      const s = 0.5 + 0.5 * back(p);
      ctx.translate(cx, Y(G, 0.36)); ctx.scale(s, s);
      const size = fit(ctx, 'FORGEMARKET', 118 * G.u, G.W - 140 * G.u, 'Raj', '600');
      ctx.font = fontOf(size, 'Raj', '600'); ctx.letterSpacing = `${12 * G.u}px`;
      ctx.textAlign = 'left';
      const w1 = ctx.measureText('FORGE').width, w2 = ctx.measureText('MARKET').width;
      ctx.fillStyle = '#f5f3ff'; ctx.fillText('FORGE', -(w1 + w2) / 2, 0);
      ctx.fillStyle = A.accent; ctx.fillText('MARKET', -(w1 + w2) / 2 + w1, 0);
      ctx.restore();
    }
    const pc = at(u, 1.0);
    if (pc > 0) {
      const pulse = 1 + 0.035 * Math.sin(Math.max(0, u - 1.3) * 6);
      const w = G.W - 260 * G.u, h = 128 * G.u;
      ctx.save(); ctx.globalAlpha *= eo(pc);
      ctx.translate(cx, Y(G, 0.52) + (1 - eo(pc)) * 40 * G.u); ctx.scale(pulse, pulse);
      const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      g.addColorStop(0, '#6366f1'); g.addColorStop(0.55, '#a855f7'); g.addColorStop(1, '#ec4899');
      roundRect(ctx, -w / 2, -h / 2, w, h, 32 * G.u); ctx.fillStyle = g;
      ctx.shadowColor = '#a855f788'; ctx.shadowBlur = 60 * G.u; ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff'; ctx.font = fontOf(58 * G.u, 'Inter', '700'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(d.cta, 0, 4 * G.u);
      ctx.restore();
    }
    line(ctx, G, d.tag.toUpperCase(), Y(G, 0.68), { px: 56, family: 'Raj', weight: '600', p: at(u, 2.0), align: 'center', x: cx, letter: 5 });
  },
};

/* ── Captions ──────────────────────────────────────────────────────────── */
/** Word-by-word caption for the scene's voice line, the current word lit. */
function captions(ctx, G, scene, u, accent) {
  const text = scene.voice;
  if (!text || !scene.voiceDur) return;
  const k = (u - VOICE_AT) / scene.voiceDur;
  if (k < 0 || k > 1.08) return;
  const words = text.split(/\s+/);
  /* Word timing in proportion to length — close enough for a highlight. */
  const weights = words.map((w) => w.length + 2);
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0, current = words.length - 1;
  for (let i = 0; i < words.length; i++) { acc += weights[i] / total; if (k < acc) { current = i; break; } }
  /* A window of up to five words around the current one, like TikTok's own —
     fewer when long words would run off the frame. */
  const px = 50 * G.u;
  ctx.save();
  ctx.font = fontOf(px, 'Inter', '700');
  const space = ctx.measureText(' ').width;
  const maxW = G.W - 160 * G.k;
  let n = 5, start, shown, widths, lineW;
  do {
    start = Math.max(0, Math.min(current - Math.floor((n - 1) / 2), words.length - n));
    shown = words.slice(start, start + n);
    widths = shown.map((w) => ctx.measureText(w).width);
    lineW = widths.reduce((a, b) => a + b, 0) + space * (shown.length - 1);
  } while (lineW > maxW && --n > 1);
  const y = G.bottom - 20 * G.u, padX = 28 * G.u, padY = 18 * G.u;
  const x0 = G.W / 2 - lineW / 2;
  roundRect(ctx, x0 - padX, y - px - padY + 8 * G.u, lineW + padX * 2, px + padY * 2, 22 * G.u);
  ctx.fillStyle = 'rgba(7,6,15,0.72)'; ctx.fill();
  let x = x0;
  shown.forEach((w, i) => {
    ctx.fillStyle = start + i === current ? accent : '#f5f3ff';
    ctx.fillText(w, x, y);
    x += widths[i] + space;
  });
  ctx.restore();
}

/* ── The frame ─────────────────────────────────────────────────────────── */
const money = (lang) => (c) => `€${(c / 100).toFixed(2).replace('.', lang === 'nl' ? ',' : '.')}`;

/** Draw the frame at t seconds. Pure: depends only on (timeline, assets, t, opts). */
export function drawFrame(ctx, timeline, assets, t, { captions: showCaptions = true } = {}) {
  const { W, H } = { W: ctx.canvas.width, H: ctx.canvas.height };
  const G = geometry(W, H, timeline.platform);
  const { scene, u } = sceneAt(timeline, t);
  const accent = scene.accent || '#a855f7';
  const A = {
    accent,
    img: (url) => assets.images?.[url] || null,
    money: money(timeline.lang),
    count: (n) => Number(n).toLocaleString(timeline.lang === 'nl' ? 'nl-NL' : 'en-GB'),
  };

  /* Background: near-black, the scene's accent as a drifting bloom, a faint grid. */
  ctx.save();
  ctx.fillStyle = '#07060f'; ctx.fillRect(0, 0, W, H);
  const bx = W * (0.75 + Math.sin(t * 0.4) * 0.05), by = H * (0.28 + Math.cos(t * 0.3) * 0.03);
  let g = ctx.createRadialGradient(bx, by, 0, bx, by, W * 0.95);
  g.addColorStop(0, `${accent}66`); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(W * 0.1, H * 0.92, 0, W * 0.1, H * 0.92, W);
  g.addColorStop(0, '#a855f733'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.06; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
  const step = 60 * G.k, drift = (t * 12 * G.k) % step;
  ctx.beginPath();
  for (let x = -drift; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = -drift; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  ctx.restore();

  /* Floating sparks, seeded so a frame is always the same frame. */
  ctx.save();
  for (let i = 0; i < 26; i++) {
    const sx = ((i * 397) % 1000) / 1000, sp = 0.02 + ((i * 131) % 100) / 2500;
    const y = H - (((sx * 7 + t * sp * 6) % 1.2) * H);
    ctx.globalAlpha = 0.12 + 0.12 * Math.sin(t * 2 + i);
    ctx.fillStyle = i % 3 ? '#ffffff' : accent;
    ctx.beginPath(); ctx.arc(sx * W, y, (2 + (i % 4)) * G.k, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  /* The scene, sliding in from the right on its cut, with a slow push-in. */
  const enter = scene.start > 0 ? eo(at(u, 0, 0.22)) : 1;
  ctx.save();
  ctx.translate((1 - enter) * 160 * G.k, 0);
  const push = 1 + 0.025 * cl(u / Math.max(1, scene.dur));
  ctx.translate(W / 2, H / 2); ctx.scale(push, push); ctx.translate(-W / 2, -H / 2);
  ctx.globalAlpha = enter;
  (SCENES[scene.type] || SCENES.trust)(ctx, G, scene.data, u, A);
  ctx.restore();

  /* Logo (not on the end card, which is the logo), and the brand disclaimer at the end. */
  if (scene.type !== 'end') {
    ctx.save();
    ctx.font = fontOf(40 * G.k, 'Raj', '600'); ctx.letterSpacing = `${7 * G.k}px`; ctx.textBaseline = 'top';
    ctx.fillStyle = '#f5f3ff'; ctx.fillText('FORGE', 80 * G.k, 70 * G.k);
    ctx.fillStyle = accent; ctx.fillText('MARKET', 80 * G.k + ctx.measureText('FORGE').width, 70 * G.k);
    ctx.restore();
  } else if (timeline.disclaimer) {
    line(ctx, G, timeline.disclaimer, G.bottom - 10 * G.u, { px: 22, family: 'Inter', weight: '400', color: 'rgba(255,255,255,0.45)', p: at(u, 2.4), align: 'center', x: W / 2, maxW: W - 160 * G.k });
  }

  if (showCaptions && scene.type !== 'end') captions(ctx, G, scene, u, accent);

  /* A white flash on every cut, three frames long. */
  const since = scene.start > 0 ? u : t;
  if (since < 0.1) {
    ctx.save(); ctx.globalAlpha = (1 - since / 0.1) * 0.8; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.restore();
  }
}

/* ── Sound ─────────────────────────────────────────────────────────────── */
/* Relative cue times per scene type: what the eye sees, the ear hears. */
const CUES = {
  hook: [['impact', 0.05], ['whoosh', 1.0], ['impact', 2.0]],
  myth: [['drop', 0.1], ...Array.from({ length: 14 }, (_, i) => ['tick', 0.2 + i * 0.075]), ['impact', 1.6]],
  trust: [['drop', 0.3], ['pop', 1.0], ['ding', 3.0]],
  math: [['pop', 0.4], ['pop', 1.4], ...Array.from({ length: 20 }, (_, i) => ['tick', 2.6 + i * 0.12]), ['impact', 5.0]],
  beforeafter: [['pop', 0.1], ...Array.from({ length: 19 }, (_, i) => ['tick', 1.0 + i * 0.12]), ['impact', 3.5]],
  guest: [['pop', 0.1], ['pop', 0.3], ['pop', 0.5], ['whoosh', 0.8]],
  refund: [['pop', 0.3], ['impact', 1.0]],
  end: [['impact', 0.2], ['ding', 1.0]],
};

/** Every sound cue on the timeline, in seconds from the start. */
export function cuesOf(timeline) {
  const out = [];
  for (const s of timeline.scenes) {
    if (s.start > 0) out.push(['whoosh', s.start]);
    if (s.type === 'end') out.push(['riser', Math.max(0, s.start - 0.9)]);
    for (const [kind, rel] of CUES[s.type] || []) if (rel < s.dur) out.push([kind, s.start + rel]);
  }
  return out.sort((a, b) => a[1] - b[1]);
}

let noiseCache = new WeakMap();
function noise(ctx) {
  if (noiseCache.has(ctx)) return noiseCache.get(ctx);
  const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = b.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < d.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[i] = (seed / 0x7fffffff) * 2 - 1; }
  noiseCache.set(ctx, b);
  return b;
}
function env(ctx, node, t, peak, attack, decay) {
  node.gain.setValueAtTime(0.0001, t);
  node.gain.exponentialRampToValueAtTime(peak, t + attack);
  node.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}
function noiseHit(ctx, out, t, { type = 'bandpass', f0 = 1000, f1 = 1000, q = 1, peak = 0.5, attack = 0.005, decay = 0.2 }) {
  const src = ctx.createBufferSource(); src.buffer = noise(ctx);
  const filt = ctx.createBiquadFilter(); filt.type = type; filt.Q.value = q;
  filt.frequency.setValueAtTime(f0, t); filt.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
  const g = ctx.createGain(); env(ctx, g, t, peak, attack, decay);
  src.connect(filt).connect(g).connect(out);
  src.start(t, Math.random() * 0.5); src.stop(t + attack + decay + 0.05);
}
function tone(ctx, out, t, { f0, f1 = f0, type = 'sine', peak = 0.4, attack = 0.005, decay = 0.3 }) {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
  const g = ctx.createGain(); env(ctx, g, t, peak, attack, decay);
  o.connect(g).connect(out); o.start(t); o.stop(t + attack + decay + 0.05);
}
const SFX = {
  impact(ctx, out, t) { tone(ctx, out, t, { f0: 120, f1: 38, peak: 0.9, decay: 0.55 }); noiseHit(ctx, out, t, { type: 'lowpass', f0: 2500, f1: 200, peak: 0.45, decay: 0.35 }); },
  whoosh(ctx, out, t) { noiseHit(ctx, out, t, { f0: 400, f1: 4000, q: 0.8, peak: 0.35, attack: 0.12, decay: 0.25 }); },
  drop(ctx, out, t) { noiseHit(ctx, out, t, { f0: 3000, f1: 300, q: 0.9, peak: 0.3, attack: 0.08, decay: 0.3 }); tone(ctx, out, t + 0.3, { f0: 90, f1: 45, peak: 0.6, decay: 0.3 }); },
  tick(ctx, out, t) { tone(ctx, out, t, { f0: 2400, type: 'square', peak: 0.06, attack: 0.002, decay: 0.03 }); },
  pop(ctx, out, t) { tone(ctx, out, t, { f0: 500, f1: 1100, peak: 0.25, decay: 0.12 }); },
  ding(ctx, out, t) { tone(ctx, out, t, { f0: 1320, peak: 0.25, decay: 0.7 }); tone(ctx, out, t + 0.06, { f0: 1760, peak: 0.18, decay: 0.8 }); },
  riser(ctx, out, t) { noiseHit(ctx, out, t, { type: 'highpass', f0: 300, f1: 6000, peak: 0.3, attack: 0.8, decay: 0.08 }); tone(ctx, out, t, { f0: 200, f1: 900, type: 'sawtooth', peak: 0.05, attack: 0.8, decay: 0.08 }); },
};

/**
 * The whole soundtrack, scheduled on an AudioContext (or OfflineAudioContext)
 * from t0: a 120 BPM beat that drops at the first cut, every cue, and the voice
 * lines — the music ducks under each one.
 */
export function scheduleAudio(ctx, destination, timeline, voices = {}, t0 = 0, { music = true } = {}) {
  const master = ctx.createDynamicsCompressor();
  master.threshold.value = -14; master.ratio.value = 4;
  master.connect(destination);
  const sfx = ctx.createGain(); sfx.gain.value = 0.8; sfx.connect(master);
  const T = timeline.total;

  if (music) {
    const bus = ctx.createGain(); bus.gain.value = 0.42; bus.connect(master);
    /* Duck: down under every voice line, back up after. */
    for (const s of timeline.scenes) {
      if (!voices[s.id]) continue;
      const a = t0 + s.start + VOICE_AT, b = a + s.voiceDur;
      bus.gain.setTargetAtTime(0.16, a - 0.05, 0.05);
      bus.gain.setTargetAtTime(0.42, b, 0.2);
    }
    const dropAt = timeline.scenes[1]?.start ?? 3;
    for (let b = dropAt; b < T - 0.5; b += 0.5) {
      tone(ctx, bus, t0 + b, { f0: 150, f1: 45, peak: 0.9, attack: 0.004, decay: 0.28 });                       // kick
      noiseHit(ctx, bus, t0 + b + 0.25, { type: 'highpass', f0: 7000, f1: 9000, peak: 0.12, attack: 0.002, decay: 0.05 }); // hat
      const bass = Math.floor(b / 2) % 2 ? 49 : 55;
      tone(ctx, bus, t0 + b, { f0: bass, peak: 0.28, attack: 0.01, decay: 0.42 });                              // bass
    }
  }
  for (const [kind, at] of cuesOf(timeline)) SFX[kind]?.(ctx, sfx, t0 + at);
  for (const s of timeline.scenes) {
    const buf = voices[s.id];
    if (!buf) continue;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = 1.15;
    src.connect(g).connect(master);
    src.start(t0 + s.start + VOICE_AT);
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
/** The best container this browser can record: MP4 where it can, WebM otherwise. */
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
export function play(canvas, timeline, assets, voices, { record = false, monitor = true, music = true, captions: showCaptions = true, onTime } = {}) {
  const ctx2d = canvas.getContext('2d');
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  const dest = ac.createMediaStreamDestination();
  const out = ac.createGain();
  out.connect(dest);
  if (monitor) out.connect(ac.destination);
  const t0 = ac.currentTime + 0.25;
  scheduleAudio(ac, out, timeline, voices, t0, { music });
  let recorder = null, chunks = [];
  const type = recorderType();
  if (record) {
    const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 12_000_000, audioBitsPerSecond: 192_000 });
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.start(250);
  }
  let raf = 0, stopped = false;
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const finish = () => {
    if (stopped) return; stopped = true;
    cancelAnimationFrame(raf);
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
