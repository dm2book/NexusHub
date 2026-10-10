/**
 * Mystery boxes are retired, and bundles take their place in the shop.
 *
 * A paid box that pays out prizes of different value by chance is very likely
 * a game of chance under the Dutch Wet op de kansspelen, which needs a licence
 * this shop does not have. Pinned here:
 *   1  the starter bundles: game-currency packs that belong together, made once
 *      per version, never over an owner's edit or deletion, never with a
 *      face-value card, and priced by the server on complete sets only
 *   2  migration 065 switches every box off, and running it again changes nothing
 *   3  nothing public lists, shows or prices a box — not even one switched back
 *      on by hand: the catalogue, the product page and its HTML, the sitemap,
 *      the ad feed, recommendations, bundles, the quote and the order
 *   4  an order from before still shows what its box paid out, the free reroll
 *      answers 410, and a refund or a chargeback still takes the prize back
 *   5  the launch check is silent without an active box, and names one that is
 *   6  the admin cannot make a box, switch one on, or save a reward pool — and
 *      can still tidy the old row while it stays off
 */
import './_selling-shop.mjs';   // must come first — see that file
import { ensureReady, createApp } from '../src/app.js';
import { all, get, run, exec, nowIso } from '../src/db/index.js';
import { newId } from '../src/utils/ids.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
await ensureReady();

const { MIGRATIONS } = await import('../src/db/migrations.js');
const { migrate } = await import('../src/db/migrate.js');
const { seedStarterContent, STARTER_BUNDLES_FLAG, isGameCurrency } = await import('../src/db/starterContent.js');
const { createProduct, updateProduct, listProducts, isSellable } = await import('../src/services/productService.js');
const { pricedBundles, createBundle, deleteBundle } = await import('../src/services/bundleService.js');
const { createOrder, markPaymentReceived, transitionOrder } = await import('../src/services/orderService.js');
const { feedRows } = await import('../src/services/productFeedService.js');
const { refundOrder } = await import('../src/services/refundService.js');
const { balanceOf } = await import('../src/services/walletService.js');
const { reverseMysteryForOrder } = await import('../src/services/mysteryBoxService.js');
const { launchChecks } = await import('../src/services/launchCheckService.js');
const { trendingRail, clearTrendingCache } = await import('../src/services/trendingService.js');
const { finalizeLogin } = await import('../src/services/authService.js');

const stamp = Date.now().toString(36);
const consent = { consent: true, consentText: 'Ik wil mijn bestelling meteen geleverd krijgen.' };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
/** Poll until fn() is truthy: the boot's upkeep and a paid order's delivery run in the background. */
const waitFor = async (fn, ms = 8000) => {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v || Date.now() > until) return v;
    await pause(80);
  }
};
const throws = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const call = async (method, path, body, token) => {
  const r = await fetch(`${base}${path}`, { method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = {};
  try { json = JSON.parse(text); } catch { /* HTML or CSV */ }
  return { status: r.status, body: json, text, headers: r.headers };
};

let n = 0;
const newUser = async (role = null) => {
  const id = newId('usr');
  const email = `retire-${stamp}-${++n}@example.test`;
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'R', @at, @at)`,
    { id, e: email, at: nowIso() });
  if (role) {
    await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, @r, @at) ON CONFLICT DO NOTHING`,
      { u: id, r: role, at: nowIso() });
  }
  const s = await finalizeLogin(await get(`SELECT * FROM users WHERE id=@id`, { id }), {});
  return { id, email, token: s.accessToken };
};
const bySku = (sku) => get(`SELECT * FROM products WHERE sku=@s`, { s: sku });
const statusOf = async (id) => (await get(`SELECT status FROM orders WHERE id=@id`, { id }))?.status;

/* A box as an older release left it: the row and its pool written straight to
   the tables, because nothing in the shop will make one any more. */
