/**
 * "When it can find nothing, give it a new picture that fits."
 *
 * A product no supplier has a photo of used to get a number on a gradient: the
 * server could not reach the mark files the shipped artwork is built from, so
 * it drew none. Those files are now bundled into the server, and the tile is
 * drawn by the shipped artwork's own renderer.
 *
 * What these check is mostly the thing that would break silently on Vercel —
 * where public/ is not beside the function — and the rule the old tile kept by
 * drawing nothing: a mark is the repo's own file, never an approximation.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const fit = await import('../src/services/productFitService.js');

console.log('\n— The bundled marks are the repo\'s marks —');
{
  let stale = '';
  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts/gen-art-assets.mjs'), '--check'], { cwd: ROOT, stdio: 'pipe' });
  } catch (e) { stale = String(e.stderr || e.message); }
  ok('the bundle matches public/products/icons', !stale, stale || 'run: node scripts/gen-art-assets.mjs');
}

console.log('\n— A tile that fits the shop —');
{
  /* Exactly the state a real tile product is in: its image IS the tile. */
  const product = { id: 'prd_t', name: '1,000 Riot Points', category: 'league', image: '/api/products/prd_t/tile.svg' };
  const svg = await fit.renderTileArt(product);
  ok('it is authored at the card ratio', /viewBox="0 0 700 600"/.test(svg));
  ok('it carries the category mark in the ring', /<svg x="[\d.]+" y="[\d.]+"/.test(svg), svg.slice(0, 200));
  ok('…and does not try to draw itself as its own mark', !svg.includes('/api/products/prd_t/tile.svg'));

  /* The rule the old tile kept by drawing nothing: never an approximation. */
  const file = readFileSync(join(ROOT, 'public/products/icons/league.svg'), 'utf8');
  const inner = file.replace(/^[\s\S]*?<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '').replace(/<\?xml[\s\S]*?\?>/gi, '');
  ok('the mark is the repo file, byte for byte', svg.includes(inner.trim().slice(0, 400)));

  ok('it states the product\'s own amount', svg.includes('1,000'));
  ok('…and its unit', svg.includes('>POINTS<'));
  const tokens = await fit.renderTileArt({ name: '2,000 Tokens', category: 'marvelrivals' });
  ok('a unit the artwork has no word for is read off the name', tokens.includes('>TOKENS<'), tokens.slice(-400));
  ok('a price never becomes a unit', !(await fit.renderTileArt({ name: 'Gift Card €25', category: 'giftcard' })).includes('>CARD<'));

  const nasty = await fit.renderTileArt({ name: '<script>alert(1)</script> 500 Coins', category: 'x' });
  ok('a name with markup cannot inject it', !nasty.includes('<script>'));
}

console.log('\n— Without public/ on disk, as on Vercel —');
{
  /* The failure this whole change exists to prevent would pass every check
     above on a laptop: the files are right there. So render again from a
     directory with no public/ at all, and demand the same bytes. */
  const disk = await fit.renderTileArt({ name: '2,800 V-Bucks Xbox', category: 'xbox' });
  const empty = mkdtempSync(join(tmpdir(), 'fm-nopublic-'));
  const script = `import(${JSON.stringify(join(ROOT, 'server/src/services/productFitService.js'))})
    .then(async (m) => process.stdout.write(await m.renderTileArt({ name: '2,800 V-Bucks Xbox', category: 'xbox' })))`;
  const away = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: empty, encoding: 'utf8' });
  ok('the tile is identical without public/', away === disk, `${away.length} vs ${disk.length}`);
  ok('…including a raster mark, inlined as data', /<image [^>]*href="data:image\/webp;base64,/.test(away));
}

console.log('\n— Served —');
{
  const { createApp, ensureReady } = await import('../src/app.js');
  await ensureReady();
  const { createProduct } = await import('../src/services/productService.js');
  const p = await createProduct({ name: '3,300 Tokens', sku: `ART-${Date.now()}`, category: 'league',
    price: 1999, currency: 'EUR', active: true, announce: false, metadata: {} });
  const srv = createApp().listen(0);
  const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/products/${p.id}/tile.svg`);
  const body = await res.text();
  srv.close();
  ok('the tile route serves the art tile', res.status === 200 && /<svg x=/.test(body) && body.includes('3,300'));
  const csp = res.headers.get('content-security-policy') || '';
  /* Raster marks are data URIs; without img-src data: the Xbox logo would be
     blocked inside the SVG and the ring would be empty for exactly those. */
  ok('…with a policy that lets an inlined raster mark load', /img-src data:/.test(csp), csp);
  ok('…and still lets nothing run', /default-src 'none'/.test(csp) && !/script-src/.test(csp));
}

console.log(`\n${fail ? '❌' : '✅'} art-assets: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
