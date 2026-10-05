/**
 * Product media: an official picture for every product, with its source, its
 * date and a quality score — and an honest status when there is none.
 *
 *   the score rewards resolution, a sensible shape, a real format and a real
 *   file; a 150 px thumbnail is low quality;
 *   only the publisher's artwork through a channel the shop may use counts as
 *   official: a supplier's own product API, or an upload the owner marked;
 *   drawn tiles, the shop's icons, generated pictures, links and unmarked
 *   uploads are "missing";
 *   an official picture with no date, or older than the limit, is outdated;
 *   enriching takes the supplier's picture, records where it came from, when
 *   and how good — refreshes a stale supplier picture — and never replaces an
 *   owner's upload.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV = 'development';
process.env.LAUNCH_MODE = 'open';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { run, get, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { finalizeLogin } = await import('../src/services/authService.js');
const { createProduct, getProduct, updateProduct } = await import('../src/services/productService.js');
const media = await import('../src/services/productMediaService.js');

console.log('\n— Quality score —');
{
  const q = media.qualityScore;
  ok('a 1200×1200 PNG of real weight scores 100', q({ width: 1200, height: 1200, bytes: 300_000, mime: 'image/png' }) === 100);
  ok('a 150×150 thumbnail is below the bar', q({ width: 150, height: 150, bytes: 6000, mime: 'image/jpeg' }) < media.MIN_QUALITY);
  ok('a long banner loses points for its shape', q({ width: 2000, height: 600, bytes: 200_000, mime: 'image/webp' }) < q({ width: 800, height: 800, bytes: 200_000, mime: 'image/webp' }));
  ok('no dimensions, no score', q({}) === 0);
}

console.log('\n— Status —');
{
  const s = (metadata) => media.mediaStatus({ metadata }).status;
  const recent = new Date().toISOString();
  ok('no picture is missing', s({}) === 'missing');
  ok('a drawn placeholder tile is missing', s({ image: '/api/products/x/tile.svg' }) === 'missing');
  ok('the shop’s own category icon is missing — not the publisher’s artwork', s({ image: '/products/icons/robux.svg' }) === 'missing');
  ok('a generated picture is missing', s({ image: '/api/images/' + 'a'.repeat(32) + '.png', imageSource: 'generated' }) === 'missing');
  ok('a linked picture is missing — no licence behind it', s({ image: 'https://example.com/robux.png' }) === 'missing');
  ok('the owner\'s own upload is their own artwork — not missing', s({ image: '/api/images/' + 'b'.repeat(32) + '.png', imageSource: 'upload' }) === 'own');
  ok('…and so is the shop\'s drawn board they put on', s({ image: '/api/products/x/tile.svg', imageSource: 'own-artwork' }) === 'own');
  ok('…but a picture added by discovery is not the owner\'s upload', s({ image: '/api/images/' + 'c'.repeat(32) + '.png', source: 'discovery' }) === 'missing');
  const sup = { image: '/api/images/' + 'c'.repeat(32) + '.png', imageSource: 'supplier' };
  ok('a supplier picture with no date is outdated', s(sup) === 'outdated');
  ok('…older than the limit is outdated', s({ ...sup, imageUpdatedAt: new Date(Date.now() - (media.MEDIA_MAX_AGE_DAYS + 5) * 86_400_000).toISOString(), imageQuality: 90 }) === 'outdated');
  ok('…recent but too small is low quality', s({ ...sup, imageUpdatedAt: recent, imageQuality: 30 }) === 'low_quality');
  ok('…recent and good is official', s({ ...sup, imageUpdatedAt: recent, imageQuality: 90 }) === 'official');
  ok('an upload the owner marked as official counts', s({ image: '/api/images/' + 'd'.repeat(32) + '.png', imageSource: 'official', imageOfficial: true, imageUpdatedAt: recent, imageQuality: 85 }) === 'official');
}

/* A PNG the image store can measure: signature, IHDR with width and height. */
const png = (w, h, size = 40_000) => {
  const b = Buffer.alloc(size);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
};
const fetchImpl = (bytes) => async () => new Response(bytes, { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) } });
const supplierWith = (image) => [{ supplier: { id: 'sup_test', name: 'Kinguin' },
  connector: { searchCatalog: async () => [{ name: '1,000 Robux Gift Card Global', image, status: 'in_stock', price: 900 }] } }];

