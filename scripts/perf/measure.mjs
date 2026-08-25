#!/usr/bin/env node
/**
 * What the shop actually costs a visitor, measured rather than estimated.
 *
 *   node scripts/perf/measure.mjs --base=http://localhost:5000 --runs=5 \
 *     --out=scripts/perf/results/before.json
 *
 * Every number here comes out of a real Chromium loading the real built bundle
 * through a server that replicates Vercel's routing and cache headers
 * (scripts/perf/edge.mjs). Nothing is modelled.
 *
 * ── Why it is throttled ───────────────────────────────────────────────────
 *
 * On an unthrottled loopback everything is fast, including the things that are
 * not. The bottleneck this shop had before — a four-hop image waterfall — was
 * invisible at 0 ms RTT and cost 1.8 seconds on a phone. So:
 *
 *   mobile    4× CPU slowdown, ~1.6 Mbps down / 750 Kbps up, 150 ms RTT
 *             (Chrome DevTools' "Slow 4G", the profile Lighthouse reports on)
 *   desktop   1× CPU, ~10 Mbps, 40 ms RTT — a decent home connection, not a
 *             datacentre. Desktop with no throttling at all measures the test
 *             machine, not the site.
 *
 * ── Why the median of N ───────────────────────────────────────────────────
 *
 * A single cold load varies by tens of percent — GC, scheduler noise, whichever
 * core the compositor lands on. One run is an anecdote. The median of five is
 * something you can compare a change against, and the spread is reported next
 * to it so a difference smaller than the noise cannot be claimed as a win.
 *
 * Every run gets a fresh browser context: no cache, no storage, no service
 * worker. A repeat view is measured separately and labelled as such — the two
 * are different questions and blending them flatters the first.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};

const BASE = (arg('base') || 'http://localhost:5000').replace(/\/+$/, '');
const RUNS = Number(arg('runs', 5));
const OUT = arg('out');
const ONLY = arg('only');
const PROFILE = arg('profile');   // run one device at a time; results merge
const CHROME = arg('chrome') || process.env.AD_CHROME
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/** The two devices worth reporting, and the numbers behind each name. */
const PROFILES = {
  mobile: {
    label: 'Mobile (Slow 4G, 4× CPU)',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    cpu: 4,
    net: { downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 150 },
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
      + '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  desktop: {
    label: 'Desktop (10 Mbps, 40 ms)',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    isMobile: false,
    cpu: 1,
    net: { downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: (2 * 1024 * 1024) / 8, latency: 40 },
    ua: null,
  },
};

/**
 * Instrumentation, installed before any of the page's own script runs.
 *
 * PerformanceObserver rather than reading the entries afterwards: LCP and CLS
 * are emitted as they happen, and an observer registered after the fact misses
 * everything before it. `buffered: true` covers the gap for the entry types
 * that support it.
 */
const PROBE = `
window.__perf = { lcp: 0, cls: 0, longTasks: [], shifts: 0 };
try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__perf.lcp = Math.max(window.__perf.lcp, e.startTime);
  }).observe({ type: 'largest-contentful-paint', buffered: true });
} catch {}
try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      // Shifts the visitor caused by interacting are not the page's fault.
      if (!e.hadRecentInput) { window.__perf.cls += e.value; window.__perf.shifts++; }
    }
  }).observe({ type: 'layout-shift', buffered: true });
} catch {}
try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__perf.longTasks.push([e.startTime, e.duration]);
  }).observe({ type: 'longtask', buffered: true });
} catch {}
`;

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (n, d = 0) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

/**
 * One cold load.
 *
 * `warm` reuses the context so the second visit measures what a returning
 * visitor gets — which is a different number and deserves to be named as one.
 */
