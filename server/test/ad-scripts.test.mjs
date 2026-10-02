/**
 * Viral ad scripts: 10 hooks, 10 scripts, 10 CTAs per product across eight
 * hook kinds, scored — built only from real products, orders, prices and
 * delivery times.
 *
 * Mostly about what must NOT come out:
 *   "shop now", ever; "best prices" or "instant delivery" without proof;
 *   a sales count or a delivery time that did not happen — refunds, test
 *   payments, giveaways and unpaid orders count for nothing;
 *   a delivery time that includes the minutes the buyer took to pay;
 *   a comparison with a competitor who is actually cheaper;
 *   "code in je mail" for Robux, which goes onto an account by username;
 *   filler to reach ten when there is nothing true left to say.
 */
import './_selling-shop.mjs';   // must come first — see that file
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
const { finalizeLogin } = await import('../src/services/authService.js');
const { createProduct } = await import('../src/services/productService.js');
const { addProductCodes } = await import('../src/services/codeStockService.js');
const { recordObservation } = await import('../src/services/market/observations.js');
const ads = await import('../src/services/adScriptService.js');

const stamp = Date.now();
const MIN = 60_000;
const BANNED = /\b(shop now|buy now|koop nu|bestel nu|nu kopen|best(e)? (price|prices|prijs|prijzen)|goedkoopste|cheapest|instant\w*|direct geleverd|binnen seconden|unbeatable|limited time|beperkte tijd|100% (legit|veilig)|gegarandeerd)\b/i;
const allText = (r) => [
  ...r.hooks.map((h) => h.text), ...r.ctas.map((c) => c.text),
  ...r.scripts.flatMap((s) => s.beats.map((b) => b.text)),
].join('\n');

console.log('\n— The gates —');
{
  const none = { instant: false, delivery: { n: 0 }, market: null, stats: {}, sold: {} };
  ok('"Shop now" is refused', !!ads.gate('Shop now!', none));
  ok('…even with every proof there is', !!ads.gate('Koop nu', { ...none, instant: true, delivery: { n: 9, medianSeconds: 5 }, market: { cheaper: true } }));
  ok('"Best prices" is refused without observed competitor prices', !!ads.gate('De beste prijzen', none));
  ok('…and allowed when a competitor was seen asking more', ads.gate('De beste prijs', { ...none, market: { cheaper: true } }) === null);
  ok('"Instant delivery" is refused for a product with stock but no measured deliveries',
    !!ads.gate('Instant delivery', { ...none, instant: true }));
  ok('…and allowed with 3+ measured deliveries at a median under a minute',
    ads.gate('Instant delivery', { ...none, instant: true, delivery: { n: 3, medianSeconds: 40, latestSeconds: 40 } }) === null);
  ok('the shared claim layer still applies: a rating nobody gave is refused', !!ads.gate('4.9/5 sterren', none));
  ok('a plain line passes', ads.gate('Geen account nodig.', none) === null);
  ok('"wij zijn nummer 1" is refused', !!ads.gate('Wij zijn nummer 1 in Nederland', none) && !!ads.gate('De #1 shop voor Robux', none));
  ok('…but counting mistakes is not a #1 claim', ads.gate('Fout nummer 1 bij Robux: je wachtwoord geven.', none) === null);
}

console.log('\n— Pack sizes —');
{
  ok('"1,700 Robux" is 1,700 Robux', JSON.stringify(ads.packOf('1,700 Robux')) === '{"n":1700,"unit":"Robux"}');
  ok('"2.800 V-Bucks"', ads.packOf('2.800 V-Bucks')?.n === 2800);
  ok('"Steam Wallet €20" is not a pack', ads.packOf('Steam Wallet €20') === null);
  ok('durations read like a person would say them', ads.duration(42) === '42 sec' && ads.duration(240) === '4 min' && ads.duration(7200) === '2 uur');
}

