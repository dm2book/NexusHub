#!/usr/bin/env node
/**
 * The ink bounding box of every brand mark, written to
 * public/products/icons/_ink.json for render.mjs to fit against.
 *
 *   node scripts/art/measure-marks.mjs
 *
 * ── WHY A MEASUREMENT AND NOT A NUMBER ────────────────────────────────────
 * preserveAspectRatio fits a mark's CANVAS into the stage, and the canvases
 * disagree: the SVG marks are drawn on a 512 square with generous padding, the
 * WebP marks are cropped tight to the artwork. Measured across all 74 marks at
 * the 176px stage the card gives them, the SVGs painted 52-62% of it and the
 * rasters 88.1% — so a quarter of the catalogue showed a logo half again as
 * large as the rest, in the same grid, for no reason connected to the products.
 * Exactly the unevenness the artboard system exists to remove, one level down.
 *
 * There is no number that fixes that, only a measurement: where the ink
 * actually is inside each file. So each mark is rasterised and its alpha channel
 * scanned, and the box is mapped back into the mark's own coordinate space —
 * a viewBox for a vector, pixels for a raster. render.mjs then fits ink to
 * stage and every mark means the same thing.
 *
 * Re-run this after adding or replacing anything in public/products/icons/.
 * product-artboards.test.mjs fails if a mark on disk has no entry, because a
 * missing entry silently falls back to canvas fitting — the bug returning
 * quietly, which is the only way it comes back.
 *
 * Needs a Chromium: pass CHROMIUM_PATH, or let it look in the usual places.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ICONS = path.join(ROOT, 'public', 'products', 'icons');

const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
].filter(Boolean);
const chromePath = CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!chromePath) {
  console.error('No Chromium found. Set CHROMIUM_PATH to one.');
  process.exit(1);
}

const pw = await import('playwright-core').catch(() => null);
if (!pw) { console.error('playwright-core is not installed: npm i -D --no-save playwright-core'); process.exit(1); }

const browser = await pw.default.chromium.launch({ executablePath: chromePath });
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });

const files = fs.readdirSync(ICONS).filter((f) => /\.(svg|webp|png)$/.test(f)).sort();
const out = {};
for (const f of files) {
  const buf = fs.readFileSync(path.join(ICONS, f));
  const isSvg = f.endsWith('.svg');
  const mime = isSvg ? 'image/svg+xml' : f.endsWith('.webp') ? 'image/webp' : 'image/png';
  const url = `data:${mime};base64,${buf.toString('base64')}`;

  const ink = await page.evaluate(async (u) => {
    const img = new Image(); img.src = u;
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('load')); });
    // 512 is enough to place an edge to within a fifth of a percent of the box.
    const N = 512, c = document.createElement('canvas'); c.width = N; c.height = N;
    const g = c.getContext('2d');
    const s = Math.min(N / img.width, N / img.height), w = img.width * s, h = img.height * s;
    const ox = (N - w) / 2, oy = (N - h) / 2;
    g.drawImage(img, ox, oy, w, h);
    const d = g.getImageData(0, 0, N, N).data;
    let minX = N, minY = N, maxX = -1, maxY = -1;
    // alpha > 16: a soft shadow's outermost pixels are not ink.
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (d[(y * N + x) * 4 + 3] > 16) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return null;
    return { x: (minX - ox) / s, y: (minY - oy) / s, w: (maxX - minX + 1) / s, h: (maxY - minY + 1) / s,
      natW: img.width, natH: img.height };
  }, url).catch(() => null);

  if (!ink) { console.log(`  skipped (no ink or would not load): ${f}`); continue; }

  let box = [0, 0, ink.natW, ink.natH];
  if (isSvg) {
    const m = /viewBox="([\d.\-\s]+)"/.exec(fs.readFileSync(path.join(ICONS, f), 'utf8'));
    const q = m ? m[1].trim().split(/\s+/).map(Number) : null;
    if (q && q.length === 4) box = q;
    // The rasteriser laid the viewBox out over natW x natH; map the ink back.
    const sx = box[2] / ink.natW, sy = box[3] / ink.natH;
    ink.x = box[0] + ink.x * sx; ink.y = box[1] + ink.y * sy; ink.w *= sx; ink.h *= sy;
  }
  out[f] = {
    x: +ink.x.toFixed(2), y: +ink.y.toFixed(2), w: +ink.w.toFixed(2), h: +ink.h.toFixed(2),
    box, spanPct: +(Math.max(ink.w, ink.h) / Math.max(box[2], box[3]) * 100).toFixed(1),
  };
}
await browser.close();

fs.writeFileSync(path.join(ICONS, '_ink.json'), `${JSON.stringify(out, null, 1)}\n`);
const spans = Object.values(out).map((v) => v.spanPct).sort((a, b) => a - b);
console.log(`Wrote _ink.json for ${Object.keys(out).length} marks`);
console.log(`  canvas fill before fitting: ${spans[0]}% to ${spans[spans.length - 1]}%`);