const FLAT20 = [{ label: '€20 store credit', weight: 1, credit: 2000 }];
const insertBox = async ({ name = 'Old Box', active = 0, price = 4999, pool = FLAT20, updatedAt = nowIso() } = {}) => {
  const id = newId('prd');
  const full = `${name} ${stamp}-${++n}`;
  await run(`INSERT INTO products (id, name, category, description, price, currency, kind, active, metadata, created_at, updated_at)
             VALUES (@id, @n, 'mystery', 'Every box wins a real prize.', @p, 'EUR', 'mystery', @a, '{}', @at, @u)`,
    { id, n: full, p: price, a: active, at: nowIso(), u: updatedAt });
  for (const r of pool) {
    await run(`INSERT INTO mystery_box_rewards (id, box_id, label, weight, credit_cents, created_at)
               VALUES (@id, @b, @l, @w, @c, @at)`,
      { id: newId('mbr'), b: id, l: r.label, w: r.weight, c: r.credit, at: nowIso() });
  }
  return { id, name: full, price };
};
/* An order for a box placed before the retirement: the checkout refuses a box
   now, so it is placed for a stand-in at the box's price and its line is then
   pointed at the box — the rows an older release wrote. */
const standIns = new Map();
const boxOrder = async (user, box) => {
  if (!standIns.has(box.price)) {
    standIns.set(box.price, await createProduct({ name: `Stand-in ${stamp}-${++n}`, category: 'giftcard',
      price: box.price, announce: false, metadata: { deliveryMode: 'manual' } }));
  }
  const standIn = standIns.get(box.price);
  const o = await createOrder({ ...consent, email: user.email, userId: user.id, items: [{ productId: standIn.id, quantity: 1 }] });
  await run(`UPDATE order_items SET product_id=@b, name=@nm, metadata=@m WHERE order_id=@o AND product_id=@s`,
    { b: box.id, nm: box.name, m: JSON.stringify({ category: 'mystery' }), o: o.id, s: standIn.id });
  return o;
};
/** Paid, opened and completed: the €20 the box always pays is in the wallet. */
const openedBox = async (user, box) => {
  const o = await boxOrder(user, box);
  await markPaymentReceived(o.id, `pi_${o.id}`, { actorId: 'stripe', reason: 'test' });
  await waitFor(async () => (await statusOf(o.id)) === 'completed' && (await balanceOf(user.id)) === 2000);
  return o;
};

console.log('— A new shop has no box —');
{
  ok('the boot seeds no mystery product at all',
    Number((await get(`SELECT COUNT(*)::int AS n FROM products WHERE kind='mystery'`)).n) === 0
    && !(await get(`SELECT id FROM products WHERE id='prd_starter_mystery_box'`)));
  const { checks } = await launchChecks();
  ok('…and the launch check has nothing to say about boxes', !checks.some((c) => c.id === 'mystery_gambling'),
    JSON.stringify(checks.find((c) => c.id === 'mystery_gambling')));
}

console.log('— 1 The starter bundles —');
const FPS = 'bnd_starter_fps_duo', RIOT = 'bnd_starter_riot', SUPERCELL = 'bnd_starter_supercell';
const EXPECT = { [FPS]: ['APEX-1000', 'VAL-1000'], [RIOT]: ['VAL-1000', 'LOL-1380'],
  [SUPERCELL]: ['COC-500', 'CR-500', 'BRAWL-360'] };
