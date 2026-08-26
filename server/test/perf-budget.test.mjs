/**
 * Performance budget.
 *
 * Speed is the easiest thing on a site to lose by accident: one eager import,
 * one PNG dropped into public/, one convenient third-party script, and the work
 * done here is undone without a single test failing. So the wins are written
 * down as limits rather than left as a story in a pull request.
 *
 * Measured before any of this: the first six Lighthouse filmstrip frames were
 * byte-identical white and nothing appeared until 14.4s on a throttled phone.
 * Speed Index was 19.8s. The numbers below are what fixed that, so each one has
 * the reason attached — a budget nobody understands gets raised rather than met.
 *
 * Runs against the built output, so `npm run build` must have happened. The
 * suite skips itself rather than failing when dist/ is absent, because a server
 * test run should not depend on a frontend build.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const ROOT = join(process.cwd(), '..');
const DIST = join(ROOT, 'dist');
const KB = (bytes) => Math.round(bytes / 1024);

if (!existsSync(DIST)) {
  console.log('  ⏭  dist/ not built — skipping the performance budget');
  console.log('\n✅ perf budget: skipped');
  process.exit(0);
}

const assets = readdirSync(join(DIST, 'assets'));
const sizeOf = (pred) => assets.filter(pred)
  .reduce((n, f) => n + statSync(join(DIST, 'assets', f)).size, 0);

// ── The critical path ───────────────────────────────────────────────────────
console.log('— What a first-time visitor downloads before anything works —');
{
  const entry = assets.filter((f) => /^index-.*\.js$/.test(f));
  ok('there is exactly one entry chunk', entry.length === 1, entry.join(','));
  const entrySize = sizeOf((f) => /^index-.*\.js$/.test(f));
  // Was 418KB with React, the router, every icon, the admin console shell and
  // the account dashboard shell all in one file.
  ok(`the entry chunk stays under 260KB (now ${KB(entrySize)}KB)`, entrySize < 260 * 1024);

  // React and the router change when they are upgraded; the app changes every
  // deploy. Together in one chunk, a typo fix invalidated the framework too.
  ok('React is a separate, cacheable chunk', assets.some((f) => /^react-.*\.js$/.test(f)));
  ok('the router is a separate chunk', assets.some((f) => /^router-.*\.js$/.test(f)));
  ok('icons are a separate chunk', assets.some((f) => /^icons-.*\.js$/.test(f)));

  const css = sizeOf((f) => f.endsWith('.css'));
  ok(`the stylesheet stays under 130KB (now ${KB(css)}KB)`, css < 130 * 1024);

  // Route chunks. A homepage visitor must not be paying for the admin console.
  const lazyChunks = assets.filter((f) => f.endsWith('.js') && !/^(index|react|router|icons)-/.test(f));
  ok(`heavy pages are split out (${lazyChunks.length} route chunks)`, lazyChunks.length >= 20);
}

// ── The shell ───────────────────────────────────────────────────────────────
console.log('— Something to look at before the JavaScript arrives —');
const html = readFileSync(join(DIST, 'index.html'), 'utf8');
{
  ok('the pre-React shell is in the HTML', html.includes('id="fm-shell"'));
  ok('…with its CSS inline, so it needs no extra request',
    /<style>[\s\S]*#fm-shell/.test(html));
  ok('…and is removed by the app once React has painted',
    readFileSync(join(ROOT, 'src/main.jsx'), 'utf8').includes("getElementById('fm-shell')"));
  // index.html is served for every URL, so a hero painted on the wrong route is
  // worse than a blank screen. Copy exists for exactly the two routes whose
  // heading is static; everything else falls back to shapes.
  ok('shell copy is limited to the routes it is written for',
    /var COPY = \{/.test(html) && html.includes("'/shop':") && /classList\.add\('bare'\)/.test(html));

  // The heading is the largest contentful paint. If the shell renders it in a
  // different font or a different size, React's copy comes out larger and LCP
  // moves to it — measured, twice.
  ok('the shell heading uses the same font as the real one',
    /#fm-shell h1\{font-family:'Bricolage Grotesque'/.test(html));
  ok('…and mirrors its responsive sizes',
    html.includes('font-size:30px') && html.includes('font-size:34px') && html.includes('font-size:50px'));
}

// ── The shell must not tell a different story than the app ──────────────────
console.log('— The shell copy matches the page it stands in for —');
{
  // These strings are duplicated into an inline script that cannot import them.
  // If the hero is reworded and this is not, the page visibly rewrites itself.
  const i18n = readFileSync(join(ROOT, 'src/lib/i18n.jsx'), 'utf8');
  const home = readFileSync(join(ROOT, 'src/pages/HomeStore.jsx'), 'utf8');
  const pick = (src, key) => (src.match(new RegExp(`'${key}',\\s*'([^']+)'`)) || [])[1]
    || (src.match(new RegExp(`'${key}':\\s*'([^']+)'`)) || [])[1];

  const enA = pick(home, 'home.h1a'), enB = pick(home, 'home.h1b');
  const nlA = pick(i18n, 'home.h1a'), nlB = pick(i18n, 'home.h1b');
  ok('the English hero heading is the one in the shell',
    !!enA && html.includes(`${enA} ${enB}`), `${enA} ${enB}`);
  ok('the Dutch hero heading is the one in the shell',
    !!nlA && html.includes(`${nlA} ${nlB}`), `${nlA} ${nlB}`);

  const enSub = pick(home, 'home.sub'), nlSub = pick(i18n, 'home.sub');
  ok('the English subtitle matches', !!enSub && html.includes(enSub));
  ok('the Dutch subtitle matches', !!nlSub && html.includes(nlSub));

  // The language rule has to be the same one, or the shell shows one language
  // and the app switches to the other.
  ok('the shell picks its language the same way the app does',
    html.includes('fm_lang') && html.includes('navigator.language'));
}

// ── Fonts ───────────────────────────────────────────────────────────────────
console.log('— Fonts —');
{
  ok('nothing is fetched from Google Fonts any more',
    !/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(html),
    'a render-blocking third-party stylesheet, and an IP address sent to a processor the privacy policy does not list');

  const fonts = existsSync(join(DIST, 'fonts')) ? readdirSync(join(DIST, 'fonts')) : [];
  ok('the fonts are served from this site', fonts.length > 0);
  ok('…as woff2 only', fonts.every((f) => f.endsWith('.woff2')), fonts.join(','));
  const total = fonts.reduce((n, f) => n + statSync(join(DIST, 'fonts', f)).size, 0);
  // Was four families and seventeen weights; the site uses seven.
  ok(`…and weigh under 200KB in total (now ${KB(total)}KB across ${fonts.length})`, total < 200 * 1024);

  /* CHANGED, and deliberately: this used to require BOTH inter-400 and
     bricolage-700 to be preloaded. Measured on Slow 4G, that put 45 KB at the
     highest priority ahead of the JavaScript everything else was waiting for —
     the entry bundle landed at 1399 ms and hydration, and so the catalogue's
     LCP, queued behind it.

     Preloading neither was faster still (FCP 328 → 244 ms) and cost something
     real: the display face then swapped in after paint, headings re-wrapped,
     and the Discord page's content moved 40 px — CLS 0 → 0.045 on a page that
     had none.

     So: exactly one, and it is the display face, because a heading re-wrap is
     what moves a page and body text swapping changes line widths rather than
     line counts. */
  const fontPreloads = [...html.matchAll(/<link\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => /rel="preload"/.test(tag) && /as="font"/.test(tag));
  ok('exactly one font is preloaded for the first paint',
    fontPreloads.length === 1, `${fontPreloads.length}: ${fontPreloads.join(' ')}`);
  ok('…and it is the display face, whose re-wrap is what moves a page',
    /bricolage-700\.woff2/.test(fontPreloads[0] || ''), fontPreloads[0]);

  const fontCss = readFileSync(join(ROOT, 'src/styles/fonts.css'), 'utf8');
  const faces = (fontCss.match(/@font-face/g) || []).length;
  // Counted per block: the file's header comment also says "font-display: swap",
  // and a naive count of the whole file was off by one because of it.
  const blocks = fontCss.split('@font-face').slice(1);
  ok(`every face swaps rather than blocking (${faces} faces)`,
    faces > 0 && blocks.every((b) => /font-display:\s*swap/.test(b.split('}')[0])));
}

