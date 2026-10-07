/**
 * Static ads, drawn on a canvas: the product's card in its brand's colours,
 * the price, one honest line, the address — square, feed and story.
 *
 * What may be said comes from the server (adStaticsService.js, claim-gated);
 * this file only decides where it goes. One column layout for every format:
 * fixed blocks (headline, name, price, button) keep their size and the card
 * takes whatever height is left, so a square ad shrinks the card instead of
 * the price.
 */

export const STATIC_FONTS = [
  ['Bric', '/fonts/bricolage-800.woff2', '800'],
  ['Inter', '/fonts/inter-600.woff2', '600'],
  ['Inter', '/fonts/inter-700.woff2', '700'],
  ['Raj', '/fonts/rajdhani-600.woff2', '600'],
];

export async function loadStaticFonts() {
  await Promise.all(STATIC_FONTS.map(async ([family, url, weight]) => {
    const f = new FontFace(family, `url(${url})`, { weight });
    await f.load().then((ff) => document.fonts.add(ff)).catch(() => {});
  }));
}

export const loadImage = (src) => new Promise((resolve) => {
  if (!src) return resolve(null);
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = src;
});

const font = (px, family = 'Bric', weight = '800') => `${weight} ${Math.round(px)}px ${family}`;

function fit(ctx, text, px, maxW, family = 'Bric', weight = '800') {
  let size = px;
  for (let i = 0; i < 40; i++) {
    ctx.font = font(size, family, weight);
    if (ctx.measureText(text).width <= maxW) break;
    size *= 0.95;
  }
  return size;
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

/** Black or white, whichever reads on this colour (WCAG relative luminance). */
export function readableOn(hex) {
  const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return L > 0.36 ? '#0b0a12' : '#ffffff';
}

function background(ctx, W, H, theme) {
  const base = ctx.createLinearGradient(0, 0, W * 0.4, H);
  base.addColorStop(0, theme.bg); base.addColorStop(0.6, theme.deep); base.addColorStop(1, '#05040a');
  ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
  for (const [x, y, r, a] of [[0.8, 0.22, 0.95, '70'], [0.1, 0.9, 0.9, '30'], [0.35, 0.5, 0.6, '22']]) {
    const g = ctx.createRadialGradient(x * W, y * H, 0, x * W, y * H, r * Math.max(W, H));
    g.addColorStop(0, `${theme.accent}${a}`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  /* A diagonal sheen: the "lit card" look, still. */
  const s = ctx.createLinearGradient(0, H * 0.1, W, H * 0.6);
  s.addColorStop(0, 'rgba(255,255,255,0)'); s.addColorStop(0.5, 'rgba(255,255,255,0.05)'); s.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = s; ctx.fillRect(0, 0, W, H);
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.4, W / 2, H / 2, Math.max(W, H) * 0.8);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
}

function wordmark(ctx, x, y, px, accent) {
  ctx.save();
  ctx.font = font(px, 'Raj', '600'); ctx.letterSpacing = `${px * 0.22}px`; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff'; ctx.fillText('FORGE', x, y);
  const w = ctx.measureText('FORGE').width;
  ctx.fillStyle = accent; ctx.fillText('MARKET', x + w, y);
  ctx.restore();
}

function card(ctx, img, cx, cy, maxW, maxH, accent) {
  if (!img) return 0;
  const ratio = (img.naturalHeight || 600) / (img.naturalWidth || 700);
  let w = maxW, h = w * ratio;
  if (h > maxH) { h = maxH; w = h / ratio; }
  ctx.save();
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.85);
  glow.addColorStop(0, `${accent}55`); glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow; ctx.fillRect(cx - w, cy - w, w * 2, w * 2);
  ctx.translate(cx, cy); ctx.rotate(-0.025);
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = w * 0.08; ctx.shadowOffsetY = w * 0.04;
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
  return h;
}

function priceSlab(ctx, text, cx, cy, px, maxW, accent) {
  const size = fit(ctx, text, px, maxW * 0.86);
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(-0.03);
  ctx.font = font(size);
  const w = ctx.measureText(text).width + size * 0.55, h = size * 1.14;
  roundRect(ctx, -w / 2, -h / 2, w, h, size * 0.16);
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = size * 0.25; ctx.shadowOffsetY = size * 0.08;
  ctx.fillStyle = accent; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = readableOn(accent); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, size * 0.05);
  ctx.restore();
}

