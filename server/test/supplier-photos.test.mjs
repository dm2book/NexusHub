/**
 * "Make it find pictures for the products by itself."
 *
 * The part that is easy to get right is finding A picture. What these
 * assertions are about is finding the RIGHT one, and never taking the owner's:
 *
 *   a photo prints its product — a 10,000 Robux card beside a 1,000 Robux
 *   price is the shop advertising one thing and selling another;
 *   an Xbox card or an account listing is a different product with the same
 *   number on it;
 *   an SVG, a 20 MB file or an http link is not something to store;
 *   and a picture somebody uploaded, or the shop's own artwork, stays.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { run, get, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { createProduct, getProduct } = await import('../src/services/productService.js');
const { finalizeLogin } = await import('../src/services/authService.js');
const photos = await import('../src/services/supplier/supplierImageService.js');

/* One real PNG header is enough to be an image; the bytes after it are filler. */
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452000000100000001008060000001ff3ff61', 'hex'),
  Buffer.alloc(64, 1)]);
const response = (body, type, status = 200, extra = {}) => ({
  ok: status < 400, status,
  headers: { get: (h) => ({ 'content-type': type, ...extra })[h.toLowerCase()] ?? null },
  arrayBuffer: async () => body,
});

console.log('\n— What still needs a photo —');
{
  ok('no picture at all', photos.needsPhoto({ metadata: {} }));
  ok('the drawn placeholder tile', photos.needsPhoto({ image: '/api/products/prd_1/tile.svg', metadata: {} }));
  ok('a picture marked as generated', photos.needsPhoto({ metadata: { image: '/x.svg', imageSource: 'generated' } }));
  ok('NOT the shop\'s own shipped artwork',
    !photos.needsPhoto({ metadata: { image: '/products/art/apex-1000.svg', imageSource: 'matched-art' } }));
  ok('NOT a picture the owner uploaded', !photos.needsPhoto({ metadata: { image: '/api/images/abc.png' } }));
}

console.log('\n— The right photo, not just a photo —');
{
  const product = { name: '1,000 Robux' };
  const found = [{ supplier: { id: 's1', name: 'Kinguin' }, candidates: [
    { name: 'Roblox 10000 Robux Card', image: 'https://cdn.test/10000.png', status: 'in_stock' },
    { name: 'Roblox 1000 Robux XBOX Card', image: 'https://cdn.test/xbox.png', status: 'in_stock' },
    { name: 'Roblox 1000 Robux Account', image: 'https://cdn.test/acct.png', status: 'in_stock' },
    { name: 'Roblox 1000 Robux', image: 'http://cdn.test/plain-http.png', status: 'in_stock' },
    { name: 'Roblox 1000 Robux Card', image: 'https://cdn.test/sold-out.png', status: 'out_of_stock' },
    { name: 'Roblox 1000 Robux Gift Card', image: 'https://cdn.test/right.png', status: 'in_stock' },
  ] }];
  const pick = photos.pickPhoto(product, found);
  ok('the listing that is certainly this product, in stock', pick?.url === 'https://cdn.test/right.png',
    JSON.stringify(pick));
  ok('never the ten-times-the-amount card', photos.pickPhoto(product, [{ supplier: found[0].supplier,
    candidates: [found[0].candidates[0]] }]) === null);
  ok('a product with no amount gets no guessed photo',
    photos.pickPhoto({ name: 'Spotify Premium' }, [{ supplier: found[0].supplier,
      candidates: [{ name: 'Spotify Premium 12 Months', image: 'https://cdn.test/s.png', status: 'in_stock' }] }]) === null);
}

console.log('\n— What is downloaded, and what is refused —');
{
  const fetchOk = async () => response(PNG, 'image/png');
  const got = await photos.downloadImage('https://cdn.test/a.png', { fetchImpl: fetchOk });
  ok('a PNG is taken', got.mime === 'image/png' && got.bytes.length === PNG.length);

  const refuse = async (url, fetchImpl) => {
    try { await photos.downloadImage(url, { fetchImpl }); return null; } catch (e) { return e.message; }
  };
  ok('an SVG is refused', /not a photo/.test(await refuse('https://cdn.test/a.svg',
    async () => response(Buffer.from('<svg/>'), 'image/svg+xml'))));
  ok('an http link is refused', /https/.test(await refuse('http://cdn.test/a.png', fetchOk)));
  ok('a file over 3 MB is refused before it is read', /3 MB/.test(await refuse('https://cdn.test/big.png',
    async () => response(PNG, 'image/png', 200, { 'content-length': String(20 * 1024 * 1024) }))));
  ok('a 404 says so', /404/.test(await refuse('https://cdn.test/gone.png', async () => response(Buffer.alloc(0), 'text/html', 404))));
}

