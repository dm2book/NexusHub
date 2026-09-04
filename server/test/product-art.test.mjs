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
const { all, get } = await import('../src/db/index.js');

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

// ── 2. One icon rule, not three ────────────────────────────────────────────
console.log('\n— The browser, the seeder and the art generator read one list —');
{
  const brand = fs.readFileSync(new URL('../../src/lib/brandMarks.js', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../../src/lib/sampleCatalog.js', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../src/db/demoSeed.js', import.meta.url), 'utf8');
  const gen = fs.readFileSync(new URL('../../scripts/art/render.mjs', import.meta.url), 'utf8');

  /* This used to check that three hand-written copies of the list AGREED —
     which is the weaker guarantee. They now import one, so the check is that
     nobody has written a fourth copy. */
  ok('the extension is chosen in exactly one place',
    /RASTER_ICONS\.has\(\w+\)\s*\?\s*'webp'\s*:\s*'svg'/.test(brand), 'brandMarks.js');
  for (const [name, src] of [['sampleCatalog', client], ['demoSeed', server], ['render.mjs', gen]]) {
    ok(`${name} reads it rather than restating it`,
      /brandMarks\.js'/.test(src) && !/(const|let)\s+RASTER_ICONS\s*=/.test(src));
  }

  const raster = [...(brand.match(/RASTER_ICONS = new Set\(\[([\s\S]*?)\]\)/)?.[1] || '')
    .matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);

  /* The four marks that must stay raster.
     The list was ten. Rendered side by side at 46 CSS px — the size a phone's
     product grid actually gives a mark — six of them failed: cod is a wordmark
     in a black box, eafc and v-bucks and giftcard are photographs, steam is the
     right logo in navy on a near-black board, discord-nitro is an unreadable
     grey blob. In each of those six the vector in the repo is a clean, legible
     icon, so the raster was costing legibility, bytes and resolution
     independence at once.
     These four are different: the raster IS the rights-holder's mark and the
     same-named SVG is a generic stand-in — xbox.svg is a circle with a cross,
     not the Xbox sphere. Swapping one of these replaces a real trademark with
     something a tool drew, which is worse than a soft edge. Emptying this list
     still builds, still passes everything else, and still looks fine — just not
     like the shop somebody designed. That is why it is a test. */
  const TRUE_MARKS = ['playstation', 'robux', 'valorant', 'xbox'];
  const dropped = TRUE_MARKS.filter((c) => !raster.includes(c));
  ok('the four real trademarks are still served as the rights-holder published them',
    dropped.length === 0, `silently swapped for stand-ins: [${dropped}]`);
  ok('and every file the list names exists',
    raster.every((c) => exists(`/products/icons/${c}.webp`)), raster.join(','));

  /* And nothing may point back at the flat banners under /products/.
     Six gradient rectangles with the brand name typeset in a corner, from before
     the icon set existed. syncCatalogImages moves any product still on one over
     to the proper art; this makes sure nothing puts them back. */
  const FLAT = ['playstation', 'xbox', 'steam', 'robux', 'vbucks', 'nitro'];
  // `image:` entries only — LEGACY_ART names the same paths on purpose, because
  // it is the thing that moves products OFF them.
  const catalogueArt = [...(server + client).matchAll(/image:\s*'([^']+)'/g)].map((m) => m[1]);
  const revived = FLAT.filter((n) => catalogueArt.includes(`/products/${n}.svg`));
  ok('no catalogue entry points at the old flat banners', revived.length === 0, `[${revived}]`);

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

// ── 5. The shipped-art manifest matches the directory ──────────────────────
//
// src/lib/shippedArt.js is what the serverless API consults, because public/ is
// CDN-served and not in the function's bundle. A generated list is only worth
// anything while it still describes reality.
console.log('\n— The generated art manifest still matches public/products —');
{
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath,
    [new URL('../../scripts/gen-art-manifest.mjs', import.meta.url).pathname, '--check'],
    { encoding: 'utf8' });
  ok('shippedArt.js is up to date', r.status === 0,
    `${(r.stdout || '') + (r.stderr || '')}`.trim());

  const { SHIPPED_ART, artStatus } = await import('../../src/lib/shippedArt.js');
  ok('the manifest is populated', SHIPPED_ART.size > 100, `n=${SHIPPED_ART.size}`);
  // Every path it claims must open, and nothing on disk may be absent from it.
  const phantom = [...SHIPPED_ART].filter((p) => !exists(p));
  ok('every listed path is a real file', phantom.length === 0, phantom.slice(0, 5).join(', '));
  ok('a known icon resolves', artStatus('/products/icons/robux.webp') === 'ok');
  ok('an invented path does not', artStatus('/products/icons/nope.svg') === 'missing');
  ok('a link is reported as remote, not verified', artStatus('https://cdn.example/x.png') === 'remote');
  ok('an upload is reported as uploaded', artStatus('data:image/webp;base64,AAAA') === 'uploaded');
  ok('nothing at all is "none"', artStatus(null) === 'none' && artStatus('') === 'none');
}

// ── 6. No two categories wear the same picture ─────────────────────────────
//
// Tiers of one currency sharing a look is the design. A gift card and a battle
// pass sharing one picture is a wiring mistake, and it is invisible until a
// customer sees two different products with identical art.
console.log('\n— Duplicated imagery —');
{
  const rows = await all(`SELECT name, category, metadata FROM products WHERE active = 1`);
  const parse = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
  const byImage = new Map();
  for (const r of rows) {
    const img = parse(r.metadata).image;
    if (!img) continue;
    if (!byImage.has(img)) byImage.set(img, []);
    byImage.get(img).push(r);
  }
  const crossed = [...byImage.entries()]
    .filter(([, rs]) => new Set(rs.map((r) => r.category)).size > 1);
  ok('no picture is shared across categories', crossed.length === 0,
    crossed.map(([img, rs]) => `${img} → ${rs.map((r) => r.name).join(' + ')}`).join(' | '));

  // And within a category, every denomination got its own cover — that is what
  // the pack generator exists for.
  const shared = [...byImage.entries()].filter(([, rs]) => rs.length > 1);
  ok('every product has a picture of its own', shared.length === 0,
    shared.map(([img, rs]) => `${rs.length}× ${img}`).join(', '));
}

// ── 7. The launch dashboard refuses to go green on a blank tile ────────────
console.log('\n— Launch readiness sees missing art —');
{
  const { launchChecks } = await import('../src/services/launchCheckService.js');
  const { run, nowIso } = await import('../src/db/index.js');

  const clean = (await launchChecks()).checks.find((c) => c.id === 'productart');
  ok('the check exists', !!clean, 'no productart check in launchChecks()');
  ok('a fully-covered catalog reports ok', clean?.status === 'ok', clean?.detail);

  // Point one product at a file that does not exist, and the check must say so
  // by name — the dashboard is only useful if it names the product to fix.
  const victim = await get(`SELECT id, name, metadata FROM products WHERE active = 1 LIMIT 1`);
  const before = victim.metadata;
  const meta = JSON.parse(before || '{}');
  await run(`UPDATE products SET metadata = @m, updated_at = @at WHERE id = @id`,
    { m: JSON.stringify({ ...meta, image: '/products/icons/definitely-not-here.svg' }),
      at: nowIso(), id: victim.id });

  const broken = (await launchChecks()).checks.find((c) => c.id === 'productart');
  ok('a missing image is a launch blocker', broken?.status === 'fail', broken?.detail);
  ok('…and it names the product', broken?.detail.includes(victim.name), broken?.detail);

  await run(`UPDATE products SET metadata = @m, updated_at = @at WHERE id = @id`,
    { m: before, at: nowIso(), id: victim.id });
  const restored = (await launchChecks()).checks.find((c) => c.id === 'productart');
  ok('and it goes green again once fixed', restored?.status === 'ok', restored?.detail);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
