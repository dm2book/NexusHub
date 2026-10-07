/**
 * The ad platforms' numbers in, and the catalogue out.
 *
 *   CSV  — a Dutch Meta export split by platform, an English TikTok export;
 *          numbers in either notation; a second import of the same days
 *          replaces, never doubles; a file without the needed columns says
 *          which ones.
 *   API  — Meta Insights and TikTok reporting, paginated, against canned
 *          answers; nothing happens without keys.
 *   Feed — only products with a catalogue image, platform-ready columns,
 *          tagged links; served as CSV.
 *   And: carousel cards, and a code product's video no longer opens about
 *   passwords.
 */
import './_selling-shop.mjs';   // must come first — see that file
import { ensureReady, createApp } from '../src/app.js';
import { all, get, run } from '../src/db/index.js';
import { createProduct } from '../src/services/productService.js';
import { config } from '../src/config/env.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
await ensureReady();
const S = await import('../src/services/adSpendSyncService.js');
const tag = Date.now().toString(36);

console.log('— Parsing what the platforms export —');
ok('numbers in Dutch notation', S.parseNumber('1.234,56') === 1234.56 && S.parseNumber('€ 12,50') === 12.5);
ok('numbers in English notation', S.parseNumber('1,234.56') === 1234.56 && S.parseNumber('12') === 12);
ok('a dot or comma between thousands is a thousands separator', S.parseNumber('1.200') === 1200 && S.parseNumber('3.400.000') === 3400000 && S.parseNumber('1,200') === 1200 && S.parseNumber('12,5') === 12.5);
ok('an empty or "--" cell is nothing, not zero', S.parseNumber('') === null && S.parseNumber('--') === null);
ok('days: ISO, Dutch day-month-year, US month/day/year', S.parseDay('2026-10-05') === '2026-10-05'
  && S.parseDay('5-10-2026') === '2026-10-05' && S.parseDay('10/05/2026') === '2026-10-05');
ok('semicolon CSV with quotes (Dutch Excel)', JSON.stringify(S.parseCsv('a;b\n"x;y";"he said ""hi"""\n')) === '[["a","b"],["x;y","he said \\"hi\\""]]');

console.log('\n— Importing a Meta export (Dutch, by platform) —');
const camp = `camp-${tag}`;
const meta = [
  'Dag;Campagnenaam;Advertentienaam;Platform;Weergaven;Linkklikken;Besteed bedrag (EUR)',
  `2026-10-01;${camp};robux-price-square-nl;facebook;1.200;24;"12,50"`,
  `2026-10-01;${camp};robux-price-square-nl;instagram;3.400;51;"20,10"`,
  `2026-10-01;${camp};robux-price-square-nl;instagram;100;2;"0,40"`,      // a second placement row, same day
  `2026-10-02;${camp};robux-price-square-nl;facebook;900;9;"7,00"`,
].join('\n');
const r1 = await S.importCsv(meta, { network: 'meta' });
const rows = await all(`SELECT day, network, impressions, clicks, spend_cents, source FROM ad_spend WHERE campaign=@c ORDER BY day, network`, { c: camp });
ok('one row per day, network and ad', r1.written === 3 && rows.length === 3, JSON.stringify(rows));
ok('facebook and instagram are separate networks', rows.some((r) => r.network === 'facebook') && rows.some((r) => r.network === 'instagram'));
const ig = rows.find((r) => r.network === 'instagram');
ok('placement rows of one ad and day are summed', Number(ig.impressions) === 3500 && Number(ig.clicks) === 53 && Number(ig.spend_cents) === 2050, JSON.stringify(ig));
ok('the source says it was imported', rows.every((r) => r.source === 'import'));
await S.importCsv(meta, { network: 'meta' });
const again = await get(`SELECT COUNT(*)::int AS n, SUM(spend_cents)::int AS s FROM ad_spend WHERE campaign=@c`, { c: camp });
ok('importing the same file again replaces, it does not double', again.n === 3 && again.s === 1250 + 2050 + 700, JSON.stringify(again));
let err = null;
try { await S.importCsv('Campaign name;Impressions\nx;1\n', { network: 'meta' }); } catch (e) { err = e; }
ok('a file without a date or spend column says which columns are missing', err && /day, spend/.test(err.message), err?.message);

console.log('\n— Importing a TikTok export (English) —');
const tcamp = `tt-${tag}`;
const tik = ['By Day,Campaign name,Ad name,Cost,Impressions,Clicks (destination)',
  `2026-10-03,${tcamp},ugc-01,"1,234.50",120000,1800`].join('\n');
const r2 = await S.importCsv(tik, { network: 'tiktok' });
const tr = await get(`SELECT network, spend_cents, impressions, clicks FROM ad_spend WHERE campaign=@c`, { c: tcamp });
ok('TikTok rows land as tiktok, spend in cents', r2.written === 1 && tr.network === 'tiktok' && Number(tr.spend_cents) === 123450 && Number(tr.clicks) === 1800, JSON.stringify(tr));