const starters = () => all(`SELECT * FROM bundles WHERE id LIKE 'bnd_starter_%' ORDER BY id`);
const memberIds = (row) => JSON.parse(row?.product_ids || '[]');
const CARD_SHELVES = ['giftcard', 'steam', 'playstation', 'psn', 'xbox', 'nintendo', 'netflix', 'spotify', 'amazon',
  'googleplay', 'itunes', 'gamepass', 'discord-nitro', 'paysafecard'];
{
  // The boot's own upkeep makes them; wait for it rather than race it.
  const flag = await waitFor(() => get(`SELECT value FROM kv WHERE key=@k`, { k: STARTER_BUNDLES_FLAG }), 20_000);
  ok(`the boot makes the starter set and marks ${STARTER_BUNDLES_FLAG} done`, !!flag);
  const first = await starters();
  await seedStarterContent();          // the next boot
  await seedStarterContent();          // and the one after
  const rows = await starters();
  ok('three starter bundles, under their fixed ids', JSON.stringify(rows.map((r) => r.id)) === JSON.stringify([FPS, RIOT, SUPERCELL]),
    JSON.stringify(rows.map((r) => r.id)));
  ok('later boots change nothing: same rows, same members, same dates',
    JSON.stringify(first.map((r) => [r.id, r.product_ids, r.created_at])) === JSON.stringify(rows.map((r) => [r.id, r.product_ids, r.created_at])));
  for (const [id, skus] of Object.entries(EXPECT)) {
    const row = rows.find((r) => r.id === id);
    const want = await Promise.all(skus.map(bySku));
    ok(`${id}: ${skus.join(' + ')}`, JSON.stringify(memberIds(row)) === JSON.stringify(want.map((p) => p?.id)),
      `${row?.product_ids} vs ${JSON.stringify(want.map((p) => p?.id))}`);
    const cheapest = await Promise.all(want.map((p) => get(
      `SELECT MIN(price)::int AS p FROM products WHERE category=@c AND active=1 AND kind='digital'`, { c: p?.category })));
    ok(`${id}: the cheapest pack of each game, 10% off`,
      want.every((p, i) => p && p.price === cheapest[i].p) && Number(row?.discount_percent) === 10 && Number(row?.active) === 1);
  }
  const members = await all(`SELECT * FROM products WHERE id = ANY(@ids)`, { ids: [...new Set(rows.flatMap(memberIds))] });
  ok('every member is game currency on sale — never a face-value card or a subscription',
    members.length === 6 && members.every((p) => Number(p.active) === 1 && p.kind === 'digital' && isGameCurrency(p)
      && !CARD_SHELVES.includes(p.category)), members.map((p) => `${p.name} (${p.category})`).join(', '));
  ok('the FPS Duo is the one earlier releases made, word for word',
    rows[0].name === 'FPS Duo Pack — Apex + Valorant' && rows[0].description === 'Top up both your shooters in one go and save 10%.');

  // What the shop shows, from the route the storefront reads.
  const r = await call('GET', '/api/bundles');
  const shown = (r.body.bundles || []).filter((b) => b.id.startsWith('bnd_starter_'));
  ok('/api/bundles offers all three', r.status === 200 && shown.length === 3, `${r.status} ${shown.length}`);
  for (const b of shown) {
    const prices = await all(`SELECT price FROM products WHERE id = ANY(@ids)`, { ids: b.products.map((p) => p.id) });
    const subtotal = prices.reduce((s, p) => s + Number(p.price), 0);
    ok(`${b.id}: priced by the server from today's prices — €${(b.total / 100).toFixed(2)} instead of €${(subtotal / 100).toFixed(2)}`,
      b.subtotal === subtotal && b.discount === Math.round(subtotal * 10 / 100) && b.total === subtotal - b.discount
      && b.discountPercent === 10, JSON.stringify({ subtotal: b.subtotal, discount: b.discount, total: b.total }));
  }
  const riot = shown.find((b) => b.id === RIOT);
  ok('a name in every language the shop is read in',
    riot?.name === 'Riot Pack — Valorant + League' && riot?.nameNl === 'Riot-pakket — Valorant + League'
    && riot?.nameDe === 'Riot-Paket — Valorant + League' && riot?.nameFr === 'Pack Riot — Valorant + League', JSON.stringify(riot));
  ok('…and a line written from its own packs and discount, per language',
    /10% cheaper together/.test(riot?.description || '') && /samen 10% goedkoper/.test(riot?.descriptionNl || '')
    && /zusammen 10% günstiger/.test(riot?.descriptionDe || '') && /10% moins cher ensemble/.test(riot?.descriptionFr || '')
    && riot.products.every((p) => riot.descriptionNl.includes(p.name)), riot?.descriptionNl);

  // The complete-set rule, through the quote the checkout shows.
  const id = Object.fromEntries(await Promise.all(['APEX-1000', 'VAL-1000', 'LOL-1380', 'COC-500', 'CR-500', 'BRAWL-360']
    .map(async (s) => [s, (await bySku(s)).id])));
  const quote = (lines) => call('POST', '/api/checkout/quote',
    { items: lines.map(([sku, quantity = 1]) => ({ productId: id[sku], quantity })) });
  const priced = await pricedBundles();
  const sc = priced.find((b) => b.id === SUPERCELL);
  const full = await quote([['COC-500'], ['CR-500'], ['BRAWL-360']]);
  ok('the whole Supercell set in a cart costs what its card says',
    full.status === 200 && full.body.bundle?.id === SUPERCELL && full.body.bundleDiscount === sc.discount && full.body.total === sc.total,
    JSON.stringify(full.body).slice(0, 300));
  const part = await quote([['COC-500'], ['CR-500']]);
  ok('two of its three packs get no bundle discount', part.status === 200 && part.body.bundleDiscount === 0 && !part.body.bundle,
    JSON.stringify(part.body).slice(0, 200));
  const extra = await quote([['COC-500', 2], ['CR-500'], ['BRAWL-360']]);
  ok('a second Clash of Clans pack does not make a second set', extra.body.bundleDiscount === sc.discount, String(extra.body.bundleDiscount));
  const twice = await quote([['COC-500', 2], ['CR-500', 2], ['BRAWL-360', 2]]);
  ok('two complete sets save twice the card', twice.body.bundleDiscount === sc.discount * 2, String(twice.body.bundleDiscount));
  const best = [FPS, RIOT].map((b) => priced.find((x) => x.id === b)).sort((a, b) => b.discount - a.discount)[0];
  const overlap = await quote([['APEX-1000'], ['VAL-1000'], ['LOL-1380']]);
  ok('one bundle per order — the best one, never both stacked',
    overlap.body.bundle?.id === best.id && overlap.body.bundleDiscount === best.discount, JSON.stringify(overlap.body.bundle));
}
{
  // The owner's word outranks the seed.
  await run(`UPDATE bundles SET discount_percent=15, name='My shooter deal' WHERE id=@id`, { id: FPS });
  await deleteBundle(RIOT);
  await seedStarterContent();
  await seedStarterContent();
  const fps = await get(`SELECT name, discount_percent FROM bundles WHERE id=@id`, { id: FPS });
  ok('a starter bundle the owner edited keeps the edit', fps?.name === 'My shooter deal' && Number(fps.discount_percent) === 15,
    JSON.stringify(fps));
  ok('one the owner deleted does not come back', !(await get(`SELECT id FROM bundles WHERE id=@id`, { id: RIOT })));
  ok('…and nothing is doubled', (await all(`SELECT id FROM bundles`)).length === 2);
}
{
  // The rules on a run of a new version: start again from no bundles and no flag.
  await run(`DELETE FROM bundles`);
  await run(`DELETE FROM kv WHERE key=@k`, { k: STARTER_BUNDLES_FLAG });
  const val = await bySku('VAL-1000');
  const card = await createProduct({ name: `Valorant Gift Card €5 ${stamp}`, category: 'valorant', price: val.price - 300, announce: false });
  const turkish = await createProduct({ name: `475 VP — Valorant TR ${stamp}`, category: 'valorant', price: val.price - 400,
    announce: false, metadata: { region: 'tr', denomUnit: 'vp', productType: 'points' } });
  await run(`UPDATE products SET active=0 WHERE category='league'`);
  await seedStarterContent();
  const made = await starters();
  const fps = made.find((b) => b.id === FPS);
  ok('the cheapest Valorant POINTS pack — not a cheaper gift card, not a pack locked to another region',
    !!fps && memberIds(fps).includes(val.id) && !memberIds(fps).includes(card.id) && !memberIds(fps).includes(turkish.id),
    fps?.product_ids);
  ok('a bundle with a game that has nothing on sale is skipped, not made half', !made.some((b) => b.id === RIOT),
    made.map((b) => b.id).join(', '));
  ok('…the others are made', made.some((b) => b.id === SUPERCELL));
  await run(`UPDATE products SET active=1 WHERE category='league'`);
  await seedStarterContent();
  ok('once per version: League back on sale does not bring it in later', !(await get(`SELECT id FROM bundles WHERE id=@id`, { id: RIOT })));
  await run(`UPDATE products SET active=0 WHERE id = ANY(@ids)`, { ids: [card.id, turkish.id] });

  // A shop with bundles of its own and no FPS Duo deleted the first starter bundle.
  await run(`DELETE FROM bundles`);
  await run(`DELETE FROM kv WHERE key=@k`, { k: STARTER_BUNDLES_FLAG });
  await createBundle({ name: `Owner duo ${stamp}`, productIds: [(await bySku('COC-500')).id, (await bySku('CR-500')).id],
    discountPercent: 5, announce: false });
  await seedStarterContent();
  ok('a shop that has its own bundles but not the FPS Duo does not get it back',
    !(await get(`SELECT id FROM bundles WHERE id=@id`, { id: FPS })));
  ok('…and does get the new ones', !!(await get(`SELECT id FROM bundles WHERE id=@id`, { id: RIOT }))
    && !!(await get(`SELECT id FROM bundles WHERE id=@id`, { id: SUPERCELL })));
}

