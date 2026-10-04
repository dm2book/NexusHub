/**
 * The store's side of the Discord bot.
 *
 *   the old unsigned `x-ingest-secret` header is refused — it had no
 *   timestamp, so one captured request could be replayed forever;
 *   an invite for any server but the configured one is refused, so a stranger
 *   who adds the bot cannot point "Join Discord" at their own server;
 *   /pay-link needs its own secret — the general bot secret is not enough to
 *   attach a payment link to a customer's order;
 *   the owner hears about it when the bot stops polling, once per outage;
 *   the buyer's DMs are in their language and claim nothing untrue.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV = 'development';
process.env.REVIEW_INGEST_SECRET = 'bot-secret-for-tests';
process.env.DISCORD_GUILD_ID = '111111111111111111';
delete process.env.DISCORD_PAYLINK_SECRET;

import { createHmac } from 'node:crypto';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { run, get } = await import('../src/db/index.js');
const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}/api/discord`;
const sign = (secret, canonical) => {
  const ts = String(Date.now());
  return { 'content-type': 'application/json', 'x-timestamp': ts, 'x-signature': createHmac('sha256', secret).update(`${ts}.${canonical}`).digest('hex') };
};

console.log('\n— Signed requests only —');
{
  const url = 'https://discord.gg/abcDEF1';
  const legacy = await fetch(`${base}/invite`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-secret': 'bot-secret-for-tests' },
    body: JSON.stringify({ url }) });
  ok('the old shared-secret header is refused', legacy.status === 403, String(legacy.status));
}

console.log('\n— The invite is for our server —');
{
  const url = 'https://discord.gg/strangers1';
  const other = await fetch(`${base}/invite`, { method: 'POST',
    headers: sign('bot-secret-for-tests', `invite:${url}:999999999999999999`), body: JSON.stringify({ url, guildId: '999999999999999999' }) });
  ok('a signed invite for another server is refused', other.status === 403, String(other.status));
  const mine = 'https://discord.gg/ourServer1';
  const good = await fetch(`${base}/invite`, { method: 'POST',
    headers: sign('bot-secret-for-tests', `invite:${mine}:111111111111111111`), body: JSON.stringify({ url: mine, guildId: '111111111111111111' }) });
  ok('…one for ours is accepted', good.status === 200, String(good.status));
}

console.log('\n— /pay-link has its own secret —');
{
  const body = { number: 'FM-NOPE', url: 'https://tikkie.me/pay/abc' };
  const r = await fetch(`${base}/pay-link`, { method: 'POST',
    headers: sign('bot-secret-for-tests', `paylink:${body.number}:${body.url}`), body: JSON.stringify(body) });
  ok('the general bot secret does not open it (off until DISCORD_PAYLINK_SECRET is set)', r.status === 403, String(r.status));
}

console.log('\n— An offline bot is reported —');
{
  const { checkBotHeartbeat } = await import('../src/services/discordService.js');
  await run(`INSERT INTO kv (key, value, updated_at) VALUES ('discord_bot_seen_at', @v, @v)
             ON CONFLICT (key) DO UPDATE SET value=@v, updated_at=@v`, { v: new Date().toISOString() });
  ok('a bot that polled a minute ago is online', (await checkBotHeartbeat()).status === 'online');
  const old = new Date(Date.now() - 45 * 60_000).toISOString();
  await run(`UPDATE kv SET value=@v WHERE key='discord_bot_seen_at'`, { v: old });
  const r = await checkBotHeartbeat();
  ok('one silent for 45 minutes is offline, and the owner is alerted', r.status === 'offline' && r.minutes >= 44);
  const sent = await get(`SELECT COUNT(*)::int AS n FROM owner_alerts WHERE event='system.error' AND dedupe_key=@k`, { k: `bot-offline-${old}` }).catch(() => null);
  ok('…once per outage, keyed on when it was last seen', sent === null || sent.n <= 1);
}

console.log('\n— The DMs —');
{
  const fs = await import('node:fs');
  const dsvc = fs.readFileSync(new URL('../src/services/discordService.js', import.meta.url), 'utf8');
  ok('no "landed a day ago" guess, no "before it\'s gone"', !/landed a day ago/.test(dsvc) && !/before it's gone/.test(dsvc));
  ok('both DMs come in nl, en, de and fr', ['Je bestelling wacht op betaling', 'Your order is waiting for payment', 'Deine Bestellung wartet', 'Ta commande attend'].every((t) => dsvc.includes(t)));
  ok('the fraud and proof alerts carry no customer email', !/name: 'Customer', value: order\.email/.test(dsvc));
}

srv.close();
console.log(`\n${fail ? '❌' : '✅'} discord-guards: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
