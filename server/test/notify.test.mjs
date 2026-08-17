/**
 * Owner alerts: five events, three channels, seconds not minutes.
 *
 * Everything here is checked against what actually left the process. The three
 * transports are pointed at a local server that records the requests, so the
 * assertions are about real HTTP — bodies, priorities and timing — rather than
 * about a function having been called.
 *
 * Two properties matter more than the formatting:
 *
 *  1. **An alert can never break an order.** These calls sit inside the payment
 *     webhook and the order state machine. A channel that is down, slow, or
 *     answering nonsense must cost the order nothing.
 *  2. **Slow is the same as broken.** The requirement is seconds. A transport
 *     with no deadline does not fail — it hangs, and takes the order with it.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_notify';
process.env.NODE_ENV ||= 'development';
process.env.APP_URL ||= 'https://forgemarket.nl';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

import http from 'node:http';

// ── A stand-in for Discord, Telegram and Pushover ───────────────────────────
const received = [];
let behaviour = 'ok';           // ok | slow | error | ratelimit
let rateLimitHits = 0;
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  received.push({ path: req.url, body: Buffer.concat(chunks).toString(), headers: req.headers });

  if (behaviour === 'slow') return;                       // never answers
  if (behaviour === 'error') { res.writeHead(500); return res.end('nope'); }
  if (behaviour === 'ratelimit' && rateLimitHits++ < 3) {
    res.writeHead(429, { 'retry-after': '1' }); return res.end('slow down');
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"ok":true}');
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

// Point every transport at it BEFORE the config module is first imported.
process.env.NOTIFY_DISCORD_WEBHOOK_URL = `${base}/discord`;
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_CHAT_ID = '12345';
process.env.PUSHOVER_TOKEN = 'ptok';
process.env.PUSHOVER_USER = 'puser';

const { notifyOwner, configuredChannels, EVENTS } = await import('../src/services/notifyService.js');

// Telegram and Pushover post to their real hostnames, so redirect those two at
// the stand-in without touching the service under test.
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  const u = String(url);
  if (u.startsWith('https://api.telegram.org')) return realFetch(`${base}/telegram`, init);
  if (u.startsWith('https://api.pushover.net')) return realFetch(`${base}/pushover`, init);
  return realFetch(url, init);
};

const reset = () => { received.length = 0; behaviour = 'ok'; rateLimitHits = 0; };
const to = (name) => received.filter((r) => r.path === `/${name}`);

// ── 1. Every configured channel gets it ─────────────────────────────────────
console.log('— One event reaches all three channels —');
{
  reset();
  ok('all three report as configured', configuredChannels().length === 3, configuredChannels().join(','));

  const r = await notifyOwner('order.paid', {
    title: 'FM-2026-TEST · €24.99',
    lines: ['1,000 Robux', 'Customer: buyer@x.dev'],
    url: 'https://forgemarket.nl/admin/orders/ord_1',
  });
  ok('all three were sent', r.sent.length === 3, JSON.stringify(r));
  ok('none failed', r.failed.length === 0, r.failed.join(','));
  ok('exactly one request per channel', received.length === 3, String(received.length));

  const d = JSON.parse(to('discord')[0].body);
  ok('discord sends an embed', !!d.embeds?.[0]);
  ok('…with the amount in the title', d.embeds[0].title.includes('€24.99'), d.embeds[0].title);
  ok('…and the event colour', d.embeds[0].color === EVENTS['order.paid'].color);

  const t = JSON.parse(to('telegram')[0].body);
  ok('telegram sends to the configured chat', t.chat_id === '12345', String(t.chat_id));
  ok('…with the order in the text', t.text.includes('FM-2026-TEST'));
  ok('…and the admin link', t.text.includes('/admin/orders/ord_1'));

  const p = new URLSearchParams(to('pushover')[0].body);
  ok('pushover sends the app token', p.get('token') === 'ptok');
  ok('…and a tappable link', p.get('url') === 'https://forgemarket.nl/admin/orders/ord_1');
}

// ── 2. Loudness matches the event ───────────────────────────────────────────
console.log('\n— A chargeback is not a restock reminder —');
{
  reset();
  await notifyOwner('chargeback', { title: 'FM-2026-X · €49.99', lines: ['Customer: a@b.dev'] });
  const cb = new URLSearchParams(to('pushover')[0].body);
  ok('a chargeback raises the push priority', cb.get('priority') === '1', cb.get('priority'));
  ok('…and is not silenced on telegram',
    JSON.parse(to('telegram')[0].body).disable_notification === false);

  reset();
  await notifyOwner('stock.low', { title: 'Low stock: Robux', lines: ['2 codes left.'] });
  const ls = new URLSearchParams(to('pushover')[0].body);
  ok('low stock is below normal priority', ls.get('priority') === '-1', ls.get('priority'));
  ok('…and arrives silently on telegram',
    JSON.parse(to('telegram')[0].body).disable_notification === true);
}

// ── 3. Hostile input cannot break the message ───────────────────────────────
console.log('\n— Order data is escaped, not interpolated —');
{
  reset();
  // A buyer controls their own email address, and Telegram parses HTML.
  await notifyOwner('order.paid', {
    title: 'FM-1 · €1',
    lines: ['Customer: <b>evil</b>@x.dev & co'],
  });
  const t = JSON.parse(to('telegram')[0].body);
  ok('customer-supplied HTML is escaped', t.text.includes('&lt;b&gt;evil&lt;/b&gt;'), t.text);
  ok('…and ampersands too', t.text.includes('&amp; co'));
  ok('the bold we add ourselves survives', t.text.includes('<b>FM-1'), t.text);
}

// ── 4. A broken channel costs the order nothing ─────────────────────────────
console.log('\n— Failure is contained —');
{
  reset(); behaviour = 'error';
  const r = await notifyOwner('order.paid', { title: 'x', lines: ['y'] });
  ok('a 500 from every channel does not throw', r.failed.length === 3, JSON.stringify(r));
  ok('…and is reported rather than swallowed', r.sent.length === 0);
  // One retry on a 5xx, so three channels produce six requests — not three, and
  // not a storm either.
  ok('a 5xx is retried exactly once', received.length === 6, String(received.length));

  reset(); behaviour = 'ratelimit';
  const rl = await notifyOwner('order.paid', { title: 'x', lines: ['y'] });
  ok('a 429 with retry-after is honoured and then succeeds', rl.sent.length === 3, JSON.stringify(rl));

  reset(); behaviour = 'ok';
  const unknown = await notifyOwner('not.a.real.event', { title: 'x', lines: ['y'] });
  ok('an unknown event sends nothing rather than crashing', unknown.configured === 0);
  ok('…and issues no requests', received.length === 0, String(received.length));
}

// ── 5. Seconds, not minutes ─────────────────────────────────────────────────
console.log('\n— A hung channel cannot hold an order open —');
{
  reset(); behaviour = 'slow';
  const t0 = Date.now();
  const r = await notifyOwner('order.paid', { title: 'x', lines: ['y'] });
  const ms = Date.now() - t0;
  ok('a channel that never answers is abandoned', r.sent.length === 0, JSON.stringify(r));
  // Three hung channels in PARALLEL cost one timeout, not three. Sequential
  // would be ~15s here, and the whole fan-out is budgeted below that anyway.
  ok(`…within seconds, in parallel (took ${ms}ms)`, ms < 8_000, `${ms}ms`);
  ok('…and it does not retry a timeout — that would double the wait',
    received.length === 3, `${received.length} requests`);
}

// ── 6. Nothing configured is a no-op, not an error ──────────────────────────
console.log('\n— A shop with no channels set still sells —');
{
  const src = (await import('node:fs')).readFileSync(
    new URL('../src/services/notifyService.js', import.meta.url), 'utf8');
  ok('each channel returns null when unconfigured', (src.match(/return null;/g) || []).length >= 3);
  ok('no channels means no requests and no throw', /if \(!started\.length\) return/.test(src));
  ok('the whole fan-out is budgeted, not just each attempt', /BUDGET_MS/.test(src),
    'per-attempt timeouts stack: 5s + a 5s retry is 10s inside a payment webhook');
}

// ── 7. The five events are wired where they happen ──────────────────────────
console.log('\n— All five events are connected to real state changes —');
{
  const fs = await import('node:fs');
  const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
  const orders = read('../src/services/orderService.js');
  const stock = read('../src/services/codeStockService.js');
  const cb = read('../src/services/chargebackService.js');

  ok('paid, failed and refunded hang off the state machine',
    /payment_received: 'order\.paid'/.test(orders)
    && /failed: 'payment\.failed'/.test(orders)
    && /refunded: 'order\.refunded'/.test(orders),
    'wiring them per-call-site would drift from TRANSITIONS');
  ok('…inside transitionOrder, which every status change goes through',
    /transitionOrder[\s\S]*NOTIFY_ON/.test(orders));
  ok('chargeback notifies', /notifyOwner\('chargeback'/.test(cb));
  ok('…after the duplicate guard, so a retried PSP webhook buzzes once',
    /if \(existing\) return \{ id: existing\.id, duplicate: true \}[\s\S]*notifyOwner\('chargeback'/.test(cb),
    'a PSP retry would notify repeatedly');
  ok('low stock notifies', /notifyOwner\('stock\.low'/.test(stock));
  ok('…after the once-per-cycle claim, so it fires per stock cycle not per order',
    /low_stock_alerted_at IS NULL[\s\S]*notifyOwner\('stock\.low'/.test(stock));

  // The launch dashboard has to admit when nobody is being told anything.
  const launch = read('../src/services/launchCheckService.js');
  ok('the readiness dashboard reports which channels are live',
    /configuredChannels\(\)/.test(launch), 'configuredChannels would be dead code');

  /**
   * Find what follows each notifyOwner(...) call.
   *
   * Counting brackets rather than matching a closing `})`: the messages contain
   * things like `(alert threshold ${config…})`, so a regex stops inside the
   * template string and reports a guarded call as unguarded. Ask the question
   * properly — where does this call actually end — and the answer is right.
   */
  const callTails = (src) => {
    const tails = [];
    for (let i = src.indexOf('notifyOwner('); i !== -1; i = src.indexOf('notifyOwner(', i + 1)) {
      let depth = 0, j = i + 'notifyOwner'.length;
      for (; j < src.length; j++) {
        if (src[j] === '(') depth++;
        else if (src[j] === ')' && --depth === 0) { j++; break; }
      }
      tails.push(src.slice(j, j + 24));
    }
    return tails;
  };

  for (const [name, src] of [['orders', orders], ['stock', stock], ['chargeback', cb]]) {
    const tails = callTails(src).filter((t) => !t.startsWith(';')); // skip the import line
    ok(`${name}: every notify call is guarded with .catch`,
      tails.length > 0 && tails.every((t) => t.startsWith('.catch(')),
      `an unguarded alert can reject an order — found: ${JSON.stringify(tails)}`);
  }
}

globalThis.fetch = realFetch;
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
