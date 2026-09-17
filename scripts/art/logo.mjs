/**
 * The logo, in the shapes other tools ask for.
 *
 * The app icon in public/brand is a square tile with a gradient background —
 * right for a Discord avatar or a home screen, wrong for an ad tool, which
 * wants a transparent logo it can place on its own backgrounds. Pasting a
 * square purple tile onto a purple ad gives a purple box on a purple box.
 *
 * So: a wordmark and a bare mark, each on transparency, in a light and a dark
 * version, drawn from the same bolt path and the same typeface the storefront
 * uses. Generated rather than exported by hand for the reason the banners are:
 * a logo file nobody can redraw is a logo file that goes stale.
 *
 *   node scripts/art/logo.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'public', 'brand');
const BROWSER = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const face = (file, weight) => {
  const p = path.join(ROOT, 'public', 'fonts', file);
  if (!fs.existsSync(p)) return '';
  return `@font-face{font-family:'Bricolage Grotesque';font-weight:${weight};font-display:block;
    src:url(data:font/woff2;base64,${fs.readFileSync(p).toString('base64')}) format('woff2')}`;
};

/* The same path as public/favicon.svg, at the same proportions. */
const BOLT = 'M13 6 L9 18 h5 l-2 8 L23 12 h-6 l2-6 z';
const GRAD = ['#7661f2', '#a855f7', '#d94bb2'];

const markSvg = (size, fill) => `
  <svg width="${size}" height="${size}" viewBox="0 0 32 32">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      ${GRAD.map((c, i) => `<stop offset="${i / (GRAD.length - 1)}" stop-color="${c}"/>`).join('')}
    </linearGradient></defs>
    <path d="${BOLT}" fill="${fill === 'gradient' ? 'url(#bg)' : fill}"/>
  </svg>`;

const tileSvg = (size) => `
  <svg width="${size}" height="${size}" viewBox="0 0 32 32">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      ${GRAD.map((c, i) => `<stop offset="${i / (GRAD.length - 1)}" stop-color="${c}"/>`).join('')}
    </linearGradient></defs>
    <rect width="32" height="32" rx="8" fill="url(#bg)"/>
    <path d="${BOLT}" fill="#fff"/>
  </svg>`;

const page = (inner, w, h, pad = 0) => `<!doctype html><html><head><meta charset="utf-8"><style>
${face('bricolage-800.woff2', 800)}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${w}px;height:${h}px;background:transparent;--pad:${pad}px}
/* max-content, then screenshotted as an element: a logo cropped to its own
   ink, with one even margin all round. Sized to the canvas instead, the
   wordmark came out almost touching the right edge while carrying 20% empty
   space above and below — which reads as a misaligned logo in any tool that
   centres what you give it. */
.row{width:max-content;height:${h}px;display:flex;align-items:center;gap:${Math.round(h * 0.22)}px;
     padding:0 var(--pad)}
.name{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:${Math.round(h * 0.58)}px;
  letter-spacing:.005em;line-height:1;white-space:nowrap}
</style></head><body>${inner}</body></html>`;

const JOBS = [
  { file: 'forgemarket-wordmark-white.png', w: 1600, h: 360,
    pad: 44,
    inner: (h) => `<div class="row">${tileSvg(Math.round(h * 0.86))}<span class="name" style="color:#ffffff">Forge<span style="color:#c9c2ea">Market</span></span></div>` },
  { file: 'forgemarket-wordmark-dark.png', w: 1600, h: 360,
    pad: 44,
    inner: (h) => `<div class="row">${tileSvg(Math.round(h * 0.86))}<span class="name" style="color:#12101f">Forge<span style="color:#6b6486">Market</span></span></div>` },
  { file: 'forgemarket-mark-gradient.png', w: 1024, h: 1024,
    inner: () => `<div class="row">${markSvg(1024, 'gradient')}</div>` },
  { file: 'forgemarket-mark-white.png', w: 1024, h: 1024,
    inner: () => `<div class="row">${markSvg(1024, '#ffffff')}</div>` },
  { file: 'forgemarket-tile-1024.png', w: 1024, h: 1024,
    inner: () => `<div class="row">${tileSvg(1024)}</div>` },
];

const browser = await chromium.launch({ executablePath: BROWSER });
fs.mkdirSync(OUT, { recursive: true });
for (const job of JOBS) {
  const p = await browser.newPage({ viewport: { width: job.w, height: job.h }, deviceScaleFactor: 1 });
  await p.setContent(page(job.inner(job.h), job.w, job.h, job.pad || 0), { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  // omitBackground is the whole point: an ad tool composites this onto its own
  // artwork, and a white box behind a logo is the most common way that looks wrong.
  const buf = await p.locator('.row').screenshot({ type: 'png', omitBackground: true });
  fs.writeFileSync(path.join(OUT, job.file), buf);
  const box = await p.locator('.row').boundingBox();
  console.log(`${job.file.padEnd(34)} ${Math.round(box.width)}x${Math.round(box.height)}  ${Math.round(buf.length / 1024)}KB`);
  await p.close();
}
await browser.close();
