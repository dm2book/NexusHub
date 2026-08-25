/**
 * Ad attribution: does the report say which advert sold something, and is the
 * number it says true?
 *
 * Everything here runs against a real database with real orders, because the
 * failure modes this is guarding against are all arithmetic:
 *
 *   - a visit with three events beside one paid order reporting the sale three
 *     times, which is what two LEFT JOINs onto one row does and what
 *     COUNT(DISTINCT) hides while SUM quietly triples the money;
 *   - a reload counting as a second click and halving the measured conversion
 *     rate of the creative that earned it;
 *   - an unsubstituted `__CID__` macro becoming a creative that outsells every
 *     real one;
 *   - an unpaid or refunded order counting as a purchase;
 *   - a second call re-attributing a sale to a later advert.
 *
 * And two that are not arithmetic at all: that no click id, IP or address is
 * ever written, and that refusing marketing storage still leaves the arrival
 * counted rather than deleting the whole report.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_ad_attribution';
process.env.NODE_ENV ||= 'development';
process.env.APP_URL ||= 'https://forgemarket.nl';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

import fs from 'node:fs';
import path from 'node:path';

const { migrate } = await import('../src/db/migrate.js');
await migrate();
const { run, get, all, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const A = await import('../src/services/attributionService.js');

// ── A product to advertise ──────────────────────────────────────────────────
const PRODUCT = newId('prd');
await run(
  `INSERT INTO products (id, sku, name, category, price, currency, kind, stock, active, created_at, updated_at)
   VALUES (@id, 'ADTEST-1000', 'Ad Test 1000', 'robux', 999, 'EUR', 'digital', 50, 1, @at, @at)`,
  { id: PRODUCT, at: nowIso() });

const paidOrder = async (visitId, total, status = 'completed') => {
  const id = newId('ord');
  await run(
    `INSERT INTO orders (id, number, email, status, currency, subtotal, total, ad_visit_id, created_at, updated_at)
     VALUES (@id, @num, 'buyer@example.test', @st, 'EUR', @t, @t, @v, @at, @at)`,
    { id, num: `FM-TEST-${id.slice(-8)}`, st: status, t: total, v: visitId, at: nowIso() });
  return id;
};

console.log('\n── Parameters ──────────────────────────────────────────────');

{
  // The three tagging dialects that must land in the same columns.
  const utm = A.parseParams({
    utm_source: 'tiktok', utm_medium: 'paid', utm_campaign: 'launch',
    utm_content: 'robux-1000-B', utm_id: 'C-77',
  });
  ok('UTM parameters are read', utm.source === 'tiktok' && utm.campaign === 'launch'
    && utm.content === 'robux-1000-B' && utm.campaignId === 'C-77',
    JSON.stringify(utm));
  ok('utm_source alone identifies the network', utm.network === 'tiktok', utm.network);

  const tt = A.parseParams({ ttclid: 'EAAxxxx', campaign_id: '17800', creative_id: '99123', __placement__: 'FYP' });
  ok('TikTok parameters are read', tt.campaignId === '17800' && tt.creativeId === '99123'
    && tt.placement === 'FYP', JSON.stringify(tt));
  ok('a TikTok click id identifies the network', tt.network === 'tiktok', tt.network);

  const yt = A.parseParams({ gclid: 'Cj0KC', campaignid: '552', creative: '881', utm_source: 'youtube' });
  ok('YouTube/Google parameters are read', yt.campaignId === '552' && yt.creativeId === '881',
    JSON.stringify(yt));
  /* A YouTube advert bought through Google Ads arrives carrying gclid. Reading
     the click id first filed every one of them under "google" — true of the
     billing, useless when the question is which platform the video works on. */
  ok('a declared utm_source outranks the click id it arrived with',
    yt.network === 'youtube', yt.network);
  ok('a click id still names the network when nothing else does',
    A.parseParams({ gclid: 'Cj0KC' }).network === 'google');

  ok('short forms work for a bio link', (() => {
    const p = A.parseParams({ src: 'tiktok', cid: 'launch-1', crid: 'robux-1000-A' });
    return p.campaignId === 'launch-1' && p.creativeId === 'robux-1000-A' && p.network === 'tiktok';
  })());

  // A macro the network failed to substitute must not become a creative.
  const macro = A.parseParams({ utm_source: 'tiktok', creative_id: '__CID__', utm_campaign: '{campaign_name}' });
  ok('unsubstituted macros are ignored, not stored',
    macro.creativeId === null && macro.campaign === null, JSON.stringify(macro));

  ok('a plain visit is not an ad visit',
    A.parseParams({ page: '2', q: 'robux' }).hasAdParams === false);
  ok('a tagged visit is an ad visit', A.parseParams({ utm_source: 'tiktok' }).hasAdParams === true);
}

