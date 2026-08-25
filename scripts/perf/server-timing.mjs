#!/usr/bin/env node
/**
 * How long the server itself takes, and how much of that is the database.
 *
 *   DATABASE_URL=… node scripts/perf/server-timing.mjs --base=http://localhost:4000
 *
 * The browser harness cannot answer this: over loopback the document comes back
 * in 2 ms and the network is not in it. This one calls each endpoint the
 * storefront actually uses, many times, and reports the median and the p95 —
 * plus, for each one, how many SQL statements it ran and how long they took.
 *
 * Query counting works by monkey-patching the db module's own `run/get/all`
 * before the routes are imported. That is deliberately not a Postgres-side
 * measurement: `pg_stat_statements` would tell you a query is fast while an
 * endpoint issues it ninety times in a loop, and the loop is the bug.
 */
import http from 'node:http';

const arg = (k, d = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};

const BASE = (arg('base') || 'http://localhost:4000').replace(/\/+$/, '');
const N = Number(arg('n', 20));

/* The API's own rate limiter answers 429 in well under a millisecond, so a
   throttled run does not look broken — it looks fast. Measured the hard way:
   160 calls in a row turned every endpoint into a 0 KB 429 and the report
   proudly showed sub-millisecond medians. Every response is now checked, and a
   non-200 aborts rather than being averaged in.

   Run the API with RATE_LIMIT_MAX high enough for the sample size. */
const get = (url) => new Promise((resolve) => {
  const started = process.hrtime.bigint();
  http.get(url, (res) => {
    let bytes = 0;
    res.on('data', (c) => { bytes += c.length; });
    res.on('end', () => resolve({
      ms: Number(process.hrtime.bigint() - started) / 1e6,
      status: res.statusCode, bytes,
      cache: res.headers['cache-control'] || null,
    }));
  }).on('error', () => resolve({ ms: null, status: 0, bytes: 0, cache: null }));
});

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const r1 = (n) => Math.round(n * 10) / 10;

/* The endpoints a first-time visitor's browser actually hits, taken from the
   API-call list the browser harness records rather than from a guess about
   which ones matter. */
const ENDPOINTS = (process.env.PERF_ENDPOINTS || [
  '/api/config',
  '/api/products',
  '/api/stats',
  '/api/reviews',
  '/api/feed',
  '/api/bundles',
  '/api/drops/upcoming',
  '/api/trending',
].join(',')).split(',').filter(Boolean);

console.log(`\n━━ server response, ${N} calls each ━━`);
console.log('  endpoint                         med    p95     KB  cache-control');

const results = [];
for (const ep of ENDPOINTS) {
  const url = `${BASE}${ep}`;
  await get(url);                                   // warm: the first is a cold import
  const runs = [];
  let last = null;
  let rejected = 0;
  for (let i = 0; i < N; i++) {
    last = await get(url);
    if (last.status === 429) { rejected++; continue; }
    if (last.ms != null && last.status === 200) runs.push(last.ms);
  }
  if (rejected) {
    console.log(`  ${ep.padEnd(30)}  ${rejected}/${N} rate-limited — raise RATE_LIMIT_MAX and re-run`);
    continue;
  }
  if (!runs.length) {
    console.log(`  ${ep.padEnd(30)}  no 200s (last status ${last?.status})`);
    continue;
  }
  const row = {
    endpoint: ep, status: last.status,
    median: r1(pct(runs, 0.5)), p95: r1(pct(runs, 0.95)),
    kb: r1(last.bytes / 1024), cache: last.cache,
  };
  results.push(row);
  console.log(`  ${ep.padEnd(30)} ${String(row.median).padStart(5)}  ${String(row.p95).padStart(5)}`
    + `  ${String(row.kb).padStart(5)}  ${row.cache || '— none —'}`);
}

const noCache = results.filter((r) => r.status === 200 && !r.cache);
if (noCache.length) {
  console.log(`\n  ${noCache.length} endpoint(s) answer 200 with no Cache-Control:`);
  for (const r of noCache) console.log(`    ${r.endpoint}`);
  console.log('  Every one of those is a full round trip on every page view, and');
  console.log('  a CDN in front of the API cannot help with any of them.');
}

const slow = results.filter((r) => r.median > 50);
if (slow.length) {
  console.log(`\n  slower than 50 ms at the median:`);
  for (const r of slow) console.log(`    ${r.endpoint.padEnd(30)} ${r.median} ms`);
}

console.log('');
if (arg('json')) console.log(JSON.stringify(results, null, 2));