console.log('— 2 Migration 065 switches every box off —');
{
  const m = MIGRATIONS.find((x) => x.id === '065_retire_mystery_boxes');
  ok('065 is the newest migration', !!m && MIGRATIONS[MIGRATIONS.length - 1] === m);
  const box = await insertBox({ name: 'Forge Mystery Box', active: 1, updatedAt: '2026-01-01T00:00:00.000Z' });
  const onSale = async () => Number((await get(
    `SELECT COUNT(*)::int AS n FROM products WHERE kind <> 'mystery' AND active = 1`)).n);
  const before = await onSale();
  await run(`DELETE FROM schema_migrations WHERE id='065_retire_mystery_boxes'`);
  const applied = await migrate();
  const after = await get(`SELECT active, updated_at FROM products WHERE id=@id`, { id: box.id });
  ok('a box still on sale is switched off when it runs', applied === 1 && Number(after?.active) === 0, `${applied} ${JSON.stringify(after)}`);
  ok('…stamped in the shop\'s own ISO format', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(after?.updated_at || '')
    && after.updated_at > '2026-01-01T00:00:00.000Z', after?.updated_at);
  ok('nothing else is switched off', (await onSale()) === before && before > 0, `${before} → ${await onSale()}`);
  ok('…the box keeps its reward pool, for the orders it was sold in',
    (await all(`SELECT id FROM mystery_box_rewards WHERE box_id=@b`, { b: box.id })).length === 1);
  await pause(5);
  await exec(m.sql);
  const again = await get(`SELECT active, updated_at FROM products WHERE id=@id`, { id: box.id });
  ok('running it again changes nothing', Number(again.active) === 0 && again.updated_at === after.updated_at, JSON.stringify(again));
}

