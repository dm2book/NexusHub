#!/usr/bin/env node
/**
 * Generate the three artboards for every active product.
 *
 *   DATABASE_URL=postgres://… node scripts/art/generate.mjs
 *   DATABASE_URL=…            node scripts/art/generate.mjs --dry
 *   DATABASE_URL=…            node scripts/art/generate.mjs --apply
 *
 * Without --apply it writes the files and reports; with --apply it also points
 * each product's metadata.image at its new main artboard. The two are separate
 * on purpose: generating art is safe, repointing 72 live products is a decision.
 *
 * Idempotent. Re-running overwrites the same paths with the same bytes, so it
 * can be part of a build without accumulating anything.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mainSvg, hoverSvg, bannerSvg } from './render.mjs';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'public', 'products', 'art');
const apply = process.argv.includes('--apply');
const dry = process.argv.includes('--dry');

const { all, run, nowIso } = await import(path.join(ROOT, 'server/src/db/index.js'));

const products = await all(
  `SELECT id, sku, name, category, price, metadata FROM products WHERE active = 1 ORDER BY category, name`);

/** A stable, readable filename from the SKU — never from the name, which changes. */
const slug = (p) => String(p.sku || p.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

fs.mkdirSync(OUT, { recursive: true });

let written = 0, bytes = 0, missingMark = [];
const rows = [];

for (const p of products) {
  let meta = {};
  try { meta = JSON.parse(p.metadata || '{}'); } catch { /* keep {} */ }
  /* imageLegacy travels with the product so markFor() can reach past our own
     previous output to the original brand art. Without it a second run has no
     way back to the logo. */
  const product = { ...p, image: meta.image || null, imageLegacy: meta.imageLegacy || null,
    price: Number(p.price) };

  const files = {
    main: `${slug(p)}.svg`,
    hover: `${slug(p)}-hover.svg`,
    banner: `${slug(p)}-banner.svg`,
  };
  const art = {
    main: mainSvg(product),
    hover: hoverSvg(product),
    banner: bannerSvg(product),
  };

  if (!product.image) missingMark.push(p.name);

  for (const k of ['main', 'hover', 'banner']) {
    const file = path.join(OUT, files[k]);
    if (!dry) fs.writeFileSync(file, art[k]);
    written += 1; bytes += Buffer.byteLength(art[k]);
  }

  rows.push({
    id: p.id, sku: p.sku, name: p.name, category: p.category,
    was: product.image,
    main: `/products/art/${files.main}`,
    hover: `/products/art/${files.hover}`,
    banner: `/products/art/${files.banner}`,
    sizes: { main: Buffer.byteLength(art.main), hover: Buffer.byteLength(art.hover), banner: Buffer.byteLength(art.banner) },
  });

  if (apply && !dry) {
    /* The old value is kept as `imageLegacy` rather than discarded: this is a
       live catalogue, and an art change you cannot walk back is not a change
       you should make automatically. */
    const next = { ...meta, image: `/products/art/${files.main}`,
      imageHover: `/products/art/${files.hover}`,
      imageBanner: `/products/art/${files.banner}`,
      imageLegacy: meta.imageLegacy ?? meta.image ?? null };
    await run(`UPDATE products SET metadata = @m, updated_at = @at WHERE id = @id`,
      { m: JSON.stringify(next), at: nowIso(), id: p.id });
  }
}

const report = {
  products: products.length,
  filesWritten: dry ? 0 : written,
  totalBytes: bytes,
  averageBytes: Math.round(bytes / written),
  applied: apply && !dry,
  productsWithNoBrandMark: missingMark,
  rows,
};
fs.writeFileSync(path.join(ROOT, 'public', 'products', 'art', '_manifest.json'), JSON.stringify(report, null, 1));

console.log(`${products.length} products → ${dry ? '(dry run) ' : ''}${written} artboards, `
  + `${(bytes / 1024).toFixed(0)} KB total, ${(bytes / written).toFixed(0)} B each`);
if (missingMark.length) console.log(`  ${missingMark.length} product(s) have no brand mark to composite: ${missingMark.slice(0, 5).join(', ')}`);
if (apply && !dry) console.log('  catalogue repointed at the new art (old paths kept as metadata.imageLegacy)');
process.exit(0);