async function loadOnce(browser, profile, url, { warm = false, seed = null } = {}) {
  const ctx = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    isMobile: profile.isMobile,
    hasTouch: profile.isMobile,
    ...(profile.ua ? { userAgent: profile.ua } : {}),
  });
  const page = await ctx.newPage();
  await page.addInitScript(PROBE);

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, ...profile.net });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });

  /* WHAT `srv` IS, AND WHAT IT IS NOT.

     Chrome's emulated latency does not apply to the document request of a
     freshly-attached session: measured, the document came back in 2 ms while
     every subresource on the same page paid its 150 ms. Loading a throwaway
     page first was tried and does not fix it. So the document's number here is
     SERVER PROCESSING ONLY — over loopback, with no network in it — and it is
     called `srv` rather than TTFB so nobody reads it as what a phone in Utrecht
     would see. Add one round trip of whatever the visitor's connection is.

     Every subresource IS throttled, which is what FCP, LCP and TBT are made of,
     and those are the numbers this audit turns on. Server processing is
     measured separately and precisely by scripts/perf/server-timing.mjs, where
     it is the thing being optimised rather than a by-product.

     This is also where the storage seed goes, for pages that are meaningless
     empty (a cart, a checkout). */
  await page.goto(`${BASE}/robots.txt`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  if (seed) {
    await page.evaluate((s) => {
      for (const [k, v] of Object.entries(s)) { try { localStorage.setItem(k, v); } catch {} }
    }, seed);
  }

  if (warm) {
    await page.goto(url, { waitUntil: 'load' }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.evaluate(() => { window.__perf = { lcp: 0, cls: 0, longTasks: [], shifts: 0 }; });
  }

  /* Byte counting comes from the network layer, not from resource timing:
     `transferSize` is zeroed for cross-origin responses without
     Timing-Allow-Origin, and a bundle that reports 0 bytes is a bundle that
     looks free.

     Sizes are matched by requestId. The two events interleave across parallel
     requests, so pairing a finish with "the most recent response" is wrong the
     moment anything loads concurrently — which is always. */
  const requests = [];
  const byId = new Map();
  cdp.on('Network.responseReceived', (e) => {
    const r = { url: e.response.url, type: e.type, status: e.response.status,
      fromCache: !!e.response.fromDiskCache, mime: e.response.mimeType, bytes: 0,
      start: e.timestamp };
    byId.set(e.requestId, r);
    requests.push(r);
  });
  cdp.on('Network.loadingFinished', (e) => {
    const r = byId.get(e.requestId);
    if (r) r.bytes = e.encodedDataLength || 0;
  });

  const started = Date.now();
  const resp = await page.goto(url, { waitUntil: 'load', timeout: 60_000 }).catch(() => null);

  /* Settle before reading. LCP is only final once the page stops painting
     bigger things, and an app that fetches its content after hydration paints
     its real LCP element well after `load`.

     Waiting for the network to go quiet rather than for a fixed 2.5 seconds: a
     flat timeout is either too short for the slow pages or wasted on the fast
     ones, and at eighty-odd loads per run the waste is most of the wall clock.
     The cap is what stops a page that polls from waiting forever. */
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(400);

  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const paints = Object.fromEntries(
      performance.getEntriesByType('paint').map((p) => [p.name, p.startTime]));
    const p = window.__perf || {};
    /* Total Blocking Time: the part of every long task over 50 ms. This is the
       number that corresponds to a page that has painted but does not answer a
       tap yet, which on a phone is most of what "feels slow" means. */
    const tbt = (p.longTasks || []).reduce((sum, [, dur]) => sum + Math.max(0, dur - 50), 0);
    return {
      srv: nav.responseStart || null,
      domContentLoaded: nav.domContentLoadedEventEnd || null,
      load: nav.loadEventEnd || null,
      fcp: paints['first-contentful-paint'] || null,
      lcp: p.lcp || null,
      cls: p.cls || 0,
      shifts: p.shifts || 0,
      tbt,
      longTasks: (p.longTasks || []).length,
    };
  });

  // What the page asked the API for, and how long the answers took to matter.
  /* Did the page actually render, or did it render an error?
     The API's rate limiter answers 429 in microseconds, so a throttled run
     produces a page that failed to load its content and a set of numbers that
     look like a fast site. Measured the hard way. A run whose API calls were
     refused is not a measurement of anything and says so.
     Run the API with RATE_LIMIT_MAX high enough for runs × pages × calls. */
  const api = requests.filter((r) => r.url.includes('/api/'));
  const refused = api.filter((r) => r.status === 429).length;
  const bodyLen = await page.evaluate(
    () => (document.body?.innerText || '').trim().length).catch(() => 0);
  const js = requests.filter((r) => /javascript/.test(r.mime));
  const img = requests.filter((r) => r.type === 'Image');
  const fonts = requests.filter((r) => r.type === 'Font');
  const css = requests.filter((r) => /text\/css/.test(r.mime));
  const sum = (xs) => xs.reduce((n, r) => n + (r.bytes || 0), 0);

  const out = {
    ...m,
    refusedApiCalls: refused,
    bodyLen,
    status: resp?.status() || 0,
    wall: Date.now() - started,
    requests: requests.length,
    bytes: sum(requests),
    jsRequests: js.length, jsBytes: sum(js),
    cssRequests: css.length, cssBytes: sum(css),
    imgRequests: img.length, imgBytes: sum(img),
    fontRequests: fonts.length, fontBytes: sum(fonts),
    apiCalls: api.length, apiBytes: sum(api),
    apiUrls: api.map((r) => r.url.replace(BASE, '').split('?')[0]),
  };

  await ctx.close();
  return out;
}

/** Median + spread across N runs, per metric. */
function collapse(runs) {
  const keys = ['srv', 'fcp', 'lcp', 'cls', 'tbt', 'load', 'domContentLoaded', 'wall',
    'requests', 'bytes', 'jsRequests', 'jsBytes', 'cssBytes', 'imgRequests', 'imgBytes',
    'fontRequests', 'fontBytes', 'apiCalls', 'apiBytes', 'longTasks', 'shifts'];
  const out = {};
  for (const k of keys) {
    const xs = runs.map((r) => r[k]).filter((v) => typeof v === 'number');
    out[k] = k === 'cls' ? round(median(xs), 3) : round(median(xs), k === 'wall' ? 0 : 1);
    if (['lcp', 'fcp', 'tbt'].includes(k) && xs.length > 1) {
      out[`${k}Spread`] = round(Math.max(...xs) - Math.min(...xs), 1);
    }
  }
  out.apiUrls = [...new Set(runs.flatMap((r) => r.apiUrls))].sort();
  out.status = runs[0]?.status || 0;
  return out;
}