console.log('— 3 Nowhere public, even switched back on by hand —');
const box = await insertBox({ name: 'Retired Box' });
const card = await createProduct({ name: `Plain Card ${stamp}`, category: 'giftcard', price: 1500, announce: false,
  metadata: { adFeedImage: '/api/images/plain-card.jpg', crossSell: [box.id] } });
// What a hand-edit in the database would do: the box on sale, featured, with an advert image.
await run(`UPDATE products SET active=1, metadata=@m WHERE id=@id`,
  { id: box.id, m: JSON.stringify({ featured: true, adFeedImage: '/api/images/retired-box.jpg' }) });
const boxBundle = newId('bnd');
await run(`INSERT INTO bundles (id, name, description, product_ids, discount_percent, active, created_at)
           VALUES (@id, @n, NULL, @p, 10, 1, @at)`,
  { id: boxBundle, n: `Box + card ${stamp}`, p: JSON.stringify([box.id, card.id]), at: nowIso() });
{
  ok('isSellable says no to it', !isSellable({ ...box, kind: 'mystery', active: true }) && isSellable({ ...card }));
  ok('the shelf every customer list reads leaves it out', !(await listProducts({ activeOnly: true })).some((p) => p.id === box.id));
  const list = await call('GET', '/api/products');
  ok('/api/products leaves it out', list.status === 200 && list.body.products.some((p) => p.id === card.id)
    && !list.body.products.some((p) => p.id === box.id));
  const one = await call('GET', `/api/products/${box.id}`);
  ok('/api/products/:id answers 404', one.status === 404, String(one.status));
  const odds = await call('GET', `/api/products/${box.id}/mystery`);
  ok('its odds page answers 410 Gone', odds.status === 410 && odds.body.error?.code === 'mystery_retired', `${odds.status} ${odds.text.slice(0, 120)}`);
  ok('…and is not cached at the edge', !/s-maxage/.test(odds.headers.get('cache-control') || ''));
  ok('its trust panel answers 404', (await call('GET', `/api/products/${box.id}/trust`)).status === 404);
  const cardPage = await call('GET', `/product/${card.id}`);
  const boxPage = await call('GET', `/product/${box.id}`);
  ok('the server-rendered page of a product on sale carries its name and Product block',
    cardPage.text.includes(card.name) && /"@type"\s*:\s*"Product"/.test(cardPage.text));
  ok('…the box\'s does not: no name, no price, no Product block',
    boxPage.status === 200 && !boxPage.text.includes(box.name) && !/"@type"\s*:\s*"Product"/.test(boxPage.text));
  const sitemap = await call('GET', '/sitemap.xml');
  ok('the sitemap lists the bundles page', /\/bundles<\/loc>/.test(sitemap.text));
  ok('…and the products on sale, but not the box', sitemap.text.includes(`/product/${card.id}<`)
    && !sitemap.text.includes(`/product/${box.id}<`));
  const feed = await feedRows({});
  ok('the ad feed carries products with an image, never the box', feed.rows.some((r) => r.id === card.id)
    && !feed.rows.some((r) => r.id === box.id));
  const csv = await call('GET', '/api/feeds/products.csv?network=meta&lang=nl');
  ok('…nor the CSV the ad platforms fetch', csv.text.includes(card.id) && !csv.text.includes(box.id));
  const recs = await call('GET', `/api/products/${card.id}/recommendations`);
  ok('a product naming the box as its cross-sell does not recommend it', recs.status === 200
    && ![...(recs.body.crossSell || []), ...(recs.body.upsell || [])].some((p) => p.id === box.id), JSON.stringify(recs.body).slice(0, 200));
  ok('a bundle holding the box is not offered', !(await pricedBundles()).some((b) => b.id === boxBundle));
  const made = await throws(() => createBundle({ name: `With a box ${stamp}`, productIds: [box.id, card.id], discountPercent: 10, announce: false }));
  ok('…and the admin cannot make one', made?.status === 400 && /Wet op de kansspelen/.test(made.message), made?.message);
  const q1 = await call('POST', '/api/checkout/quote', { items: [{ productId: box.id }] });
  ok('the checkout quote refuses it, and says why', q1.status === 409 && /retired/.test(q1.body.error?.message || ''), `${q1.status} ${q1.text.slice(0, 160)}`);
  const q2 = await call('POST', '/api/checkout/quote', { items: [{ productId: card.id }, { productId: box.id }] });
  ok('…also next to something on sale', q2.status === 409, String(q2.status));
  const u = await newUser();
  const withAccount = await throws(() => createOrder({ ...consent, email: u.email, userId: u.id, items: [{ productId: box.id, quantity: 1 }] }));
  const asGuest = await throws(() => createOrder({ ...consent, email: `guest-${stamp}@example.test`, items: [{ productId: box.id, quantity: 1 }] }));
  ok('an order for it is refused, with an account or without', withAccount?.status === 409 && asGuest?.status === 409
    && /retired/.test(withAccount.message), `${withAccount?.status} ${withAccount?.message} / ${asGuest?.status}`);
  ok('…and nothing was written', !(await get(`SELECT id FROM order_items WHERE product_id=@b`, { b: box.id })));
}

