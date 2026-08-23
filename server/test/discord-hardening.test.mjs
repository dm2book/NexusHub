/**
 * The Discord system, at the two points where it quietly lost things.
 *
 * The bot persisted XP, running giveaways and its weekly bookkeeping to JSON
 * files next to its own source, and the comments there say "so it survives a
 * restart". It survives a process restart. It does not survive a DEPLOY: the
 * documented target is Railway, where the container filesystem is the build
 * image and every push replaces it. So every code change reset every member's
 * level, desynced the level roles granted from it, and dropped every running
 * giveaway — entrants had entered something that no longer existed.
 *
 * And the direct-webhook path bypassed the outbox entirely. The outbox exists
 * because a lost event costs more than the queue does — its own comment says "a
 * lost ping means a paid order nobody knows about" — but one 500 from Discord,
 * one rate limit, one network blip, and the sale ping, the chargeback alert or
 * the out-of-stock warning was simply gone.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_discord_hard';
process.env.NODE_ENV ||= 'development';
process.env.REVIEW_INGEST_SECRET = 'test-ingest-secret-for-the-suite';

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n} ${x}`); } };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

const { ensureReady, createApp } = await import('../src/app.js');
await ensureReady();
await new Promise((r) => setTimeout(r, 3000));
const { all, run } = await import('../src/db/index.js');
const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;

const SECRET = process.env.REVIEW_INGEST_SECRET;
const signed = (path, canonical, body) => {
  const ts = String(Date.now());
  const sig = createHmac('sha256', SECRET).update(`${ts}.${canonical}`).digest('hex');
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-timestamp': ts, 'x-signature': sig },
    body: JSON.stringify(body),
  });
};

console.log('— State the bot cannot afford to lose —');
{
  const value = { u1: { xp: 420, lvl: 3 }, u2: { xp: 12, lvl: 0 } };
  const set = await signed('/api/discord/state/set', `state:set:xp:${JSON.stringify(value)}`,
    { key: 'xp', value });
  ok('a signed write is accepted', set.status === 200, `${set.status}`);

  const get = await signed('/api/discord/state/get', 'state:get:xp', { key: 'xp' });
  const got = await get.json();
  ok('…and comes back exactly', JSON.stringify(got.value) === JSON.stringify(value), JSON.stringify(got));

  const missing = await signed('/api/discord/state/get', 'state:get:giveaways', { key: 'giveaways' });
  ok('an unwritten key is null, not an error',
    missing.status === 200 && (await missing.json()).value === null);
}

console.log('\n— And nobody else may write it —');
{
  const value = { u1: { xp: 999999 } };
  const ts = String(Date.now());
  const unsigned = await fetch(`${base}/api/discord/state/set`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'xp', value }) });
  ok('an unsigned write is refused', unsigned.status >= 400, `${unsigned.status}`);

  const wrongSig = await fetch(`${base}/api/discord/state/set`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-timestamp': ts, 'x-signature': 'deadbeef' },
    body: JSON.stringify({ key: 'xp', value }) });
  ok('a forged signature is refused', wrongSig.status >= 400, `${wrongSig.status}`);

  /* The key is inside the signature, so a captured write cannot be pointed at a
     different one — which is what stops a replay from scribbling over another
     bot key. */
  const swapped = await signed('/api/discord/state/set', `state:set:xp:${JSON.stringify(value)}`,
    { key: 'meta', value });
  ok('a signature for one key does not authorise another', swapped.status >= 400, `${swapped.status}`);

  // And the endpoint only ever touches its own namespace.
  const other = await signed('/api/discord/state/set', `state:set:category_logos:${JSON.stringify(value)}`,
    { key: 'category_logos', value });
  ok('an unknown key is refused outright', other.status === 400, `${other.status}`);
  const logos = await all(`SELECT key FROM kv WHERE key='category_logos'`);
  ok('…and nothing outside the namespace was written', logos.length === 0, JSON.stringify(logos));

  const stillMine = await signed('/api/discord/state/get', 'state:get:xp', { key: 'xp' });
  ok('the real value survived all of that',
    (await stillMine.json()).value?.u1?.xp === 420);
}

console.log('\n— A webhook that fails does not eat the event —');
{
  await run(`DELETE FROM discord_outbox`);
  const { postStockAlert } = await import('../src/services/discordService.js');
  const { config } = await import('../src/config/env.js');

  // A webhook URL that answers 500, the way Discord does when it is unhappy.
  const http = await import('node:http');
  let hits = 0;
  const bad = http.createServer((_q, s) => { hits++; s.writeHead(500); s.end('nope'); });
  await new Promise((r) => bad.listen(0, r));
  const saved = config.discord.stockWebhookUrl;
  config.discord.stockWebhookUrl = `http://127.0.0.1:${bad.address().port}/hook`;

  await postStockAlert({ id: 'prd_x', name: 'Test product' }, 0, 0).catch(() => {});
  const queued = await all(`SELECT kind FROM discord_outbox WHERE delivered_at IS NULL`);
  ok('the webhook was actually tried', hits >= 1, `${hits}`);
  ok('…and the event was queued for the bot instead of dropped',
    queued.length === 1, JSON.stringify(queued));

  config.discord.stockWebhookUrl = saved;
  bad.close();
}

console.log('\n— A Discord that stops answering cannot stall an order —');
{
  const src = read('server', 'src', 'services', 'discordService.js');
  ok('the webhook post carries a deadline',
    /AbortController/.test(src) && /signal: ctrl\.signal/.test(src));
  ok('…and says so when it trips', /timed out after/.test(src));
  ok('a failed direct post falls through to the queue',
    /if \(await postWebhook\(url, body\)\) return true;[\s\S]{0,200}enqueueOutbox\(channel, body\)/.test(src));
}

console.log('\n— The bot writes its state where a deploy cannot reach it —');
{
  const bot = read('discord', 'src', 'bot.js');
  ok('there is one helper for durable state, not three copies',
    /async function stateGet\(/.test(bot) && /async function stateSet\(/.test(bot));
  ok('giveaways go through it', /stateSet\('giveaways'/.test(bot));
  ok('XP goes through it', /stateSet\('xp'/.test(bot));
  ok('the weekly bookkeeping goes through it', /stateSet\('meta'/.test(bot));
  ok('they are loaded again on ready',
    /loadXP\(\);/.test(bot) && /loadMeta\(\);/.test(bot) && /restoreGiveaways\(c\);/.test(bot));
  ok('the local file is kept as the fallback, not dropped',
    /existsSync\(file\)/.test(bot) && /writeFileSync\(file/.test(bot));

  /* The store write is a signed round trip carrying the whole map; on a busy
     server the four-second file debounce would repost every member's score all
     day long. */
  ok('the store is written on a slower cadence than the file',
    /xpStoreAt > 60_000/.test(bot), 'no separate cadence');

  /* Railway sends SIGTERM on every deploy, and the saves are debounced — so the
     one moment that reliably erases state was the one moment nothing wrote. */
  ok('SIGTERM flushes before the container goes', /'SIGTERM'/.test(bot) && /async function shutdown/.test(bot));
  ok('…all three stores', /stateSet\('xp', XP, XP_FILE\)[\s\S]{0,200}stateSet\('meta'/.test(bot));
  ok('…and Discord is told, instead of showing green until the session times out',
    /client\.destroy\(\)/.test(bot));
}

srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
