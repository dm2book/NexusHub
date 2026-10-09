/**
 * syncCatalogImages (db/demoSeed.js): one read, rewrites in memory, a write only
 * for a row that changes — and the same results as the per-path UPDATEs it
 * replaced: stale icon extensions healed, the six flat banners retired, missing
 * catalogue images backfilled, owner images and links left alone.
 */
import './_selling-shop.mjs';   // must come first — see that file
import { ensureReady } from '../src/app.js';
import { get, run, all } from '../src/db/index.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
await ensureReady();
const { syncCatalogImages } = await import('../src/db/demoSeed.js');
const meta = async (id) => JSON.parse((await get('SELECT metadata FROM products WHERE id=@id', { id })).metadata || '{}');

// A catalogue product (has a sku the seed knows) with its image cleared.
const seeded = await get(`SELECT id, sku, metadata FROM products WHERE sku IS NOT NULL AND metadata LIKE '%"image"%' LIMIT 1`);
const seededImage = JSON.parse(seeded.metadata).image;
await run(`UPDATE products SET metadata=@m WHERE id=@id`, { id: seeded.id, m: JSON.stringify({ ...JSON.parse(seeded.metadata), image: '' }) });

// Our own icon path stored with a dead extension, and an old flat banner.
const stale = await get(`SELECT id FROM products WHERE sku IS NOT NULL AND id <> @s LIMIT 1`, { s: seeded.id });
await run(`UPDATE products SET metadata=@m WHERE id=@id`, { id: stale.id, m: JSON.stringify({ image: '/products/icons/robux.png' }) });
const banner = await get(`SELECT id FROM products WHERE sku IS NOT NULL AND id NOT IN (@a, @b) LIMIT 1`, { a: seeded.id, b: stale.id });
await run(`UPDATE products SET metadata=@m WHERE id=@id`, { id: banner.id, m: JSON.stringify({ image: '/products/robux.svg' }) });
// The owner's own upload and an external link must not be touched.
const owner = await get(`SELECT id FROM products WHERE sku IS NOT NULL AND id NOT IN (@a, @b, @c) LIMIT 1`, { a: seeded.id, b: stale.id, c: banner.id });
await run(`UPDATE products SET metadata=@m WHERE id=@id`, { id: owner.id, m: JSON.stringify({ image: 'https://cdn.example.com/my-robux.png', note: '/products/robux.svg is old' }) });

const before = (await all('SELECT id, updated_at FROM products')).reduce((m, r) => m.set(r.id, r.updated_at), new Map());

await syncCatalogImages();

ok('a missing catalogue image is filled in again', (await meta(seeded.id)).image === seededImage, JSON.stringify(await meta(seeded.id)));
ok('a dead .png icon path is repointed to the icon that exists', /\/products\/icons\/robux\.(svg|webp)$/.test((await meta(stale.id)).image), (await meta(stale.id)).image);
ok('a flat banner is moved to its icon', (await meta(banner.id)).image === '/products/icons/robux.webp', (await meta(banner.id)).image);
const o = await meta(owner.id);
ok('an owner upload and an unquoted mention are left exactly as they were',
  o.image === 'https://cdn.example.com/my-robux.png' && o.note === '/products/robux.svg is old', JSON.stringify(o));

const after = await all('SELECT id, updated_at FROM products');
const touched = after.filter((r) => r.updated_at !== before.get(r.id)).map((r) => r.id);
ok('only the rows that needed a change were written', touched.length >= 3 && touched.every((id) => [seeded.id, stale.id, banner.id].includes(id)),
  `${touched.length} written`);

// A second run on a healthy catalogue changes nothing at all.
const snap = (await all('SELECT id, updated_at FROM products')).reduce((m, r) => m.set(r.id, r.updated_at), new Map());
await syncCatalogImages();
const again = (await all('SELECT id, updated_at FROM products')).filter((r) => r.updated_at !== snap.get(r.id));
ok('a second run writes nothing', again.length === 0, `${again.length} rows`);

console.log(`\n${fail ? '❌' : '✅'} catalog-image-sync: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