console.log('\n— Against the catalogue —');
{
  const stamp = Date.now();
  const mk = (name, metadata = {}) => createProduct({ name, sku: `PH-${name.replace(/\W+/g, '')}-${stamp}`,
    category: 'robux', price: 1299, currency: 'EUR', active: true, announce: false, metadata });
  const bare = await mk('1,000 Robux');
  const tiled = await mk('2,800 V-Bucks', { image: '/api/products/x/tile.svg', imageSource: 'generated' });
  const owned = await mk('500 Coins', { image: '/api/images/0123456789abcdef0123456789abcdef.png' });
  const lonely = await mk('1,000 Riot Points');

  const connector = { supportsSearch: true, searchCatalog: async (term) => [
    { name: 'Roblox 1000 Robux Gift Card', image: 'https://cdn.test/robux.png', status: 'in_stock' },
    { name: 'Fortnite 2800 V-Bucks Card', image: 'https://cdn.test/vbucks.png', status: 'in_stock' },
    { name: 'Coins 500', image: 'https://cdn.test/coins.png', status: 'in_stock' },
  ].filter((c) => c.name.toLowerCase().includes(String(term).toLowerCase().split(' ').pop())) };
  const sources = [{ supplier: { id: 'sup_x', name: 'Kinguin' }, connector }];
  const fetchImpl = async () => response(PNG, 'image/png');

  const dry = await photos.findPhotos([bare.id, tiled.id, owned.id, lonely.id], { sources, fetchImpl });
  const st = (p, out = dry) => out.rows.find((r) => r.productId === p.id)?.status;
  ok('a product with no picture gets a proposal', st(bare) === 'found', JSON.stringify(dry.rows));
  ok('…and so does one with a drawn tile', st(tiled) === 'found');
  ok('an owner\'s own upload is kept', st(owned) === 'kept');
  ok('nothing is written on the first press', !(await getProduct(bare.id)).image);

  const done = await photos.findPhotos([bare.id, tiled.id, owned.id, lonely.id], { sources, fetchImpl, apply: true });
  const b = await getProduct(bare.id);
  ok('applying stores the photo in the shop\'s own image store', /^\/api\/images\/[a-f0-9]{32}\.png$/.test(b.image || ''),
    String(b.image));
  ok('…and notes where it came from', b.metadata.imageSource === 'supplier' && b.metadata.imageFrom === 'Kinguin');
  ok('the drawn tile is upgraded', /^\/api\/images\//.test((await getProduct(tiled.id)).image || ''));
  ok('the owner\'s upload is untouched',
    (await getProduct(owned.id)).image === '/api/images/0123456789abcdef0123456789abcdef.png');
  ok('a product nobody carries says so', st(lonely, done) === 'none');
  ok('two photos were applied', done.applied === 2, String(done.applied));

  /* The nightly sweep must move on, not ask about the same product every night. */
  const queue = await photos.photoQueue({ limit: 1000 });
  ok('a product looked for today is not looked for again tonight', !queue.includes(lonely.id));
  ok('…but a person pressing the button still gets it',
    (await photos.photoQueue({ limit: 1000, ignoreBackoff: true })).includes(lonely.id));
  ok('…and in two weeks the sweep tries again',
    (await photos.photoQueue({ limit: 1000, now: Date.now() + 15 * 86_400_000 })).includes(lonely.id));
}

console.log('\n— The nightly sweep, before and after a supplier exists —');
{
  const stamp = Date.now();
  const waiting = await createProduct({ name: '3,000 Gold', sku: `PH-GOLD-${stamp}`, category: 'robux',
    price: 999, currency: 'EUR', active: true, announce: false, metadata: {} });

  /* No supplier is active in this database. A sweep that marked every product
     "looked for" now would hold them back two weeks after the owner connects
     one. */
  const { setSetting, getSetting } = await import('../src/services/settingsService.js');
  await setSetting('photo_sweep_last_at', null);
  await run(`UPDATE suppliers SET status = 'inactive'`);
  const { runMaintenance } = await import('../src/services/maintenanceService.js');
  const s1 = await runMaintenance();
  ok('with no supplier the sweep looks at nothing', !s1.photosLooked && !s1.photosError, JSON.stringify({ l: s1.photosLooked, e: s1.photosError }));
  ok('…and marks nothing as looked for', !(await getProduct(waiting.id)).metadata.imageSearchAt);
  ok('…and does not start its daily clock', !(await getSetting('photo_sweep_last_at', null)));

  const direct = await photos.findPhotos([waiting.id], { apply: true, sources: [] });
  ok('asking with nobody to ask says so', direct.rows[0].status === 'none'
    && /no active supplier/.test(direct.rows[0].detail));
  ok('…and leaves the product free for the next sweep', !(await getProduct(waiting.id)).metadata.imageSearchAt);
}

console.log('\n— A product added by hand is never blank —');
{
  const id = newId('usr');
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at)
             VALUES (@id, @e, 'Owner', @at, @at)`, { id, e: `photos-${Date.now()}@test.local`, at: nowIso() });
  await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, 'owner', @at)
             ON CONFLICT DO NOTHING`, { u: id, at: nowIso() });
  const { accessToken } = await finalizeLogin(await get(`SELECT * FROM users WHERE id=@id`, { id }), {});
  const srv = createApp().listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const res = await fetch(`${base}/api/admin/products`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ name: '4,500 Gems', sku: `PH-NEW-${Date.now()}`, category: 'clash', price: 1999, currency: 'EUR' }),
  });
  const body = await res.json();
  srv.close();
  ok('the new product is created', res.status === 201, JSON.stringify(body).slice(0, 200));
  ok('…with a picture straight away', !!body.product?.image, String(body.product?.image));
  ok('…marked as a placeholder the sweep may upgrade', photos.needsPhoto(body.product || {}),
    JSON.stringify(body.product?.metadata));
}

console.log(`\n${fail ? '❌' : '✅'} supplier-photos: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
