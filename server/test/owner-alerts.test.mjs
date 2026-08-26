/**
 * Owner alerts: does every one of the ten actually arrive, and does the shop
 * survive them not arriving?
 *
 * Every assertion here runs against a real database and a real HTTP server
 * standing in for Discord, Telegram and Pushover, so what is checked is what
 * left the process — not that a function was called.
 *
 * The ten events are the ones the owner asked for. Seven existed; four did not,
 * and the four that did not are the quiet ones: a fulfilment that failed, a
 * webhook the PSP could not deliver, an email that never sent, a 500. Those are
 * the failures nobody complains about, which is exactly why they need a page.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_owner_alerts';
process.env.NODE_ENV ||= 'development';
process.env.APP_URL ||= 'https://forgemarket.nl';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

import http from 'node:http';

// ── Stand-ins for the three channels ────────────────────────────────────────
const received = [];
let failNext = 0;          // make the next N requests fail, to test retry
let statusToReturn = 200;

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  received.push({ path: req.url, body: Buffer.concat(chunks).toString() });
  if (failNext > 0) { failNext--; res.writeHead(statusToReturn); return res.end('nope'); }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"ok":true}');
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

// Set BEFORE config is first imported.
process.env.NOTIFY_DISCORD_WEBHOOK_URL = `${base}/discord`;
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_CHAT_ID = '12345';
process.env.PUSHOVER_TOKEN = 'ptok';
process.env.PUSHOVER_USER = 'puser';

const { migrate } = await import('../src/db/migrate.js');
await migrate();
const { run, get, all, nowIso } = await import('../src/db/index.js');
const N = await import('../src/services/notifyService.js');

/* Telegram and Pushover go to real hostnames. Point them at the local server by
   intercepting fetch — the alternative is asserting on a mock of our own code,
   which proves nothing about what the process would actually send. */
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  const u = String(url);
  const local = u.startsWith('http://127.0.0.1')
    ? u
    : `${base}/${u.includes('telegram') ? 'telegram' : u.includes('pushover') ? 'pushover' : 'other'}`;
  return realFetch(local, init);
};

const reset = () => { received.length = 0; failNext = 0; statusToReturn = 200; };
const sentTo = (kind) => received.filter((r) => r.path.includes(kind)).length;

console.log('\n── All ten events reach all three channels ─────────────────');

const EVENTS_ASKED_FOR = [
  ['order.paid', 'successful order'],
  ['payment.failed', 'failed payment'],
  ['order.refunded', 'refund'],
  ['chargeback', 'chargeback'],
  ['stock.out', 'product sold out'],
  ['stock.critical', 'critical stock'],
  ['system.error', 'system error'],
  ['fulfillment.failed', 'fulfillment failure'],
  ['webhook.failed', 'payment webhook failure'],
  ['email.failed', 'email delivery failure'],
];

for (const [event, asked] of EVENTS_ASKED_FOR) {
  reset();
  const r = await N.alertOwner(event, {
    title: `test ${event}`, lines: ['line one', 'line two'], key: `t-${event}`,
  });
  const all3 = sentTo('discord') === 1 && sentTo('telegram') === 1 && sentTo('pushover') === 1;
  ok(`${asked.padEnd(24)} → discord, telegram, pushover`,
    r.status === 'sent' && all3,
    `${r.status}, d=${sentTo('discord')} t=${sentTo('telegram')} p=${sentTo('pushover')}`);
}

console.log('\n── Priority is carried, not just declared ─────────────────');

{
  reset();
  await N.alertOwner('chargeback', { title: 'loud', lines: ['x'], key: 'p-loud' });
  const push = received.find((r) => r.path.includes('pushover'));
  ok('a chargeback asks Pushover for priority 1', /priority=1/.test(push.body), push.body.slice(0, 90));
  const tg = received.find((r) => r.path.includes('telegram'));
  ok('…and does not silence Telegram', /"disable_notification":false/.test(tg.body));

  reset();
  await N.alertOwner('stock.low', { title: 'quiet', lines: ['x'], key: 'p-quiet' });
  const push2 = received.find((r) => r.path.includes('pushover'));
  ok('low stock asks for priority -1', /priority=-1/.test(push2.body));
  const tg2 = received.find((r) => r.path.includes('telegram'));
  ok('…and arrives silently on Telegram', /"disable_notification":true/.test(tg2.body),
    'an owner woken by a restock reminder mutes the channel and then misses the chargeback');
}

console.log('\n── Deduplication ──────────────────────────────────────────');

