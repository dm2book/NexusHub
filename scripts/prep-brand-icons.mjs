/**
 * One-off: turn the brand artwork the owner uploaded into tidy square icons.
 *
 * Each source needs different treatment — some are logos on a flat background
 * that should be knocked out, some are solid-colour tiles where the background
 * IS the design, and one is a wide promo banner that has to be cropped down to
 * the product shot. The recipe per file lives in SPEC below.
 *
 *   node scripts/prep-brand-icons.mjs
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const DIR = '/home/user/NexusHub/public/products/icons';
const SIZE = 256;          // output canvas (displayed at ≤ 92px, so 2-3x for retina)
const PAD = 0.06;          // breathing room around the artwork

// bg: 'remove' knocks out a flat background; 'keep' leaves it (the colour is
// part of the mark). round: rounds the corners of a solid tile.
const SPEC = [
  { file: 'robux.jpg',            slug: 'robux',         bg: 'remove' },
  { file: 'vbucks.jpg',           slug: 'v-bucks',       bg: 'remove' },
  { file: 'valorant points.jpg',  slug: 'valorant',      bg: 'remove' },
  { file: 'discord nitro.png',    slug: 'discord-nitro', bg: 'remove' },
  { file: 'steam jpg.jpg',        slug: 'steam',         bg: 'remove' },
  { file: 'giftcard jpg.jpg',     slug: 'giftcard',      bg: 'remove' },
  { file: 'playstation jpg.jpg',  slug: 'playstation',   bg: 'keep', round: true },
  { file: 'xbox.png',             slug: 'xbox',          bg: 'keep', round: true },
  { file: 'call of duty jpg.jpg', slug: 'cod',           bg: 'keep', round: true },
  // Promo banner: crop to the token pile, which also drops the headline text
  // and the other shop's watermark along the bottom.
  { file: 'fifa points.jpg',      slug: 'eafc',          bg: 'keep', round: true,
    crop: { x: 0.19, y: 0.45, w: 0.62, h: 0.47 } },
];

const mime = (f) => (/\.png$/i.test(f) ? 'image/png' : 'image/jpeg');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('about:blank');

for (const spec of SPEC) {
  const src = join(DIR, spec.file);
  if (!existsSync(src)) { console.log(`  ⚠ missing ${spec.file}`); continue; }
  const dataUrl = `data:${mime(spec.file)};base64,${readFileSync(src).toString('base64')}`;

  const out = await page.evaluate(async ({ dataUrl, spec, SIZE, PAD }) => {
    const img = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl;
    });

    // 1. optional crop of the source
    const cw = spec.crop ? Math.round(img.width * spec.crop.w) : img.width;
    const ch = spec.crop ? Math.round(img.height * spec.crop.h) : img.height;
    const cx = spec.crop ? Math.round(img.width * spec.crop.x) : 0;
    const cy = spec.crop ? Math.round(img.height * spec.crop.y) : 0;
    let c = document.createElement('canvas'); c.width = cw; c.height = ch;
    let x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);

    // 2. knock out a flat background by flood-filling from the edges
    if (spec.bg === 'remove') {
      const image = x.getImageData(0, 0, cw, ch), px = image.data;
      const at = (X, Y) => { const i = (Y * cw + X) * 4; return [px[i], px[i + 1], px[i + 2]]; };
      const corners = [at(0, 0), at(cw - 1, 0), at(0, ch - 1), at(cw - 1, ch - 1)];
      const bg = [0, 1, 2].map((k) => Math.round(corners.reduce((s, v) => s + v[k], 0) / 4));
      const thr = 34 * 3;
      const close = (i) => (Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2])) <= thr;
      const seen = new Uint8Array(cw * ch), stack = [];
      const push = (X, Y) => { if (X >= 0 && X < cw && Y >= 0 && Y < ch) { const p = Y * cw + X; if (!seen[p]) { seen[p] = 1; stack.push(p); } } };
      for (let X = 0; X < cw; X++) { push(X, 0); push(X, ch - 1); }
      for (let Y = 0; Y < ch; Y++) { push(0, Y); push(cw - 1, Y); }
      while (stack.length) {
        const p = stack.pop(), i = p * 4;
        if (!close(i)) continue;
        px[i + 3] = 0;
        const X = p % cw, Y = (p / cw) | 0;
        push(X - 1, Y); push(X + 1, Y); push(X, Y - 1); push(X, Y + 1);
      }
      // feather the leftover fringe so there's no white halo
      for (let p = 0; p < cw * ch; p++) {
        const i = p * 4; if (px[i + 3] === 0) continue;
        const d = Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]);
        if (d < thr * 1.5) px[i + 3] = Math.round(255 * (d / (thr * 1.5)));
      }
      x.putImageData(image, 0, 0);
    }

    // 3. trim to the visible content
    const data = x.getImageData(0, 0, cw, ch).data;
    let minX = cw, minY = ch, maxX = -1, maxY = -1;
    for (let Y = 0; Y < ch; Y++) for (let X = 0; X < cw; X++) {
      if (data[(Y * cw + X) * 4 + 3] > 12) {
        if (X < minX) minX = X; if (X > maxX) maxX = X;
        if (Y < minY) minY = Y; if (Y > maxY) maxY = Y;
      }
    }
    if (maxX < 0) { minX = 0; minY = 0; maxX = cw - 1; maxY = ch - 1; }
    const tw = maxX - minX + 1, th = maxY - minY + 1;

    // 4. centre it on a square canvas, scaled to fit with padding
    const outC = document.createElement('canvas'); outC.width = SIZE; outC.height = SIZE;
    const o = outC.getContext('2d');
    o.imageSmoothingQuality = 'high';
    const avail = SIZE * (1 - PAD * 2);
    const scale = Math.min(avail / tw, avail / th);
    const dw = Math.round(tw * scale), dh = Math.round(th * scale);
    const dx = Math.round((SIZE - dw) / 2), dy = Math.round((SIZE - dh) / 2);

    if (spec.round) {
      // solid tile → clip to a rounded square so it sits like an app icon
      const r = Math.round(Math.min(dw, dh) * 0.22);
      o.save(); o.beginPath();
      o.moveTo(dx + r, dy); o.arcTo(dx + dw, dy, dx + dw, dy + dh, r);
      o.arcTo(dx + dw, dy + dh, dx, dy + dh, r); o.arcTo(dx, dy + dh, dx, dy, r);
      o.arcTo(dx, dy, dx + dw, dy, r); o.closePath(); o.clip();
    }
    o.drawImage(c, minX, minY, tw, th, dx, dy, dw, dh);
    if (spec.round) o.restore();

    return { png: outC.toDataURL('image/png'), tw, th, cw, ch };
  }, { dataUrl, spec, SIZE, PAD });

  const buf = Buffer.from(out.png.split(',')[1], 'base64');
  const dest = join(DIR, `${spec.slug}.png`);
  writeFileSync(dest, buf);
  // the generated 3D icon for this slug is now superseded
  const svg = join(DIR, `${spec.slug}.svg`);
  if (existsSync(svg)) unlinkSync(svg);
  // drop the original upload (odd filename, unoptimised) — unless it IS the
  // destination, which would delete the file we just wrote.
  if (src !== dest) unlinkSync(src);
  console.log(`  ✓ ${spec.slug}.png  ${Math.round(buf.length / 1024)}KB  (content ${out.tw}×${out.th} of ${out.cw}×${out.ch})`);
}

await browser.close();
console.log('done');
