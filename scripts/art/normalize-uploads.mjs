#!/usr/bin/env node
/**
 * Put every uploaded product photo on the same artboard.
 *
 *   DATABASE_URL=…  node scripts/art/normalize-uploads.mjs --dry
 *   DATABASE_URL=…  node scripts/art/normalize-uploads.mjs
 *   DATABASE_URL=…  node scripts/art/normalize-uploads.mjs --revert
 *
 * ── WHAT THIS IS FOR ──────────────────────────────────────────────────────
 * Measured on the live shop: 45 products carry an uploaded photo, in FOURTEEN
 * different aspect ratios — from 0.66 (a tall gift card) to 1.78 (widescreen).
 * The card's media box is 7:6 = 1.167 and the art is contained inside it, so
 * the same grid shows some photos filling 86% of their tile and others 59%,
 * with white bands wherever the ratio does not match. Nothing is broken; it
 * simply looks like nobody chose.
 *
 * This does the choosing. Each photo is placed, untouched and uncropped, on a
 * 7:6 ForgeMarket artboard — the same dark ground the generated art uses — so
 * every card fills its tile identically and the shop reads as one shop. The
 * photo keeps its own proportions; the artboard supplies the rest.
 *
 * ── WHAT IT CANNOT DO ─────────────────────────────────────────────────────
 * Twenty-nine of the uploads are narrower than 400px, some as small as
 * 139x170, and a card slot is 352 device pixels wide on a 2x desktop. Scaling
 * a 139px picture up does not create detail — it only makes the softness
 * bigger. Those are listed at the end as worth re-uploading; the artboard
 * makes them look deliberate, not sharp.
 *
 * ── REVERSIBLE ────────────────────────────────────────────────────────────
 * The original is kept in product_images and its id is written to
 * metadata.imageOriginal, so --revert puts every product back exactly.
 */
import path from 'node:path';
import fs from 'node:fs';

const ROOT = process.cwd();
const dry = process.argv.includes('--dry');
const revert = process.argv.includes('--revert');

const { all, get, run, nowIso } = await import(path.join(ROOT, 'server/src/db/index.js'));
const store = await import(path.join(ROOT, 'server/src/services/imageStoreService.js'));
const { BRAND, accentFor } = await import(path.join(ROOT, 'scripts/art/design.mjs'));

const W = 1400, H = 1200;           // 7:6, twice the card artboard so it stays sharp
/* The share of the artboard the photo is allowed to occupy. It is a BOX the
   photo is fitted into, not a cap on its natural size — max-width/max-height
   never scale a small picture UP, so a 232x264 upload stayed 232px wide inside
   a 1400px frame and came out about a fifth of the tile. Measured on the first
   proof sheet: every card consistent, and every product smaller than before. */
const INSET = 0.86;

/** Where a product's picture currently lives, whatever form it is in. */
async function currentBytes(image) {
  const parsed = store.parseDataUri(image);
  if (parsed) return parsed;
  const m = /^\/api\/images\/([a-f0-9]{32})\./.exec(String(image || ''));
  if (!m) return null;
  const row = await store.readImage(m[1]);
  return row ? { mime: row.mime, bytes: row.bytes } : null;
}

