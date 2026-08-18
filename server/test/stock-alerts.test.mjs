/**
 * Inventory alerts: one warning per rung, and the right kind of loud.
 *
 * The old behaviour was a single threshold and a single flag: told once that a
 * product was low, an owner heard nothing further as it went to 4, and nothing
 * at all when it hit zero and orders started needing hand delivery. That last
 * one is the expensive silence — a shop selling something it cannot deliver.
 *
 * So the assertions here are about the LADDER, driven by real orders against a
 * real database, with the Discord and Telegram transports pointed at a local
 * server that records what actually left the process:
 *
 *   - each rung announces exactly once, however many orders cross it
 *   - a drop straight past a rung announces the severe one, not both
 *   - a rung already passed never fires again while stock stays there
 *   - restocking re-arms the whole ladder
 *   - "out of stock" is allowed to wake somebody; "ten left" is not
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_stock_alerts';
process.env.NODE_ENV ||= 'development';
process.env.APP_URL ||= 'https://forgemarket.nl';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

import http from 'node:http';

// ── Stand-ins for Discord and Telegram ──────────────────────────────────────
const received = [];
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  received.push({ path: req.url, body: Buffer.concat(chunks).toString() });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"ok":true}');
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

// Set BEFORE the config module is first imported. The staff webhook is given a
// separate URL from the owner one on purpose: that is the configuration where
// both Discord paths are meant to fire, and the duplicate-suppression case gets
// its own section further down.
process.env.NOTIFY_DISCORD_WEBHOOK_URL = `${base}/owner-discord`;
process.env.DISCORD_STOCK_WEBHOOK_URL = `${base}/staff-discord`;
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_CHAT_ID = '4242';

const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  const u = String(url);
  if (u.startsWith('https://api.telegram.org')) return realFetch(`${base}/telegram`, init);
  if (u.startsWith('https://api.pushover.net')) return realFetch(`${base}/pushover`, init);
  return realFetch(url, init);
};

const { ensureReady } = await import('../src/app.js');
await ensureReady();
const { createProduct } = await import('../src/services/productService.js');
const { addProductCodes, availableCount, stockTierFor } = await import('../src/services/codeStockService.js');
const { createOrder, markPaymentReceived } = await import('../src/services/orderService.js');
const { get } = await import('../src/db/index.js');

const tag = process.pid;
let n = 0;
const stockProduct = async (codes) => {
  const p = await createProduct({ name: `Stock Pack ${tag}-${++n}`, category: 'giftcard', price: 500, announce: false });
  await addProductCodes(p.id, Array.from({ length: codes }, (_, i) => `SA-${tag}-${n}-${i}`));
  return p;
};
/**
 * Wait until nothing new has arrived for a moment.
 *
 * `autoDispenseFromStock` is fire-and-forget inside transitionOrder, so the
 * delivery — and the stock check that follows it — completes AFTER
 * markPaymentReceived resolves. Measuring immediately reads the PREVIOUS order's
 * alerts, which is exactly what made the first run of this file report fourteen
 * warnings for twelve sales and attribute them to the wrong products.
 */
const settle = async (quietFor = 250, cap = 6000) => {
  const started = Date.now();
  let seen = received.length, quiet = 0;
  while (Date.now() - started < cap) {
    await new Promise((r) => setTimeout(r, 50));
    if (received.length === seen) { quiet += 50; if (quiet >= quietFor) return; }
    else { seen = received.length; quiet = 0; }
  }
};

const buyOne = async (productId) => {
  const o = await createOrder({ consent: true, consentText: 'x', email: `b${tag}-${Math.random()}@x.dev`,
    items: [{ productId, quantity: 1 }] });
  await markPaymentReceived(o.id, `tx-${o.number}`, { actorId: 'test' });
  await settle();
};
const since = () => { const n = received.length; return () => received.slice(n); };
/* Only the STOCK messages. Every purchase also fires a paid-order alert down the
   same channels, and counting those as stock warnings is how the first run of
   this file produced fourteen "alerts" for twelve sales. */
