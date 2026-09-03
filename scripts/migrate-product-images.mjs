#!/usr/bin/env node
/**
 * Move uploaded product photos out of the product rows.
 *
 *   DATABASE_URL=postgres://…  node scripts/migrate-product-images.mjs --dry
 *   DATABASE_URL=postgres://…  node scripts/migrate-product-images.mjs
 *   DATABASE_URL=postgres://…  node scripts/migrate-product-images.mjs --optimise
 *
 * WHY. Measured on the live shop: 45 of 71 products carried their photo as a
 * base64 data: URI inside products.metadata. One GET /api/products was 8.7 MB,
 * of which 4.3 MB was image bytes — read out of Postgres on every uncached
 * call, against a database whose monthly data-transfer allowance had already
 * run out once.
 *
 * After this the bytes live in product_images and the product keeps a URL, so
 * the catalogue query reads a few hundred bytes per product and each picture is
 * fetched once per browser and cached immutably.
 *
 * --dry       report what would happen and change nothing
 * --optimise  also re-encode to WebP and cap the long edge at 1200px. Needs a
 *             Chromium (playwright-core, or CHROME=/path). Without one the
 *             script says so and moves the originals unchanged, which is still
 *             the whole of the transfer win.
 *
 * SAFE TO RE-RUN. Images are addressed by content hash, so a second run finds
 * the rows it wrote and changes nothing. Nothing is deleted: the bytes are in
 * product_images before the product row is rewritten, and the row keeps the
 * hash it was migrated from.
 */
import path from 'node:path';
import fs from 'node:fs';

const ROOT = process.cwd();
const dry = process.argv.includes('--dry');
const optimise = process.argv.includes('--optimise');
const MAX_EDGE = Number(process.env.IMAGE_MAX_EDGE || 1200);
const QUALITY = Number(process.env.IMAGE_QUALITY || 0.82);

const { all, run, nowIso } = await import(path.join(ROOT, 'server/src/db/index.js'));
const { parseDataUri, storeImage, dimensions, imageStats } =
  await import(path.join(ROOT, 'server/src/services/imageStoreService.js'));

/**
 * Re-encode with a headless browser, because the alternative is a native image
 * library this project does not have and should not grow for a one-off script.
 * Returns null when no browser is available — the caller then keeps the
 * original, which is the honest outcome rather than a silent quality change.
 */
async function makeOptimiser() {
  if (!optimise) return null;
  let chromium;
  try { ({ chromium } = await import('playwright-core')); }
  catch { console.log('  ⚠ --optimise needs playwright-core; keeping the originals'); return null; }
  const exe = process.env.CHROME
    || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium', '/usr/bin/google-chrome']
      /* `require` does not exist in an ES module, and the try/catch around it
       swallowed the ReferenceError — so this silently reported "no Chromium"
       on a machine that had one. Caught by running --optimise and getting
       byte-identical output. */
    .find((candidate) => fs.existsSync(candidate));
  if (!exe) { console.log('  ⚠ --optimise found no Chromium (set CHROME=/path); keeping the originals'); return null; }

  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const page = await (await browser.newContext()).newPage();
  await page.goto('about:blank');

  return {
    async convert(mime, bytes) {
      const src = `data:${mime};base64,${bytes.toString('base64')}`;
      const out = await page.evaluate(async ([dataUri, maxEdge, quality]) => {
        const img = new Image();
        img.decoding = 'sync';
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUri; });
        const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        const url = c.toDataURL('image/webp', quality);
        return url.startsWith('data:image/webp') ? url : null;   // no WebP support
      }, [src, MAX_EDGE, QUALITY]).catch(() => null);
      if (!out) return null;
      return { mime: 'image/webp', bytes: Buffer.from(out.split(',')[1], 'base64') };
    },
    close: () => browser.close(),
  };
}

const products = await all(`SELECT id, sku, name, metadata FROM products`);
const opt = await makeOptimiser();

let moved = 0, skipped = 0, reused = 0, beforeBytes = 0, afterBytes = 0, failed = [];
const rows = [];

for (const p of products) {
  let meta = {};
  try { meta = JSON.parse(p.metadata || '{}'); } catch { continue; }
  const parsed = parseDataUri(meta.image);
  if (!parsed) { skipped += 1; continue; }

  beforeBytes += String(meta.image).length;
  let { mime, bytes } = parsed;
  const original = bytes.length;
  const dim = dimensions(mime, bytes);

  if (opt) {
    const better = await opt.convert(mime, bytes);
    /* Only take the re-encode when it is actually smaller. WebP usually wins,
       but a small PNG of flat colour can come out bigger, and shipping a
       larger file to save space is the kind of thing nobody checks. */
    if (better && better.bytes.length < bytes.length) ({ mime, bytes } = better);
  }

  if (!dry) {
    try {
      const stored = await storeImage(mime, bytes, { productId: p.id, source: 'migrated' });
      if (stored.reused) reused += 1;
      const next = { ...meta, image: stored.url, imageBytes: bytes.length, imageSha: stored.id };
      delete next.imageLegacy;   // never keep a base64 copy: that is the problem
      await run(`UPDATE products SET metadata = @m, updated_at = @at WHERE id = @id`,
        { m: JSON.stringify(next), at: nowIso(), id: p.id });
      rows.push({ sku: p.sku, name: p.name, url: stored.url,
        was: `${(original / 1024).toFixed(0)} KB ${parsed.mime}`,
        now: `${(bytes.length / 1024).toFixed(0)} KB ${mime}`,
        pixels: dim.width ? `${dim.width}x${dim.height}` : '?' });
    } catch (err) { failed.push({ name: p.name, error: err.message }); continue; }
  }
  afterBytes += bytes.length;
  moved += 1;
}

if (opt) await opt.close();

const stats = dry ? null : await imageStats();
console.log(`\n${products.length} product(s) examined`);
console.log(`  ${moved} had an embedded photo${dry ? ' (dry run — nothing written)' : ' → moved to product_images'}`);
console.log(`  ${skipped} already point at a URL or a file`);
if (reused) console.log(`  ${reused} shared bytes with a picture already stored`);
if (failed.length) console.log(`  ${failed.length} FAILED: ${failed.slice(0, 3).map((f) => `${f.name}: ${f.error}`).join('; ')}`);
console.log(`\n  base64 removed from product rows : ${(beforeBytes / 1048576).toFixed(2)} MB`);
console.log(`  bytes now held in product_images  : ${(afterBytes / 1048576).toFixed(2)} MB`
  + (optimise && opt ? '  (re-encoded to WebP)' : ''));
if (beforeBytes) {
  console.log(`  catalogue query is now ${(beforeBytes / Math.max(1, afterBytes)).toFixed(1)}x lighter, `
    + `and stops carrying images altogether`);
}
if (stats) console.log(`  store holds ${stats.count} image(s), ${(stats.totalBytes / 1048576).toFixed(2)} MB`);
if (rows.length) {
  console.log('\n  first few:');
  for (const r of rows.slice(0, 6)) console.log(`    ${r.was.padEnd(16)} → ${r.now.padEnd(16)} ${r.pixels.padEnd(11)} ${r.name.slice(0, 38)}`);
}
process.exit(failed.length ? 1 : 0);
