/**
 * A request body the parser refuses is a 4xx, not a crash.
 *
 * Malformed JSON and a body over the size limit reached the generic error
 * handler as unknown errors: the caller got 500 "Internal server error" and the
 * owner a "500 on …" alert — for something any client (or bot) can send. Now
 * malformed JSON is 400, an oversized body 413, and neither pages the owner.
 * Covered on the general JSON parser and on Pay.'s exchange path, which has its
 * own form + JSON parsers.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_body_errors';
process.env.NODE_ENV ||= 'development';

const { ensureReady, createApp } = await import('../src/app.js');
await ensureReady();
const { all } = await import('../src/db/index.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const send = async (path, body, type = 'application/json') => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': type }, body });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const alerts = async () => (await all(`SELECT title FROM owner_alerts WHERE event = 'system.error'`)).length;
const before = await alerts();

console.log('— The general JSON parser —');
{
  const r = await send('/api/orders', '{"email": "a@b.c", "items": [');
  ok('malformed JSON → 400', r.status === 400, `${r.status} ${JSON.stringify(r.body)}`);
  ok('…with a short message, no stack or parser text', /not valid JSON/.test(r.body?.error?.message || '')
    && !/Unexpected|position|at /.test(JSON.stringify(r.body)), JSON.stringify(r.body));
  const big = JSON.stringify({ pad: 'x'.repeat(3.2 * 1024 * 1024) });
  const t = await send('/api/orders', big);
  ok('a body over the 3mb limit → 413', t.status === 413, `${t.status} ${JSON.stringify(t.body)}`);
}

console.log('\n— Pay.\'s exchange path (its own parsers) —');
{
  const r = await send('/api/payments/paynl/exchange', '{"action": "new_ppt", ');
  ok('malformed JSON → 400', r.status === 400, `${r.status} ${JSON.stringify(r.body)}`);
  const t = await send('/api/payments/paynl/exchange', `order_id=${'x'.repeat(40 * 1024)}`,
    'application/x-www-form-urlencoded');
  ok('a form over its 32kb limit → 413', t.status === 413, `${t.status} ${JSON.stringify(t.body)}`);
}

console.log('\n— Nobody is paged —');
{
  await new Promise((r) => setTimeout(r, 500)); // alertOwner is fire-and-forget
  const after = await alerts();
  ok('no "500 on …" owner alert for any of these', after === before, `${before} → ${after}`);
}

srv.close();
console.log(`\n${fail ? '❌' : '✅'} request-body-errors: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