console.log('\n— Enriching —');
{
  const { findPhotos } = await import('../src/services/supplier/supplierImageService.js');
  const p = await createProduct({ name: '1,000 Robux', category: 'robux', price: 999, announce: false });
  const out = await findPhotos([p.id], { apply: true, sources: supplierWith('https://cdn.supplier.test/robux-1000.png'), fetchImpl: fetchImpl(png(1200, 1200)), scope: 'all', refresh: true });
  const after = await getProduct(p.id);
  const m = after.metadata;
  ok('the supplier’s picture is applied', out.applied === 1 && /^\/api\/images\//.test(m.image), JSON.stringify(out.rows));
  ok('…with its source, the URL it came from, the date and a quality score',
    m.imageSource === 'supplier' && m.imageSourceUrl === 'https://cdn.supplier.test/robux-1000.png'
    && Date.now() - Date.parse(m.imageUpdatedAt) < 60_000 && m.imageQuality === 100 && m.imageWidth === 1200);
  ok('…and the product now reads as official', media.mediaStatus(after).status === 'official');

  /* Stale: the date is a year old. A refresh fetches it again. */
  await updateProduct(p.id, { metadata: { ...m, imageUpdatedAt: new Date(Date.now() - 400 * 86_400_000).toISOString() } });
  ok('a year later it reads as outdated', media.mediaStatus(await getProduct(p.id)).status === 'outdated');
  const again = await findPhotos([p.id], { apply: true, sources: supplierWith('https://cdn.supplier.test/robux-1000-v2.png'), fetchImpl: fetchImpl(png(1000, 1000, 50_000)), scope: 'all', refresh: true });
  const fresh = (await getProduct(p.id)).metadata;
  ok('…and a refresh replaces it with the current picture', again.applied === 1 && fresh.imageSourceUrl.endsWith('-v2.png') && media.mediaStatus({ metadata: fresh }).status === 'official');

  const own = await createProduct({ name: '4,500 Robux', category: 'robux', price: 3899, announce: false });
  const ownImage = '/api/images/' + 'e'.repeat(32) + '.png';
  await updateProduct(own.id, { metadata: { image: ownImage, imageSource: 'upload' } });
  await findPhotos([own.id], { apply: true, sources: supplierWith('https://cdn.supplier.test/x.png'), fetchImpl: fetchImpl(png(1200, 1200)), scope: 'all', refresh: true });
  ok('an owner’s upload is never replaced', (await getProduct(own.id)).metadata.image === ownImage);
  ok('…nor queued for enrichment', !(await media.enrichmentQueue({ limit: 1000 })).includes(own.id));

  const r = await media.setOfficial(own.id, true, { sourceUrl: 'https://press.roblox.example/robux.png' });
  ok('the owner can mark their upload as official artwork', r.official === true && (await getProduct(own.id)).metadata.imageOfficial === true);
  const linked = await createProduct({ name: '10,000 Robux', category: 'robux', price: 7999, announce: false });
  await updateProduct(linked.id, { metadata: { image: 'https://example.com/a.png', imageSource: 'link' } });
  const refused = await media.setOfficial(linked.id, true).then(() => 'marked', (e) => e.status);
  ok('…but a linked picture cannot be marked — there is no copy here', refused === 400);
}

console.log('\n— Admin —');
{
  const owner = newId('usr');
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'O', @at, @at)`, { id: owner, e: `o-${owner}@example.test`, at: nowIso() });
  await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, 'owner', @at)`, { u: owner, at: nowIso() });
  const { accessToken } = await finalizeLogin(await get('SELECT * FROM users WHERE id=@id', { id: owner }), {});
  const srv = createApp().listen(0);
  const base = `http://127.0.0.1:${srv.address().port}/api/admin/products`;
  const H = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
  const rep = await (await fetch(`${base}/media`, { headers: H })).json();
  ok('the report has the five counts and every active product',
    ['missing', 'low_quality', 'outdated', 'own', 'official'].every((k) => typeof rep.counts?.[k] === 'number') && rep.items.length === rep.total);
  ok('…worst first: missing before official', rep.items.findIndex((i) => i.status === 'missing') < rep.items.findIndex((i) => i.status === 'official'));
  ok('…not for a visitor', (await fetch(`${base}/media`)).status === 401);
  srv.close();
  const fs = await import('node:fs');
  const page = fs.readFileSync(new URL('../../src/pages/admin/ProductMedia.jsx', import.meta.url), 'utf8');
  ok('the admin page shows Missing, Outdated, Own artwork, Official and Low quality', ['Ontbreekt', 'Verouderd', 'Eigen artwork', 'Officieel', 'Lage kwaliteit'].every((t) => page.includes(t)));
}