const isUpload = (src) => !!src
  && (String(src).startsWith('data:') || /^\/api\/images\//.test(String(src)));

if (revert) {
  const products = await all(`SELECT id, name, metadata FROM products`);
  let back = 0;
  for (const p of products) {
    let meta = {}; try { meta = JSON.parse(p.metadata || '{}'); } catch { continue; }
    if (!meta.imageOriginal) continue;
    const row = await store.readImage(meta.imageOriginal);
    if (!row) continue;
    const next = { ...meta, image: `/api/images/${row.id}.${store.extFor(row.mime)}` };
    delete next.imageOriginal; delete next.imageNormalized;
    if (!dry) await run(`UPDATE products SET metadata=@m, updated_at=@at WHERE id=@id`,
      { m: JSON.stringify(next), at: nowIso(), id: p.id });
    back += 1;
  }
  console.log(`${back} product(s) put back on their original photo${dry ? ' (dry run)' : ''}`);
  process.exit(0);
}

// ── The browser that does the compositing ──────────────────────────────────
const exe = process.env.CHROME
  || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium', '/usr/bin/google-chrome']
    .find((c) => fs.existsSync(c));
if (!exe) {
  console.error('This needs a Chromium to composite with. Install playwright-core and a browser, '
    + 'or point CHROME= at one.');
  process.exit(1);
}
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();

/**
 * The artboard. Same ground as the generated art so a mixed grid reads as one
 * set: near-black base, a purple bloom, a per-category accent, a faint grid,
 * and a soft stage under the photo so it sits on something rather than floats.
 */
function html(dataUri, accent) {
  return `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden}
  .bg{position:absolute;inset:0;background:
    radial-gradient(120% 90% at 50% 34%, ${accent}2e 0%, transparent 62%),
    radial-gradient(120% 100% at 50% 40%, ${BRAND.purple}42 0%, ${BRAND.indigo}1f 45%, transparent 72%),
    linear-gradient(140deg, ${BRAND.ink0} 0%, ${BRAND.ink1} 55%, ${BRAND.ink0} 100%);}
  .grid{position:absolute;inset:0;opacity:.10;
    background-image:linear-gradient(${'#c7d2fe'} 1px,transparent 1px),linear-gradient(90deg,${'#c7d2fe'} 1px,transparent 1px);
    background-size:140px 140px;
    -webkit-mask-image:radial-gradient(60% 55% at 50% 42%, #000 0%, transparent 100%);}
  .vig{position:absolute;inset:0;background:radial-gradient(75% 70% at 50% 50%, transparent 52%, #04030c9c 100%)}
  .stage{position:absolute;left:50%;top:${Math.round(H * 0.78)}px;transform:translateX(-50%);
    width:${Math.round(W * 0.52)}px;height:46px;border-radius:50%;
    background:radial-gradient(closest-side, ${accent}44, transparent 72%);filter:blur(10px)}
  .wrap{position:absolute;inset:0;display:grid;place-items:center}
  /* A sized box plus object-fit:contain, so the photo is scaled to fill it in
     whichever dimension binds — up as well as down — while keeping its own
     proportions. Nothing is cropped and nothing is stretched. */
  .frame{width:${Math.round(W * INSET)}px;height:${Math.round(H * INSET)}px;
      display:grid;place-items:center}
  img{width:100%;height:100%;object-fit:contain;display:block;
      filter:drop-shadow(0 26px 46px rgba(0,0,0,.55))}
  .bar{position:absolute;left:0;right:0;bottom:0;height:9px;
    background:linear-gradient(90deg, ${BRAND.indigo}, ${BRAND.purple}, ${accent})}
  </style>
  <div class="bg"></div><div class="grid"></div><div class="vig"></div>
  <div class="stage"></div>
  <div class="wrap"><div class="frame"><img src="${dataUri}"></div></div>
  <div class="bar"></div>`;
}

const products = await all(`SELECT id, sku, name, category, metadata FROM products WHERE active = 1`);
let done = 0, skipped = 0, tooSmall = [], failed = [];
let beforeBytes = 0, afterBytes = 0;

for (const p of products) {
  let meta = {}; try { meta = JSON.parse(p.metadata || '{}'); } catch { continue; }
  if (meta.imageNormalized) { skipped += 1; continue; }     // already done
  if (!isUpload(meta.image)) { skipped += 1; continue; }

  const src = await currentBytes(meta.image);
  if (!src) { failed.push({ name: p.name, error: 'could not read the current image' }); continue; }

  const { width, height } = store.dimensions(src.mime, src.bytes);
  if (width && width < 400) tooSmall.push({ name: p.name, size: `${width}x${height}` });
  beforeBytes += src.bytes.length;

  if (dry) { done += 1; continue; }

  try {
    // Keep the original addressable so --revert can find it again.
    const original = await store.storeImage(src.mime, src.bytes, { productId: p.id, source: 'original' });

    const uri = `data:${src.mime};base64,${src.bytes.toString('base64')}`;
    await page.setContent(html(uri, accentFor(p.category)));
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
    const shot = await page.screenshot({ type: 'webp', quality: 88 });

    const composed = await store.storeImage('image/webp', shot, { productId: p.id, source: 'normalized' });
    afterBytes += shot.length;

    await run(`UPDATE products SET metadata = @m, updated_at = @at WHERE id = @id`,
      { m: JSON.stringify({ ...meta, image: composed.url,
        imageNormalized: true, imageOriginal: original.id }), at: nowIso(), id: p.id });
    done += 1;
  } catch (err) { failed.push({ name: p.name, error: err.message }); }
}

await browser.close();

console.log(`\n${products.length} active product(s)`);
console.log(`  ${done} photo(s) placed on the 7:6 ForgeMarket artboard${dry ? ' (dry run — nothing written)' : ''}`);
console.log(`  ${skipped} left alone (generated art, built-in icons, or already normalised)`);
if (failed.length) console.log(`  ${failed.length} FAILED: ${failed.slice(0, 3).map((f) => `${f.name}: ${f.error}`).join('; ')}`);
if (!dry && beforeBytes) {
  console.log(`\n  ${(beforeBytes / 1048576).toFixed(2)} MB of photos → ${(afterBytes / 1048576).toFixed(2)} MB of artboards`);
}
if (tooSmall.length) {
  console.log(`\n  ${tooSmall.length} upload(s) are narrower than 400px. A card slot is 352 device`);
  console.log('  pixels wide on a 2x desktop, so these stay soft — the artboard makes them');
  console.log('  look deliberate, not sharp. Worth re-uploading at 1400x1200:');
  for (const t of tooSmall.slice(0, 12)) console.log(`    ${t.size.padEnd(10)} ${t.name.slice(0, 46)}`);
  if (tooSmall.length > 12) console.log(`    …and ${tooSmall.length - 12} more`);
}
console.log('\n  Reversible: node scripts/art/normalize-uploads.mjs --revert');
process.exit(failed.length ? 1 : 0);
