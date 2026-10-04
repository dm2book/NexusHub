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
  ok('an upload nobody marked as official is missing', s({ image: '/api/images/' + 'b'.repeat(32) + '.png', imageSource: 'upload' }) === 'missing');
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
  ok('the report has the four counts and every active product',
    ['missing', 'low_quality', 'outdated', 'official'].every((k) => typeof rep.counts?.[k] === 'number') && rep.items.length === rep.total);
  ok('…worst first: missing before official', rep.items.findIndex((i) => i.status === 'missing') < rep.items.findIndex((i) => i.status === 'official'));
  ok('…not for a visitor', (await fetch(`${base}/media`)).status === 401);
  srv.close();
  const fs = await import('node:fs');
  const page = fs.readFileSync(new URL('../../src/pages/admin/ProductMedia.jsx', import.meta.url), 'utf8');
  ok('the admin page shows Missing, Outdated, Official and Low quality', ['Ontbreekt', 'Verouderd', 'Officieel', 'Lage kwaliteit'].every((t) => page.includes(t)));
}

console.log(`\n${fail ? '❌' : '✅'} product-media: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