// ── Products ──
const P = async (name, category, price, { mode = 'auto' } = {}) => {
  const p = await createProduct({ name, sku: `AS-${name.replace(/\W+/g, '')}-${stamp}`, category, price, currency: 'EUR', active: true, announce: false });
  await run(`UPDATE products SET metadata=@m WHERE id=@id`, { id: p.id, m: JSON.stringify({ deliveryMode: mode }) });
  return p;
};
const vb = await P('2,800 V-Bucks EU', 'v-bucks', 2299);
await P('1,000 V-Bucks EU', 'v-bucks', 899);                      // a sibling pack, for per-1.000
const robux = await P('1,700 Robux', 'robux', 1999);
const steam = await P('Steam Wallet €20', 'giftcard', 2199);
const bare = await P('Mystery Bundle', 'mystery', 999, { mode: 'manual' });
await addProductCodes(vb.id, ['A1', 'A2', 'A3']);                  // 3 left: real, low stock

let seq = 0;
/** An order through its real status changes: placed, paid after `payWait`, delivered `deliver` after that. */
async function order(p, { status = 'completed', minsAgo = 60, payWait = 15, deliver = 0.75, total = p.price, test = false } = {}) {
  const id = newId('ord'); seq += 1;
  const placed = Date.now() - minsAgo * MIN;
  const paid = placed + payWait * MIN; const done = paid + deliver * MIN;
  const iso = (t) => new Date(t).toISOString();
  await run(`INSERT INTO orders (id, number, email, status, currency, subtotal, total, billing, created_at, updated_at)
             VALUES (@id, @n, @e, @st, 'EUR', @t, @t, '{}', @at, @at)`,
    { id, n: `AS-${stamp}-${seq}`, e: `b${seq}@x.dev`, st: status, t: total, at: iso(placed) });
  await run(`INSERT INTO order_items (id, order_id, product_id, name, quantity, unit_price) VALUES (@id, @o, @p, @nm, 1, @u)`,
    { id: newId('oi'), o: id, p: p.id, nm: p.name, u: p.price });
  for (const [to, at] of [['payment_received', paid], ['completed', done]]) {
    await run(`INSERT INTO order_status_history (id, order_id, to_status, created_at) VALUES (@id, @o, @s, @at)`,
      { id: newId('osh'), o: id, s: to, at: iso(at) });
  }
  if (test) {
    await run(`INSERT INTO social_events (id, order_id, product_label, status, test, created_at) VALUES (@id, @o, 'x', 'visible', 1, @at)`,
      { id: newId('soc'), o: id, at: iso(done) });
  }
  return id;
}
// V-Bucks: three real sales this week — delivered 45s, 2 min and 4 min after PAYMENT
// (the buyers took 15 minutes to pay, which is not delivery time).
await order(vb, { minsAgo: 30, deliver: 0.75 });
await order(vb, { minsAgo: 2 * 24 * 60, deliver: 2 });
await order(vb, { minsAgo: 3 * 24 * 60, deliver: 4 });
// …and four that are not sales.
await order(vb, { status: 'refunded', minsAgo: 20 });
await order(vb, { status: 'pending', minsAgo: 10 });
await order(vb, { minsAgo: 40, test: true });
await order(vb, { minsAgo: 50, total: 0 });
// A competitor seen asking more for the V-Bucks; one asking less for Steam.
async function seen(p, source, cents) {
  const r = await recordObservation(source, { title: `${p.name} ${stamp}`, priceCents: cents, currency: 'EUR', url: `https://${source}.test/x`, availability: 'in_stock' });
  await run(`INSERT INTO market_candidates (id, market_product_id, forge_product_id, status, created_at, updated_at)
             VALUES (@id, @mp, @fp, 'product_created', @at, @at)`, { id: newId('mkc'), mp: r.marketProductId, fp: p.id, at: nowIso() });
}
await seen(vb, 'g2a', 2499);
await seen(steam, 'eneba', 1999);