console.log('— 4 Orders from before keep what they were sold —');
{
  const a = await newUser();
  const oa = await openedBox(a, box);
  ok('a box order placed before the retirement and paid now still opens: €20, completed',
    (await statusOf(oa.id)) === 'completed' && (await balanceOf(a.id)) === 2000, `${await statusOf(oa.id)} wallet ${await balanceOf(a.id)}`);
  const shown = await call('GET', `/api/account/orders/${oa.id}/mystery`, null, a.token);
  const pull = shown.body.pulls?.[0];
  ok('the buyer\'s order page still shows what it paid out', shown.status === 200 && shown.body.pulls?.length === 1
    && pull.credit === 2000 && pull.label === '€20 store credit', JSON.stringify(shown.body));
  const reroll = await call('POST', `/api/account/orders/${oa.id}/mystery/${pull?.id}/reroll`, {}, a.token);
  ok('the free reroll answers 410 Gone', reroll.status === 410 && reroll.body.error?.message === 'Mystery boxes are retired',
    `${reroll.status} ${reroll.text.slice(0, 160)}`);
  ok('…pays nothing and marks nothing', (await balanceOf(a.id)) === 2000
    && !(await get(`SELECT rerolled_at FROM mystery_pulls WHERE id=@id`, { id: pull?.id }))?.rerolled_at);
  await refundOrder(oa.id, { method: 'money', actorId: 'test', reason: 'test' });
  ok('a refund still takes the prize back', (await balanceOf(a.id)) === 0, `wallet ${await balanceOf(a.id)}`);
  ok('…and the order still shows what the box paid out', (await call('GET', `/api/account/orders/${oa.id}/mystery`, null, a.token)).body.pulls?.length === 1);

  const b = await newUser();
  const ob = await openedBox(b, box);
  await transitionOrder(ob.id, 'refunded', { actorId: 'stripe', reason: 'Chargeback', chargeback: true, silent: true });
  ok('a chargeback still takes the prize back', (await balanceOf(b.id)) === 0, `wallet ${await balanceOf(b.id)}`);
  ok('…once', (await reverseMysteryForOrder(ob.id, 'charged back')) === null && (await balanceOf(b.id)) === 0);

  // The box has sales now, so the trending engine sees it; the rail must not show it.
  clearTrendingCache();
  const rail = await trendingRail({ limit: 50 });
  const trending = await call('GET', '/api/products/trending');
  ok(`the trending rail leaves it out${rail.some((r) => r.id === box.id) ? ' (the engine ranked it)' : ''}`,
    trending.status === 200 && !(trending.body.products || []).some((p) => p.id === box.id));
}