// ── The pages ────────────────────────────────────────────────────────────────
// A cart and a checkout with nothing in them measure an empty-state component,
// so both are seeded with a real product from the real catalogue.
async function pages() {
  const products = await fetch(`${BASE}/api/products`).then((r) => r.json()).catch(() => null);
  const list = products?.products || products || [];
  const p = list.find((x) => x.active !== false) || list[0];
  if (!p) throw new Error('No products in the catalogue — seed one before measuring.');
  const cart = JSON.stringify([{ id: p.id, name: p.name, price: p.price, qty: 1,
    image: p.image, currency: p.currency || 'EUR' }]);
  const consent = JSON.stringify({ v: 1, at: new Date(0).toISOString(), analytics: true, marketing: true });
  const seed = { fm_cart: cart, fm_consent: consent };

  return [
    { id: 'homepage', label: 'Homepage', url: `${BASE}/` },
    { id: 'catalog', label: 'Catalogue', url: `${BASE}/shop` },
    { id: 'product', label: 'Product page', url: `${BASE}/product/${p.id}` },
    { id: 'cart', label: 'Cart', url: `${BASE}/cart`, seed },
    { id: 'checkout', label: 'Checkout', url: `${BASE}/checkout`, seed },
    { id: 'login', label: 'Login', url: `${BASE}/login` },
    { id: 'discord', label: 'Discord', url: `${BASE}/discord` },
  ];
}

/* Node buffers stdout to a pipe, so a twenty-minute run prints nothing at all
   until it ends. Flushing per line keeps the progress visible while it works. */
const say = (line) => { try { fs.writeSync(1, `${line}\n`); } catch { console.log(line); } };
const ms = (v) => (v == null ? '   —  ' : `${String(round(v)).padStart(5)}`);
const kb = (v) => `${String(round((v || 0) / 1024)).padStart(5)}`;

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const targets = (await pages()).filter((p) => !ONLY || ONLY.split(',').includes(p.id));

/* Merge into whatever is already on disk rather than replacing it.
   A full sweep is eighty throttled loads, long enough that it is worth being
   able to run one device or one page at a time and still end up with a single
   comparable file. */
let results = { base: BASE, runs: RUNS, at: new Date().toISOString(), profiles: {} };
if (OUT && fs.existsSync(path.resolve(OUT))) {
  try {
    const prior = JSON.parse(fs.readFileSync(path.resolve(OUT), 'utf8'));
    if (prior.base === BASE) results = { ...prior, runs: RUNS, at: results.at, complete: false };
  } catch { /* unreadable: start fresh rather than half-merge */ }
}

/* Written after every page rather than only at the end. Eighty throttled loads
   is twenty minutes, and losing all of it to one interruption means starting
   over — which is how a measurement stops being repeated often enough to be
   worth having. */
const save = () => {
  if (!OUT) return;
  fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
  fs.writeFileSync(path.resolve(OUT), JSON.stringify(results, null, 2));
};

for (const [name, profile] of Object.entries(PROFILES)) {
  if (PROFILE && PROFILE !== name) continue;
  say(`\n━━ ${profile.label} · median of ${RUNS} cold loads ━━`);
  say('  page           srv   FCP   LCP   TBT    CLS   reqs   KB    JS   img  API');
  results.profiles[name] = results.profiles[name] || { label: profile.label, pages: {} };

  for (const t of targets) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      runs.push(await loadOnce(browser, profile, t.url, { seed: t.seed }));
    }
    const bad = runs.filter((r) => r.refusedApiCalls > 0 || r.status !== 200 || r.bodyLen < 200);
    if (bad.length) {
      console.error(`\n✖ ${t.id}: ${bad.length}/${RUNS} run(s) did not render a real page`
        + ` (429s: ${bad[0].refusedApiCalls}, status: ${bad[0].status}, text: ${bad[0].bodyLen} chars).`);
      console.error('  Refusing to report these as timings — they measure an error state.\n');
      process.exit(1);
    }
    const cold = collapse(runs);
    // One warm load too: what a returning visitor gets, kept separate.
    const warm = collapse([await loadOnce(browser, profile, t.url, { warm: true, seed: t.seed })]);
    results.profiles[name].pages[t.id] = { label: t.label, url: t.url, cold, warm };
    save();

    say(`  ${t.id.padEnd(11)} ${ms(cold.srv)} ${ms(cold.fcp)} ${ms(cold.lcp)} `
      + `${ms(cold.tbt)} ${String(cold.cls).padStart(6)} ${String(cold.requests).padStart(5)} `
      + `${kb(cold.bytes)} ${kb(cold.jsBytes)} ${kb(cold.imgBytes)} ${String(cold.apiCalls).padStart(4)}`);
  }
}

await browser.close();

results.complete = Object.keys(results.profiles).length === Object.keys(PROFILES).length;
save();
if (OUT) say(`\n  → ${OUT}`);
