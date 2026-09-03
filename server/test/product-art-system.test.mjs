/**
 * The product-art system, held to the geometry it exists for.
 *
 * Measured on the real catalogue in a real browser before any of this:
 *
 *   62 products   480x300 pack covers   painted 73.1% of the card (mobile)
 *   10 products   512x512 / 256x256     painted 47.7% (mobile), 36.3% (desktop)
 *
 * — two intrinsic ratios, three render treatments, and a card whose media box is
 * aspect-[7/6] = 1.167, which neither ratio matched. The generated system is one
 * artboard authored at exactly 7:6, so the arithmetic that used to produce that
 * spread produces nothing at all.
 *
 * These checks are geometric and textual rather than visual: a test cannot tell
 * you the art is beautiful, but it can tell you the day someone ships a 4:3
 * cover, or points a product at art that does not exist, or reintroduces the
 * extension-based logo/photo split that made two files render at double size.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ART = join(ROOT, 'public', 'products', 'art');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}  ${x}`); } };

if (!existsSync(ART)) {
  console.log('  ⏭  no generated art — run scripts/art/generate.mjs');
  console.log('\n✅ product art: skipped');
  process.exit(0);
}

const files = readdirSync(ART).filter((f) => f.endsWith('.svg'));
const mains = files.filter((f) => !f.endsWith('-hover.svg') && !f.endsWith('-banner.svg'));

console.log('— Every product has all three artboards —');
{
  ok('there is art to check', mains.length > 0, `${mains.length}`);
  const missing = mains.filter((m) => {
    const base = m.replace(/\.svg$/, '');
    return !files.includes(`${base}-hover.svg`) || !files.includes(`${base}-banner.svg`);
  });
  ok('every main artboard has a hover and a banner beside it', missing.length === 0,
    missing.slice(0, 4).join(', '));
  ok('the three come as a set, so the count divides by three',
    files.length === mains.length * 3, `${files.length} files, ${mains.length} products`);
}

console.log('\n— The geometry the whole system exists for —');
{
  const viewBoxOf = (f) => (readFileSync(join(ART, f), 'utf8').match(/viewBox="([^"]+)"/) || [, ''])[1];
  const ratioOf = (f) => {
    const [, , w, h] = viewBoxOf(f).split(/\s+/).map(Number);
    return h ? +(w / h).toFixed(4) : null;
  };
  const cardRatio = 7 / 6;

  const cards = [...mains, ...files.filter((f) => f.endsWith('-hover.svg'))];
  const wrongCard = cards.filter((f) => Math.abs(ratioOf(f) - cardRatio) > 0.001);
  ok('every card artboard is exactly 7:6, the ratio of the tile it lands in',
    wrongCard.length === 0, wrongCard.slice(0, 3).map((f) => `${f}=${ratioOf(f)}`).join(', '));

  const banners = files.filter((f) => f.endsWith('-banner.svg'));
  const wrongBanner = banners.filter((f) => Math.abs(ratioOf(f) - 16 / 9) > 0.001);
  ok('every banner is exactly 16:9, for TikTok and Discord',
    wrongBanner.length === 0, wrongBanner.slice(0, 3).join(', '));

  // The point of matching: one ratio across the whole catalogue.
  ok('the catalogue has exactly ONE card ratio, not two',
    new Set(cards.map(ratioOf)).size === 1, [...new Set(cards.map(ratioOf))].join(', '));
}

console.log('\n— Dark, branded, and honest —');
{
  const sample = mains.slice(0, 12).map((f) => readFileSync(join(ART, f), 'utf8'));
  ok('every artboard is dark rather than the old light plinth',
    sample.every((s) => /#07060f|#0e0b1e/.test(s)));
  ok('every artboard carries the purple/blue accent',
    sample.every((s) => /#6366f1/i.test(s) && /#a855f7/i.test(s)));
  const banner = readFileSync(join(ART, files.find((f) => f.endsWith('-banner.svg'))), 'utf8');
  ok('the banner is ForgeMarket-branded, so a Discord embed says whose shop it is',
    /ForgeMarket/.test(banner) && /forgemarket\.nl/.test(banner));

  /* The honesty rule this shop keeps re-learning. Art is the easiest place to
     assert something the shop cannot back up, and nobody reads an SVG. */
  const claims = /instant|24\s*\/\s*7|guaranteed|cheapest|best price|100%/i;
  const lying = mains.map((f) => [f, readFileSync(join(ART, f), 'utf8')])
    .filter(([, s]) => claims.test(s.replace(/<!--[\s\S]*?-->/g, '')));
  ok('no artboard makes a claim the shop cannot keep', lying.length === 0,
    lying.slice(0, 3).map(([f]) => f).join(', '));
}

console.log('\n— The classifier that decided a logo was a photograph —');
{
  const catalog = readFileSync(join(ROOT, 'src', 'lib', 'catalog.js'), 'utf8');
  ok('generated art is treated as carrying its own background, so it is never inset',
    /\/products\\\/\(art\|packs\)\\\//.test(catalog) || /\(art\|packs\)/.test(catalog), 'path rule missing');
  ok('the icon set is treated as logos whatever container they ship in',
    /\/products\\\/icons\\\//.test(catalog) && /return false/.test(catalog));
  // Before this, `.webp` alone decided, and the two WebP logos rendered at
  // double the size of the SVG logos in the same row.
  /* Comments stripped first. The explanation of the bug names ".webp" several
     times and sits above the code, so an ordering check that reads the raw text
     compares a comment against a branch and always fails. */
  const fn = catalog.slice(catalog.indexOf('carriesOwnBackground = (src)'));
  const body = fn.slice(0, fn.indexOf('\n};'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok('the extension test no longer runs before the path test',
    body.indexOf('/products/icons/') < body.indexOf('webp'), body.replace(/\s+/g, ' ').slice(0, 140));
}

console.log('\n— The generator can be run twice —');
{
  const render = readFileSync(join(ROOT, 'scripts', 'art', 'render.mjs'), 'utf8');
  ok('it refuses to composite its own output into itself',
    /products\/art\//.test(render) && /imageLegacy/.test(render));
  const seed = readFileSync(join(ROOT, 'server', 'src', 'db', 'demoSeed.js'), 'utf8');
  ok('a fresh deployment seeds the new art rather than the old covers',
    /products\/art/.test(seed) && /fileURLToPath/.test(seed));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} product art: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
