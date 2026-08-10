/**
 * Every product must point at art that exists.
 *
 * The icon rule is written down twice — once for the browser in
 * src/lib/sampleCatalog.js, once for the seeder in server/src/db/demoSeed.js —
 * and the two drifted. During the performance pass the ten raster brand icons
 * were converted from PNG to WebP (481KB across ten files became 83KB). The
 * frontend copy was updated. The server copy was not, and kept composing
 * `/products/icons/<cat>.png` — paths that have pointed at nothing since.
 *
 * Worse, the loop meant to REPAIR mismatched extensions used the same broken
 * rule: for those ten categories it rewrote working `.svg` paths into the dead
 * `.png` on every boot. A self-inflicting bug in the healing code.
 *
 * Nothing failed loudly. A missing image renders as a blank tile, and no test
 * had ever opened the files a product claims to use. So this suite does exactly
 * that: it resolves every path the catalog can produce against the filesystem.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_art';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const fs = await import('node:fs');
const publicFile = (p) => new URL(`../../public${p}`, import.meta.url);
const exists = (p) => typeof p === 'string' && p.startsWith('/') && fs.existsSync(publicFile(p));

const { ensureReady } = await import('../src/app.js');
await ensureReady();
// syncCatalogImages runs in background upkeep; give it room to finish.
await new Promise((r) => setTimeout(r, 4000));
const { all } = await import('../src/db/index.js');

// ── 1. Every seeded product resolves to a real file ─────────────────────────
console.log('— Every product in the shop has art that exists —');
{
  const rows = await all(`SELECT name, category, metadata FROM products WHERE active = 1`);
  ok('the catalog is not empty', rows.length > 0, `rows=${rows.length}`);

  const parse = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
  const withImage = rows.map((r) => ({ ...r, image: parse(r.metadata).image }));

  const missing = withImage.filter((r) => !r.image);
  ok('no product is left without a cover', missing.length === 0,
    missing.map((r) => r.name).join(', '));

  // Owner uploads and external links are theirs; only our own bundled art is
  // resolvable here.
  const local = withImage.filter((r) => r.image?.startsWith('/products/'));
  ok('the bundled art is the majority of the catalog', local.length >= rows.length - 2,
    `${local.length}/${rows.length}`);

  const broken = local.filter((r) => !exists(r.image));
  ok('every bundled path opens a real file', broken.length === 0,
    broken.map((r) => `${r.name} -> ${r.image}`).join(' | '));
}

// ── 2. The two copies of the icon rule agree ────────────────────────────────
console.log('\n— The browser and the seeder compose the same path —');
{
  const client = fs.readFileSync(new URL('../../src/lib/sampleCatalog.js', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../src/db/demoSeed.js', import.meta.url), 'utf8');

  const extOf = (src) => src.match(/RASTER_ICONS\.(?:has|includes)\(\w+\)\s*\?\s*'(\w+)'\s*:\s*'(\w+)'/);
  const c = extOf(client);
  const s = extOf(server);
  ok('both files still build the icon path the same way', !!c && !!s, `client=${!!c} server=${!!s}`);
  ok('…and pick the same extension for raster art', c?.[1] === s?.[1], `client=${c?.[1]} server=${s?.[1]}`);
  ok('…and the same one for the generated icons', c?.[2] === s?.[2], `client=${c?.[2]} server=${s?.[2]}`);

  // The rule is only right if the files agree with it.
  const rasterList = server.match(/const RASTER_ICONS = \[([\s\S]*?)\];/)?.[1] || '';
  const raster = [...rasterList.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
  ok('the raster list is not empty', raster.length > 0, `n=${raster.length}`);
  const wrongExt = raster.filter((cat) => !exists(`/products/icons/${cat}.${s?.[1]}`));
  ok(`every raster category has a .${s?.[1]} file on disk`, wrongExt.length === 0, wrongExt.join(', '));

  // Nothing may point at PNG: there are none left.
  const pngs = fs.readdirSync(new URL('../../public/products/icons', import.meta.url))
    .filter((f) => f.endsWith('.png'));
  ok('no PNG icons remain in the repo', pngs.length === 0, pngs.join(', '));
  ok('and the seeder does not compose .png paths',
    !/\/products\/icons\/\$\{cat\}\.\$\{[^}]*'png'/.test(server), 'the seeder still builds .png');
}

// ── 3. Every category icon the code advertises actually ships ───────────────
console.log('\n— Every advertised icon is a file, in both copies of the list —');
{
  for (const [label, rel] of [
    ['client', '../../src/lib/sampleCatalog.js'],
    ['server', '../src/db/demoSeed.js'],
  ]) {
    const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
    const list = src.match(/const CATS_WITH_ICON = \[([\s\S]*?)\];/)?.[1] || '';
    const cats = [...list.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
    ok(`${label}: the icon list is populated`, cats.length > 40, `n=${cats.length}`);
    const absent = cats.filter((c) => !exists(`/products/icons/${c}.svg`) && !exists(`/products/icons/${c}.webp`));
    ok(`${label}: every listed category has an icon file`, absent.length === 0, absent.join(', '));
  }
}

// ── 4. Pack art referenced by the seed ──────────────────────────────────────
console.log('\n— Per-denomination pack art —');
{
  const seed = fs.readFileSync(new URL('../src/db/demoSeed.js', import.meta.url), 'utf8');
  const paths = [...seed.matchAll(/image: '(\/products\/[^']+)'/g)].map((m) => m[1]);
  ok('the seed references pack art', paths.length > 20, `n=${paths.length}`);
  const gone = [...new Set(paths)].filter((p) => !exists(p));
  ok('every referenced pack file exists', gone.length === 0, gone.join(', '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
