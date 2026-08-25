/**
 * The first paint's critical path, asserted rather than remembered.
 *
 * A performance audit is a snapshot; the reason its results survive is that the
 * things it fixed are checked on every run. Each assertion here corresponds to
 * a measured finding, and the comment says what the number was.
 *
 * These are structural checks on the built output and the source, not timings.
 * Timings belong in scripts/perf/measure.mjs, which needs a browser and a
 * throttled network and cannot run in a unit suite — but every one of the
 * structures below is what made those timings what they are, and each of them
 * is a single edit away from being undone by accident.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_perf_critical';
process.env.NODE_ENV ||= 'development';
process.env.APP_URL ||= 'https://forgemarket.nl';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const has = (p) => fs.existsSync(path.join(ROOT, p));

console.log('\n── The stylesheet must not block the first paint ───────────');

{
  /* index.html paints a complete shell from inline styles. A render-blocking
     stylesheet blocks that paint anyway: measured at 830 ms for the sheet and
     980 ms for the paint, on a frame whose CSS was already in the document. */
  const cfg = rd('vite.config.js');
  ok('the build rewrites the app stylesheet to a non-blocking preload',
    cfg.includes("rel=\"preload\" as=\"style\"") || cfg.includes("rel=\"preload\" as=\"style\""));
  ok('…with a noscript fallback, so the page is styled without JavaScript',
    /<noscript><link rel="stylesheet"/.test(cfg));

  /* The risk that creates is React rendering before its CSS applies. */
  const main = rd('src/main.jsx');
  ok('React waits for the stylesheet before mounting',
    /styleReady\(\)\s*\.then/.test(main) && main.includes('data-app-css'));
  ok('…but not forever — a stylesheet that never arrives still opens the shop',
    /setTimeout\(done,\s*\d+\)/.test(main));
}

console.log('\n── Content is asked for during HTML parse, not after hydration ──');