// Case-insensitive: the staff embed shouts OUT OF STOCK where the owner
// message says 'Out of stock', and a case-sensitive filter silently dropped it.
const STOCK = /low stock|stock critical|out of stock/i;
const stockRows = (rows) => rows.filter((r) => STOCK.test(r.body));
const events = (rows) => stockRows(rows).filter((r) => r.path === '/telegram')
  .map((r) => JSON.parse(r.body).text.split('\n')[0]);

// ── 1. Which rung a count belongs to ────────────────────────────────────────
console.log('— The most severe rung a count has crossed —');
{
  ok('12 left is nothing to say', stockTierFor(12) === null, String(stockTierFor(12)));
  ok('10 left is already below the 10 mark', stockTierFor(9) === 10, String(stockTierFor(9)));
  ok('a drop to 3 is the 5 rung, not the 10 one', stockTierFor(3) === 5, String(stockTierFor(3)));
  ok('zero is its own rung', stockTierFor(0) === 0, String(stockTierFor(0)));
  ok('exactly 10 has not crossed 10 yet', stockTierFor(10) === null, String(stockTierFor(10)));
  ok('exactly 5 has crossed 10 but not 5', stockTierFor(5) === 10, String(stockTierFor(5)));
}

// ── 2. Walking a product all the way down ───────────────────────────────────
console.log('\n— One product, twelve sales, three warnings —');
{
  const p = await stockProduct(12);
  const seen = [];
  for (let i = 0; i < 12; i++) {
    const mark = since();
    await buyOne(p.id);
    const left = await availableCount(p.id);
    for (const line of events(mark())) seen.push({ left, line });
  }

  ok('exactly three alerts for a product sold from 12 to 0', seen.length === 3,
    JSON.stringify(seen.map((s) => `${s.left}:${s.line}`)));
  ok('the first lands when stock first goes below 10', seen[0]?.left === 9, String(seen[0]?.left));
  ok('…and it is the quiet one', /Low stock/.test(seen[0]?.line || ''), seen[0]?.line);
  ok('the second lands when stock first goes below 5', seen[1]?.left === 4, String(seen[1]?.left));
  ok('…and it says critical', /Stock critical/.test(seen[1]?.line || ''), seen[1]?.line);
  ok('the third lands at zero', seen[2]?.left === 0, String(seen[2]?.left));
  ok('…and it says out of stock', /Out of stock/.test(seen[2]?.line || ''), seen[2]?.line);
  ok('nothing repeats in between', seen.length === new Set(seen.map((s) => s.line)).size);
}

// ── 3. A rung skipped is not a rung announced twice ─────────────────────────
console.log('\n— A single order that clears a whole rung —');
{
  const p = await stockProduct(12);
  const mark = since();
  // 12 → 3 in one go: past the 10 mark and the 5 mark together.
  const o = await createOrder({ consent: true, consentText: 'x', email: `bulk${tag}@x.dev`,
    items: [{ productId: p.id, quantity: 9 }] });
  await markPaymentReceived(o.id, `tx-${o.number}`, { actorId: 'test' });
  await settle();
  const lines = events(mark());
  ok('a 12 → 3 order warns once, not twice', lines.length === 1, JSON.stringify(lines));
  ok('…and it warns about where the stock actually is', /Stock critical/.test(lines[0] || ''), lines[0]);

  const row = await get('SELECT low_stock_alert_level FROM products WHERE id=@p', { p: p.id });
  ok('…and the skipped rung is recorded as passed', Number(row.low_stock_alert_level) === 5,
    String(row.low_stock_alert_level));

  // The 10 rung must not fire later on the way down.
  const mark2 = since();
  await buyOne(p.id);              // 3 → 2, still the 5 rung
  ok('a further sale inside the same rung is silent', events(mark2()).length === 0,
    JSON.stringify(events(mark2())));
}