console.log('\n── What is written, and what is not ────────────────────────');

let visitA;
{
  const v = await A.recordVisit({
    sessionId: 'v_test_session_one',
    query: {
      utm_source: 'tiktok', utm_medium: 'paid', utm_campaign: 'launch-week',
      creative_id: 'adtest-1000-B', campaign_id: 'C-1', ttclid: 'EAAsecret123',
      product: 'ADTEST-1000',
    },
    path: '/product/adtest',
    referrer: 'https://www.tiktok.com/@someone/video/123?secret=abc',
  });
  visitA = v?.id;
  ok('a tagged arrival is recorded', !!visitA);

  const row = await get('SELECT * FROM ad_visits WHERE id=@id', { id: visitA });
  ok('the creative id is stored', row.creative_id === 'adtest-1000-B', row.creative_id);
  ok('the campaign id is stored', row.campaign_id === 'C-1', row.campaign_id);
  ok('the network is derived', row.network === 'tiktok', row.network);
  ok('the product parameter resolves to a product id',
    row.product_id === PRODUCT, `${row.product_id} != ${PRODUCT}`);

  /* The privacy promise, checked against the row rather than against the
     comment that makes it. A click id is a per-person handle and its only use
     is posting conversions back to the network — which nobody asked for. */
  const serialised = JSON.stringify(row);
  ok('the click id itself is never stored', !serialised.includes('EAAsecret123'), serialised);
  ok('the referrer is reduced to a host', row.referrer_host === 'tiktok.com', row.referrer_host);
  ok('the referrer query string is not kept', !serialised.includes('secret=abc'));

  const cols = (await all(
    `SELECT column_name FROM information_schema.columns WHERE table_name='ad_visits'`))
    .map((c) => c.column_name);
  for (const forbidden of ['ip', 'ip_address', 'user_agent', 'email', 'click_id', 'fingerprint']) {
    ok(`ad_visits has no ${forbidden} column`, !cols.includes(forbidden));
  }
}

{
  const before = (await get('SELECT COUNT(*) AS n FROM ad_visits')).n;
  await A.recordVisit({ sessionId: 'v_untagged', query: { page: '2' }, path: '/shop' });
  ok('an untagged arrival writes nothing',
    (await get('SELECT COUNT(*) AS n FROM ad_visits')).n === before);
}

{
  // A tap, a back, a tap again is one click as far as TikTok is concerned.
  const again = await A.recordVisit({
    sessionId: 'v_test_session_one',
    query: { utm_source: 'tiktok', utm_campaign: 'launch-week', creative_id: 'adtest-1000-B', campaign_id: 'C-1' },
    path: '/product/adtest',
  });
  ok('a reload within the hour reuses the visit', again?.id === visitA && again?.deduped === true,
    JSON.stringify(again));
}

console.log('\n── Consent: counted, or counted and followed ───────────────');

let anonVisit;
{
  const v = await A.recordVisit({
    sessionId: null,          // marketing refused: nothing stored on the device
    query: { utm_source: 'youtube', utm_campaign: 'launch-week', creative_id: 'adtest-1000-C' },
    path: '/',
  });
  anonVisit = v?.id;
  ok('an arrival with no identifier is still counted', !!anonVisit);
  const row = await get('SELECT session_id FROM ad_visits WHERE id=@id', { id: anonVisit });
  ok('…and stored without one', row.session_id === null, String(row.session_id));

  const e = await A.recordEvent({ sessionId: null, kind: 'product_view', productId: PRODUCT });
  ok('…but cannot be followed to a product view', e === null);
}

console.log('\n── The funnel ──────────────────────────────────────────────');

{
  await A.recordEvent({ visitId: visitA, kind: 'product_view', productId: PRODUCT });
  await A.recordEvent({ visitId: visitA, kind: 'product_view', productId: PRODUCT });
  await A.recordEvent({ visitId: visitA, kind: 'product_view', productId: PRODUCT });
  const views = (await get(
    `SELECT COUNT(*) AS n FROM ad_events WHERE visit_id=@v AND kind='product_view'`, { v: visitA })).n;
  ok('re-reading a product page is one product view, not four', Number(views) === 1, String(views));

  await A.recordEvent({ sessionId: 'v_test_session_one', kind: 'checkout' });
  await A.recordEvent({ sessionId: 'v_test_session_one', kind: 'checkout' });
  const cos = (await get(
    `SELECT COUNT(*) AS n FROM ad_events WHERE visit_id=@v AND kind='checkout'`, { v: visitA })).n;
  ok('a checkout is recorded once per visit', Number(cos) === 1, String(cos));
  ok('an event resolves the visit from the session id alone', Number(cos) === 1);

  ok('an unknown event kind is refused',
    (await A.recordEvent({ visitId: visitA, kind: 'wishlist' })) === null);
}

