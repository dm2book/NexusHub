/**
 * Ad creatives at the level of the marketplaces they compete with.
 *
 * What an Eneba- or G2A-style paid-social creative always has, checked here
 * against what this shop now produces — video (Ad Studio) and stills (Static
 * ads):
 *
 *   the product itself, as its own card — not a generic category icon;
 *   the brand's own colours, not one purple for everything;
 *   the price, big, and a clear button;
 *   the product in the very first frame (the thumbnail);
 *   every format a network asks for: 1:1, 4:5, 9:16 — in four languages;
 *   nothing outside the safe area, nothing on top of something else;
 *   and still: only what the shop can prove (the claim gate decides).
 *
 * The layout is checked with a measuring stand-in for a canvas, so the boxes
 * drawStatic reports are the ones a real browser would draw (text widths are
 * estimated generously, which errs towards finding overlaps).
 */
import './_selling-shop.mjs';   // must come first — see that file
import { readFileSync } from 'node:fs';
import { ensureReady } from '../src/app.js';
import { run, nowIso } from '../src/db/index.js';
import { createProduct } from '../src/services/productService.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
await ensureReady();
const tag = Date.now().toString(36);
const mk = (name, price, category) => createProduct({ name: `${name}`, sku: `CR-${name.replace(/\W+/g, '')}-${tag}`, category, price, currency: 'EUR', active: true, announce: false });
const rbx = await mk(`1,000 Robux ${tag}`, 999, 'robux');
await mk(`2,000 Robux ${tag}`, 1799, 'robux');
await mk(`4,500 Robux ${tag}`, 3899, 'robux');
const fc = await mk(`2,800 FC Points PlayStation ${tag}`, 2299, 'eafc');
const steam = await mk(`Steam Wallet €25 ${tag}`, 2699, 'giftcard');

/* Twelve visible reviews, so the rating design has something real to show. */
for (let i = 0; i < 12; i++) {
  await run(`INSERT INTO reviews (id, author, stars, body, source, status, created_at, verified)
             VALUES (@id, 'Koper', @s, 'Snel geleverd.', 'site', 'visible', @at, 1)`,
    { id: `rv_cr_${tag}_${i}`, s: i < 10 ? 5 : 4, at: nowIso() }).catch(() => {});
}
const { staticAds, STATIC_FORMATS } = await import('../src/services/adStaticsService.js');
const { buildStoryboard } = await import('../src/services/adStudioService.js');
const { adTheme } = await import('../src/services/ads/adArt.js');