console.log('— 5 The launch check —');
{
  const named = (await launchChecks()).checks.filter((c) => c.id === 'mystery_gambling');
  ok('a box switched on by hand is named, once, as a warning', named.length === 1 && named[0].status === 'warn'
    && named[0].detail.includes(box.name) && /Wet op de kansspelen/.test(named[0].detail), JSON.stringify(named));
  await run(`UPDATE products SET active=0 WHERE id=@id`, { id: box.id });
  const after = (await launchChecks()).checks.find((c) => c.id === 'mystery_gambling');
  ok('switched off, the check is silent again', !after, JSON.stringify(after));
}

console.log('— 6 The admin cannot bring one back —');
{
  const owner = await newUser('owner');
  const admin = (method, path, body) => call(method, path, body, owner.token);
  const law = (r) => r.status === 400 && /Wet op de kansspelen/.test(r.body.error?.message || '');
  const name = `New Box ${stamp}`;
  const created = await admin('POST', '/api/admin/products', { name, price: 4999, kind: 'mystery' });
  const createdOff = await admin('POST', '/api/admin/products', { name, price: 4999, kind: 'mystery', active: false });
  ok('creating a box is refused with the reason', law(created) && law(createdOff), `${created.status} ${created.text.slice(0, 200)}`);
  ok('…and nothing was made', !(await get(`SELECT id FROM products WHERE name=@n`, { n: name })));
  const on = await admin('PATCH', `/api/admin/products/${box.id}`, { active: true });
  ok('switching the old box back on is refused', law(on), `${on.status} ${on.text.slice(0, 200)}`);
  ok('…and it stays off', Number((await get(`SELECT active FROM products WHERE id=@id`, { id: box.id })).active) === 0);
  // What the product form sends on every save: kind and active come along unchanged.
  const tidy = await admin('PATCH', `/api/admin/products/${box.id}`,
    { name: `${box.name} (retired)`, price: 4999, kind: 'mystery', active: false, description: 'No longer sold.' });
  ok('the old box can still be tidied while it stays off', tidy.status === 200 && tidy.body.product?.name === `${box.name} (retired)`
    && tidy.body.product?.active === false, `${tidy.status} ${tidy.text.slice(0, 200)}`);
  const turned = await admin('PATCH', `/api/admin/products/${card.id}`, { kind: 'mystery' });
  ok('a product cannot be turned into a box', law(turned)
    && (await get(`SELECT kind FROM products WHERE id=@id`, { id: card.id })).kind === 'digital', `${turned.status}`);
  const bulkOn = await admin('POST', '/api/admin/products/bulk', { ids: [box.id, card.id], action: 'active', value: true });
  ok('a bulk "switch on" that includes the box is refused as a whole, naming it', law(bulkOn)
    && (bulkOn.body.error?.message || '').includes(box.name), bulkOn.text.slice(0, 200));
  ok('…nothing in it changed', Number((await get(`SELECT active FROM products WHERE id=@id`, { id: box.id })).active) === 0);
  const bulkOff = await admin('POST', '/api/admin/products/bulk', { ids: [box.id, card.id], action: 'active', value: false });
  ok('switching a selection with the box OFF is fine', bulkOff.status === 200 && bulkOff.body.updated === 2, bulkOff.text.slice(0, 200));
  const bulkCard = await admin('POST', '/api/admin/products/bulk', { ids: [card.id], action: 'active', value: true });
  ok('…and the rest switch back on without it', bulkCard.status === 200
    && Number((await get(`SELECT active FROM products WHERE id=@id`, { id: card.id })).active) === 1);
  const pool = await admin('PUT', `/api/admin/products/${box.id}/mystery`, { rewards: [{ label: '€99', weight: 1, credit: 9900 }] });
  ok('saving a reward pool is refused', law(pool), `${pool.status} ${pool.text.slice(0, 200)}`);
  const kept = await admin('GET', `/api/admin/products/${box.id}/mystery`);
  ok('…the pool its orders were rolled against stays readable, unchanged', kept.status === 200
    && kept.body.rewards?.length === 1 && kept.body.rewards[0].credit === 2000, JSON.stringify(kept.body));
  const svcCreate = await throws(() => createProduct({ name: `Service Box ${stamp}`, kind: 'mystery', price: 4999, active: false, announce: false }));
  const svcOn = await throws(() => updateProduct(box.id, { active: true }));
  ok('the service refuses the same, whoever calls it', svcCreate?.status === 400 && svcOn?.status === 400);
}

srv.close();
console.log(`\n${fail ? '❌' : '✅'} mystery-retired: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