// ── Images ──────────────────────────────────────────────────────────────────
console.log('— Images —');
{
  const icons = join(DIST, 'products/icons');
  const files = existsSync(icons) ? readdirSync(icons) : [];
  ok('no PNG product icons are left', !files.some((f) => f.endsWith('.png')),
    files.filter((f) => f.endsWith('.png')).join(','));
  const webp = files.filter((f) => f.endsWith('.webp'));
  ok(`the raster icons are WebP (${webp.length} files)`, webp.length >= 10);
  const worst = webp.map((f) => [f, statSync(join(icons, f)).size]).sort((a, b) => b[1] - a[1])[0];
  // The worst PNG was 95KB, downloading in parallel with the JavaScript the
  // page cannot paint without.
  ok(`no icon is over 20KB (largest: ${worst?.[0]} at ${KB(worst?.[1] || 0)}KB)`, (worst?.[1] || 0) < 20 * 1024);
  const iconTotal = webp.reduce((n, f) => n + statSync(join(icons, f)).size, 0);
  ok(`all icons together stay under 120KB (now ${KB(iconTotal)}KB, was 481KB)`, iconTotal < 120 * 1024);

  // A 512x512 image was being served three times over, one of them declared as
  // a 192px favicon.
  for (const [name, limit] of [['favicon-192.png', 8], ['apple-touch-icon.png', 10], ['icon-512.png', 24]]) {
    const size = statSync(join(DIST, name)).size;
    ok(`${name} is under ${limit}KB (now ${KB(size)}KB, was 121KB)`, size < limit * 1024);
  }
  const og = statSync(join(DIST, 'og.png')).size;
  ok(`the social preview is under 150KB (now ${KB(og)}KB, was 386KB)`, og < 150 * 1024);
}

