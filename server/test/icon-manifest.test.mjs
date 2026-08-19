/**
 * The category → 3D icon map, checked against the files that actually exist.
 *
 * This list lives in two places — the storefront (src/lib/sampleCatalog.js) and
 * the seed that stamps product covers (server/src/db/demoSeed.js) — because the
 * frontend and the API are separate bundles. Nothing compared them, and they
 * drifted: the storefront knew about `wildrift` and `wow`, the seeder did not,
 * so those two categories were served a cover on one path and null on the
 * other. `mystery` was in neither, and it is the most expensive product in the
 * shop.
 *
 * Drift like that is invisible in review and obvious to a buyer, who just sees
 * a blank tile. Every assertion here is one way the two lists, and the folder
 * on disk, can disagree.
 *
 * Regenerate the icons with `node scripts/gen-icons.mjs` after editing the
 * catalogue in that script; then update both lists to match.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ICON_DIR = join(ROOT, 'public', 'products', 'icons');

const list = (text, name) => {
  const m = text.match(new RegExp(`${name} = (?:new Set\\()?\\[[\\s\\S]*?\\]`));
  if (!m) return null;
  return [...m[0].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};

const front = readFileSync(join(ROOT, 'src', 'lib', 'sampleCatalog.js'), 'utf8');
const seed = readFileSync(join(ROOT, 'server', 'src', 'db', 'demoSeed.js'), 'utf8');

// The raster icons are WebP now — as PNGs they were 481KB across ten files and
// competed for bandwidth with the JavaScript the page cannot paint without.
// PNG is still recognised here so a newly added icon in the old format is
// caught by the extension check below rather than silently 404ing.
const RASTER_EXT = /\.(png|webp)$/;
const files = readdirSync(ICON_DIR).filter((f) => /\.(svg|png|webp)$/.test(f));
const onDisk = new Set(files.map((f) => f.replace(/\.(svg|png|webp)$/, '')));
const rasterOnDisk = new Set(files.filter((f) => RASTER_EXT.test(f)).map((f) => f.replace(RASTER_EXT, '')));

console.log('— The two copies of the list agree —');
{
  const a = list(front, 'CATS_WITH_ICON');
  const b = list(seed, 'CATS_WITH_ICON');
  ok('the storefront defines CATS_WITH_ICON', Array.isArray(a));
  ok('the seeder defines CATS_WITH_ICON', Array.isArray(b));
  const sa = [...(a || [])].sort(), sb = [...(b || [])].sort();
  const onlyFront = sa.filter((x) => !sb.includes(x));
  const onlySeed = sb.filter((x) => !sa.includes(x));
  ok('neither list has a category the other is missing',
    onlyFront.length === 0 && onlySeed.length === 0,
    `storefront-only: [${onlyFront}] seeder-only: [${onlySeed}]`);

  const ra = list(front, 'RASTER_ICONS');
  const rb = list(seed, 'RASTER_ICONS');
  ok('the raster sets agree too',
    JSON.stringify([...(ra || [])].sort()) === JSON.stringify([...(rb || [])].sort()),
    `${ra} vs ${rb}`);
}

console.log('\n— Every mapped category resolves to a file that exists —');
{
  const a = list(front, 'CATS_WITH_ICON') || [];
  const raster = new Set(list(front, 'RASTER_ICONS') || []);
  const missing = a.filter((c) => !onDisk.has(c));
  ok('no category points at a missing icon', missing.length === 0, `missing: [${missing}]`);

  /* The extension is chosen from RASTER_ICONS, so a slug in that set with no
     .webp on disk is a 404 that shows up as a blank tile in the shop.

     The check runs one way only, and that is deliberate. It used to demand the
     set and the disk match EXACTLY, which quietly forbade the thing that made
     the catalogue look tidy: every category now uses the generated 3D icon, and
     the ten .webp brand logos stay on disk unused rather than being deleted, so
     putting a category back is a one-word change. What must never happen is a
     category asking for a file that is not there. */
  const missingRaster = a.filter((c) => raster.has(c) && !rasterOnDisk.has(c));
  ok('every raster-set slug has its raster file',
    missingRaster.length === 0, `no .webp on disk for: [${missingRaster}]`);
}

console.log('\n— Nothing on disk is stranded —');
{
  const a = new Set(list(front, 'CATS_WITH_ICON') || []);
  // coin.svg and gem.svg were generated and then never mapped, so the shop
  // shipped two icons it could not show.
  const stranded = [...onDisk].filter((c) => !a.has(c));
  ok('no generated icon is left unmapped', stranded.length === 0, `stranded: [${stranded}]`);
}

console.log('\n— The categories the shop actually sells all have one —');
{
  // Read straight from the seeded catalogue rather than a hand-kept list: this
  // is the set a buyer can really land on.
  const cats = new Set([...seed.matchAll(/category: '([a-z0-9-]+)'/g)].map((m) => m[1]));
  const a = new Set(list(front, 'CATS_WITH_ICON') || []);
  const bare = [...cats].filter((c) => !a.has(c));
  ok(`all ${cats.size} seeded categories have a 3D icon`, bare.length === 0, `without one: [${bare}]`);
}

console.log('\n— The icons themselves are well-formed —');
{
  const svgs = files.filter((f) => f.endsWith('.svg'));
  ok('the generator produced a healthy set', svgs.length >= 50, `only ${svgs.length}`);
  const bad = [];
  for (const f of svgs) {
    const t = readFileSync(join(ICON_DIR, f), 'utf8');
    if (!t.startsWith('<svg') || !t.includes('viewBox="0 0 512 512"') || t.length < 200) bad.push(f);
  }
  ok('every icon is a 512px SVG with real content', bad.length === 0, `bad: [${bad.slice(0, 5)}]`);

  // Gradient/clip ids are namespaced per icon because several can be inlined
  // into one document, where duplicates would silently cross-wire the colours.
  const dupes = [];
  for (const f of svgs) {
    const t = readFileSync(join(ICON_DIR, f), 'utf8');
    const ids = [...t.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    if (new Set(ids).size !== ids.length) dupes.push(f);
  }
  ok('no icon repeats an id within itself', dupes.length === 0, `dupes: [${dupes.slice(0, 5)}]`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
