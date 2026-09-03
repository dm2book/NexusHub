/**
 * Uploaded photos, out of the product row and behind a cacheable URL.
 *
 * Measured on the live shop before this existed: 45 of 71 products carried
 * their photo as a base64 data: URI inside products.metadata. One
 * GET /api/products was 8.7 MB, of which 4.3 MB was image bytes — read out of
 * Postgres on every uncached call, against a database that had already run out
 * of its monthly transfer allowance once.
 *
 * These checks are about the two properties that make the fix worth having:
 * the catalogue query stops carrying pictures, and a picture that is fetched is
 * fetched once. Everything else is detail.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_images_test';
process.env.NODE_ENV ||= 'development';

const { ensureReady, createApp } = await import('../src/app.js');
await ensureReady();
const { run, get, all, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const store = await import('../src/services/imageStoreService.js');

const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}  ${x}`); } };

/** A real 1x1 PNG, so the header parser has something true to read. */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
const dataUri = (buf, mime = 'image/png') => `data:${mime};base64,${buf.toString('base64')}`;

console.log('— A data: URI is recognised, anything else is left alone —');
{
  ok('a PNG data URI parses', store.parseDataUri(dataUri(PNG_1x1))?.mime === 'image/png');
  ok('an SVG data URI is refused, because SVG can carry script',
    store.parseDataUri('data:image/svg+xml;base64,PHN2Zy8+') === null);
  ok('a path is not a data URI', store.parseDataUri('/products/icons/robux.svg') === null);
  ok('junk is refused rather than stored', store.parseDataUri('data:image/png;base64,!!!!') === null
    || store.parseDataUri('data:image/png;base64,!!!!')?.bytes?.length === 0);
  const d = store.dimensions('image/png', PNG_1x1);
  ok('intrinsic size is read from the header', d.width === 1 && d.height === 1, JSON.stringify(d));
}

console.log('\n— Stored once, addressed by content —');
let url;
{
  const a = await store.storeImage('image/png', PNG_1x1, { source: 'test' });
  url = a.url;
  ok('storing returns a URL under /api/images/', /^\/api\/images\/[a-f0-9]{32}\.png$/.test(a.url), a.url);
  ok('and it is not a reuse the first time', a.reused === false);

  const b = await store.storeImage('image/png', PNG_1x1, { source: 'test' });
  ok('the same bytes give the same URL', b.url === a.url);
  ok('…and are recognised as already stored', b.reused === true);
  const n = Number((await get(`SELECT COUNT(*) AS n FROM product_images`)).n);
  ok('so the same picture is held once, not twice', n === 1, `${n} rows`);
}

console.log('\n— Served like a file, cached like one —');
{
  const res = await fetch(base + url);
  ok('it serves', res.status === 200, `status ${res.status}`);
  ok('with the right content type', res.headers.get('content-type') === 'image/png');
  const cc = res.headers.get('cache-control') || '';
  /* immutable is only honest because the URL carries the content hash: change
     the bytes and the address changes, so a cached copy can never be stale. */
  ok('cached immutably for a year', /immutable/.test(cc) && /max-age=31536000/.test(cc), cc);
  ok('and at the edge too, so the database is read once per region', /s-maxage/.test(cc), cc);
  ok('sniffing is off', res.headers.get('x-content-type-options') === 'nosniff');
  const body = Buffer.from(await res.arrayBuffer());
  ok('the bytes come back unchanged', body.equals(PNG_1x1), `${body.length} vs ${PNG_1x1.length}`);

  const etag = res.headers.get('etag');
  const again = await fetch(base + url, { headers: { 'if-none-match': etag } });
  ok('a revalidating client gets 304, not the bytes again', again.status === 304, `status ${again.status}`);

  ok('an unknown id is 404, not 500', (await fetch(`${base}/api/images/${'0'.repeat(32)}.png`)).status === 404);
  ok('a malformed id is 404 too', (await fetch(`${base}/api/images/not-an-id.png`)).status === 404);
}