// ── Caching ─────────────────────────────────────────────────────────────────
console.log('— Caching —');
{
  const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  // Exact match. `includes` matched "/assets/(.*)" when asked for "/(.*)",
  // so the catch-all rule was never the one being inspected.
  const rule = (src) => vercel.headers?.find((h) => h.source === src);
  const value = (src, key) => rule(src)?.headers.find((h) => h.key.toLowerCase() === key)?.value || '';

  // Filenames carry a content hash, so the bytes behind a URL can never change.
  ok('hashed assets are immutable for a year',
    /max-age=31536000.*immutable/.test(value('/assets/(.*)', 'cache-control')));
  ok('fonts are immutable too',
    /max-age=31536000.*immutable/.test(value('/fonts/(.*)', 'cache-control')));
  ok('images revalidate rather than never expiring',
    /max-age=\d+/.test(value('/(products|brand|discord)/(.*)', 'cache-control')));
  ok('the security headers survived',
    !!value('/(.*)', 'x-content-type-options'), JSON.stringify(rule('/(.*)')?.headers?.map((h) => h.key)));
}

// ── Things that quietly cost a lot ──────────────────────────────────────────
console.log('— Regressions worth catching early —');
{
  ok('the homepage does not eagerly import the chat widget',
    !/^import ChatWidget/m.test(readFileSync(join(ROOT, 'src/pages/HomeStore.jsx'), 'utf8')));
  ok('the store layout does not either',
    !/^import ChatWidget/m.test(readFileSync(join(ROOT, 'src/layouts/StoreLayout.jsx'), 'utf8')));
  ok('the admin and account shells are lazy',
    /lazy\(\(\) => import\('\.\/layouts\/AdminLayout/.test(readFileSync(join(ROOT, 'src/App.jsx'), 'utf8')));

  // As a real text node this decorative watermark was the largest contentful
  // paint on the homepage, so the page's loading score was decided by when an
  // outline finished drawing.
  ok('the hero watermark is drawn by CSS, not typed into the markup',
    !/>FORGE</.test(readFileSync(join(ROOT, 'src/pages/HomeStore.jsx'), 'utf8')));

  // No third-party origin at all now. Adding one back is a decision, not a
  // detail — it costs a connection on the critical path and shows up in the
  // privacy policy.
  const externalHosts = [...html.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)]
    .map((m) => m[1].toLowerCase())
    .filter((h) => !h.endsWith('forgemarket.nl') && !h.endsWith('schema.org') && !h.endsWith('w3.org'));
  ok('the HTML loads nothing from another origin', externalHosts.length === 0, [...new Set(externalHosts)].join(','));
}

console.log('— Background polling —');
{
  /* Three components each ran their own one-minute timer, so an idle open tab
     asked the API for the same activity feed three times a minute, forever, and
     kept doing it while minimised. That traffic is visible in the production
     database logs. One shared poller, paused when the tab is hidden, backing off
     while there is nothing to show. */
  const feed = readFileSync(join(ROOT, 'src/lib/useSocialProof.js'), 'utf8');
  ok('the activity feed is polled by one shared timer, not one per component',
    /const subscribers = new Set\(\)/.test(feed) && (feed.match(/setTimeout\(/g) || []).length <= 2);
  ok('polling stops while the tab is hidden',
    /visibilityState === 'hidden'/.test(feed) && /visibilitychange/.test(feed));
  ok('an empty feed backs the interval off instead of asking again every minute',
    /MAX_POLL/.test(feed) && /emptyRuns/.test(feed));

  const consumers = ['src/components/SiteExtras.jsx',
    'src/components/store/LiveActivity.jsx',
    'src/components/store/RecentlyDelivered.jsx'];
  for (const f of consumers) {
    /* Their own setInterval is fine and stays — it rotates which line of the
       feed is on screen and touches nothing. What must not come back is a
       component fetching the feed for itself, which is what multiplied one
       request into three. */
    ok(`${f.split('/').pop()} takes the feed from the shared poller instead of fetching it`,
      !/api\.get\(\s*['"`]\/api\/social/.test(readFileSync(join(ROOT, f), 'utf8')));
  }
}

console.log(`\n${fail === 0 ? '✅' : '❌'} perf budget: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