{
  reset();
  const a = await N.alertOwner('order.paid', { title: 'FM-1 · €9.99', lines: ['x'], key: 'FM-1:paid' });
  const b = await N.alertOwner('order.paid', { title: 'FM-1 · €9.99', lines: ['x'], key: 'FM-1:paid' });
  ok('the same event twice is sent once', a.status === 'sent' && b.status === 'duplicate',
    `${a.status}/${b.status}`);
  ok('…and only one message left the process', sentTo('discord') === 1, String(sentTo('discord')));

  // The race, not the sequence: two callers at the same instant.
  reset();
  const [x, y] = await Promise.all([
    N.alertOwner('order.paid', { title: 'FM-2', lines: ['x'], key: 'FM-2:paid' }),
    N.alertOwner('order.paid', { title: 'FM-2', lines: ['x'], key: 'FM-2:paid' }),
  ]);
  const statuses = [x.status, y.status].sort();
  ok('two callers racing on one event still send once',
    statuses[0] === 'duplicate' && statuses[1] === 'sent', statuses.join('/'));
  ok('…enforced by the database, not by a SELECT that races itself',
    sentTo('discord') === 1, String(sentTo('discord')));

  ok('a different event on the same order is NOT deduplicated', await (async () => {
    reset();
    const p = await N.alertOwner('order.paid', { title: 'FM-3', lines: ['x'], key: 'FM-3:paid' });
    const rf = await N.alertOwner('order.refunded', { title: 'FM-3', lines: ['x'], key: 'FM-3:refunded' });
    return p.status === 'sent' && rf.status === 'sent';
  })());
}

console.log('\n── No notification storm ──────────────────────────────────');

{
  reset();
  const budget = N.STORM.perEvent['system.error'];
  /* The window is shared with everything else this file has already sent, and
     an earlier section fired one system.error of its own. Hard-coding "budget"
     here made the test wrong rather than the code — so the expectation is read
     from the same window the rule reads, which is also the only way this stays
     correct when a section is added above. */
  const since = new Date(Date.now() - N.STORM.windowMs).toISOString();
  const alreadySent = Number((await get(
    `SELECT COUNT(*) AS n FROM owner_alerts
      WHERE event='system.error' AND created_at > @s AND status IN ('sent','suppressed')`,
    { s: since })).n);
  const room = Math.max(0, budget - alreadySent);
  const burst = room + 6;

  const results = [];
  for (let i = 0; i < burst; i++) {
    results.push((await N.alertOwner('system.error',
      { title: `burst ${i}`, lines: ['x'], key: `burst-${i}` })).status);
  }
  const sent = results.filter((s) => s === 'sent').length;
  const suppressed = results.filter((s) => s === 'suppressed').length;
  ok(`only the ${room} left in the window get through, not all ${burst}`,
    sent === room, `sent=${sent}, room=${room}`);
  ok('the rest are suppressed, not dropped', suppressed === burst - room,
    `suppressed=${suppressed}`);
  ok('…and every one is still on record',
    Number((await get(`SELECT COUNT(*) AS n FROM owner_alerts WHERE event='system.error'`)).n) >= burst);
  ok('the phone rang once per sent alert and no more',
    sentTo('discord') === room, String(sentTo('discord')));

  // A storm of one kind must not silence a different, rarer kind.
  reset();
  const cb = await N.alertOwner('chargeback', { title: 'during the storm', lines: ['x'], key: 'cb-storm' });
  ok('a chargeback still gets through during an error storm', cb.status === 'sent', cb.status);
}

console.log('\n── Storms are summarised, not forgotten ───────────────────');

{
  // Age the suppressed rows past the window so the sweep closes them out.
  const held = Number((await get(
    `SELECT COUNT(*) AS n FROM owner_alerts WHERE status='suppressed'`)).n);
  const old = new Date(Date.now() - N.STORM.windowMs - 60_000).toISOString();
  await run(`UPDATE owner_alerts SET created_at=@o WHERE status='suppressed'`, { o: old });
  reset();
  const swept = await N.sweepAlerts();
  ok('the sweep summarises everything that was held back',
    swept.summarised === held, `${swept.summarised} of ${held}`);
  const msg = received.find((r) => r.path.includes('discord'))?.body || '';
  ok('…in one message that says how many', new RegExp(`${held} more`).test(msg), msg.slice(0, 140));
  ok('…and the rows are marked so it happens once',
    Number((await get(`SELECT COUNT(*) AS n FROM owner_alerts WHERE status='suppressed'`)).n) === 0);
}

console.log('\n── Retries ────────────────────────────────────────────────');