console.log('\n— The catalogue stops carrying pictures —');
{
  const id = newId('prd');
  const big = Buffer.concat(Array.from({ length: 40 }, () => PNG_1x1));   // ~3 KB of "photo"
  await run(`INSERT INTO products (id, sku, name, category, description, price, currency, kind, active, metadata, created_at, updated_at)
             VALUES (@id,'IMGTEST','Image test','giftcard','t',999,'EUR','digital',1,@m,@at,@at)`,
    { id, m: JSON.stringify({ image: dataUri(big) }), at: nowIso() });

  const before = Number((await get(`SELECT LENGTH(metadata) AS n FROM products WHERE id=@id`, { id })).n);
  const { value, stored } = await store.normalizeImageValue(dataUri(big), { productId: id, source: 'test' });
  ok('an upload normalises to a URL', stored === true && value.startsWith('/api/images/'), value.slice(0, 40));

  await run(`UPDATE products SET metadata=@m WHERE id=@id`, { m: JSON.stringify({ image: value }), id });
  const after = Number((await get(`SELECT LENGTH(metadata) AS n FROM products WHERE id=@id`, { id })).n);
  ok('the product row shrinks by the size of the picture', after < before / 10, `${before} → ${after} bytes`);

  const list = await fetch(`${base}/api/products`).then((r) => r.text());
  ok('and no catalogue response contains base64 image data',
    !/data:image\/(png|jpe?g|webp);base64/.test(list),
    (list.match(/data:image[^"]{0,40}/) || [''])[0]);

  ok('a path is passed through untouched',
    (await store.normalizeImageValue('/products/icons/robux.svg')).stored === false);
}

console.log('\n— The generator does not overwrite the owner\'s own photographs —');
{
  const gen = (await import('node:fs')).readFileSync(
    new URL('../../scripts/art/generate.mjs', import.meta.url), 'utf8');
  ok('it recognises artwork it did not make', /ownerArt/.test(gen));
  ok('…skips it by default', /ownerArt && !force/.test(gen));
  ok('…and says how many it left alone', /kept the owner/.test(gen));
  ok('overwriting is possible but must be asked for', /--force/.test(gen));
}

console.log('\n— A NEW upload never lands in the product row —');
{
  /* The hole this closes: the store and the migration both existed while the
     admin form still wrote base64 straight into products.metadata, so a one-off
     cleanup would have been undone by the next upload. Driven through the real
     service the route calls, with the real bytes. */
  const id = newId('prd');
  const photo = Buffer.concat(Array.from({ length: 60 }, () => PNG_1x1));
  await run(`INSERT INTO products (id, sku, name, category, description, price, currency, kind, active, metadata, created_at, updated_at)
             VALUES (@id,'UPLOADPATH','Upload path','giftcard','t',999,'EUR','digital',1,'{}',@at,@at)`,
    { id, at: nowIso() });

  const { value } = await store.normalizeImageValue(dataUri(photo), { productId: id, source: 'upload' });
  await run(`UPDATE products SET metadata=@m WHERE id=@id`, { m: JSON.stringify({ image: value }), id });

  const meta = (await get(`SELECT metadata FROM products WHERE id=@id`, { id })).metadata;
  ok('what the row stores is a URL, not the picture',
    /^\/api\/images\//.test(JSON.parse(meta).image), JSON.parse(meta).image.slice(0, 40));
  ok('and the row is small', meta.length < 200, `${meta.length} bytes`);
  ok('the picture is reachable at that URL',
    (await fetch(base + JSON.parse(meta).image)).status === 200);

  // The route itself must call it — a service nobody invokes is not a fix.
  const route = (await import('node:fs')).readFileSync(
    new URL('../src/routes/admin/products.js', import.meta.url), 'utf8');
  ok('the create route stores uploads', /createProduct/.test(route) && /storeUpload\(body\.metadata\)/.test(route));
  ok('the update route stores uploads', /storeUpload\(body\.metadata, req\.params\.id\)/.test(route));
  ok('and so does setting one image across a bulk selection',
    /normalizeImageValue\(url/.test(route));
}

console.log('\n— Background removal knows when to decline —');
{
  const lib = (await import('node:fs')).readFileSync(
    new URL('../../src/lib/imageUpload.js', import.meta.url), 'utf8');
  ok('it declines when it barely removed anything', /cleared < w \* h \* 0\.02/.test(lib));
  /* The guard that was missing: the flood fills from the edges inward, so a
     subject the SAME colour as its background has nothing to stop it. A white
     gift card photographed on white was eaten from the border through its own
     body, leaving the logo floating with no card under it. Verified in a real
     canvas: a white card on white is now declined, a red logo on white is
     still stripped. */
  ok('…and when it removed so much that the subject went with it',
    /cleared > w \* h \* 0\.55/.test(lib));
  ok('the reason is written down next to it', /same colour as its background/i.test(lib));
}

console.log('\n— The owner can do it without a terminal —');
{
  /* The scripts need a DATABASE_URL and a shell, which is exactly what the
     person who needs them does not have. The half that only moves bytes runs
     on the server; the half that composites runs in the admin's own browser,
     because a Vercel function has no canvas. */
  const route = (await import('node:fs')).readFileSync(
    new URL('../src/routes/admin/products.js', import.meta.url), 'utf8');
  ok('there is an endpoint to move embedded photos out of the rows',
    /\/images\/migrate/.test(route));
  ok('it can be asked what it would do before it does it', /dry/.test(route));
  ok('it never keeps a base64 copy behind', /delete next\.imageLegacy/.test(route));
  ok('and it is staff-only', /requirePermission\('suppliers\.manage'\)/.test(route));

  const board = (await import('node:fs')).readFileSync(
    new URL('../../src/lib/productArtboard.js', import.meta.url), 'utf8');
  ok('the artboard is 7:6, matching the card', /const W = 1400/.test(board) && /const H = 1200/.test(board));
  ok('the photo is scaled in both directions, not merely capped',
    /Math\.min\(boxW \/ img\.naturalWidth/.test(board));
  ok('nothing is cropped', !/drawImage\([^)]*sx/.test(board));

  const upload = (await import('node:fs')).readFileSync(
    new URL('../../src/lib/imageUpload.js', import.meta.url), 'utf8');
  /* 600px was the cap while photos lived in the product row. The product hero
     asks for 1490 device pixels, so it guaranteed softness. */
  ok('uploads are no longer capped at 600px', /max = 1600/.test(upload));
  ok('…and the reason the old cap existed is written down', /base64 inside the product/.test(upload));

  const admin = (await import('node:fs')).readFileSync(
    new URL('../../src/pages/admin/Products.jsx', import.meta.url), 'utf8');
  ok('a new upload is put on the artboard as it is uploaded', /toArtboard\(data/.test(admin));
  ok('an artboard failure keeps the photo rather than losing it',
    /an artboard is an improvement, not a requirement/.test(admin));
  ok('there is a one-pass button for the photos already there', /normalizeAll/.test(admin));
  ok('…offered only when there is something to do',
    /isOwnerUpload\(p\.image\) && !p\.imageNormalized/.test(admin));
}

console.log('\n— Normalising uploads onto one artboard —');
{
  const src = (await import('node:fs')).readFileSync(
    new URL('../../scripts/art/normalize-uploads.mjs', import.meta.url), 'utf8');
  ok('the artboard is 7:6, the ratio of the tile', /const W = 1400, H = 1200/.test(src));
  /* The bug the first proof sheet caught: max-width/max-height cap a picture
     but never scale a small one up, so a 232px upload stayed 232px inside a
     1400px frame and came out a fifth of the tile — consistent, and smaller
     than before. A sized box plus object-fit does scale up. */
  ok('the photo is fitted to a box rather than merely capped',
    /\.frame\{width:/.test(src) && /object-fit:contain/.test(src));
  ok('…and nothing is cropped or stretched', !/object-fit:\s*cover/.test(src));
  ok('the original is kept so the change can be undone',
    /imageOriginal/.test(src) && /--revert/.test(src));
  ok('it will not process its own output twice', /imageNormalized/.test(src));
  ok('it leaves generated art and built-in icons alone', /isUpload/.test(src));
  // Upscaling does not create detail; saying so is part of the job.
  ok('it reports which uploads are too small to be sharp', /narrower than 400px/.test(src));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} product images: ${pass} passed, ${fail} failed`);
srv.close();
process.exit(fail ? 1 : 0);
