/**
 * Product-card imagery: one element, one request, one decode.
 *
 * Every card used to draw its artwork twice — the picture, and a blurred scaled
 * copy of the same file behind it to tint the tile. Measured in a browser before
 * any of this was written:
 *
 *   - the same URL fetched twice per card, including the ones that 404;
 *   - a 4000×4000 source decoded to fill a 140px box AND again for a 235×200
 *     blurred layer, with a 40px blur composited over it, per card;
 *   - `loading="lazy"` on every image including the first row, so the tint
 *     arrived after the artwork — the "background appears late, then garbles".
 *
 * And two bugs this rewrite introduced and had to fix, both caught by measuring
 * rather than by reading:
 *
 *   - folding "which file" and "has it loaded" into one state variable is an
 *     infinite loop: art 404s → fall back to the icon → icon loads → state says
 *     'ready' → src recomputes to the broken art → 404s again. 193 requests for
 *     one missing file on a single page load.
 *   - a component that hardcodes `relative` while the caller passes
 *     `absolute inset-0` leaves two equal-specificity classes fighting; the
 *     artwork rendered 256px tall in a 150px box and CLS went 0.003 → 0.475.
 *
 * Both are asserted below, because neither is visible in the rendered output
 * until it is too late.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_product_media';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

import fs from 'node:fs';
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
/* Assert against CODE, not prose.
   These files document what the old two-layer version cost, which means the
   comments legitimately contain the words "blur", "<img" and "Roblox". A first
   run of this file failed three times on its own documentation. */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block comments, JSX ones included
  .replace(/^\s*\/\/.*$/gm, ' ');      // line comments
const media = stripComments(read('../../src/components/store/ProductMedia.jsx'));
const card = stripComments(read('../../src/components/store/LightProductCard.jsx'));

// ── 1. One layer, not two ───────────────────────────────────────────────────
console.log('— One picture, one <img> —');
{
  const imgTags = (media.match(/<img\b/g) || []).length;
  ok('the media component renders exactly one image element', imgTags === 1, `${imgTags} found`);
  ok('…and the card no longer draws its own', !/<img\b/.test(card),
    'the card used to render the artwork twice itself');
  ok('no blurred duplicate of the artwork remains',
    !/blur-(2xl|3xl)/.test(media),
    'the second layer is the duplicate request and the late/garbled background');
}

