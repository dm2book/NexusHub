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

const { parseTitle } = await import('../src/services/market/normalize.js');
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
  const r800 = await P.addCandidate(c800.id, { actor: 'owner@test' });
  const p800 = await get(`SELECT * FROM products WHERE id=@id`, { id: r800.productId });
  ok('a person can add a REVIEW_REQUIRED product — without a supplier it is added HIDDEN', r800.created && !r800.sellable && p800.active === 0 && r800.hiddenReason === 'no supplier');
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

  const fs = await import('node:fs');
  const page = fs.readFileSync(new URL('../../src/pages/admin/ProductDiscovery.jsx', import.meta.url), 'utf8');
  ok('the admin screen has the actions from the brief', ['Approve & add', 'Reject', 'Edit', 'Add all safe', 'Re-scan category', 'Re-scan product'].every((t) => page.includes(t)));
}

console.log(`\n${fail ? '❌' : '✅'} product-discovery: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