console.log('\n── The sale ────────────────────────────────────────────────');

{
  const orderId = newId('ord');
  await run(
    `INSERT INTO orders (id, number, email, status, currency, subtotal, total, created_at, updated_at)
     VALUES (@id, 'FM-TEST-ATTACH', 'buyer@example.test', 'pending', 'EUR', 999, 999, @at, @at)`,
    { id: orderId, at: nowIso() });

  await A.attachOrder(orderId, { sessionId: 'v_test_session_one' });
  ok('an order is attributed to the visit that produced it',
    (await get('SELECT ad_visit_id FROM orders WHERE id=@id', { id: orderId })).ad_visit_id === visitA);

  // A later advert must not steal a sale that is already spoken for.
  const later = await A.recordVisit({
    sessionId: 'v_test_session_one',
    query: { utm_source: 'youtube', creative_id: 'adtest-1000-STEALER' }, path: '/' });
  await A.attachOrder(orderId, { visitId: later.id });
  ok('a second attach cannot re-attribute the sale',
    (await get('SELECT ad_visit_id FROM orders WHERE id=@id', { id: orderId })).ad_visit_id === visitA);

  ok('a forged visit id attributes nothing',
    (await A.attachOrder(orderId, { visitId: 'adv_does_not_exist' })) === null);
}

console.log('\n── The arithmetic ──────────────────────────────────────────');

{
  /* The fan-out. visitA now carries a product view AND a checkout AND a paid
     order. Joined naively that is two event rows beside one order row, and the
     revenue comes back doubled. */
  await run(`UPDATE orders SET status='completed' WHERE number='FM-TEST-ATTACH'`);

  const creatives = await A.creativePerformance({ days: 30 });
  const row = creatives.find((c) => c.creative === 'adtest-1000-B');
  ok('the creative appears in the report', !!row, JSON.stringify(creatives));
  ok('its revenue is not multiplied by its event count', row.revenue === 999, String(row.revenue));
  ok('it counts one purchase', row.purchases === 1, String(row.purchases));
  ok('it counts one visit', row.visits === 1, String(row.visits));
  ok('it counts one product view', row.productViews === 1, String(row.productViews));
  ok('it counts one checkout', row.checkouts === 1, String(row.checkouts));
  ok('its conversion rate is a real number', row.conversionRate === 100, String(row.conversionRate));

  // A creative that has run and not sold has a rate of 0. One that has not run
  // has no rate at all — showing 0% for it reads as "this advert fails".
  const cold = creatives.find((c) => c.creative === 'adtest-1000-C');
  ok('a creative with visits and no sale reports 0%, not null',
    cold && cold.conversionRate === 0, JSON.stringify(cold));
}

{
  // Money that was never paid is not revenue, in this report or any other.
  const v = await A.recordVisit({
    sessionId: 'v_unpaid', query: { utm_source: 'tiktok', creative_id: 'adtest-1000-UNPAID' }, path: '/' });
  await paidOrder(v.id, 5000, 'pending');
  await paidOrder(v.id, 7000, 'refunded');
  const row = (await A.creativePerformance({ days: 30 })).find((c) => c.creative === 'adtest-1000-UNPAID');
  ok('an unpaid order is not a purchase', row.purchases === 0, JSON.stringify(row));
  ok('a refunded order is not revenue', row.revenue === 0, String(row.revenue));
}

{
  // Two paid orders on one visit is two purchases and the sum of both.
  const v = await A.recordVisit({
    sessionId: 'v_two', query: { utm_source: 'tiktok', creative_id: 'adtest-1000-TWO' }, path: '/' });
  await paidOrder(v.id, 1000);
  await paidOrder(v.id, 2500);
  await A.recordEvent({ visitId: v.id, kind: 'product_view', productId: PRODUCT });
  await A.recordEvent({ visitId: v.id, kind: 'checkout' });
  const row = (await A.creativePerformance({ days: 30 })).find((c) => c.creative === 'adtest-1000-TWO');
  ok('two sales on one visit are two purchases', row.purchases === 2, JSON.stringify(row));
  ok('…and the revenue is their sum, not a multiple', row.revenue === 3500, String(row.revenue));
}

console.log('\n── The report ──────────────────────────────────────────────');

