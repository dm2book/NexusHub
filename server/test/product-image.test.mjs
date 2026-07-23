/** The catalog art sync must NEVER overwrite an image the owner set in the
 *  admin — it may only backfill a default cover when there is none. */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

await (await import('../src/app.js')).ensureReady(); // seeds the demo catalog
const { updateProduct, getProduct } = await import('../src/services/productService.js');
const { syncCatalogImages } = await import('../src/db/demoSeed.js');
const { get } = await import('../src/db/index.js');

// Grab a real seeded catalog product (matched by SKU by the sync job).
const row = await get(`SELECT id FROM products WHERE sku IS NOT NULL ORDER BY created_at ASC LIMIT 1`);
ok('a seeded catalog product exists', !!row, JSON.stringify(row));

const custom = 'https://cdn.example.com/my-real-logo.png';
const before = await getProduct(row.id);
await updateProduct(row.id, { metadata: { ...before.metadata, image: custom } });
ok('owner sets a custom image', (await getProduct(row.id)).image === custom);

// The every-boot sync must leave it untouched.
await syncCatalogImages();
ok('custom image survives syncCatalogImages (the bug)', (await getProduct(row.id)).image === custom,
  (await getProduct(row.id)).image);

// Clearing the image lets the default cover backfill again (escape hatch).
await updateProduct(row.id, { metadata: { ...before.metadata, image: undefined } });
ok('image is now empty after clearing', !(await getProduct(row.id)).image);
await syncCatalogImages();
const backfilled = (await getProduct(row.id)).image;
ok('a default cover is backfilled when empty', !!backfilled && backfilled !== custom, backfilled);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