const V = await ads.generateAdScripts(vb.id);
const R = await ads.generateAdScripts(robux.id);
const S = await ads.generateAdScripts(steam.id);
const B = await ads.generateAdScripts(bare.id);

console.log('\n— Ten of each, across the eight kinds —');
{
  for (const [n, r] of [['V-Bucks', V], ['Robux', R], ['Steam', S]]) {
    ok(`${n}: 10 hooks, 10 scripts, 10 CTAs`, r.hooks.length === 10 && r.scripts.length === 10 && r.ctas.length === 10 && !r.shortfall,
      `${r.hooks.length}/${r.scripts.length}/${r.ctas.length} ${r.shortfall || ''}`);
  }
  ok('V-Bucks, with sales, deliveries and an observed price, uses all eight kinds',
    V.types.every((t) => t.count > 0), JSON.stringify(V.types.map((t) => [t.type, t.count])));
  ok('every hook is one of the eight', [V, R, S].every((r) => r.hooks.every((h) => ads.HOOK_TYPES.includes(h.type))));
  ok('ten different hooks, ten different CTAs', new Set(V.hooks.map((h) => h.text)).size === 10 && new Set(V.ctas.map((c) => c.text)).size === 10);
  ok('every script has a hook, proof, the product, how it arrives and a CTA, in 15–25 seconds',
    V.scripts.every((s) => ['hook', 'proof', 'what', 'how', 'cta'].every((k) => s.beats.some((b) => b.kind === k)) && s.seconds >= 15 && s.seconds <= 25),
    JSON.stringify(V.scripts.map((s) => s.seconds)));
}

console.log('\n— Real numbers only —');
{
  const t = allText(V);
  ok('the real price', t.includes('€22,99') && !/€2[0-9],[0-9]{2}/.test(t.replace(/€22,99|€24,99/g, '')), '');
  ok('3 sold this week — refunds, unpaid, test and free orders not counted', V.facts.sold.total === 3 && V.facts.sold.last7 === 3,
    JSON.stringify(V.facts.sold));
  ok('delivery measured from PAYMENT, not from placing the order: median 2 min, latest 45 sec',
    V.facts.deliveryMeasured.median === '2 min' && V.facts.deliveryMeasured.latest === '45 sec' && V.facts.deliveryMeasured.n === 3,
    JSON.stringify(V.facts.deliveryMeasured));
  ok('…and those are the numbers the hooks use', /Mediane levertijd: 2 min|Mediaan tot nu toe: 2 min|Na 45 sec/.test(t));
  ok('per 1.000 from the product\'s own price and pack: €8,21', t.includes('€8,21'));
  ok('the observed competitor, with source and date', /G2A (vroeg|zat op) €24,99/.test(t));
  ok('the real, low stock', V.facts.stockLeft === 3);
  /* Found on screen: the size comparison picked another product of the SAME
     size — "2.800 V-Bucks voor €22,99 of 2.800 V-Bucks voor €12,99?". */
  ok('the size comparison is against a different size', !V.facts.sibling || !/2\.?800/.test(V.facts.sibling.name),
    JSON.stringify(V.facts.sibling));
}

console.log('\n— Nothing generic, nothing unproven —');
{
  for (const [n, r] of [['V-Bucks', V], ['Robux', R], ['Steam', S], ['Mystery', B]]) {
    const hit = allText(r).match(BANNED);
    ok(`${n}: no generic advertising phrase`, !hit, hit?.[0]);
  }
  ok('Steam: a competitor was CHEAPER, so no comparison and no "goedkoper"',
    !S.hooks.some((h) => h.type === 'comparison') && !/goedkoper|vroeg €19,99/.test(allText(S)) && S.facts.market.cheaper === false);
  ok('Robux, never sold: no sales count, no delivery time', !/verkocht|levertijd|Mediaan|stopwatch/i.test(R.hooks.map((h) => h.text).join(' ')));
  ok('Robux goes onto an account: never "code in je mail"', !/code in (je|de) mail|komt als code/.test(allText(R)));
  ok('…it says what is true: the username, never the password', /Roblox-gebruikersnaam/.test(allText(R)) && /wachtwoord/.test(allText(R)));
  ok('a gift card has no pack size, so no per-1.000 math', !/per 1\.000/.test(allText(S)));
}