function pill(ctx, text, cx, cy, { px, accent, filled = true, maxW }) {
  ctx.save();
  const size = fit(ctx, text, px, maxW - px * 2, 'Inter', '700');
  ctx.font = font(size, 'Inter', '700');
  const w = Math.min(maxW, ctx.measureText(text).width + size * 2.2), h = size * 2.1;
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
  if (filled) {
    ctx.shadowColor = `${accent}88`; ctx.shadowBlur = size * 0.9;
    ctx.fillStyle = accent; ctx.fill(); ctx.shadowColor = 'transparent';
    ctx.fillStyle = readableOn(accent);
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.fill();
    ctx.strokeStyle = accent; ctx.lineWidth = Math.max(2, size * 0.07); ctx.stroke();
    ctx.fillStyle = '#ffffff';
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + size * 0.05);
  ctx.restore();
  return h;
}

function line(ctx, text, cx, y, { px, maxW, color = '#ffffff', family = 'Bric', weight = '800', shadow = true }) {
  const size = fit(ctx, text, px, maxW, family, weight);
  ctx.save();
  ctx.font = font(size, family, weight); ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  if (shadow) { ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = size * 0.2; ctx.shadowOffsetY = size * 0.05; }
  ctx.fillText(text, cx, y);
  ctx.restore();
  return size;
}

function stamp(ctx, text, cx, cy, px) {
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(-0.12);
  ctx.font = font(px);
  const w = ctx.measureText(text).width + px * 0.6, h = px * 1.15;
  roundRect(ctx, -w / 2, -h / 2, w, h, px * 0.14);
  ctx.fillStyle = 'rgba(244,63,94,0.16)'; ctx.fill();
  ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = px * 0.08; ctx.stroke();
  ctx.fillStyle = '#f43f5e'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, px * 0.06);
  ctx.restore();
}

/**
 * Draw one static ad.
 * fmt: { w, h, safeTop, safeBottom }; ad: the server's answer; tpl: one of
 * ad.templates; images: { [url]: HTMLImageElement }.
 * Returns the boxes it drew (for checks: nothing outside the safe area).
 */