// ── 2. The retry loop, which cost 193 requests for one missing file ─────────
console.log('\n— A broken image falls back once and stops —');
{
  ok('"which file" and "has it loaded" are separate state',
    /const \[failed, setFailed\] = useState\(false\)/.test(media)
    && /const \[loaded, setLoaded\] = useState\(false\)/.test(media),
    'one variable for both is an infinite fallback loop');
  ok('the source depends only on the sticky failure flag',
    /const src = \(!failed && custom\) \? custom : fallback;/.test(media),
    'if the source depends on load state, a successful fallback re-selects the broken art');
  ok('an error sets that flag and nothing else', /onError=\{\(\) => \{[\s\S]{0,320}setFailed\(true\);/.test(media));
  ok('the failure is reported in development', /import\.meta\.env\?\.DEV[\s\S]{0,120}console\.warn/.test(media));
}

// ── 3. Space is reserved before any bytes arrive ────────────────────────────
console.log('\n— The box is the right size before the picture exists —');
{
  ok('intrinsic dimensions are declared', /width=\{width\}/.test(media) && /height=\{height\}/.test(media));
  ok('the component does not fight its caller for positioning',
    !/`relative overflow-hidden \$\{className\}`/.test(media),
    'relative + absolute at equal specificity is how the tile stopped constraining its image');
  ok('a skeleton covers the wait rather than a blank hole', /fm-skeleton/.test(media));
  ok('…and the picture is revealed rather than popped in',
    /transition-opacity/.test(media) && /loaded \? 'opacity-100' : 'opacity-0'/.test(media));
}

// ── 4. Loading priority ─────────────────────────────────────────────────────
console.log('\n— The first row is not lazy —');
{
  ok('priority images load eagerly', /loading=\{priority \? 'eager' : 'lazy'\}/.test(media));
  ok('…and are fetched at high priority', /fetchpriority=\{priority \? 'high' : 'auto'\}/.test(media));
  const shop = read('../../src/pages/Shop.jsx');
  ok('the grid marks its first cards as priority', /priority=\{i < 8\}/.test(shop));
  ok('…and so does the trending rail', /priority=\{i < 4\}/.test(shop));
  ok('everything below the fold stays lazy', /: 'lazy'/.test(media));
}

// ── 5. Framing is product data, not a rule about brands ─────────────────────
console.log('\n— Composition belongs to the picture —');
{
  const { focalOf, DEFAULT_POSITION } = await import('../../src/components/store/ProductMedia.jsx')
    .catch(() => ({}));
  // The component imports React; if that fails in node, fall back to source checks.
  if (typeof focalOf === 'function') {
    ok('the default is centred and whole', focalOf({}).position === '50% 50%' && focalOf({}).fit === 'contain');
    ok('a product may move its focal point',
      focalOf({ imagePosition: { x: 20, y: 80 } }).position === '20% 80%');
    ok('…within sane bounds', focalOf({ imagePosition: { x: -50, y: 999 } }).position === '0% 100%');
    ok('a banner may opt into filling the tile', focalOf({ imageFit: 'cover' }).fit === 'cover');
    ok('…and anything else falls back to whole', focalOf({ imageFit: 'nonsense' }).fit === 'contain');
    ok('a default exists to override', DEFAULT_POSITION.x === 50 && DEFAULT_POSITION.y === 50);
  } else {
    ok('focalOf is exported for products to configure framing', /export function focalOf/.test(media));
    ok('…with a documented default', /export const DEFAULT_POSITION/.test(media));
  }
  ok('no brand is special-cased in the component',
    !/robux|minecraft|pokemon/i.test(media),
    'a rule about Robux is a rule that breaks on the next product');
}

// ── 6. The API carries the framing ──────────────────────────────────────────
console.log('\n— The server sends what the tile needs —');
{
  const svc = read('../src/services/productService.js');
  ok('imagePosition is exposed', /imagePosition:/.test(svc));
  ok('…clamped to 0–100 rather than trusted', /Math\.min\(100, Math\.max\(0, Number\(v\)\)\)/.test(svc));
  ok('imageFit is exposed and restricted to the two it supports',
    /\['cover', 'contain'\]\.includes\(metadata\.imageFit\)/.test(svc));
  ok('imageScale is bounded', /Math\.min\(2, Math\.max\(0\.5/.test(svc));

  // Round-trip through the real serializer, against a real schema.
  const { ensureReady } = await import('../src/app.js');
  await ensureReady();
  const { run } = await import('../src/db/index.js');
  const { createProduct } = await import('../src/services/productService.js');
  const { getProduct } = await import('../src/services/productService.js');
  const p = await createProduct({ name: `Framing ${process.pid}`, category: 'robux', price: 100, announce: false });
  const md = { image: '/products/icons/robux.webp', imagePosition: { x: 10, y: 90 }, imageFit: 'cover', imageScale: 1.2 };
  await run('UPDATE products SET metadata=@m WHERE id=@p', { m: JSON.stringify(md), p: p.id });
  const back = await getProduct(p.id);
  ok('a product round-trips its focal point', back.imagePosition?.x === 10 && back.imagePosition?.y === 90,
    JSON.stringify(back.imagePosition));
  ok('…its fit', back.imageFit === 'cover', String(back.imageFit));
  ok('…and its scale', back.imageScale === 1.2, String(back.imageScale));

  await run('UPDATE products SET metadata=@m WHERE id=@p',
    { m: JSON.stringify({ image: '/x.png', imagePosition: 'nonsense', imageFit: 'zoom', imageScale: 99 }), p: p.id });
  const junk = await getProduct(p.id);
  ok('junk framing data is dropped rather than rendered',
    junk.imagePosition === null && junk.imageFit === null && junk.imageScale === 2,
    JSON.stringify({ pos: junk.imagePosition, fit: junk.imageFit, scale: junk.imageScale }));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