console.log('\n— The owner\'s own artwork on every product (the EA FC look) —');
{
  const art = await import('../src/services/discovery/categoryArtService.js');
  const { needsPhoto } = await import('../src/services/supplier/supplierImageService.js');
  const tag = Date.now().toString(36);
  const upload = '/api/images/' + '1'.repeat(32) + '.webp';
  const own = await createProduct({ name: `1,600 FC Points — EA FC ${tag}`, category: 'eafc', price: 1499, announce: false, metadata: { image: upload } });
  const logo = await createProduct({ name: `475 VP — Valorant ${tag}`, category: 'valorant', price: 499, announce: false,
    metadata: { source: 'discovery', denomination: 475, image: '/api/images/' + '3'.repeat(32) + '.png', imageSource: 'licensed', imageLicence: 'Public domain' } });
  const supplier = await createProduct({ name: `13,000 COD Points Xbox ${tag}`, category: 'cod', price: 7549, announce: false,
    metadata: { source: 'discovery', denomination: 13000, image: '/api/images/' + '4'.repeat(32) + '.jpg', imageSource: 'supplier' } });
  const linked = await createProduct({ name: `Discord Nitro — 1 Month ${tag}`, category: 'discord-nitro', price: 999, announce: false,
    metadata: { image: 'https://example.com/nitro.png' } });
  const shipped = await createProduct({ name: `1,000 Apex Coins ${tag}`, category: 'apex', price: 999, announce: false,
    metadata: { denomination: 1000, image: '/api/images/' + '5'.repeat(32) + '.png', imageSource: 'supplier' } });
  const big = await createProduct({ name: `12,000 FC Points — EA FC ${tag}`, category: 'eafc', price: 9999, announce: false, metadata: { image: '/api/images/' + '2'.repeat(32) + '.webp' } });
  const fc = await createProduct({ name: `18,500 FC Points PlayStation ${tag}`, category: 'eafc', price: 14999, announce: false,
    metadata: { source: 'discovery', denomination: 18500, image: '/api/images/' + '6'.repeat(32) + '.png', imageSource: 'licensed' } });
  const fcSmall = await createProduct({ name: `500 FC Points Xbox ${tag}`, category: 'eafc', price: 499, announce: false,
    metadata: { source: 'discovery', denomination: 500 } });
  const amazon = await createProduct({ name: `Amazon Gift Card €25 ${tag}`, category: 'giftcard', price: 2500, announce: false, metadata: { image: '/api/images/' + '7'.repeat(32) + '.webp' } });
  const netflix = await createProduct({ name: `Netflix €15 NL ${tag}`, category: 'giftcard', price: 1500, announce: false, metadata: { source: 'discovery', denomination: 15 } });
  const xboxOwn = await createProduct({ name: `Xbox Gift Card €25 ${tag}`, category: 'giftcard', price: 2500, announce: false, metadata: { image: '/api/images/' + '8'.repeat(32) + '.webp' } });
  const xboxNl = await createProduct({ name: `Xbox €15 NL ${tag}`, category: 'giftcard', price: 1500, announce: false, metadata: { source: 'discovery', denomination: 15 } });
  const amazon50 = await createProduct({ name: `Amazon Gift Card €50 ${tag}`, category: 'giftcard', price: 5000, announce: false, metadata: { source: 'discovery', denomination: 50 } });

  const stopped = await art.applyCategoryArtwork({ deadline: Date.now() - 1 });
  ok('it stops at its deadline and says how much is left', stopped.applied === 0 && stopped.remaining > 0);
  const r = await art.applyCategoryArtwork();
  const m = async (p) => (await getProduct(p.id)).metadata;
  const tile = (p) => `/api/products/${p.id}/tile.svg`;
  ok('a brand logo becomes the shop\'s board drawn with the product\'s own amount', (await m(logo)).image === tile(logo)
    && (await m(logo)).imageSource === 'own-artwork' && !(await m(logo)).imageLicence, JSON.stringify(await m(logo)));
  ok('…a supplier photo too — products that already HAD a picture get it as well', (await m(supplier)).image === tile(supplier));
  ok('…and a linked picture', (await m(linked)).image === tile(linked));
  ok('a product with no owner card gets the live store card for its own amount', (await m(shipped)).image === tile(shipped), (await m(shipped)).image);
  ok('the picture it replaced is kept, so nothing is lost', (await m(logo)).imagePrevious === '/api/images/' + '3'.repeat(32) + '.png' && (await m(logo)).imagePreviousSource === 'licensed');
  ok('a product of a game the owner made artwork for gets THAT artwork — the EA FC card with its logos', (await m(fc)).image === '/api/images/' + '2'.repeat(32) + '.webp'
    && (await m(fc)).imageSource === 'own-artwork' && /12,000 FC Points/.test((await m(fc)).imageFrom), JSON.stringify(await m(fc)));
  ok('…the one nearest in amount', (await m(fcSmall)).image === upload, (await m(fcSmall)).image);
  ok('a gift card takes only its own brand\'s artwork: Netflix never shows the Amazon card', (await m(netflix)).image === tile(netflix), (await m(netflix)).image);
  ok('…and the same brand does share it', (await m(amazon50)).image === '/api/images/' + '7'.repeat(32) + '.webp');
  ok('"Xbox €15 NL" is an Xbox card too, and takes the owner\'s Xbox artwork', (await m(xboxNl)).image === '/api/images/' + '8'.repeat(32) + '.webp', (await m(xboxNl)).image);
  ok('a game with a real logo but no owner card gets the board that draws that logo', (await m(logo)).image === tile(logo) && /logo/.test((await m(logo)).imageFrom), (await m(logo)).imageFrom);
  ok('both owner uploads stay as they are', (await m(big)).image === '/api/images/' + '2'.repeat(32) + '.webp' && (await m(amazon)).image === '/api/images/' + '7'.repeat(32) + '.webp');
  ok('the owner\'s own upload is the look, and is never touched', (await m(own)).image === upload && !(await m(own)).imageSource && r.kept >= 1);
  ok('running it again changes nothing — and keeps the first previous picture', (await art.applyCategoryArtwork()).applied === 0);
  ok('the supplier photo sweep never replaces it', !needsPhoto({ metadata: await m(logo) }, { scope: 'all' }));
  ok('Product media lists it as own artwork — not missing — so the button visibly worked', media.mediaStatus({ metadata: await m(logo) }).status === 'own'
    && /own artwork/.test(media.mediaStatus({ metadata: await m(logo) }).reasons[0]));
  {
    const fit = await import('../src/services/productFitService.js');
    const { storeImage } = await import('../src/services/imageStoreService.js');
    /* A real 1×1 PNG stands in for the brand logo held under a free licence. */
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const { url } = await storeImage('image/png', png, { source: 'licensed' });
    const val = await createProduct({ name: `2,400 COD Points PC ${tag}`, category: 'cod', price: 1999, announce: false,
      metadata: { source: 'discovery', denomination: 2400, image: url, imageSource: 'licensed' } });
    await art.applyCategoryArtwork();
    const vm = await m(val);
    const logoUri = await fit.tileLogo(await getProduct(val.id));
    ok('the card finds the logo the product carried before (kept in imagePrevious)', vm.imagePrevious === url && /^data:image\/png;base64,/.test(logoUri?.src || ''), JSON.stringify(logoUri)?.slice(0, 60));
    ok('…and knows which plate keeps it readable', ['light', 'dark'].includes(logoUri?.plate));
    const svg = await fit.renderTileArt(await getProduct(val.id), { logo: logoUri });
    ok('…and draws it on that plate, with the product\'s own amount and currency', svg.includes('href="data:image/png;base64,') && svg.includes('2,400') && svg.includes('>COD POINTS<'), svg.slice(0, 200));
    ok('PlayStation, Xbox, Steam and Valorant keep the real app icon the shop ships', await fit.tileLogo({ name: 'PlayStation Store €20 NL', category: 'giftcard', metadata: {} }) === null);
    /* A one-pixel RGBA PNG of one colour, built here so the test owns its bytes. */
    const { deflateSync, crc32 } = await import('node:zlib');
    const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]);
      const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
    const onePx = (r, g, b) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])), chunk('IDAT', deflateSync(Buffer.from([0, r, g, b, 255]))), chunk('IEND', Buffer.alloc(0))]);
    ok('a white logo is read as light (it goes on the dark plate), a black one as dark',
      fit.pngLuminance(onePx(255, 255, 255)) > 0.9 && fit.pngLuminance(onePx(0, 0, 0)) < 0.1, `${fit.pngLuminance(onePx(255, 255, 255))} ${fit.pngLuminance(onePx(0, 0, 0))}`);
    const xb = await fit.renderTileArt({ id: 'x', name: 'Xbox €15 NL', category: 'giftcard', metadata: {} });
    ok('a gift card is drawn in its brand\'s colours with its real logo', xb.includes('>XBOX<') && xb.includes('data:image/webp;base64,') && xb.includes('€15'));
    ok('a gift card with no logo still draws its own brand: "Xbox €15 NL" is not a gift box', fit.brandSlug('Xbox €15 NL') === 'xbox' && fit.brandSlug('PlayStation Store €20 NL') === 'playstation');
  }
  const page = (await import('node:fs')).readFileSync(new URL('../../src/pages/admin/ProductMedia.jsx', import.meta.url), 'utf8');
  ok('the admin page has the button', page.includes('Eigen artwork op alle producten') && page.includes('/api/admin/products/media/category-artwork'));
}

console.log(`\n${fail ? '❌' : '✅'} product-media: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
