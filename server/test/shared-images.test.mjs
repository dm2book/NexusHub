/**
 * A picture in the image store belongs to its bytes, not to one product.
 *
 * product_images is content-addressed — the id is the hash, and uploading the
 * same picture twice returns the SAME row. The product_id column is a note
 * about who uploaded it first. Declared ON DELETE CASCADE, that note became
 * ownership: deleting the first product deleted the row, and everything else
 * pointing at that URL started 404ing with nothing to say why.
 *
 * Measured before the fix: two products given one picture share one row;
 * DELETE the first and readImage() on the shared id returns null.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const { ensureReady } = await import('../src/app.js');
await ensureReady();
const { createProduct } = await import('../src/services/productService.js');
const { normalizeImageValue, readImage } = await import('../src/services/imageStoreService.js');
const { setCategoryLogo, getCategoryLogos } = await import('../src/services/settingsService.js');
const { run, get } = await import('../src/db/index.js');

// 1x1 png, small enough to inline and real enough to store.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const idOf = (url) => String(url).split('/').pop().split('.')[0];

console.log('\n— One picture, one row —');
const a = await createProduct({ name: 'Shared A', category: 'robux', price: 199, announce: false });
const b = await createProduct({ name: 'Shared B', category: 'robux', price: 299, announce: false });
const ra = await normalizeImageValue(PNG, { productId: a.id });
const rb = await normalizeImageValue(PNG, { productId: b.id });
ok('the same picture stores once', ra.value === rb.value, `${ra.value} vs ${rb.value}`);
ok('the second upload reports the row as reused', rb.stored === true && rb.value === ra.value);

const shared = idOf(ra.value);
ok('the row is there', !!(await readImage(shared)));

console.log('\n— Deleting one product does not take the picture —');
await run('DELETE FROM products WHERE id=@p', { p: a.id });
ok('the picture survives', !!(await readImage(shared)), 'the FK cascaded and deleted a shared row');
const row = await get('SELECT product_id FROM product_images WHERE id=@id', { id: shared });
ok('…and the stale provenance is cleared, not kept', row?.product_id === null, `product_id=${row?.product_id}`);

console.log('\n— The constraint itself says so —');
const fk = await get(`
  SELECT rc.delete_rule FROM information_schema.referential_constraints rc
    JOIN information_schema.table_constraints tc ON tc.constraint_name = rc.constraint_name
   WHERE tc.table_name = 'product_images' AND tc.constraint_type = 'FOREIGN KEY'`);
ok('product_images.product_id is ON DELETE SET NULL', fk?.delete_rule === 'SET NULL', `rule=${fk?.delete_rule}`);

console.log('\n— A category logo is in the same store, so it is covered too —');
await setCategoryLogo('robux', PNG);
const logos = await getCategoryLogos();
ok('the logo is stored as a URL', /^\/api\/images\/[a-f0-9]{32}\.png$/.test(logos.robux || ''), logos.robux?.slice(0, 40));
ok('…sharing the row the products already made', idOf(logos.robux) === shared);
await run('DELETE FROM products WHERE id=@p', { p: b.id });
ok('deleting the last product that used it leaves the logo working', !!(await readImage(idOf(logos.robux))));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