console.log('\n— Pulling from the APIs —');
ok('without keys nothing is called', (await S.syncMeta({ fetchImpl: () => { throw new Error('called'); } })).skipped === 'not configured');
config.adPlatforms.meta.token = 'test-token'; config.adPlatforms.meta.accountId = '123';
config.adPlatforms.tiktok.token = 'test-token'; config.adPlatforms.tiktok.advertiserId = '456';
const mcamp = `api-${tag}`;
const calls = [];
const metaFetch = async (url) => {
  calls.push(url);
  const page2 = /after=2/.test(url);
  return new Response(JSON.stringify({
    data: [{ date_start: page2 ? '2026-10-05' : '2026-10-04', campaign_name: mcamp, ad_name: 'catalog', publisher_platform: page2 ? 'instagram' : 'facebook',
      impressions: '1000', inline_link_clicks: '10', spend: '4.20' }],
    paging: page2 ? {} : { next: `https://graph.facebook.com/next?after=2` },
  }), { status: 200 });
};
const m = await S.syncMeta({ days: 3, fetchImpl: metaFetch });
ok('Meta: every page is followed', m.written === 2 && m.pages === 2 && calls.length === 2, JSON.stringify(m));
ok('…split by platform, ad level, daily, and read-only fields', /level=ad/.test(calls[0]) && /breakdowns=publisher_platform/.test(calls[0]) && /time_increment=1/.test(calls[0]));
const mm = await all(`SELECT network, spend_cents FROM ad_spend WHERE campaign=@c ORDER BY day`, { c: mcamp });
ok('…stored as facebook and instagram, spend in cents', mm.map((x) => `${x.network}:${x.spend_cents}`).join() === 'facebook:420,instagram:420', JSON.stringify(mm));
const tFetch = async (url, init) => new Response(JSON.stringify({ code: 0, data: {
  list: [{ dimensions: { ad_id: '1', stat_time_day: '2026-10-04 00:00:00' }, metrics: { campaign_name: `tapi-${tag}`, ad_name: 'ugc-02', spend: '3.10', impressions: '5000', clicks: '40' } }],
  page_info: { total_page: 1 } } }), { status: 200, headers: { 'x-token-seen': init?.headers?.['Access-Token'] || '' } });
const t = await S.syncTikTok({ days: 3, fetchImpl: tFetch });
const tt = await get(`SELECT day, spend_cents FROM ad_spend WHERE campaign=@c`, { c: `tapi-${tag}` });
ok('TikTok: day from stat_time_day, spend in cents', t.written === 1 && tt.day === '2026-10-04' && Number(tt.spend_cents) === 310, JSON.stringify(tt));
const bad = await S.syncAll({ days: 1 }).catch((e) => ({ thrown: e.message }));
ok('a platform error is recorded, not thrown, and the other still runs', !bad.thrown && 'meta' in bad && 'tiktok' in bad, JSON.stringify(bad).slice(0, 200));
config.adPlatforms.meta.token = ''; config.adPlatforms.tiktok.token = '';
const st = await S.syncStatus();
ok('the page gets the tracking parameters that make rows meet their sales',
  /\{\{ad\.name\}\}/.test(st.tracking.meta) && /__CID_NAME__/.test(st.tracking.tiktok) && /\{\{site_source_name\}\}/.test(st.tracking.meta));
ok('…and the spend that no visit carries the name of', st.unmatched.some((u) => u.campaign === camp));

console.log('\n— The catalogue feed —');
const F = await import('../src/services/productFeedService.js');
const p1 = await createProduct({ name: `1,000 Robux ${tag}`, category: 'robux', price: 999, announce: false });
const p2 = await createProduct({ name: `2,000 Robux ${tag}`, category: 'robux', price: 1799, announce: false });
const { storeImage } = await import('../src/services/imageStoreService.js');
const jpg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
const stored = await storeImage('image/jpeg', Buffer.concat([jpg, Buffer.from(tag)]), { productId: p1.id, source: 'ad-feed' });
await F.setFeedImage(p1.id, stored.url);
const feed = await F.feedRows({ network: 'tiktok', lang: 'nl' });
const row = feed.rows.find((r) => r.id === p1.id);
ok('a product with a catalogue image is in the feed', !!row);
ok('…one without is left out and counted', !feed.rows.some((r) => r.id === p2.id) && feed.withoutImage >= 1);
ok('platform-ready values: price "9.99 EUR", condition new, an availability value both accept',
  row.price === '9.99 EUR' && row.condition === 'new' && ['in stock', 'available for order'].includes(row.availability), JSON.stringify(row));
ok('the image is an absolute JPG URL, the brand is the game', /^https?:\/\/.+\/api\/images\/[a-f0-9]+\.jpg$/.test(row.image_link) && row.brand === 'Roblox', `${row.image_link} ${row.brand}`);
ok('the link is tagged for this network and product', /utm_source=tiktok/.test(row.link) && new RegExp(`utm_content=${row.id}`).test(row.link));
const srv = createApp().listen(0);
const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/feeds/products.csv?network=meta`);
const csv = await res.text();
srv.close();
ok('served as CSV with a header row the platforms read', /text\/csv/.test(res.headers.get('content-type')) && csv.startsWith('id,title,description,availability,condition,price,link,image_link,brand'));

console.log('\n— Carousel, and the video opening for a code —');
{
  const statics = await import('../../src/lib/adStudio/statics.js');
  const { staticAds } = await import('../src/services/adStaticsService.js');
  const ad = await staticAds(p1.id, 'nl');
  const cards = statics.carouselCards(ad);
  ok('a carousel: one card per amount, then a closing card', ad.ladder && cards.length === ad.ladder.length + 1 && cards.at(-1).kind === 'end');
  const steam = await createProduct({ name: `Steam Wallet €25 ${tag}`, category: 'giftcard', price: 2699, announce: false });
  const { buildStoryboard } = await import('../src/services/adStudioService.js');
  const b = await buildStoryboard({ productId: steam.id, angles: ['trust'], length: 15, lang: 'nl' });
  ok('a code product\'s video opens on the code, not on passwords', b.scenes[0].data.big === 'GEEN GEDOE.' && !/wachtwoord/i.test(b.scenes[0].voice), b.scenes[0].voice);
}

console.log(`\n${fail ? '❌' : '✅'} ad-platform-sync: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