console.log('— Video: the product, in its colours, from the first frame —');
{
  const b = await buildStoryboard({ productId: rbx.id, platform: 'tiktok', length: 15, lang: 'nl' });
  const types = b.scenes.map((s) => s.type);
  ok('a 15-second ad has a product scene before the close', types.includes('offer') && types.indexOf('offer') === types.length - 2, types.join(','));
  ok('the image is the product\'s own card, not the category icon', b.scenes.every((s) => /\/api\/products\/[^/]+\/tile\.svg$|^\/api\/images\//.test(s.data.image || '')), b.scenes[0].data.image);
  ok('the board carries the brand palette', !!b.theme?.bg && !!b.theme?.accent && b.theme.key === 'robux');
  const offer = b.scenes.find((s) => s.type === 'offer');
  ok('the product scene names the amount and the price', /1\.000 Robux/.test(offer.data.name) && /€9,99/.test(offer.data.price));
  const end = b.scenes.find((s) => s.type === 'end');
  ok('the close shows the price again, not only the address', /€9,99/.test(end.data.price || ''));
  const bf = await buildStoryboard({ productId: fc.id, platform: 'tiktok', length: 15, lang: 'nl' });
  ok('a platform-bound code says which platform', bf.scenes.find((s) => s.type === 'offer')?.data.platform === 'Voor PlayStation');
  ok('…and its ad is EA FC green, not Robux', bf.theme.key === 'eafc' && bf.theme.accent !== b.theme.accent);
  const eng = readFileSync(new URL('../../src/lib/adStudio/engine.js', import.meta.url), 'utf8');
  ok('the engine draws the theme behind every scene', /background\(ctx, G, t, accent, assets\.grain, Math\.round\(t \* 30\), timeline\.theme/.test(eng));
  ok('the hook shows the card from frame 0 (the thumbnail)', /hook\(ctx, G, d, u, A\) \{[\s\S]{0,400}hero\(ctx, G, img/.test(eng));
}

console.log('\n— Stills: the right designs for the right product —');
const R = await staticAds(rbx.id, 'nl');
const F = await staticAds(fc.id, 'nl');
const G = await staticAds(steam.id, 'nl');
const ids = (a) => a.templates.map((t) => t.id);
ok('Robux: price, amounts, "free Robux is fake", username-not-password, refund, price per 1,000', ['price', 'ladder', 'myth', 'password', 'refund', 'value'].every((x) => ids(R).includes(x)), ids(R).join(','));
ok('…the amounts are real sibling packs, this one lit', R.ladder?.length === 3 && R.ladder.filter((x) => x.self).length === 1 && R.ladder.map((x) => x.price).join(' ') === '€9,99 €17,99 €38,99', JSON.stringify(R.ladder?.map((x) => x.price)));
ok('a code product gets "code by email", not "username"', ids(F).includes('code') && !ids(F).includes('password'), ids(F).join(','));
ok('a gift card is not told "free … is fake"', !ids(G).includes('myth'));
ok('three formats: 1:1, 4:5, 9:16', JSON.stringify(Object.values(STATIC_FORMATS).map((f) => [f.w, f.h])) === '[[1080,1080],[1080,1350],[1080,1920]]');
ok('the story format keeps out of the TikTok/Reels UI (top 13%, bottom 21%)', STATIC_FORMATS.story.safeTop >= 0.12 && STATIC_FORMATS.story.safeBottom >= 0.2);
for (const L of ['en', 'de', 'fr']) {
  const a = await staticAds(rbx.id, L);
  ok(`${L}: the same designs, in ${L}`, ids(a).join() === ids(R).join() && a.product.price !== R.product.price || (L === 'en' && ids(a).join() === ids(R).join()), `${ids(a)} ${a.product.price}`);
}
ok('French prices are written the French way', /^9,99\s€$/.test((await staticAds(rbx.id, 'fr')).product.price.replace(/ /g, ' ')));
const allText = JSON.stringify([R, F, G].map((a) => a.templates));
ok('no hype the shop cannot prove (cheapest, instant, #1, guaranteed, limited time)', !/cheapest|goedkoopst|instant|direct geleverd|#1|guaranteed|gegarandeerd|limited time|beperkte tijd/i.test(allText));
ok('every link is tagged per design and format for the attribution report', /utm_content=\{template\}-\{format\}-nl/.test(R.link));
{
  const { get } = await import('../src/db/index.js');
  const r = await get(`SELECT COUNT(*)::int AS n, AVG(stars) AS avg FROM reviews WHERE status='visible'`);
  const rating = R.templates.find((t) => t.id === 'rating');
  const should = r.n >= 10 && Math.round(Number(r.avg) * 10) / 10 >= 4;
  const real = (Math.round(Number(r.avg) * 10) / 10).toFixed(1).replace('.', ',');
  ok('a rating design only with 10+ real reviews averaging 4.0+, showing exactly that number',
    should ? rating?.l1 === `${real}/5` && new RegExp(`^${r.n} `).test(rating.l2) : !rating, `${JSON.stringify(rating)} vs ${r.n} @ ${real}`);
  const value = R.templates.find((t) => t.id === 'value');
  ok('price per 1,000 from the shop\'s own packs, the lowest lit', value && value.rows.length === 3
    && value.rows.filter((x) => x.self).length === 1 && value.rows[2].self, JSON.stringify(value?.rows?.map((x) => [x.name, x.price, x.self])));
}

console.log('\n— Stills: nothing outside the safe area, nothing on top of something else —');
{
  globalThis.document = undefined;
  const M = await import('../../src/lib/adStudio/statics.js');
  /* A canvas stand-in that measures: text ≈ 0.6 × size per character (wide). */
  const ctxStub = () => {
    let fontPx = 10;
    const noop = () => {};
    return new Proxy({}, {
      get(t, k) {
        if (k === 'measureText') return (s) => ({ width: String(s).length * fontPx * 0.6 });
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop });
        if (k in t) return t[k];
        return noop;
      },
      set(t, k, v) { if (k === 'font') { const m = /(\d+)px/.exec(v); if (m) fontPx = Number(m[1]); } t[k] = v; return true; },
    });
  };
  const img = { naturalWidth: 700, naturalHeight: 600 };
  const problems = [];
  for (const a of [R, F, G, await staticAds(rbx.id, 'de'), await staticAds(rbx.id, 'fr')]) {
    const images = { [a.product.image]: img, ...Object.fromEntries((a.ladder || []).map((x) => [x.image, img])) };
    for (const tpl of a.templates) {
      for (const [fid, fmt] of Object.entries(a.formats)) {
        const boxes = M.drawStatic(ctxStub(), fmt, a, tpl, images);
        const top = fmt.h * fmt.safeTop, bottom = fmt.h * (1 - fmt.safeBottom);
        for (const b of boxes) {
          if (b.y0 < top - 1 || b.y1 > bottom + 1) problems.push(`${a.lang}/${tpl.id}/${fid}: ${b.name} outside the safe area (${Math.round(b.y0)}–${Math.round(b.y1)} of ${Math.round(top)}–${Math.round(bottom)})`);
          if (b.y1 - b.y0 < 0) problems.push(`${a.lang}/${tpl.id}/${fid}: ${b.name} has no height`);
        }
        const sorted = boxes.filter((b) => b.name !== 'brand').sort((x, y) => x.y0 - y.y0);
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i].y0 < sorted[i - 1].y1 - 2) problems.push(`${a.lang}/${tpl.id}/${fid}: ${sorted[i - 1].name} and ${sorted[i].name} overlap`);
        }
        const card = boxes.find((b) => b.name === 'card');
        if (card && tpl.id !== 'ladder' && (card.y1 - card.y0) < fmt.h * 0.14) problems.push(`${a.lang}/${tpl.id}/${fid}: the card is only ${Math.round(card.y1 - card.y0)}px tall`);
      }
    }
  }
  ok('every design, format and language lays out cleanly', problems.length === 0, `\n      ${problems.slice(0, 12).join('\n      ')}`);
}

console.log(`\n${fail ? '❌' : '✅'} ad-creatives: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