{
  /* Every API call lives in a useEffect, which cannot run until the bundle has
     downloaded and executed. Measured: /api/products was requested at 1420 ms,
     for a URL that was knowable before the page existed. */
  /* Comments are stripped first. The head carries a note explaining why
     `as="fetch"` was rejected, and a check that greps the raw file finds its
     own explanation and calls it a violation — which is how a test ends up
     asserting the opposite of what it means. */
  const html = rd('index.html').replace(/<!--[\s\S]*?-->/g, '');
  ok('the shell starts the config request itself', /__FM_EARLY/.test(html) && html.includes('/api/config'));
  ok('…and the catalogue, on the two routes that render it',
    html.includes("/api/products") && /path === '\/' \|\| path === '\/shop'/.test(html));
  ok('a preload as=fetch is NOT used for it',
    !/rel="preload"[^>]*as="fetch"/.test(html),
    'as=fetch only matches a later request when the credentials mode matches too — a mismatch fetches twice');

  ok('the handover module exists', has('src/lib/earlyFetch.js'));
  const early = rd('src/lib/earlyFetch.js');
  ok('a prefetched response is handed over exactly once', /delete bag\[key\]/.test(early));
  ok('…and a failure falls back to a normal request rather than failing the page',
    /catch\(\(\) => fallback\(\)\)/.test(early));

  ok('the config loader consumes it', /withEarly\('config'/.test(rd('src/lib/useConfig.js')));
  for (const page of ['src/pages/HomeStore.jsx', 'src/pages/Shop.jsx']) {
    ok(`${path.basename(page)} consumes it`, /withEarly\('products'/.test(rd(page)));
  }
}

console.log('\n── Only the page you asked for is downloaded ───────────────');

{
  /* Four storefront pages used to share one eager entry chunk: somebody landing
     on the homepage downloaded the catalogue, the product page and the sign-in
     form before the homepage could render. */
  const app = rd('src/App.jsx');
  for (const page of ['HomeStore', 'Shop', 'ProductDetail', 'Login']) {
    ok(`${page} is split out of the entry bundle`,
      new RegExp(`const ${page} = lazy\\(`).test(app),
      'an eager import here puts it in every route\'s critical path');
  }

  /* A lazy route costs a round trip to discover, unless its chunk is announced
     in the HTML of the route that needs it. */
  const pre = rd('scripts/prerender.mjs');
  ok('the build announces each prerendered route\'s chunk',
    /modulepreload/.test(pre) && /ROUTE_CHUNKS/.test(pre));
  ok('…reading the real hashed filenames from the build manifest',
    /manifest\.json/.test(pre) && /manifest: true/.test(rd('vite.config.js')));
  ok('…and writes the product page\'s chunk for the API to use',
    /routeChunks\.js/.test(pre));

  const seo = rd('server/src/routes/seo.js');
  ok('the API announces the product page\'s chunk',
    /modulepreload/.test(seo) && /ROUTE_CHUNKS/.test(seo));
  ok('…and degrades when the frontend has never been built',
    /catch \{ chunks = \[\]; \}/.test(seo));
}

console.log('\n── Work that was being repeated ───────────────────────────');

{
  /* new Intl.NumberFormat() per price. Profiled at 70 ms of main-thread time on
     one catalogue render, for seventy identical formatters. */
  for (const f of ['src/lib/catalog.js', 'src/lib/format.js']) {
    const src = rd(f);
    ok(`${path.basename(f)} caches its currency formatter`,
      /FORMATTERS\s*=\s*new Map\(\)/.test(src));
    ok(`…and money() no longer builds one per call`,
      !/export const money[^\n]*\n?[^\n]*new Intl\.NumberFormat/.test(src));
  }

  const card = rd('src/components/store/LightProductCard.jsx');
  ok('product cards are memoised', /export default memo\(/.test(card));
  ok('…and the catalogue passes a stable callback, or the memo is a no-op',
    /useCallback\(/.test(rd('src/pages/Shop.jsx')));
}

console.log('\n── Layout stability ───────────────────────────────────────');

{
  /* flex-1 alone put the footer exactly at the viewport bottom while a page was
     still loading, and the arriving content shoved it down. Measured on the
     desktop cart: CLS 0.147, almost all of it that one move. */
  ok('the storefront main reserves at least one screen',
    /<main[^>]*min-h-screen/.test(rd('src/layouts/StoreLayout.jsx')));

  /* The image the LCP is made of must not fade in — the fade was inside the
     number: bytes → onLoad → state → re-render → 300 ms transition → visible. */
  const media = rd('src/components/store/ProductMedia.jsx');
  ok('a priority image paints at full opacity on its first frame',
    /priority \? 'opacity-100'/.test(media));
  ok('…and shows no skeleton over an image that is already there',
    /!loaded && !priority/.test(media));

  /* Preloading both faces put 45 KB ahead of the JavaScript everything waited
     for; preloading neither let headings re-wrap after paint (CLS 0 → 0.045). */
  // Attribute order is not fixed by anything, so it is not assumed here.
  const head = rd('index.html').replace(/<!--[\s\S]*?-->/g, '');
  const preloadedFonts = [...head.matchAll(/<link\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => /rel="preload"/.test(tag) && /as="font"/.test(tag))
    .map((tag) => (tag.match(/href="([^"]+)"/) || [])[1])
    .filter(Boolean);
  ok('exactly one font is preloaded', preloadedFonts.length === 1, JSON.stringify(preloadedFonts));
  ok('…and it is the display face, whose re-wrap is what moves a page',
    /bricolage/.test(preloadedFonts[0] || ''), preloadedFonts[0]);
  ok('every face still swaps rather than blocking',
    !/font-display:\s*(block|auto)/.test(rd('src/styles/fonts.css')));
}

console.log('\n── The measurement itself ─────────────────────────────────');

{
  /* A harness that reports an error state as a fast page is worse than none. */
  const m = rd('scripts/perf/measure.mjs');
  ok('the harness refuses to report a run whose API calls were refused',
    /refusedApiCalls/.test(m) && /did not render a real page/.test(m));
  ok('…and says plainly that its `srv` figure excludes the network',
    /SERVER PROCESSING ONLY/.test(m));
  ok('the edge simulator compresses, because the real edge does',
    /brotliCompressSync/.test(rd('scripts/perf/edge.mjs')));
  ok('…and takes its routes and headers from vercel.json rather than a copy',
    /vercel\.json/.test(rd('scripts/perf/edge.mjs')));
  ok('the comparison marks differences inside the run-to-run spread',
    /inside the run-to-run spread/.test(rd('scripts/perf/compare.mjs')));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} perf critical path: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