console.log('\n— Fewer than ten, rather than filler —');
{
  ok('a product with almost nothing to say gets fewer, and says why',
    B.hooks.length < 10 && /fewer than 10/.test(B.shortfall || ''), `${B.hooks.length} ${B.shortfall}`);
  ok('…and every one it does get passes the gates', B.hooks.every((h) => ads.gate(h.text, { instant: false, delivery: { n: 0 }, market: null, stats: {} }) === null));
}

console.log('\n— Scores —');
{
  const all = [...V.scripts, ...R.scripts];
  ok('four scores per script, 0–100, each with its reasons', all.every((s) =>
    ['hookStrength', 'retention', 'scrollStop', 'conversion'].every((k) => s.scores[k] >= 0 && s.scores[k] <= 100 && s.why[k].length > 0)));
  const real = V.hooks.filter((h) => h.real); const plain = V.hooks.filter((h) => !h.real);
  const avg = (xs) => xs.reduce((a, h) => a + h.scores.hookStrength, 0) / xs.length;
  ok('hooks built on real sales and deliveries score higher than ones that are not', avg(real) > avg(plain), `${avg(real)} vs ${avg(plain)}`);
  ok('scripts come best-first', V.scripts.every((s, i, a) => i === 0
    || Object.values(a[i - 1].scores).reduce((x, y) => x + y) >= Object.values(s.scores).reduce((x, y) => x + y)));
  ok('the scores differ — they rank something', new Set(V.scripts.map((s) => Object.values(s.scores).join())).size > 3);
  ok('each script has a tagged link Ad Intelligence can measure',
    V.scripts.every((s) => s.link.includes(`/product/${vb.id}?`) && s.link.includes('utm_content=') && s.link.includes('utm_source=tiktok')));
  ok('…and says plainly the scores are predicted, not measured', /not measured/.test(V.scoreNote) && V.scripts.every((s) => s.measured === null));
}

console.log('\n— Admin —');
{
  const owner = newId('usr');
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'O', @at, @at)`, { id: owner, e: `o-${stamp}@x.dev`, at: nowIso() });
  await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, 'owner', @at) ON CONFLICT DO NOTHING`, { u: owner, at: nowIso() });
  const { accessToken } = await finalizeLogin(await get(`SELECT * FROM users WHERE id=@id`, { id: owner }), {});
  const srv = createApp().listen(0);
  const base = `http://127.0.0.1:${srv.address().port}/api/admin/analytics/ad-scripts`;
  const auth = { headers: { authorization: `Bearer ${accessToken}` } };
  const list = await (await fetch(base, auth)).json();
  ok('the product list puts what sells first', list.products[0].id === vb.id && list.products[0].sold === 3, JSON.stringify(list.products[0]));
  const one = await fetch(`${base}/${vb.id}`, auth);
  ok('scripts for one product', one.status === 200 && (await one.json()).scripts.length === 10);
  ok('an unknown product is a 404', (await fetch(`${base}/nope`, auth)).status === 404);
  ok('only for staff', (await fetch(base)).status === 401);
  srv.close();
  const fs = await import('node:fs');
  ok('Growth → Ad Scripts is in the admin menu',
    /growth\/ad-scripts.*Ad Scripts/.test(fs.readFileSync(new URL('../../src/layouts/AdminLayout.jsx', import.meta.url), 'utf8')));
}

console.log(`\n${fail ? '❌' : '✅'} ad-scripts: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