export function drawStatic(ctx, fmt, ad, tpl, images) {
  const W = fmt.w, H = fmt.h, k = W / 1080;
  const theme = ad.theme, accent = theme.accent;
  const left = 72 * k, maxW = W - left * 2, cx = W / 2;
  const top = H * fmt.safeTop, bottom = H * (1 - fmt.safeBottom);
  const boxes = [];
  const box = (name, y0, y1) => boxes.push({ name, y0, y1 });
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  background(ctx, W, H, theme);

  // Brand, top-left; the platform the code works on, top-right.
  wordmark(ctx, left, top + 34 * k, 34 * k, accent);
  box('brand', top, top + 40 * k);
  const img = images[ad.product.image];
  const p = ad.product;
  const tall = H / W;                         // 1, 1.25, 1.78
  /* A story has a third more usable height than a square at the same width:
     everything fixed is drawn bigger there, not left floating small. */
  const z = tall > 1.5 ? 1.22 : 1;
  const gap = 26 * k * Math.min(1.4, tall);

  // Fixed blocks, bottom up: disclaimer, button, price, name.
  let y = bottom;
  if (ad.disclaimer) {
    const ds = fit(ctx, ad.disclaimer, 19 * k, maxW, 'Inter', '600');
    ctx.save(); ctx.font = font(ds, 'Inter', '600'); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.textAlign = 'center';
    ctx.fillText(ad.disclaimer, cx, y - 6 * k); ctx.restore();
    box('disclaimer', y - 26 * k, y);
    y -= 26 * k + gap * 0.6;
  }
  const btnPx = 46 * k * z;
  const btnH = btnPx * 2.1;
  pill(ctx, ad.cta, cx, y - btnH / 2, { px: btnPx, accent, maxW: maxW * 0.86 });
  box('cta', y - btnH, y);
  y -= btnH + gap;

  const header = top + 40 * k + gap * 1.2;    // first line below the brand

  if (tpl.id === 'ladder' && ad.ladder) {
    // Title, then one row per amount; this product's row lit.
    const ts = line(ctx, tpl.title, cx, header + 92 * k * z, { px: 96 * k * z, maxW });
    box('title', header, header + 92 * k * z);
    const rowsTop = header + 92 * k * z + gap * 1.4;
    const n = ad.ladder.length;
    const rowH = Math.min(230 * k * z, (y - rowsTop - gap * (n - 1)) / n);
    ad.ladder.forEach((r, i) => {
      const ry = rowsTop + i * (rowH + gap);
      ctx.save();
      roundRect(ctx, left, ry, maxW, rowH, rowH * 0.18);
      ctx.fillStyle = r.self ? `${accent}26` : 'rgba(0,0,0,0.32)'; ctx.fill();
      ctx.strokeStyle = r.self ? accent : 'rgba(255,255,255,0.14)'; ctx.lineWidth = (r.self ? 5 : 2) * k; ctx.stroke();
      ctx.restore();
      const im = images[r.image];
      if (im) {
        const ih = rowH * 0.78, iw = ih * ((im.naturalWidth || 700) / (im.naturalHeight || 600));
        ctx.drawImage(im, left + rowH * 0.12, ry + (rowH - ih) / 2, iw, ih);
      }
      const tx = left + rowH * 0.12 + rowH * 0.78 * (7 / 6) + 30 * k;
      ctx.save();
      /* The price first, the name in what is left — "4.500 Robux€38,99" otherwise. */
      const ps = fit(ctx, r.price, rowH * 0.3, maxW * 0.3);
      ctx.font = font(ps); const pw = ctx.measureText(r.price).width;
      const ns = fit(ctx, r.name, rowH * 0.24, left + maxW - 32 * k - pw - 28 * k - tx, 'Bric', '800');
      ctx.font = font(ns); ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillText(r.name, tx, ry + rowH / 2);
      ctx.font = font(ps); ctx.fillStyle = r.self ? accent : '#ffffff'; ctx.textAlign = 'right';
      ctx.fillText(r.price, left + maxW - 32 * k, ry + rowH / 2);
      ctx.restore();
      box(`row${i}`, ry, ry + rowH);
    });
    void ts;
    ctx.restore();
    return boxes;
  }

  // Price, then the name above it.
  const pricePx = (tpl.id === 'price' ? 150 : 128) * k * z;
  priceSlab(ctx, p.price, cx, y - pricePx * 0.6, pricePx, maxW, accent);
  box('price', y - pricePx * 1.2, y);
  y -= pricePx * 1.2 + gap * 0.9;
  if (p.platform) {
    const ph = pill(ctx, p.platform, cx, y - 30 * k * z, { px: 30 * k * z, accent, filled: false, maxW: maxW * 0.7 });
    box('platform', y - ph, y);
    y -= ph + gap * 0.6;
  }
  /* The drawn card already carries the amount ("1,000 ROBUX"), so the name
     line is only spent where it adds something: on the price ad, and on the
     owner's own artwork, which may show another amount of the same game. */
  if (tpl.id === 'price' || p.ownArt) {
    const nameSize = line(ctx, p.name, cx, y - 6 * k, { px: 72 * k * z, maxW });
    box('name', y - nameSize, y);
    y -= nameSize + gap;
  }

  // The headline, from the top.
  let hy = header;
  if (tpl.id === 'myth') {
    const base1 = hy + 100 * k * z;
    line(ctx, tpl.title, cx, base1, { px: 104 * k * z, maxW });
    /* Placed by its own height below the title's baseline, so a long title
       that fit() made smaller never ends up under the stamp. */
    const sp = 110 * k * z, half = sp * 0.62;
    const stampY = base1 + half + 26 * k;
    stamp(ctx, tpl.stamp, cx, stampY, sp);
    const subY = stampY + half + 58 * k * z;
    line(ctx, tpl.sub, cx, subY, { px: 44 * k * z, maxW, family: 'Inter', weight: '600', color: '#e7e3f8' });
    box('headline', hy, subY + 10 * k);
    hy = subY + 10 * k;
  } else if (tpl.l1) {
    const s1 = line(ctx, tpl.l1, cx, hy + 92 * k * z, { px: 92 * k * z, maxW });
    const s2 = line(ctx, tpl.l2, cx, hy + 92 * k * z + s1 * 1.1, { px: 92 * k * z, maxW, color: accent });
    box('headline', hy, hy + 92 * k * z + s1 * 1.1 + s2 * 0.2);
    hy = hy + 92 * k * z + s1 * 1.1 + s2 * 0.2;
  }

  // The card takes what is left between the headline and the name.
  const slotTop = hy + gap, slotBottom = y;
  const ch = card(ctx, img, cx, (slotTop + slotBottom) / 2, maxW * 0.96, Math.max(0, slotBottom - slotTop), accent);
  box('card', (slotTop + slotBottom) / 2 - ch / 2, (slotTop + slotBottom) / 2 + ch / 2);
  ctx.restore();
  return boxes;
}

/** File name the owner gets: forgemarket-<product>-<template>-<format>-<lang>.png */
export const staticFileName = (ad, tplId, fmtId) =>
  `forgemarket-${String(ad.product.name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${tplId}-${fmtId}-${ad.lang}.png`;