{
  const f = await A.funnel({ days: 30 });
  const stage = (id) => f.stages.find((s) => s.id === id).count;
  ok('the funnel has all four measured stages', f.stages.length === 4);
  ok('the funnel does not claim to measure clicks', f.adClicksMeasured === false);
  ok('visits are counted', stage('visit') >= 5, String(stage('visit')));
  ok('product views are counted', stage('product_view') === 2, String(stage('product_view')));
  ok('checkouts are counted', stage('checkout') === 2, String(stage('checkout')));
  ok('purchases are counted', stage('purchase') === 3, String(stage('purchase')));
  ok('funnel revenue matches the paid orders', f.revenue === 999 + 3500, String(f.revenue));
  ok('visitors who refused to be followed are surfaced, not hidden',
    f.notFollowed === 1, String(f.notFollowed));

  const camps = await A.campaignPerformance({ days: 30 });
  const launch = camps.find((c) => c.campaign === 'launch-week');
  ok('campaigns roll the creatives up', !!launch && launch.creatives === 2, JSON.stringify(launch));
  // One campaign pushed to two networks is one row listing both — not two rows
  // that each look like a smaller campaign than the one that actually ran.
  ok('a campaign on two networks stays one campaign',
    launch.visits === 2 && launch.networks.join(',') === 'tiktok,youtube', JSON.stringify(launch));
  ok('the campaign rollup revenue is not multiplied', launch.revenue === 999, String(launch.revenue));
}

{
  const old = new Date(Date.now() - 500 * 86_400_000).toISOString();
  await run(`INSERT INTO ad_visits (id, session_id, creative_id, created_at)
             VALUES (@id, 'v_old', 'ancient', @at)`, { id: newId('adv'), at: old });
  const r = await A.pruneAttribution();
  ok('rows past the retention window are pruned', r.removed === 1, JSON.stringify(r));
  ok('…and the rest survive',
    Number((await get(`SELECT COUNT(*) AS n FROM ad_visits WHERE creative_id='adtest-1000-B'`)).n) === 1);
}

console.log('\n── Wiring ──────────────────────────────────────────────────');

{
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const rd = (p) => fs.readFileSync(path.join(root, p), 'utf8');

  ok('the checkout sends its attribution with the order',
    rd('src/pages/Checkout.jsx').includes('...attributionForOrder()'));
  ok('the product page reports a product view',
    /reportStep\('product_view'/.test(rd('src/pages/ProductDetail.jsx')));
  ok('the checkout page reports a checkout',
    /reportStep\('checkout'\)/.test(rd('src/pages/Checkout.jsx')));
  ok('landings are watched on every route',
    rd('src/App.jsx').includes('useAdAttribution()'));
  ok('the order route accepts and attaches the attribution',
    /adVisit: z\.string/.test(rd('server/src/routes/catalog.js'))
    && rd('server/src/routes/catalog.js').includes('attachOrder(order.id'));

  /* Withdrawing consent has to delete what is already on the device. fm_attr
     lives in sessionStorage, and a purge that only clears localStorage is a
     purge that leaves the identifier it promised to remove. */
  const consent = rd('src/lib/consent.js');
  ok('refusing marketing purges the attribution id', consent.includes("'fm_attr'"));
  ok('…from sessionStorage too', /sessionStorage\.removeItem/.test(consent));

  ok('the admin report is behind the analytics permission',
    rd('server/src/routes/admin/analytics.js').includes("requirePermission('analytics.read')")
    && rd('server/src/routes/admin/analytics.js').includes("'/attribution'"));
}

console.log('\n── When the reporting breaks ───────────────────────────────');

{
  /* Attribution is reporting. A shop that cannot take a paid-for order because
     its advert bookkeeping fell over is a far worse outcome than not knowing
     which advert sold it — so every path here swallows its own errors and the
     order goes through regardless.
     Asserted by removing the tables outright, which is the bluntest version of
     every failure this could have. LAST in the file on purpose: nothing below
     this point has an ad_visits table to query. */
  const { exec } = await import('../src/db/index.js');
  await exec('DROP TABLE ad_events; DROP TABLE ad_visits;');
  const quiet = console.error; console.error = () => {};   // the noise is the point

  ok('recordVisit degrades to nothing',
    (await A.recordVisit({ sessionId: 'v_x', query: { utm_source: 'tiktok' }, path: '/' })) === null);
  ok('recordEvent degrades to nothing',
    (await A.recordEvent({ sessionId: 'v_x', kind: 'product_view' })) === null);
  ok('adoptVisit degrades to nothing', (await A.adoptVisit('adv_x', 'v_x')) === null);

  const oid = newId('ord');
  await run(
    `INSERT INTO orders (id, number, email, status, currency, subtotal, total, created_at, updated_at)
     VALUES (@id, 'FM-TEST-NOATTR', 'buyer@example.test', 'pending', 'EUR', 100, 100, @at, @at)`,
    { id: oid, at: nowIso() });
  ok('attachOrder degrades to nothing', (await A.attachOrder(oid, { sessionId: 'v_x' })) === null);
  ok('…and the order is still there, untouched',
    (await get('SELECT status FROM orders WHERE id=@id', { id: oid }))?.status === 'pending');

  console.error = quiet;
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ad attribution: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
