/**
 * The launch date must survive the database.
 *
 * On 26 August the production database hit its data-transfer quota and started
 * refusing connections. Everything under /api/ answered 500 — including
 * /api/config, which needs no database at all: every field in it comes from the
 * environment, and the one row it would like (the owner's category logos)
 * already falls back to {} on its own. It failed only because it sat behind the
 * middleware that makes sure the schema exists.
 *
 * The field that cost is `launchAt`. The storefront has no launch moment of its
 * own; it compares the one in this response against the browser's clock. With
 * the response gone, `prelaunch` computes false, the countdown disappears and
 * the purchase buttons render exactly as they would on an open shop — at the
 * moment nothing works at all. Measured on the live site while it was down.
 *
 * The gate itself never depended on this: the server refuses to sell by reading
 * the clock, and refused throughout. What was broken was the shop's account of
 * itself.
 *
 * This suite points the app at a port with nothing behind it, which is a
 * harsher outage than the real one — no handshake at all — and asserts that the
 * configuration still answers while the catalogue honestly does not.
 */
process.env.DATABASE_URL = 'postgres://nobody:nothing@127.0.0.1:59997/none';
process.env.LAUNCH_DATE = '2026-09-24T00:00:00Z';
process.env.JWT_SECRET = 'x'.repeat(40);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

// Dynamic, because config/env.js reads process.env once at import and static
// imports are hoisted above the assignments above.
const { createApp } = await import('../src/app.js');

const app = createApp({ lazyReady: true });
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (p) => {
  const res = await fetch(base + p);
  let body = null;
  try { body = await res.json(); } catch { /* not json */ }
  return { status: res.status, body };
};

console.log('— /api/config answers while the database is unreachable —');
{
  const r = await call('/api/config');
  ok('it answers at all', r.status === 200, `status ${r.status}`);
  ok('it carries the launch moment', r.body?.launchAt === '2026-09-24T00:00:00.000Z', String(r.body?.launchAt));
  // Without this the storefront cannot tell a pre-launch shop from an open one.
  ok('so the storefront can still compare it against its own clock',
    Number.isFinite(Date.parse(r.body?.launchAt || '')));
  // The one field that wanted a row degrades instead of failing the response.
  ok('the owner-set category logos degrade to empty rather than 500',
    r.body && typeof r.body.categoryLogos === 'object' && r.body.categoryLogos !== null);
}

console.log('\n— /api/health reports the outage instead of becoming it —');
{
  const r = await call('/api/health');
  /* 503, because the database really is down — but with a readable body saying
     so, which is the entire job. Behind the schema gate it answered 500 with
     {"error":{"message":"Internal server error"}}, during the one outage a
     health check exists for. */
  ok('it answers rather than throwing', r.status === 503 || r.status === 200, `status ${r.status}`);
  ok('and names the database as the thing that is down',
    r.body?.database?.status === 'down', JSON.stringify(r.body?.database || {}).slice(0, 120));
  // The question this suite was written to answer from the outside: is a mailer
  // configured? Without it a login code is recorded and never sent, and the
  // owner cannot get into their own shop.
  ok('it says whether email can actually be delivered',
    r.body?.email?.status === 'configured' || r.body?.email?.status === 'not_configured',
    JSON.stringify(r.body?.email || {}).slice(0, 120));
  ok('without ever printing a key',
    !JSON.stringify(r.body || {}).includes('re_') && !/apiKey/i.test(JSON.stringify(r.body || {})));
}

console.log('\n— and everything that genuinely needs the database still fails —');
{
  const r = await call('/api/products');
  /* The point of the exemption is that it is narrow. A catalogue served from
     somewhere during an outage is the failure this whole change removed; the
     storefront now says so in words instead. */
  ok('the catalogue does not pretend to work', r.status >= 500, `status ${r.status}`);
  const o = await call('/api/orders/lookup?number=FM-1');
  ok('nor does an order lookup', o.status >= 400, `status ${o.status}`);
}

server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