{
  /* Every channel down. The alert must survive as a row, and the sweep must
     deliver it once they come back — this is the case the whole table exists
     for. */
  reset();
  failNext = 99; statusToReturn = 503;
  const r = await N.alertOwner('chargeback', { title: 'while everything was down', lines: ['x'], key: 'cb-down' });
  ok('an alert nobody accepted is not lost', r.status === 'failed' && !!r.id, r.status);
  const row = await get('SELECT * FROM owner_alerts WHERE id=@id', { id: r.id });
  ok('…it is recorded as pending, with the error', row.status === 'pending' && !!row.last_error,
    `${row.status} / ${row.last_error}`);
  ok('…and scheduled to be tried again', !!row.next_try_at);
  ok('in-request retry already tried twice per channel', row.attempts === 1 && sentTo('discord') === 2,
    `attempts=${row.attempts} discord=${sentTo('discord')}`);

  reset();
  await run(`UPDATE owner_alerts SET next_try_at=@n WHERE id=@id`,
    { n: new Date(Date.now() - 1000).toISOString(), id: r.id });
  const swept = await N.sweepAlerts();
  ok('the sweep delivers it once the channels are back', swept.delivered === 1, JSON.stringify(swept));
  const after = await get('SELECT * FROM owner_alerts WHERE id=@id', { id: r.id });
  ok('…and it is marked sent, with the channels that took it',
    after.status === 'sent' && /discord/.test(after.channels || ''), `${after.status} ${after.channels}`);

  // Give-up, so a deleted webhook does not become an infinite queue.
  /* A different event from the storm section above: system.error has spent its
     window, and a SUPPRESSED alert is never retried — correctly, since it was
     deliberately not sent. Using it here tested the storm rule a second time
     instead of the give-up rule. */
  reset();
  failNext = 99; statusToReturn = 503;
  const g = await N.alertOwner('order.refunded', { title: 'gone forever', lines: ['x'], key: 'gone' });
  ok('…the give-up case starts from a pending alert, not a suppressed one',
    g.status === 'failed' && !!g.id, g.status);
  await run(`UPDATE owner_alerts SET attempts=@a, next_try_at=@n WHERE id=@id`,
    { a: N.MAX_ATTEMPTS, n: new Date(Date.now() - 1000).toISOString(), id: g.id });
  const s2 = await N.sweepAlerts();
  ok('an alert that can never be delivered is eventually given up on', s2.givenUp === 1,
    JSON.stringify(s2));
  ok('…and says so rather than disappearing',
    (await get('SELECT status FROM owner_alerts WHERE id=@id', { id: g.id })).status === 'failed');
  failNext = 0; statusToReturn = 200;
}

console.log('\n── A notification failure cannot break an order ───────────');

{
  /* The property that matters more than any of the above. Nothing about
     alerting may be the reason a paid order fails to settle — so the table is
     removed outright, which is the bluntest version of every failure it could
     have, and an order is transitioned across it. */
  reset();
  const { newId } = await import('../src/utils/ids.js');
  const { exec } = await import('../src/db/index.js');
  await exec('ALTER TABLE owner_alerts RENAME TO owner_alerts_hidden');

  failNext = 0;
  const r = await N.alertOwner('order.paid', { title: 'no table', lines: ['x'], key: 'no-table' });
  ok('with the table gone the alert is still SENT',
    r.status === 'sent' && sentTo('discord') === 1,
    `${r.status} d=${sentTo('discord')} — losing the audit trail beats losing the page`);
  ok('…and reports that it could not be recorded', r.status === 'sent' && !r.id, JSON.stringify(r));

  // And with every channel down as well.
  reset();
  failNext = 99; statusToReturn = 500;
  let threw = null;
  try {
    await N.alertOwner('chargeback', { title: 'nothing works', lines: ['x'], key: 'nothing' });
  } catch (e) { threw = e; }
  ok('nothing throws even when the table and every channel are gone', threw === null,
    String(threw?.message));
  failNext = 0; statusToReturn = 200;

  await exec('ALTER TABLE owner_alerts_hidden RENAME TO owner_alerts');
}

console.log('\n── Every asked-for event is wired to something real ───────');

{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

  const wiring = [
    ['successful order / failed payment / refund', 'server/src/services/orderService.js', /alertOwner\(NOTIFY_ON\[to\]/],
    ['chargeback', 'server/src/services/chargebackService.js', /alertOwner\('chargeback'/],
    ['sold out / critical stock', 'server/src/services/codeStockService.js', /alertOwner\(event/],
    ['fulfillment failure', 'server/src/services/fulfillmentService.js', /alertOwner\('fulfillment\.failed'/],
    ['payment webhook failure', 'server/src/routes/mollie.js', /alertOwner\('webhook\.failed'/],
    ['email delivery failure', 'server/src/services/emailService.js', /alertOwner\('email\.failed'/],
    ['system error', 'server/src/middleware/error.js', /alertOwner\('system\.error'/],
  ];
  for (const [what, file, re] of wiring) {
    ok(`${what} fires from ${path.basename(file)}`, re.test(rd(file)));
  }

  ok('every call site passes a dedupe key',
    wiring.every(([, file]) => /key:/.test(rd(file))),
    'without one the title is the key, which deduplicates accidents and nothing else');

  ok('the maintenance sweep retries and prunes',
    /sweepAlerts/.test(rd('server/src/services/maintenanceService.js'))
    && /pruneAlerts/.test(rd('server/src/services/maintenanceService.js')));

  ok('the 500 handler no longer alerts Discord alone',
    !/postErrorAlert\(/.test(rd('server/src/middleware/error.js')),
    'it was Discord-only and throttled per-instance, so a Telegram owner saw no 500s at all');
}

globalThis.fetch = realFetch;
server.close();
console.log(`\n${fail === 0 ? '✅' : '❌'} owner alerts: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
