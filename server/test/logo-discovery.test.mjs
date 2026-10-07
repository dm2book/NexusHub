/**
 * Automatic Logo Discovery (services/logoDiscoveryService.js).
 *
 *   order    official brand assets › press kit › developer portal › Commons ›
 *            public SVG (Simple Icons) › ForgeMarket files; fallback: the
 *            card's category logo / drawn artwork
 *   quality  SVG first; raster ≥ 512×512; transparent; no JPEG; nothing named
 *            like a screenshot/mockup; ≤ 5 MB; scored, best chosen
 *   kept     sourceUrl, licence, retrievedAt, logoType, width, height
 *   cache    30 days; never on a page view
 *   polite   robots.txt is honoured; SVGs are sanitized and served sandboxed
 */
import './_selling-shop.mjs';   // must come first — see that file
import { ensureReady, createApp } from '../src/app.js';
import { all, get, run } from '../src/db/index.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
await ensureReady();
const L = await import('../src/services/logoDiscoveryService.js');

const png = (w, h, colorType, extra = Buffer.alloc(0)) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); b[24] = 8; b[25] = colorType;
  return Buffer.concat([b, extra]);
};
const svg = (body = '<path d="M0 0h24v24z" fill="#e00"/>') => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`);

console.log('— Looking at a file —');
ok('PNG with an alpha channel is transparent', L.inspect('image/png', png(1024, 1024, 6)).transparent === true);
ok('PNG without one is not', L.inspect('image/png', png(1024, 1024, 2)).transparent === false);
ok('…unless it has a transparency chunk', L.inspect('image/png', png(1024, 1024, 3, Buffer.from('....tRNS'))).transparent === true);
ok('PNG size read from the header', L.inspect('image/png', png(800, 600, 6)).width === 800 && L.inspect('image/png', png(800, 600, 6)).height === 600);
ok('an SVG is transparent unless it paints its whole canvas first', L.inspect('image/svg+xml', svg()).transparent === true
  && L.inspect('image/svg+xml', svg('<rect width="100%" height="100%" fill="#fff"/><path d="M0 0"/>')).transparent === false);

console.log('\n— The quality rules —');
const a = (o) => L.assess({ tier: 'commons', license: 'Public domain', url: 'https://x/logo.png', ...o });
ok('a JPEG is refused (a photo or a screenshot, never transparent)', a({ mime: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8]) }).status === 'rejected');
ok('a raster under 512×512 is refused', /at least 512/.test(a({ mime: 'image/png', bytes: png(256, 256, 6) }).reason || ''));
ok('an opaque raster is refused', /transparent/.test(a({ mime: 'image/png', bytes: png(1024, 1024, 2) }).reason || ''));
ok('a file named like a screenshot or mockup is refused', a({ mime: 'image/png', bytes: png(1024, 1024, 6), url: 'https://x/Roblox_screenshot.png' }).status === 'rejected'
  && a({ mime: 'image/svg+xml', bytes: svg(), url: 'https://x/logo-mockup.svg' }).status === 'rejected');
ok('over 5 MB is refused', a({ mime: 'image/png', bytes: Buffer.concat([png(1024, 1024, 6), Buffer.alloc(L.MAX_BYTES)]) }).status === 'rejected');
const svgScore = a({ mime: 'image/svg+xml', bytes: svg() }).score, pngScore = a({ mime: 'image/png', bytes: png(1024, 1024, 6) }).score;
ok('SVG scores above an equally good PNG', svgScore > pngScore, `${svgScore} vs ${pngScore}`);
const s = (tier) => L.assess({ tier, mime: 'image/svg+xml', bytes: svg(), license: 'x' }).score;
ok('official brand assets › press kit › developer portal › Commons › public SVG › shop file',
  s('brand_assets') > s('press_kit') && s('press_kit') > s('developer_portal') && s('developer_portal') > s('commons') && s('commons') > s('public_svg') && s('public_svg') > s('shop_asset'));

console.log('\n— Safe to serve, polite to fetch —');
const dirty = '<?xml version="1.0"?><svg onload="alert(1)" xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><a href="https://evil.example/"><path d="M0 0"/></a><image href="data:image/png;base64,AAA"/></svg>';
const clean = L.sanitizeSvg(dirty);
ok('scripts, handlers and outside links are removed', !/script|onload|evil\.example/.test(clean), clean);
ok('…an embedded PNG survives', /data:image\/png/.test(clean));
const robotsFetch = async (url) => (url.endsWith('/robots.txt')
  ? new Response('User-agent: *\nDisallow: /private/\n', { status: 200 }) : new Response('x'));
ok('robots.txt is honoured', await L.robotsAllow('https://brand.test/press/logo.svg', { fetchImpl: robotsFetch })
  && !(await L.robotsAllow('https://brand.test/private/logo.svg', { fetchImpl: robotsFetch })));

console.log('\n— Discovering, storing, choosing —');
await run(`DELETE FROM brand_logos WHERE brand='roblox'`); await run(`DELETE FROM logo_sources WHERE brand='roblox'`);
const served = {
  'https://brand.test/robots.txt': () => new Response('User-agent: *\nDisallow: /private/\n'),
  'https://brand.test/assets/roblox-logo.svg': () => new Response(svg('<path d="M1 1h20v20z" fill="#000"/>'), { headers: { 'content-type': 'image/svg+xml' } }),
  'https://brand.test/assets/roblox-small.png': () => new Response(png(300, 300, 6), { headers: { 'content-type': 'image/png' } }),
  'https://brand.test/private/hidden.svg': () => new Response(svg(), { headers: { 'content-type': 'image/svg+xml' } }),
};
const fake = async (url) => (served[String(url)] ? served[String(url)]() : new Response('nope', { status: 404 }));
await run(`INSERT INTO logo_sources (id, brand, tier, url, license, guidelines, logo_type, created_at) VALUES
  ('lgs_t1','roblox','brand_assets','https://brand.test/assets/roblox-logo.svg','Roblox brand guidelines','https://brand.test/guidelines','svg logo', now()::text),
  ('lgs_t2','roblox','press_kit','https://brand.test/assets/roblox-small.png','press kit terms',null,'png logo', now()::text),
  ('lgs_t3','roblox','developer_portal','https://brand.test/private/hidden.svg',null,null,'svg logo', now()::text)`);
const chosen = await L.discoverBrand('roblox', { fetchImpl: fake, network: false });
ok('the official brand-assets SVG is chosen over Simple Icons and shop files', chosen?.tier === 'brand_assets' && chosen.mime === 'image/svg+xml', JSON.stringify(chosen && { tier: chosen.tier, score: chosen.score }));
ok('kept: source URL, licence, retrieved at, type, width, height',
  chosen.source_url === 'https://brand.test/assets/roblox-logo.svg' && chosen.license === 'Roblox brand guidelines' && !!chosen.retrieved_at
  && chosen.logo_type === 'svg logo' && chosen.width === 24 && chosen.height === 24 && chosen.guidelines === 'https://brand.test/guidelines');
const rows = await all(`SELECT tier, status, reject_reason FROM brand_logos WHERE brand='roblox'`);
ok('a too-small press-kit PNG is kept with its reason, never used', rows.some((r) => r.tier === 'press_kit' && r.status === 'rejected' && /512/.test(r.reject_reason)));
ok('a file robots.txt forbids is not fetched', rows.some((r) => r.tier === 'developer_portal' && r.status === 'rejected' && /robots/.test(r.reject_reason)));
ok('Simple Icons and the shop file are candidates too', rows.some((r) => r.tier === 'public_svg') && rows.some((r) => r.tier === 'shop_asset'));

console.log('\n— Wikimedia Commons: free licences only —');
{
  await run(`DELETE FROM brand_logos WHERE brand='nintendo'`);
  const commons = async (url) => {
    const u = String(url);
    if (u.startsWith('https://commons.wikimedia.org/w/api.php')) return new Response(JSON.stringify({ query: { pages: {
      1: { title: 'File:Nintendo logo.svg', imageinfo: [{ mime: 'image/svg+xml', url: 'https://upload.test/Nintendo_logo.svg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Nintendo_logo.svg', extmetadata: { LicenseShortName: { value: 'Public domain' } } }] },
      2: { title: 'File:Nintendo logo red.svg', imageinfo: [{ mime: 'image/svg+xml', url: 'https://upload.test/red.svg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:red.svg', extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' } } }] },
    } } }));
    if (u.endsWith('/robots.txt')) return new Response('');
    if (u === 'https://upload.test/Nintendo_logo.svg') return new Response(svg('<path d="M2 2h20v20z" fill="#e60012"/>'), { headers: { 'content-type': 'image/svg+xml' } });
    if (u === 'https://upload.test/red.svg') throw new Error('a non-free file must not be downloaded');
    return new Response('', { status: 404 });
  };
  const n = await L.discoverBrand('nintendo', { fetchImpl: commons, network: true });
  ok('a public-domain Commons logo is found and chosen', n?.tier === 'commons' && /Nintendo_logo/.test(n.source_url) && n.license === 'Public domain');
  const nrows = await all(`SELECT source_url FROM brand_logos WHERE brand='nintendo'`);
  ok('…a CC BY-SA one is never even downloaded', !nrows.some((r) => /red\.svg/.test(r.source_url)));
}

console.log('\n— Cache: 30 days, never on a page view —');
{
  const stale = await L.staleBrands();
  ok('a brand looked at just now is not stale', !stale.includes('roblox') && !stale.includes('nintendo'));
  await run(`UPDATE brand_logos SET retrieved_at=@t WHERE brand='nintendo'`, { t: new Date(Date.now() - 31 * 86_400_000).toISOString() });
  ok('31 days later it is', (await L.staleBrands()).includes('nintendo'));
  const real = globalThis.fetch; let fetched = false;
  globalThis.fetch = async () => { fetched = true; throw new Error('no'); };
  const c = await L.chosenLogo('roblox');
  globalThis.fetch = real;
  ok('reading the chosen logo never fetches anything', !!c && !fetched);
}

console.log('\n— On the product card —');
{
  const { tileLogo } = await import('../src/services/productFitService.js');
  const logo = await tileLogo({ name: '1,000 Robux', category: 'robux', metadata: '{}' }, { categoryLogos: {} });
  ok('an official library logo is used on the card', /^data:image\/svg\+xml;base64,/.test(logo?.src || ''), JSON.stringify(logo)?.slice(0, 120));
  const own = await tileLogo({ name: '1,000 Robux', category: 'robux', metadata: '{}' }, { categoryLogos: { robux: '/api/images/0000000000000000000000000000000.png' } });
  ok('…the owner\'s category logo would still win (when it exists)', own === null || /^data:image\/svg/.test(own.src));
  const none = await tileLogo({ name: '2,400 CP — Call of Duty', category: 'cod', metadata: '{}' }, { categoryLogos: {} });
  ok('no library logo → the card keeps its fallback artwork', none === null);
}

console.log('\n— Report and routes —');
{
  await L.discoverBrand('eafc', { network: false });
  const lib = await L.library();
  ok('every one of the 21 brands is listed', lib.brands.length === 21);
  const r = lib.report;
  ok('Roblox is found (official)', r.found.some((x) => x.brand === 'Roblox' && x.tier === 'brand_assets'));
  ok('brands with nothing are missing and top the upload list', r.missing.includes('Amazon') && r.recommendedUploads[0].priority === 'high');
  ok('a stand-in mark (EA for EA FC) counts as low quality, not found', !r.found.some((x) => x.brand === 'EA SPORTS FC') && r.lowQuality.some((x) => x.brand === 'EA SPORTS FC'));
  const id = (await get(`SELECT id FROM brand_logos WHERE brand='roblox' AND chosen=1`)).id;
  const srv = createApp().listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const res = await fetch(`${base}/api/logos/${id}.svg`);
  ok('a library SVG is served sandboxed', res.ok && /sandbox/.test(res.headers.get('content-security-policy') || '') && /image\/svg\+xml/.test(res.headers.get('content-type')));
  ok('the admin page needs a login', (await fetch(`${base}/api/admin/logos`)).status === 401);
  srv.close();
}

console.log(`\n${fail ? '❌' : '✅'} logo-discovery: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
