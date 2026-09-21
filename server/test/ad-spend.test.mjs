/**
 * Ad spend, end to end: the numbers only the platform has, and what they unlock.
 *
 * The parts that only exist once there is a database:
 *
 *   · re-importing yesterday's export UPDATES rather than doubling the spend.
 *     Doubling it halves every ROAS on the page and reads as "the adverts got
 *     worse", which is the most expensive wrong conclusion this report can
 *     produce;
 *   · spend entered against a campaign is not spread across that campaign's
 *     creatives — that invents a per-creative ROAS out of one total, and it is
 *     exactly the number somebody would act on;
 *   · the write needs a WRITE permission, not the reporting grant the route
 *     file happened to have at hand.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';
import { sha256 } from '../src/utils/crypto.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { createProduct } = await import('../src/services/productService.js');
const { requestEmailOtp } = await import('../src/services/authService.js');
const attribution = await import('../src/services/attributionService.js');
const adPerf = await import('../src/services/adPerformanceService.js');
const { run, get, all } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');

const app = createApp();
const srv = app.listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const today = new Date().toISOString().slice(0, 10);

const email = 'mohamedelhannouti51@gmail.com';
await requestEmailOtp(email, {});
const otp = await get(
  `SELECT id FROM otp_codes WHERE email=@e AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
  { e: email });
await run(`UPDATE otp_codes SET code_hash=@h WHERE id=@id`, { h: sha256('654321'), id: otp.id });
const login = await (await fetch(`${base}/api/auth/otp/verify`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, code: '654321' }) })).json();
const auth = { 'content-type': 'application/json', authorization: `Bearer ${login.accessToken}` };
ok('staff signs in', !!login.accessToken);

console.log('\n— One row per creative per day, however many times it is imported —');
{
  await adPerf.recordSpend({ day: today, network: 'tiktok', campaign: 'launch',
    creative: 'ad-A', impressions: 50000, clicks: 400, spendCents: 5000 });
  const again = await adPerf.recordSpend({ day: today, network: 'tiktok', campaign: 'launch',
    creative: 'ad-A', impressions: 52000, clicks: 410, spendCents: 5200 });
  const rows = await all(`SELECT * FROM ad_spend WHERE creative='ad-A' AND day=@d`, { d: today });
  ok('a second import does not make a second row', rows.length === 1, String(rows.length));
  ok('…it corrects the first', Number(again.spend_cents) === 5200 && Number(again.impressions) === 52000);
}

console.log('\n— A spend row has to be possible —');
{
  const bad = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
  ok('a day that is not a day is refused',
    /YYYY-MM-DD/.test(await bad(() => adPerf.recordSpend({ day: 'yesterday', network: 'tiktok', spendCents: 1 }))));
  ok('a row with no network is refused',
    /network/.test(await bad(() => adPerf.recordSpend({ day: today, spendCents: 1 }))));
  ok('a row with nothing in it is refused',
    /records nothing/.test(await bad(() => adPerf.recordSpend({ day: today, network: 'tiktok' }))));
  ok('negative spend is refused',
    /not negative/.test(await bad(() => adPerf.recordSpend({ day: today, network: 'tiktok', spendCents: -5 }))));
  /* More clicks than impressions is a mis-mapped column in somebody's CSV, and
     it would put a CTR above 100% on the page. */
  ok('more clicks than impressions is refused',
    /check the columns/.test(await bad(() => adPerf.recordSpend({
      day: today, network: 'tiktok', creative: 'x', impressions: 10, clicks: 99 }))));
}

// ── A real click, a real funnel, a real order ─────────────────────────────
const product = await createProduct({ name: 'Ad Test Pack', category: 'robux',
  price: 1000, announce: false });

const landAndBuy = async (creative, { visits, buys }) => {
  for (let i = 0; i < visits; i++) {
    const v = await attribution.recordVisit({
      sessionId: `sess-${creative}-${i}`,
      query: { utm_source: 'tiktok', utm_campaign: 'launch', utm_content: creative },
      path: '/robux', referrer: 'https://www.tiktok.com/',
    });
    await attribution.recordEvent({ visitId: v.id, kind: 'checkout' }).catch(() => {});
    if (i < buys) {
      const orderId = newId('ord');
      await run(
        `INSERT INTO orders (id, number, email, status, subtotal, total, currency, created_at, updated_at)
         VALUES (@id, @num, @email, 'completed', @total, @total, 'EUR', @at, @at)`,
        { id: orderId, num: `FM-AD-${creative}-${i}`, email: `buyer-${creative}-${i}@example.test`,
          total: 1000, at: new Date().toISOString() });
      await attribution.attachOrder(orderId, { visitId: v.id });
    }
  }
};

await landAndBuy('ad-A', { visits: 40, buys: 8 });
await landAndBuy('ad-B', { visits: 40, buys: 1 });

