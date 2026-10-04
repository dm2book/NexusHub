/**
 * The product discovery pipeline: find what the market sells that ForgeMarket
 * does not, and add only what is safe.
 *
 *   normalisation reads two ways of writing one product as one product, and
 *   never merges a different platform, region, denomination or type;
 *   the catalogue check says ALREADY_EXISTS or MISSING_PRODUCT — the Robux
 *   example from the brief, exactly;
 *   the gate gives AUTO_APPROVE only at ≥ 98% match and ≥ 95% image, with a
 *   supplier in stock, a known cost and a safe price — and REVIEW_REQUIRED,
 *   DUPLICATE, UNAVAILABLE or UNSAFE_MATCH, with the reason, otherwise;
 *   pictures for another denomination or platform are refused;
 *   stale data, a source that cannot be asked and a source that times out are
 *   "unavailable", never "nobody sells it";
 *   requests are spaced per host;
 *   end to end: observations in, the safe product added and sellable, the rest
 *   in review, nothing duplicated, a product without a supplier never sellable.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV = 'development';
process.env.LAUNCH_MODE = 'open';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { parseTitle, GAMES } = await import('../src/services/market/normalize.js');
const GAMES_KEYS = new Set(GAMES.map((g) => g.key));
const G = await import('../src/services/discovery/gate.js');
const P = await import('../src/services/discovery/discoveryPipeline.js');
const A = await import('../src/services/discovery/catalogAuditService.js');
const ours = (name, extra = {}) => ({ product: { id: name, name, ...extra }, model: parseTitle(name) });

console.log('\n— Normalisation —');
{
  const a = parseTitle('EA FC 1600 Points PS5 EU'), b = parseTitle('FC Points 1600 PlayStation Europe');
  ok('"EA FC 1600 Points PS5 EU" and "FC Points 1600 PlayStation Europe" are one product', a.canonicalKey === b.canonicalKey, `${a.canonicalKey} | ${b.canonicalKey}`);
  ok('…with every dimension read', a.confidence === 1 && b.confidence === 1);
  ok('Xbox is another product (platform)', parseTitle('EA FC 1600 Points Xbox EU').canonicalKey !== a.canonicalKey);
  ok('US is another product (region)', parseTitle('EA FC 1600 Points PS5 US').canonicalKey !== a.canonicalKey);
  ok('2800 is another product (denomination)', parseTitle('EA FC 2800 Points PS5 EU').canonicalKey !== a.canonicalKey);
  ok('a subscription is not a gift card (type)', parseTitle('Xbox Game Pass Ultimate 1 Month EU').productType === 'subscription'
    && parseTitle('Xbox Gift Card €25 EU').productType === 'giftcard');
  ok('Robux carry no console: platform "any" when none is named', parseTitle('Roblox 1000 Robux Global').platform === 'any');
  ok('…but EA FC points with no platform stay unknown — a person decides', parseTitle('EA FC 1600 Points EU').platform === 'unknown');
  ok('the brief\'s list is recognised: Google Play, Apple, Game Pass, PUBG UC, NL region', parseTitle('Google Play €25 NL').game === 'google-play'
    && parseTitle('App Store & iTunes €25 NL').game === 'apple' && parseTitle('Xbox Game Pass 3 Months').game === 'xbox-game-pass'
    && parseTitle('PUBG Mobile 660 UC Global').productType === 'points' && parseTitle('Steam Wallet €20 NL').region === 'nl');
  ok('a year of a subscription is twelve months, never the same product as one month',
    parseTitle('Discord Nitro — 1 Year').denomination === 12 && parseTitle('Discord Nitro — 1 Month').denomination === 1
    && A.findDuplicates([ours('Discord Nitro — 1 Year'), ours('Discord Nitro — 1 Month')]).length === 0);
  ok('the live catalogue\'s own names read: PlayStation Store €25, CP — Call of Duty, Amazon',
    parseTitle('PlayStation Store €25').game === 'playstation-store' && parseTitle('9,500 CP — Call of Duty').productType === 'points'
    && parseTitle('Amazon Gift Card €25').game === 'amazon');
  ok('names in the shop\'s own style', P.productTitle(parseTitle('Roblox 4500 Robux Global')) === '4,500 Robux'
    && P.productTitle(parseTitle('Steam Wallet €20 EU')) === 'Steam Wallet €20 EU'
    && P.productTitle(parseTitle('EA FC 1600 Points PS5 EU')) === '1,600 FC Points PlayStation EU', P.productTitle(parseTitle('EA FC 1600 Points PS5 EU')));
  ok('a stable SKU from the identity', G.skuFor(parseTitle('Roblox 4500 Robux Global')) === 'ROBLOX-4500-ANY-GLOBAL');
}

console.log('\n— The brief\'s example: what exists, what is missing —');
{
  const catalogue = [ours('1,000 Robux'), ours('2,000 Robux')];
  const market = ['Roblox 400 Robux Global', 'Roblox 800 Robux Gift Card Global', 'Roblox 1000 Robux Global',
    'Roblox 2000 Robux Card Global', 'Roblox 4500 Robux Global', 'Roblox 10000 Robux Global'].map((t) => parseTitle(t));
  const verdicts = market.map((m) => [m.denomination, G.catalogMatch(m, catalogue).status]);
  const is = (d) => verdicts.find(([n]) => n === d)[1];
  ok('1000 and 2000 Robux: ALREADY_EXISTS', is(1000) === G.PRESENCE.ALREADY_EXISTS && is(2000) === G.PRESENCE.ALREADY_EXISTS, JSON.stringify(verdicts));
  ok('400, 800, 4500 and 10000 Robux: MISSING_PRODUCT', [400, 800, 4500, 10000].every((d) => is(d) === G.PRESENCE.MISSING_PRODUCT));
  const keys = new Set(market.map((m) => m.canonicalKey));
  ok('no duplicates: six listings, six products', keys.size === 6);
  const ps = [ours('1,600 FC Points', { }), { product: { id: 'ps', name: '1,600 FC Points PS' }, model: parseTitle('EA FC 1600 Points PS5 EU') }];
  ok('our PlayStation points do not hide the Xbox ones', G.catalogMatch(parseTitle('EA FC 1600 Points Xbox EU'), [ps[1]]).status === G.PRESENCE.MISSING_PRODUCT);
  const near = G.catalogMatch(parseTitle('EA FC 1600 Points Xbox EU'), [{ product: { name: 'x' }, model: parseTitle('EA FC 1600 Points PS5 EU') }]).near;
  ok('…and the near-miss is named for a person', near?.field === 'platform' && near.ours === 'playstation' && near.theirs === 'xbox');
  ok('duplicates inside our own catalogue are found', A.findDuplicates([ours('1,000 Robux'), ours('1000 Robux'), ours('2,000 Robux')]).length === 1);
}

console.log('\n— Pictures —');
{
  const m = parseTitle('Roblox 800 Robux Global');
  const good = G.imageConfidence({ sourceType: 'supplier', quality: 100, url: 'https://cdn.supplier.test/roblox-800-robux.png', model: m, otherDenominations: [400, 1000] });
  ok('supplier artwork, full quality, naming this amount: 95%', good.score === 0.95 && !good.mismatch, JSON.stringify(good));
  const other = G.imageConfidence({ sourceType: 'supplier', quality: 100, url: 'https://cdn.supplier.test/roblox-1000-robux.png', model: m, otherDenominations: [400, 1000] });
  ok('a picture of another denomination is refused', other.score === 0 && /1000/.test(other.mismatch));
  const fc = parseTitle('EA FC 1600 Points PS5 EU');
  const xbox = G.imageConfidence({ sourceType: 'supplier', quality: 100, url: 'https://cdn.supplier.test/fc-points-xbox.png', model: fc });
  ok('a picture of another platform is refused', xbox.score === 0 && /xbox/.test(xbox.mismatch));
  ok('sizes in the address are not denominations', !G.numbersInUrl('https://cdn.test/img/1200x630/robux_w800.png').has(1200));
  const low = G.imageConfidence({ sourceType: 'supplier', quality: 30, url: 'https://cdn.supplier.test/roblox-800.png', model: m });
  ok('a low-resolution picture stays under the bar', low.score < G.AUTO_IMAGE && low.reasons.some((r) => /low quality/.test(r)));
  const market = G.imageConfidence({ sourceType: 'marketplace', quality: 100, url: 'https://cdn.market.test/roblox-800.png', model: m });
  ok('a marketplace listing\'s picture never reaches auto-approve on its own', market.score < G.AUTO_IMAGE);
  const generic = G.imageConfidence({ sourceType: 'supplier', quality: 100, url: 'https://cdn.supplier.test/roblox-card.png', model: m });
  ok('a picture not tied to this amount goes to review', generic.score < G.AUTO_IMAGE && generic.reasons.some((r) => /exact amount/.test(r)));
  ok('three crops from one stored picture: square, card, hero', JSON.stringify(P.cropsFor(1200, 900)) === JSON.stringify({
    square: { x: 150, y: 0, w: 900, h: 900 }, card: { x: 0, y: 0, w: 1200, h: 900 }, hero: { x: 0, y: 113, w: 1200, h: 675 } }));
}

console.log('\n— The gate —');
{
  const m = parseTitle('Roblox 800 Robux Global');
  const supplier = (verdict, best = {}) => ({ verdict, candidates: 1, best: { cost: 600, safe: true, inStock: true, ...best } });
  const base = { model: m, presence: { status: G.PRESENCE.MISSING_PRODUCT }, sources: ['g2a', 'kinguin'], inStockSources: ['g2a'],
    freshObservations: 2, supplier: supplier('ready'), categoryStatus: 'existing', image: { score: 0.95, reasons: [] } };
  ok('everything checks out: AUTO_APPROVE', G.gate(base).status === G.GATE.AUTO_APPROVE, JSON.stringify(G.gate(base)));
  const one = G.gate({ ...base, sources: ['g2a'] });
  ok('one source only (95% match): REVIEW_REQUIRED, and it says why', one.status === G.GATE.REVIEW_REQUIRED && one.reasons.some((r) => /match confidence 95%/.test(r)));
  ok('image at 94%: REVIEW_REQUIRED', G.gate({ ...base, image: { score: 0.94, reasons: [] } }).status === G.GATE.REVIEW_REQUIRED);
  ok('the threshold is 98% / 95%, not less', G.AUTO_MATCH === 0.98 && G.AUTO_IMAGE === 0.95);
  ok('picture of another product: REVIEW_REQUIRED, picture rejected', G.gate({ ...base, image: { score: 0, mismatch: 'another denomination' } }).reasons.some((r) => /picture rejected/.test(r)));
  ok('already sold: DUPLICATE', G.gate({ ...base, presence: { status: G.PRESENCE.ALREADY_EXISTS, product: { name: '800 Robux' } } }).status === G.GATE.DUPLICATE);
  ok('differs from ours only in a stated platform: DUPLICATE for a person', G.gate({ ...base, presence: { status: G.PRESENCE.MISSING_PRODUCT, near: { product: { name: 'x' }, field: 'platform', ours: 'playstation', theirs: 'xbox' } } }).status === G.GATE.DUPLICATE);
  ok('region US: UNSAFE_MATCH (does not redeem for a Dutch buyer)', G.gate({ ...base, model: parseTitle('Roblox 800 Robux US') }).status === G.GATE.UNSAFE_MATCH);
  const conflict = G.gate({ ...base, supplier: { verdict: 'check', candidates: 2, best: { safe: false, reasons: ['the listing is for Xbox only'] } } });
  ok('every supplier listing conflicts (supplier mismatch): UNSAFE_MATCH', conflict.status === G.GATE.UNSAFE_MATCH && /Xbox only/.test(conflict.reasons[0]));
  const noCost = G.gate({ ...base, supplier: supplier('ready', { cost: null }) });
  ok('cost unknown: REVIEW_REQUIRED', noCost.status === G.GATE.REVIEW_REQUIRED && noCost.reasons.includes('supplier cost unknown'));
  ok('loses money after BTW and fees: REVIEW_REQUIRED (unsafe pricing)', G.gate({ ...base, supplier: supplier('loss') }).reasons.some((r) => /loses money/.test(r)));
  ok('under the margin floor: REVIEW_REQUIRED (unsafe pricing)', G.gate({ ...base, supplier: supplier('thin') }).reasons.some((r) => /minimum margin/.test(r)));
  ok('no supplier at all: REVIEW_REQUIRED, not auto', G.gate({ ...base, supplier: null }).reasons.some((r) => /no supplier/.test(r)));
  ok('a category the shop does not have: REVIEW_REQUIRED', G.gate({ ...base, categoryStatus: 'new' }).status === G.GATE.REVIEW_REQUIRED);
  ok('identity incomplete: REVIEW_REQUIRED', G.gate({ ...base, model: parseTitle('EA FC 1600 Points EU') }).reasons.some((r) => /identity incomplete: platform/.test(r)));
  const stale = G.gate({ ...base, inStockSources: [], freshObservations: 0, supplier: null });
  ok('no observation in seven days: UNAVAILABLE — stale', stale.status === G.GATE.UNAVAILABLE && /stale/.test(stale.reasons[0]));
  const down = G.gate({ ...base, inStockSources: [], freshObservations: 0, supplier: null, sourceErrors: ['Kinguin: timed out after 10000 ms'] });
  ok('a source that could not be asked: UNAVAILABLE, and it says so', down.status === G.GATE.UNAVAILABLE && /could not be asked.*timed out/.test(down.reasons[0]));
  ok('out of stock everywhere: UNAVAILABLE', G.gate({ ...base, inStockSources: [], supplier: supplier('out_of_stock') }).status === G.GATE.UNAVAILABLE);
  ok('the suggested price never sits under the margin floor', G.suggestPrice({ costCents: 1000, marketMedianCents: 900, floorPrice: () => 1149, roundUp: (x) => x }) === 1149
    && G.suggestPrice({ costCents: 1000, marketMedianCents: 2000, floorPrice: () => 1149, roundUp: (x) => x, position: 0.98 }) === 1960);
  ok('no cost, no price', G.suggestPrice({ costCents: null, marketMedianCents: 2000, floorPrice: () => 1, roundUp: (x) => x }) === null);
}

console.log('\n— Rate limits and timeouts —');
{
  let clock = 1000; const slept = [];
  const f = P.throttledFetch(async () => ({ ok: true }), { minIntervalMs: 1500, timeoutMs: 1000, now: () => clock, sleep: async (ms) => { slept.push(ms); clock += ms; } });
  P.resetThrottle();
  await f('https://api.kinguin.test/a'); await f('https://api.kinguin.test/b'); await f('https://api.g2a.test/c');
  ok('a second request to the same host waits its turn', slept.length === 1 && slept[0] === 1500, JSON.stringify(slept));
  ok('…another host does not wait for it', slept.length === 1);
  P.resetThrottle();
  const hang = P.throttledFetch(() => new Promise(() => {}), { minIntervalMs: 0, timeoutMs: 50 });
  const err = await hang('https://api.slow.test/x').then(() => null, (e) => e.message);
  ok('a source that does not answer times out with a reason', /timed out after 50 ms/.test(err || ''), err);
}

console.log('\n— End to end —');
{
  const { ensureReady } = await import('../src/app.js');
  await ensureReady();
  const { run, get, all, nowIso } = await import('../src/db/index.js');
  const { newId } = await import('../src/utils/ids.js');
  const { recordObservation } = await import('../src/services/market/observations.js');
  const { runDiscovery } = await import('../src/services/market/discovery.js');
  /* The shop sells 1,000 and 2,000 Robux, as in the brief. */
  await run(`DELETE FROM products WHERE category = 'robux' AND name NOT IN ('1,000 Robux', '2,000 Robux')`);
  const supId = newId('sup');
  await run(`INSERT INTO suppliers (id, name, connector_kind, status, config, created_at, updated_at) VALUES (@id, 'Kinguin', 'kinguin', 'active', '{}', @at, @at)`, { id: supId, at: nowIso() });

  const at = (msAgo) => new Date(Date.now() - msAgo).toISOString();
  const obs = (title, extra = {}) => recordObservation('g2a', { title, priceCents: 999, currency: 'EUR', availability: 'in_stock',
    url: `https://www.g2a.com/${encodeURIComponent(title)}`, observedAt: at(3_600_000), ...extra });
  for (const t of ['Roblox 400 Robux Global', 'Roblox 800 Robux Global', 'Roblox 1000 Robux Global', 'Roblox 2000 Robux Global',
    'Roblox 4500 Robux Global', 'Roblox 10000 Robux Global']) await obs(t, { priceCents: Number(t.match(/\d+/)[0]) * 1.6 }); // eslint-disable-line no-await-in-loop
  await obs('Roblox 1700 Robux US');                                           // a region a Dutch buyer cannot redeem
  await obs('Roblox 22500 Robux Global', { observedAt: at(10 * 86_400_000) }); // stale: ten days old

  /* A supplier that carries 400 (good art), 4500 (art for no particular amount) and 10000 (out of stock). Not 800. */
  const listing = (n, extra = {}) => ({ supplierSku: `kg-${n}`, name: `Roblox ${n} Robux Gift Card Global`, cost: Math.round(n * 0.9), status: 'in_stock',
    region: 'Global', image: `https://cdn.kinguin.test/roblox-${n}-robux.png`, ...extra });
  const connector = { searchCatalog: async (term) => {
    const n = Number((String(term).match(/\d[\d,]*/) || ['0'])[0].replace(/,/g, ''));
    return { 400: [listing(400)], 4500: [listing(4500, { image: 'https://cdn.kinguin.test/roblox-card.png' })], 10000: [listing(10000, { status: 'out_of_stock' })] }[n] || [];
  } };
  const supplierSources = [{ supplier: { id: supId, name: 'Kinguin', connector_kind: 'kinguin' }, connector }];
  const png = (w, h, size = 60_000) => { const b = Buffer.alloc(size); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
  const imageFetch = async () => new Response(png(1200, 1200), { status: 200, headers: { 'content-type': 'image/png' } });

  await runDiscovery();
  const ev = await P.evaluateCandidates({ supplierSources, imageFetch, limit: 50 });
  const byDen = async (d) => {
    const r = await get(`SELECT c.* FROM market_candidates c JOIN market_products p ON p.id = c.market_product_id WHERE p.game='roblox' AND p.denomination=@d`, { d });
    return r;
  };
  const g = async (d) => (await byDen(d))?.gate_status;
  ok('1000 and 2000 Robux: DUPLICATE of what the shop sells', await g(1000) === 'DUPLICATE' && await g(2000) === 'DUPLICATE', JSON.stringify(ev.map((e) => [e.title, e.status])));
  ok('400 Robux: AUTO_APPROVE (two sources, supplier art for this amount, cost known, safe price)', await g(400) === 'AUTO_APPROVE', JSON.stringify((await byDen(400))?.gate_reasons));
  ok('800 Robux: REVIEW_REQUIRED — no supplier carries it', await g(800) === 'REVIEW_REQUIRED' && /no supplier/.test((await byDen(800)).gate_reasons));
  ok('4500 Robux: REVIEW_REQUIRED — the picture is not tied to the amount', await g(4500) === 'REVIEW_REQUIRED' && /image confidence/.test((await byDen(4500)).gate_reasons));
  ok('10000 Robux: REVIEW_REQUIRED — the supplier is out of stock', await g(10000) === 'REVIEW_REQUIRED' && /out of stock/.test((await byDen(10000)).gate_reasons));
  ok('1700 Robux US: UNSAFE_MATCH', await g(1700) === 'UNSAFE_MATCH');
  ok('22500 Robux seen ten days ago: UNAVAILABLE — stale', await g(22500) === 'UNAVAILABLE' && /stale/.test((await byDen(22500)).gate_reasons));

  const c400 = await byDen(400);
  const img = JSON.parse(c400.image);
  ok('the picture is stored in the shop\'s own image store, with its provenance',
    /^\/api\/images\//.test(img.url) && img.sourceUrl === 'https://cdn.kinguin.test/roblox-400-robux.png' && img.sourceType === 'supplier'
    && img.width === 1200 && img.height === 1200 && img.mime === 'image/png' && img.confidence === 0.95 && !!img.lastChecked && !!img.crops?.square);
  const content = JSON.parse(c400.content);
  ok('content is generated: title, SKU, SEO, FAQ, delivery requirement', content.title === '400 Robux' && content.sku === 'ROBLOX-400-ANY-GLOBAL'
    && content.nl.seoTitle && content.nl.faq.length >= 3 && /gebruikersnaam/i.test(content.deliveryRequirement || ''), JSON.stringify(content).slice(0, 300));
  ok('suggested price, supplier cost and margin are on the row', Number(c400.suggested_price_cents) > 360 && Number(c400.supplier_cost_cents) === 360 && Number(c400.expected_margin_pct) >= 6);

  const added = await P.addAllSafe();
  const p400 = await get(`SELECT * FROM products WHERE name = '400 Robux'`);
  const meta = JSON.parse(p400?.metadata || '{}');
  ok('"Add all safe" adds exactly the AUTO_APPROVE product', added.added === 1 && !!p400, JSON.stringify(added));
  ok('…sellable: active, priced, mapped to the supplier at its cost', p400.active === 1 && Number(p400.price) === Number(c400.suggested_price_cents)
    && !!(await get(`SELECT 1 FROM supplier_products WHERE product_id=@p AND supplier_sku='kg-400' AND cost=360`, { p: p400.id })));
  ok('…with category, SKU, picture, description, SEO and platform/region', p400.category === 'robux' && p400.sku === 'ROBLOX-400-ANY-GLOBAL'
    && meta.image === img.url && meta.imageSource === 'supplier' && meta.platform === 'any' && meta.region === 'global'
    && p400.description.length > 100 && meta.content?.nl?.seoDescription);
  ok('…and nothing else was added automatically', (await all(`SELECT id FROM products WHERE metadata LIKE '%"source":"discovery"%'`)).length === 1);
  ok('running it again adds nothing twice', (await P.addAllSafe()).added === 0);
  const again = await P.evaluateCandidates({ supplierSources, imageFetch, limit: 50 });
  ok('…and the next evaluation reads 400 Robux as already sold', !again.find((e) => e.title === '400 Robux' && e.status !== 'DUPLICATE'));

  const c800 = await byDen(800);
  /* Wikimedia Commons, faked: a public-domain Roblox logo, and its PNG render. */
  process.env.DISCOVERY_LOGOS = 'on';
  const commonsCalls = [];
  const commons = async (url, opts) => {
    commonsCalls.push({ url: String(url), ua: opts?.headers?.['User-Agent'] });
    if (String(url).startsWith('https://upload.wikimedia.org/')) return new Response(png(800, 300), { status: 200, headers: { 'content-type': 'image/png' } });
    const page = (title, licence, extra = {}) => ({ title, imageinfo: [{ mime: 'image/svg+xml', width: 1000, height: 400,
      thumburl: `https://upload.wikimedia.org/thumb/${encodeURIComponent(title)}.png`, descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
      extmetadata: { LicenseShortName: { value: licence }, Artist: { value: '<a href="x">Roblox Corporation</a>' } }, ...extra }] });
    return new Response(JSON.stringify({ query: { pages: {
      1: page('File:Roblox Logo 2025.png', 'Public domain'),
      2: page('File:Roblox fan logo.svg', 'Public domain'),
      3: page('File:Roblox logo 2010.svg', 'Public domain'),
      4: page('File:Roblox logo alt.svg', 'CC BY-SA 4.0'),
    } } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const r800 = await P.addCandidate(c800.id, { actor: 'owner@test', logoFetch: commons });
  const p800 = await get(`SELECT * FROM products WHERE id=@id`, { id: r800.productId });
  ok('a person can add a REVIEW_REQUIRED product — without a supplier it is added HIDDEN', r800.created && !r800.sellable && p800.active === 0 && r800.hiddenReason === 'no supplier');
  const m800 = JSON.parse(p800.metadata);
  ok('…with no official picture it gets the brand\'s free-licence logo from Wikimedia Commons, not shop artwork',
    /^\/api\/images\//.test(m800.image) && m800.imageSource === 'licensed' && m800.imageLicence === 'Public domain'
    && /commons\.wikimedia\.org\/wiki\/File%3ARoblox%20Logo%202025\.png/.test(m800.imageSourceUrl) && m800.imageAuthor === 'Roblox Corporation'
    && m800.imageOfficial === false, JSON.stringify(m800).slice(0, 300));
  ok('…asked through the Commons API, identifying the shop', commonsCalls.some((c) => c.url.startsWith('https://commons.wikimedia.org/w/api.php')) && commonsCalls.every((c) => /ForgeMarket/.test(c.ua || '')));
  const L = await import('../src/services/discovery/commonsLogoService.js');
  const f = (title, licence, mime = 'image/svg+xml') => ({ title, licence, mime, thumbUrl: 'https://upload.wikimedia.org/x.png', width: 500 });
  ok('only public domain or CC0 is taken — not CC BY-SA, not unknown', !L.pickLogo([f('File:Steam logo.svg', 'CC BY-SA 4.0'), f('File:Steam logo 2.svg', '')], 'Steam')
    && L.pickLogo([f('File:Steam logo.svg', 'Public domain')], 'Steam')?.title === 'File:Steam logo.svg');
  ok('…and not a fan, old or unrelated file', !L.pickLogo([f('File:Steam fan logo.svg', 'Public domain'), f('File:Steam logo 2004.svg', 'Public domain'), f('File:Valve logo.svg', 'Public domain')], 'Steam'));
  const { updateProduct: up } = await import('../src/services/productService.js');
  const { createProduct: cp } = await import('../src/services/productService.js');
  const art = await cp({ name: '1,700 Robux', category: 'robux', price: 1999, announce: false, metadata: { image: '/products/icons/robux.svg', imageSource: 'artwork' } });
  const upl = await cp({ name: '3,000 Robux', category: 'robux', price: 2999, announce: false, metadata: { image: '/api/images/' + 'f'.repeat(32) + '.png', imageSource: 'upload' } });
  const lr = await L.applyLogos({ fetchImpl: commons });
  const artAfter = JSON.parse((await get('SELECT metadata FROM products WHERE id=@i', { i: art.id })).metadata);
  const uplAfter = JSON.parse((await get('SELECT metadata FROM products WHERE id=@i', { i: upl.id })).metadata);
  ok('shop artwork on existing products is replaced by the free logo', lr.applied >= 1 && artAfter.imageSource === 'licensed');
  ok('…an owner\'s upload is never touched', uplAfter.imageSource === 'upload' && uplAfter.image.endsWith('f'.repeat(32) + '.png'));
  const { needsPhoto } = await import('../src/services/supplier/supplierImageService.js');
  ok('…and a supplier\'s real picture may replace the logo later', needsPhoto({ metadata: artAfter }));
  const { mediaStatus } = await import('../src/services/productMediaService.js');
  ok('Product media still lists a logo as "missing an official picture", saying why', mediaStatus({ metadata: artAfter }).status === 'missing'
    && /free licence/.test(mediaStatus({ metadata: artAfter }).reasons[0]));
  delete process.env.DISCOVERY_LOGOS;
  const dupAdd = await P.addCandidate((await byDen(1000)).id, { actor: 'owner@test' }).then(() => 'added', (e) => e.status);
  ok('a DUPLICATE cannot be added', dupAdd === 409);
  const unsafeAuto = await P.addCandidate((await byDen(4500)).id, { actor: 'system', auto: true }).then(() => 'added', (e) => e.status);
  ok('the pipeline never auto-adds a REVIEW_REQUIRED product', unsafeAuto === 409);

  const c10k = await byDen(10000);
  await P.editCandidate(c10k.id, { title: '10,000 Robux (Global)', priceCents: 99 }, { actor: 'owner@test' });
  const r10k = await P.addCandidate(c10k.id, { actor: 'owner@test' });
  ok('an edited price under the margin floor is added hidden, never sellable', !r10k.sellable && ['supplier out of stock', 'price under the margin floor'].includes(r10k.hiddenReason));
  await P.rejectCandidate((await byDen(4500)).id, { actor: 'owner@test' });
  ok('reject is recorded and final', (await byDen(4500)).status === 'rejected');

  /* The catalogue audit sees the market's in-stock, fresh, sellable gaps. */
  const audit = await A.catalogueAudit();
  const robux = audit.categories.find((c) => c.category === 'robux');
  ok('the audit has every category and product', audit.totals.categories === audit.categories.length && audit.totals.products >= 70);
  /* 400 was added, 800 and 10000 were added hidden, 4500 was rejected; 1700 is US-only, 22500 stale. */
  ok('…and the Robux shelf\'s missing denominations come from fresh, sellable observations, not a list',
    robux.missingDenominations.map((d) => `${d.denomination}:${d.title}`).join() === '4500:4,500 Robux', JSON.stringify(robux.missingDenominations));
  ok('…a product with no supplier and no codes is flagged', robux.missingSupplier.some((x) => x.name === '1,000 Robux'));

  /* Sources with no credentials: reported, never worked around. */
  const { collectFromSources } = await import('../src/services/market/engine.js');
  let asked = 0;
  const col = await collectFromSources(['Roblox'], { fetchImpl: async () => { asked++; return new Response('{}'); } });
  ok('a source without partner credentials is UNAVAILABLE and is not fetched', asked === 0 && col.unavailable.some((u) => u.source === 'kinguin' && /Public pages are NOT a fallback/.test(u.reason)));

  /* Official packs the owner read on EA's store — the fix for "FIFA has only two". */
  const fcSrc = 'https://www.ea.com/games/ea-sports-fc/fc-points';
  const ref = await P.addReferenceDenominations({ game: 'ea-fc', platforms: ['playstation', 'xbox'], region: 'eu', sourceUrl: fcSrc, actor: 'owner@test',
    amounts: [{ denomination: 500, priceCents: 499 }, { denomination: 1600, priceCents: 1499 }, { denomination: 2800, priceCents: 2499 }] },
  { supplierSources: [], imageFetch });
  const fcRow = async (d, platform) => get(`SELECT c.* FROM market_candidates c JOIN market_products p ON p.id = c.market_product_id
    WHERE p.game='ea-fc' AND p.denomination=@d AND p.platform=@pl`, { d, pl: platform });
  ok('official packs are recorded per platform, with the page they came from', ref.recorded === 6
    && !!(await get(`SELECT 1 FROM market_observations WHERE source_key='official:ea' AND url=@u AND is_official=1`, { u: fcSrc })));
  ok('1,600 — which the shop already sells — is DUPLICATE on both platforms', (await fcRow(1600, 'playstation')).gate_status === 'DUPLICATE'
    && (await fcRow(1600, 'xbox')).gate_status === 'DUPLICATE');
  const fc500 = await fcRow(500, 'playstation');
  ok('500 and 2,800 are missing products, one per platform, for review — never automatic on one source',
    fc500.gate_status === 'REVIEW_REQUIRED' && (await fcRow(2800, 'xbox')).gate_status === 'REVIEW_REQUIRED'
    && /match confidence 95%/.test(fc500.gate_reasons), fc500.gate_reasons);
  ok("…named per platform in the shop's style", JSON.parse(fc500.content).title === '500 FC Points PlayStation EU', fc500.content?.slice(0, 80));
  const own = await P.addCandidate(fc500.id, { actor: 'owner@test', manualCostCents: 380 });
  const p500 = await get(`SELECT * FROM products WHERE id=@id`, { id: own.productId });
  const m500 = JSON.parse(p500.metadata);
  ok('the owner can deliver it themselves: sellable with their own cost, above the margin floor',
    own.sellable && p500.active === 1 && m500.deliveryMode === 'manual' && m500.costCents === 380 && Number(p500.price) >= 499, JSON.stringify(own));
  const hidden = await P.addCandidate((await fcRow(2800, 'xbox')).id, { actor: 'owner@test' });
  ok('without a supplier or an own cost it is added hidden', !hidden.sellable && hidden.hiddenReason === 'no supplier');
  const auto = await P.addCandidate((await fcRow(2800, 'playstation')).id, { actor: 'system', auto: true, manualCostCents: 100 }).then(() => 'added', (e) => e.status);
  ok('the automatic path never uses an own cost to add a review product', auto === 409);
  const badUrl = await P.addReferenceDenominations({ game: 'ea-fc', amounts: [{ denomination: 100, priceCents: 99 }], sourceUrl: 'http://x' }).then(() => 'ok', (e) => e.status);
  const badGame = await P.addReferenceDenominations({ game: 'nope', amounts: [{ denomination: 100, priceCents: 99 }], sourceUrl: fcSrc }).then(() => 'ok', (e) => e.status);
  ok('an entry needs the official https page and a game the parser knows', badUrl === 400 && badGame === 400);

  /* Search results (Brave Search API): which packs exist — never a price, stock or picture. */
  const S = await import('../src/services/discovery/searchSource.js');
  ok('a pack counts only next to the game\'s own unit — not a year, price or "FC 26"',
    S.extractMentions('EA SPORTS FC 26 – 2800 FC Points PS5, was €24.99', 'ea-fc').map((m) => m.denomination).join() === '2800'
    && S.extractMentions('FC 26 Points 18500 PlayStation', 'ea-fc').map((m) => m.denomination).join() === '18500');
  ok('one console named → that console; several or none → unknown, never a guess',
    S.extractMentions('5900 FC Points PS5', 'ea-fc')[0].platform === 'playstation'
    && S.extractMentions('5900 FC Points PS5 Xbox PC', 'ea-fc')[0].platform === 'unknown'
    && S.extractMentions('5900 FC Points', 'ea-fc')[0].platform === 'unknown');
  ok('gift cards read €-amounts, subscriptions months and years', S.extractMentions('Google Play €15 en 50 euro', 'google-play').map((m) => m.denomination).join() === '15,50'
    && S.extractMentions('Nitro 3 months or 1 Year', 'discord').map((m) => m.denomination).join() === '3,12');
  const braveCalls = [];
  const brave = async (url, opts) => {
    braveCalls.push({ url, key: opts?.headers?.['X-Subscription-Token'] });
    const q = decodeURIComponent(new URL(url).searchParams.get('q'));
    if (/Robux/i.test(q)) return new Response('', { status: 429 });
    const results = /EA FC/.test(q) ? [
      { title: 'EA SPORTS FC 26 – 18500 FC Points <strong>PS5</strong>', url: 'https://shop-a.test/fc-18500-ps5', description: 'Buy 18,500 FC Points' },
      { title: 'FC 26 Points 18500 PlayStation', url: 'https://shop-b.test/p/18500', description: 'PS5 code' },
      { title: 'EA FC 26 – 250 FC Points PS5', url: 'https://shop-c.test/250', description: '' },
      { title: 'Win 99999 FC Points!', url: 'https://www.forgemarket.nl/blog', description: 'EA FC' },
      { title: 'Best gaming deals', url: 'https://shop-d.test/deals', description: 'EA FC 7777 FC Points PS5' },
    ] : [];
    return new Response(JSON.stringify({ web: { results } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const m1 = await S.collectMentions(['EA Sports FC', 'Roblox'], { fetchImpl: brave, credentials: { apiKey: 'test-key' } });
  ok('Brave is asked through its API with the key in X-Subscription-Token', braveCalls.length === 2 && braveCalls.every((a) => a.key === 'test-key' && a.url.startsWith('https://api.search.brave.com/res/v1/web/search')));
  ok('a rate-limited search (429) is an error with a reason, not "nothing found"', m1.errors.some((e) => /429/.test(e)));
  ok('without a key nothing is asked', (await S.collectMentions(['EA Sports FC'], { fetchImpl: async () => { throw new Error('asked'); }, credentials: {} })).skipped === 'no Brave Search API key');
  await runDiscovery();
  const fcm = async (d) => get(`SELECT p.id FROM market_products p WHERE p.game='ea-fc' AND p.denomination=@d AND p.platform='playstation'`, { d });
  ok('our own pages are never evidence, and the game must be in the result\'s title', !(await fcm(99999)) && !(await fcm(7777)));
  const ev18500 = await P.evaluateCandidates({ ids: [(await get(`SELECT id FROM market_candidates WHERE market_product_id=@p`, { p: (await fcm(18500)).id })).id], supplierSources: [], imageFetch });
  ok('18,500 FC Points on two websites: REVIEW_REQUIRED, "found only in search results"', ev18500[0].status === 'REVIEW_REQUIRED'
    && ev18500[0].reasons.some((r) => /found only in search results or research \(2 websites\)/.test(r)), JSON.stringify(ev18500[0].reasons));
  const ev250 = await P.evaluateCandidates({ ids: [(await get(`SELECT id FROM market_candidates WHERE market_product_id=@p`, { p: (await fcm(250)).id })).id], supplierSources: [], imageFetch });
  ok('250 FC Points on one website only: UNAVAILABLE — not enough evidence', ev250[0].status === 'UNAVAILABLE' && /only one website/.test(ev250[0].reasons[0]));
  ok('search results alone never reach auto-approve', ev18500[0].matchConfidence < G.AUTO_MATCH);

  /* Desk research: packs found by hand, with their pages, loaded as mentions. */
  const R = await import('../src/services/discovery/researchedPacks.js');
  const domainsOf = (urls) => new Set(urls.map((u) => new URL(u).hostname.replace(/^www\./, '')));
  ok('every researched pack names at least two different websites', R.RESEARCHED_PACKS.every((p) => domainsOf(p.sources).size >= 2),
    R.RESEARCHED_PACKS.filter((p) => domainsOf(p.sources).size < 2).map((p) => p.game).join());
  ok('…every game in it is one the parser knows, every region sellable', R.RESEARCHED_PACKS.every((p) => GAMES_KEYS.has(p.game) && G.SELLABLE_REGIONS.includes(p.region)));
  ok('…and it is dated, not "today"', R.RESEARCHED_AT === '2026-10-04T12:00:00Z');
  const before = (await get(`SELECT COUNT(*)::int AS n FROM market_mentions WHERE source_key='research'`)).n;
  const imp = await S.importResearch();
  const again2 = await S.importResearch();
  ok('the research loads once per version', imp.mentions > 100 && again2.skipped === 'already imported' && before === 0);
  ok('…dated when it was done', !!(await get(`SELECT 1 FROM market_mentions WHERE source_key='research' AND seen_at=@at`, { at: R.RESEARCHED_AT })));
  await runDiscovery();
  const valMp = await get(`SELECT id FROM market_products WHERE game='valorant' AND denomination=475`);
  const valC = await get(`SELECT id FROM market_candidates WHERE market_product_id=@p`, { p: valMp.id });
  const [val] = await P.evaluateCandidates({ ids: [valC.id], supplierSources: [], imageFetch });
  ok('475 Valorant Points (not sold yet) is a missing product for review, with its websites', val.status === 'REVIEW_REQUIRED'
    && val.reasons.some((r) => /research \(3 websites\)/.test(r)), JSON.stringify(val.reasons));
  const mnt = await get(`SELECT c.gate_status FROM market_candidates c JOIN market_products p ON p.id=c.market_product_id WHERE p.game='valorant' AND p.denomination=1000`);
  const [v1000] = await P.evaluateCandidates({ ids: [(await get(`SELECT c.id FROM market_candidates c JOIN market_products p ON p.id=c.market_product_id WHERE p.game='valorant' AND p.denomination=1000`)).id], supplierSources: [], imageFetch });
  ok('1,000 VP — which the shop sells — is recognised as a duplicate', v1000.status === 'DUPLICATE', JSON.stringify([mnt, v1000.status]));
  await run(`UPDATE market_mentions SET seen_at=@old WHERE source_key='research'`, { old: new Date(Date.now() - 100 * 86_400_000).toISOString() });
  const [stale] = await P.evaluateCandidates({ ids: [valC.id], supplierSources: [], imageFetch });
  ok('after 90 days the research no longer counts: stale', stale.status === 'UNAVAILABLE', JSON.stringify(stale.reasons));
  delete process.env.DISCOVERY_RESEARCH;
  ok('outside production it loads only when asked (DISCOVERY_RESEARCH=on)', P.researchEnabled() === false);

  /* A remote database answers in ~0.1 s: every step must stop on time and resume. */
  const slowRun = await runDiscovery({ deadline: Date.now() - 1 });
  ok('the classify run stops at its deadline and says how much is left', slowRun.classified === 0 && slowRun.remaining > 0, JSON.stringify(slowRun));
  await run(`DELETE FROM kv WHERE key LIKE 'discovery.research.%'`);
  const part = await S.importResearch({ deadline: Date.now() - 1 });
  ok('the research import stops at its deadline and resumes, never half-marked done', part.complete === false && part.next === 0
    && !(await get(`SELECT 1 FROM kv WHERE key='discovery.research.version'`)));
  const whole = await S.importResearch({ deadline: Date.now() + 60_000 });
  ok('…and finishes in later steps', whole.complete === true && (await S.importResearch()).skipped === 'already imported');

  const { classifyNew } = await import('../src/services/market/discovery.js');
  await run(`INSERT INTO market_products (id, canonical_key, product_type, game, edition, platform, region, denomination, denom_unit, quantity, title, created_at, updated_at)
             VALUES ('mkp_bulk1','points:roblox:-:any:global:123456:robux:1','points','roblox','','any','global',123456,'robux',1,'Roblox 123456',@at,@at)`, { at: new Date().toISOString() });
  const bulk = await classifyNew();
  ok('new market products get their candidates in one go', bulk.classified >= 1 && !!(await get(`SELECT 1 FROM market_candidates WHERE market_product_id='mkp_bulk1'`)));
  ok('…and a second call finds nothing new', (await classifyNew()).classified === 0);

  /* Add everything in review at once, priced from the shop's own prices. */
  const peer = (name, price, meta = {}) => ({ product: { name, price, active: 1, metadata: meta }, model: parseTitle(name) });
  const id = (x) => x;
  ok('points: the nearest own pack\'s price per unit, times this pack', G.estimateFromCatalogue(parseTitle('475 VP — Valorant'),
    [peer('1,000 VP — Valorant', 1000), peer('5,350 VP — Valorant', 4999)], { roundUp: id })?.priceCents === 475);
  ok('gift cards: the own cards\' price-to-value, times this face value', G.estimateFromCatalogue(parseTitle('Steam Wallet €20'),
    [peer('Steam Wallet €10', 1199), peer('Steam Wallet €25', 2799), peer('Steam Wallet €50', 5599)], { roundUp: id })?.priceCents === 2240);
  ok('no own product of that game: no estimate, never another game\'s price', G.estimateFromCatalogue(parseTitle('475 VP — Valorant'), [peer('1,000 Robux', 999)]) === null);
  ok('an estimated price is never the basis for the next estimate', G.estimateFromCatalogue(parseTitle('475 VP — Valorant'),
    [peer('1,000 VP — Valorant', 1000, { pricing: { estimated: true } })]) === null);
  await run(`UPDATE market_mentions SET seen_at=@at WHERE source_key='research'`, { at: R.RESEARCHED_AT.replace('2026-10-04', new Date().toISOString().slice(0, 10)) });
  await P.evaluateCandidates({ limit: 1000, supplierSources: [], imageFetch });
  const reviewBefore = (await get(`SELECT COUNT(*)::int AS n FROM market_candidates WHERE gate_status='REVIEW_REQUIRED' AND forge_product_id IS NULL AND status <> 'rejected'`)).n;
  let bulkAdd = { remaining: 1 }, live = 0, rounds = 0; const bulkErrors = [];
  while (bulkAdd.remaining && rounds < 50) { bulkAdd = await P.addAllReview({ actor: 'owner@test', deadline: Date.now() + 2_000 }); live += bulkAdd.live; bulkErrors.push(...bulkAdd.errors); rounds++; }
  if (bulkErrors.length) console.log('bulk errors', bulkErrors); // eslint-disable-line no-await-in-loop
  ok('"add all" takes every review product, in steps, until none are left', reviewBefore > 10 && bulkAdd.remaining === 0, JSON.stringify({ reviewBefore, bulkAdd, rounds }));
  const est = await get(`SELECT p.* FROM products p WHERE p.metadata LIKE '%"estimated":true%' AND p.active = 1 ORDER BY p.created_at LIMIT 1`);
  const estMeta = JSON.parse(est?.metadata || '{}');
  ok('…live, priced from the shop\'s own prices, marked "estimated, cost unknown"', live > 0 && !!est && Number(est.price) > 0
    && estMeta.pricing?.costUnknown === true && /prijs/.test(estMeta.pricing?.basis || ''), JSON.stringify({ live, name: est?.name, price: est?.price, pricing: estMeta.pricing }));
  ok('…on the shop\'s own price endings', [49, 99].includes(Number(est.price) % 100));
  const list2 = await P.discoveryList();
  ok('nothing in review is left behind', list2.counts.REVIEW_REQUIRED === 0, JSON.stringify(list2.items.filter((i) => i.gate === 'REVIEW_REQUIRED' && !i.productId && i.status !== 'rejected').map((i) => [i.title, i.status, i.productId])));

  /* The complete scan: as long as it takes, in steps that each fit a server function. */
  await obs('Roblox 1200 Robux Global');
  const start = await P.startFullScan({ actor: 'owner@test' });
  ok('a complete scan takes every search term, uncapped', start.queries.length >= 20 && start.phase === 'collect');
  ok('…and asking to start again while it runs returns the same scan', (await P.startFullScan({ actor: 'x' })).id === start.id);
  let st, steps = 0;
  const seen = [];
  do {
    // eslint-disable-next-line no-await-in-loop
    st = await P.fullScanStep({ budgetMs: 15, supplierSources, imageFetch, autoAdd: true });
    seen.push(`${st.phase}:${st.qi}:${st.ei}`); steps++;
  } while (st.phase !== 'done' && steps < 500);
  ok('…it runs in several resumable steps and finishes', st.phase === 'done' && steps > 1, `${steps} steps, ${st.phase}`);
  ok('…every search term was asked, every open candidate evaluated', st.qi === st.totalQueries && st.ei === st.totalCandidates && st.totalCandidates >= 1);
  ok('…progress only moves forward', seen.every((x, i) => i === 0 || Number(x.split(':')[1]) >= Number(seen[i - 1].split(':')[1])));
  ok('…the new 1,200 Robux was found and judged', !!(await byDen(1200))?.gate_status);
  ok('…and sources it may not ask are listed, not worked around', st.unavailable.some((u) => u.source === 'kinguin'));
  ok('…when done, a new scan can start', (await P.startFullScan({ actor: 'x' })).id !== start.id);

  /* Maintenance runs hourly; the category batch must not. */
  await run(`DELETE FROM kv WHERE key LIKE 'discovery.job.%'`);
  const first = await P.scheduledDiscovery({ now: Date.now(), deadline: Date.now() + 5000, supplierSources: [], imageFetch });
  const hourLater = await P.scheduledDiscovery({ now: Date.now() + 3_600_000, deadline: Date.now() + 5000, supplierSources: [], imageFetch });
  const dayLater = await P.scheduledDiscovery({ now: Date.now() + 25 * 3_600_000, deadline: Date.now() + 5000, supplierSources: [], imageFetch });
  ok('the scheduled category batch runs once a day, not every hourly maintenance run',
    !!first.categories && !hourLater.categories && !!dayLater.categories, JSON.stringify({ first: !!first.categories, hourLater: !!hourLater.categories, dayLater: !!dayLater.categories }));

  const fs = await import('node:fs');
  const page = fs.readFileSync(new URL('../../src/pages/admin/ProductDiscovery.jsx', import.meta.url), 'utf8');
  ok('the admin page runs the complete scan step by step', /full\/step/.test(page) && page.includes('Volledige scan'));
  ok('…says plainly when no automatic source could be asked', page.includes('no-sources') && /niet dat er niets ontbreekt/.test(page));
  ok('…and takes official packs with their source page', page.includes('/api/admin/discovery/reference') && page.includes('Officiële pakketten invoeren'));
  ok('…and adds everything in review at once, showing the estimated price', page.includes('/api/admin/discovery/add-review') && page.includes('estimatedPrice'));
  ok('the admin screen has the actions from the brief', ['Approve & add', 'Reject', 'Edit', 'Add all safe', 'Re-scan category', 'Re-scan product'].every((t) => page.includes(t)));
}

console.log(`\n${fail ? '❌' : '✅'} product-discovery: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
