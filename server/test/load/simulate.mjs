/**
 * A launch-week visitor simulation.
 *
 * The other file here, loadtest.mjs, hunts for the bugs that only appear when
 * things happen AT THE SAME TIME — two buyers on the last code, a webhook
 * arriving twice. This one is a different question: what gives out first when a
 * LOT of people simply arrive. It models the shape of launch traffic — mostly
 * people looking, a few buying — and reports which endpoint degrades fastest,
 * because that is the one that decides whether the shop feels up.
 *
 *   createdb fmload && (migrate + seed)
 *   DATABASE_URL=…  RATE_LIMIT_MAX=1000000 PORT=4200 node server/src/index.js
 *   node server/test/load/simulate.mjs http://127.0.0.1:4200 5000 120
 *
 * Numbers off a laptop are not production numbers: every hot endpoint carries a
 * shared cache header, so in front of a CDN most of this never reaches the
 * function at all. What the run is good for is the RANKING — which endpoint is
 * four times slower than the rest, and which one gets worse the busier it gets.
 *
 * Measured at 100 / 1,000 / 5,000 visitors, nothing failed at any scale, and
 * the ranking pointed at one thing: /api/products/:id/recommendations, at
 * 103ms → 267ms → 419ms p95 while everything else held near 100ms. It was
 * loading the entire catalogue twice per request.
 */
const BASE = process.argv[2] || 'http://127.0.0.1:4200';
const VISITORS = Number(process.argv[3] || 100);
const CONCURRENCY = Number(process.argv[4] || 40);

const stats = new Map();
const record = (name, ms, ok) => {
  const s = stats.get(name) || { n: 0, fail: 0, ms: [] };
  s.n++; if (!ok) s.fail++; s.ms.push(ms);
  stats.set(name, s);
};

async function hit(name, path, init) {
  const t = Date.now();
  try {
    const r = await fetch(BASE + path, { ...init, signal: AbortSignal.timeout(20000) });
    // Drain the body: a response nobody reads is not a response anybody measured.
    await r.arrayBuffer();
    record(name, Date.now() - t, r.ok || r.status === 404 || r.status === 400);
    return r.status;
  } catch (e) {
    record(name, Date.now() - t, false);
    return 0;
  }
}

let products = [];
{
  const r = await fetch(`${BASE}/api/products`);
  const d = await r.json();
  products = (Array.isArray(d) ? d : d.products || d.items || []).map((p) => p.id);
}
if (!products.length) { console.error('no products'); process.exit(1); }

/** One visitor's journey, in the proportions a launch actually arrives in. */
async function visitor(i) {
  await hit('GET /api/config', '/api/config');
  await hit('GET /api/products', '/api/products');
  // 70% look at a product
  if (i % 10 < 7) {
    const id = products[i % products.length];
    await hit('GET /api/products/:id', `/api/products/${id}`);
    await hit('GET /api/products/:id/recommendations', `/api/products/${id}/recommendations`);
  }
  // 40% see the social proof widget
  if (i % 10 < 4) await hit('GET /api/social/feed', '/api/social/feed');
  // 25% look at reviews
  if (i % 4 === 0) await hit('GET /api/reviews', '/api/reviews');
  // 10% check the shop stats
  if (i % 10 === 0) await hit('GET /api/stats', '/api/stats');
  // 5% try to track an order
  if (i % 20 === 0) await hit('GET /api/orders/lookup', '/api/orders/lookup?number=FM-NOPE');
}

const t0 = Date.now();
let next = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (true) {
    const i = next++;
    if (i >= VISITORS) return;
    await visitor(i);
  }
}));
const wall = (Date.now() - t0) / 1000;

const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
const rows = [...stats.entries()].map(([name, s]) => {
  const ms = s.ms.sort((a, b) => a - b);
  return { name, n: s.n, fail: s.fail, p50: pct(ms, 0.5), p95: pct(ms, 0.95), max: ms[ms.length - 1] };
}).sort((a, b) => b.p95 - a.p95);

const total = rows.reduce((n, r) => n + r.n, 0);
const fails = rows.reduce((n, r) => n + r.fail, 0);
console.log(`\n${VISITORS} visitors · ${CONCURRENCY} at a time · ${total} requests in ${wall.toFixed(1)}s `
  + `(${Math.round(total / wall)} req/s)`);
console.log(`${fails} failed (${(fails / total * 100).toFixed(2)}%)\n`);
console.log('  p95   p50    max   fail  n     endpoint');
for (const r of rows) {
  console.log(`${String(r.p95).padStart(5)} ${String(r.p50).padStart(5)} ${String(r.max).padStart(6)} `
    + `${String(r.fail).padStart(6)} ${String(r.n).padStart(5)}  ${r.name}`);
}