console.log('\n— The report, over real arrivals —');
{
  const rep = await adPerf.adPerformance({ days: 30, minVisits: 30 });
  const a = rep.creatives.find((c) => c.creative === 'ad-A');
  const b = rep.creatives.find((c) => c.creative === 'ad-B');
  ok('both creatives are there', !!a && !!b, JSON.stringify(rep.creatives.map((c) => c.creative)));
  ok('landings are counted', a.visits === 40 && b.visits === 40);
  ok('checkout starts are counted', a.checkouts === 40, String(a.checkouts));
  ok('purchases and revenue are counted', a.purchases === 8 && a.revenueCents === 8000);
  ok('conversion rate is computed', a.conversionRate === 20, String(a.conversionRate));

  /* ad-A has spend recorded; ad-B does not. One report, two evidence states. */
  ok('the creative with spend has a ROAS', a.roas === 8000 / 5200 || a.roas === 1.54, String(a.roas));
  ok('…and a CTR off its impressions', a.ctr != null && a.impressions === 52000);
  ok('the one without has neither', b.roas === null && b.ctr === null);
  ok('…and says why', /no spend recorded/.test(b.roasBasis));
}

console.log('\n— Campaign-level spend is not spread across creatives —');
{
  await adPerf.recordSpend({ day: today, network: 'tiktok', campaign: 'launch',
    creative: null, spendCents: 99999 });
  const rep = await adPerf.adPerformance({ days: 30, minVisits: 30 });
  const b = rep.creatives.find((c) => c.creative === 'ad-B');
  ok('a creative with no spend row of its own still has no ROAS', b.roas === null);
  /* It is not lost either — it is reported as spend nothing could be matched to,
     which is a number worth seeing rather than one to quietly drop. */
  ok('but the money is not lost from the totals',
    rep.totals.unattributedSpendCents >= 99999, String(rep.totals.unattributedSpendCents));
  await run(`DELETE FROM ad_spend WHERE creative IS NULL`);
}

console.log('\n— Grading over the real set —');
{
  await landAndBuy('ad-C', { visits: 40, buys: 4 });
  const rep = await adPerf.adPerformance({ days: 30, minVisits: 30 });
  const grades = Object.fromEntries(rep.creatives.map((c) => [c.creative, c.grade]));
  ok('three creatives with traffic can be compared',
    Object.values(grades).filter((g) => g !== 'unrated').length >= 3, JSON.stringify(grades));
  ok('the best converter is the winner', grades['ad-A'] === 'winner', JSON.stringify(grades));
  ok('the worst is the loser', grades['ad-B'] === 'loser');
  ok('the counts add up',
    Object.values(rep.counts).reduce((x, y) => x + y, 0) === rep.creatives.length);
}

console.log('\n— The chart has a point per day, on one measure —');
{
  const ts = await adPerf.adTimeseries({ days: 30, metric: 'conversion' });
  ok('it returns series', ts.series.length > 0, JSON.stringify(ts.series.map((s) => s.name)));
  ok('…named by creative', ts.series.every((s) => typeof s.name === 'string'));
  ok('…carrying one value per point', ts.series[0].points.every(
    (p) => typeof p.value === 'number' && typeof p.at === 'string'));
  ok('…for the metric asked for', ts.metric === 'conversion');
  /* All of today, so one point each — and the chart is told rather than drawing
     a line through a single dot. */
  ok('one day of data is not a line', ts.enoughToPlot === false, JSON.stringify(ts.series[0].points));
}

console.log('\n— The endpoints —');
{
  const r = await fetch(`${base}/api/admin/analytics/ads?days=30`, { headers: auth });
  const body = await r.json();
  ok('staff can read the report', r.status === 200 && Array.isArray(body.creatives));
  ok('…with the evidence state', !!body.evidence && Array.isArray(body.evidence.blockers));
  ok('…and the totals', typeof body.totals?.revenueCents === 'number');

  const ts = await fetch(`${base}/api/admin/analytics/ads/timeseries?metric=roas`, { headers: auth });
  ok('the chart endpoint answers', ts.status === 200);
  const badMetric = await fetch(`${base}/api/admin/analytics/ads/timeseries?metric=vibes`, { headers: auth });
  ok('an unknown metric is refused', badMetric.status === 400, String(badMetric.status));

  const post = await fetch(`${base}/api/admin/analytics/ads/spend`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ day: today, network: 'instagram', creative: 'ig-1', spendCents: 2500 }) });
  ok('spend can be recorded over HTTP', post.status === 200, String(post.status));

  const anon = await fetch(`${base}/api/admin/analytics/ads`);
  ok('a stranger can read nothing', anon.status === 401 || anon.status === 403, String(anon.status));
}

console.log('\n— Recording spend is a write, and needs a write permission —');
{
  const perms = await all(`SELECT id FROM permissions WHERE id LIKE 'analytics%'`).catch(() => []);
  ok('analytics.write exists as its own permission',
    perms.some((p) => p.id === 'analytics.write'), JSON.stringify(perms));
  /* It sat behind analytics.read because that was the permission the route file
     already had — which is how a reporting grant quietly becomes a way to enter
     the figures every ROAS is computed from. */
  const routeSrc = (await import('node:fs')).readFileSync(
    new URL('../src/routes/admin/analytics.js', import.meta.url), 'utf8');
  ok('…and the spend route asks for it',
    /ads\/spend', requirePermission\('analytics\.write'\)/.test(routeSrc));
}

srv.close();
console.log(`\n${fail === 0 ? '✅' : '❌'} ad-spend: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