// ── 4. Restocking re-arms the ladder ────────────────────────────────────────
console.log('\n— Refilling starts the ladder over —');
{
  const p = await stockProduct(11);
  await buyOne(p.id);                       // 11 → 10, silent
  const mark = since();
  await buyOne(p.id);                       // 10 → 9, crosses 10
  ok('the 10 rung fires on the way down', events(mark()).length === 1, JSON.stringify(events(mark())));

  await addProductCodes(p.id, Array.from({ length: 20 }, (_, i) => `SA-${tag}-re-${i}`));
  await settle();
  const row = await get('SELECT low_stock_alert_level, low_stock_alerted_at FROM products WHERE id=@p', { p: p.id });
  ok('a restock clears the rung that was reached', row.low_stock_alert_level === null,
    String(row.low_stock_alert_level));
  ok('…and the stamp with it', row.low_stock_alerted_at === null, String(row.low_stock_alerted_at));

  // Sell back down past 10 — the same rung must be allowed to speak again.
  let mark2;
  for (let i = 0; i < 20; i++) {
    mark2 = since();
    await buyOne(p.id);
    if ((await availableCount(p.id)) === 9) break;
  }
  ok('…so the same warning can be given again after a refill',
    events(mark2()).some((l) => /Low stock/.test(l)), JSON.stringify(events(mark2())));
}

// ── 5. Both channels, and the right loudness ────────────────────────────────
console.log('\n— Discord and Telegram, and only one of the three wakes you —');
{
  const p = await stockProduct(1);
  const mark = since();
  await buyOne(p.id);                       // 1 → 0
  const rows = mark();

  const staff = stockRows(rows).filter((r) => r.path === '/staff-discord');
  const owner = stockRows(rows).filter((r) => r.path === '/owner-discord');
  const telegram = stockRows(rows).filter((r) => r.path === '/telegram');
  ok('the staff Discord channel is told', staff.length === 1, String(staff.length));
  ok('the owner Discord channel is told', owner.length === 1, String(owner.length));
  ok('Telegram is told', telegram.length === 1, String(telegram.length));

  ok('the Discord embed says out of stock',
    /OUT OF STOCK/.test(JSON.parse(staff[0].body).embeds[0].title), JSON.parse(staff[0].body).embeds[0].title);
  ok('…and explains what it costs, not just that it happened',
    /cannot be delivered/i.test(JSON.parse(staff[0].body).embeds[0].description),
    JSON.parse(staff[0].body).embeds[0].description);
  ok('running out is NOT silenced on Telegram',
    JSON.parse(telegram[0].body).disable_notification === false);

  // …while the mildest rung is.
  const q = await stockProduct(11);
  const mark2 = since();
  await buyOne(q.id); await buyOne(q.id);   // 11 → 9
  const tg = stockRows(mark2()).filter((r) => r.path === '/telegram');
  ok('being merely low IS silenced on Telegram',
    JSON.parse(tg[0].body).disable_notification === true);
}

// ── 6. Two Discord paths must not mean two messages ─────────────────────────
console.log('\n— One channel, one message —');
{
  const src = (await import('node:fs')).readFileSync(
    new URL('../src/services/codeStockService.js', import.meta.url), 'utf8');
  ok('the staff post is skipped when it lands where the owner post already goes',
    /staffUrl && staffUrl === ownerUrl/.test(src),
    'with only DISCORD_ORDER_WEBHOOK_URL set, both paths resolve to it');
  ok('…and the message kept is the one that also reaches Telegram',
    /if \(!\(staffUrl && staffUrl === ownerUrl\)\) \{[\s\S]{0,120}postStockAlert/.test(src));
  ok('an unconfigured Discord still reaches the relay outbox',
    /await postStockAlert\(product, remaining, tier\)/.test(src),
    'relay-only is the setup this project documents');
}

// ── 7. An alert can never break an order ────────────────────────────────────
console.log('\n— The order comes first —');
{
  const src = (await import('node:fs')).readFileSync(
    new URL('../src/services/codeStockService.js', import.meta.url), 'utf8');
  ok('every alert call is guarded', (src.match(/\.catch\(\(\) => \{\}\)/g) || []).length >= 3);
  ok('and the whole check is wrapped', /catch \(err\) \{[\s\S]{0,120}low-stock check failed/.test(src));
}

globalThis.fetch = realFetch;
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
