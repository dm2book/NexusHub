/**
 * The bot's requests to the store (middleware/ingestSignature.js):
 *   v2  signs timestamp, method, path and the WHOLE body — every endpoint, one rule;
 *   old signatures keep working until BOT_LEGACY_SIGNATURES=off (the bot runs
 *       separately and keeps sending them until it is redeployed), and their use
 *       is recorded;
 *   a signature works once — a captured request cannot be sent again.
 * The signer is the bot's own (discord/src/signing.js).
 */
process.env.NODE_ENV = 'development';
process.env.REVIEW_INGEST_SECRET = 'bot-secret-for-tests';
process.env.DISCORD_GUILD_ID = '111111111111111111';
process.env.DISCORD_PAYLINK_SECRET = 'paylink-secret-for-tests';

import { createHmac } from 'node:crypto';
import { signRequestV2 } from '../../discord/src/signing.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { get, run } = await import('../src/db/index.js');
const { config } = await import('../src/config/env.js');
const srv = createApp().listen(0);
const origin = `http://127.0.0.1:${srv.address().port}`;

let lastTs = 0;
const nextTs = () => String(lastTs = Math.max(Date.now(), lastTs + 1));
/** A v2 request exactly as the bot sends it. */
const v2 = (path, body, { secret = 'bot-secret-for-tests', ts = nextTs(), tamper = null } = {}) => {
  const raw = JSON.stringify(body);
  const headers = { 'content-type': 'application/json', 'x-timestamp': ts, 'x-signature': signRequestV2(secret, ts, 'POST', path, raw) };
  return { url: `${origin}${path}`, init: { method: 'POST', headers, body: tamper ? JSON.stringify(tamper) : raw } };
};
const legacy = (path, body, canonical, { secret = 'bot-secret-for-tests' } = {}) => {
  const ts = nextTs();
  return { url: `${origin}${path}`, init: { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json',
    'x-timestamp': ts, 'x-signature': createHmac('sha256', secret).update(`${ts}.${canonical}`).digest('hex') } } };
};
const send = async ({ url, init }) => { const r = await fetch(url, init); return { status: r.status, body: await r.json().catch(() => ({})) }; };

console.log('— v2: the whole request is signed —');
{
  const set = await send(v2('/api/discord/state/set', { key: 'xp', value: { u1: 10 } }));
  ok('a v2-signed state write is accepted', set.status === 200, `${set.status} ${JSON.stringify(set.body)}`);
  const got = await send(v2('/api/discord/state/get', { key: 'xp' }));
  ok('…and reads back', got.status === 200 && got.body.value?.u1 === 10, JSON.stringify(got.body));
  const tampered = await send(v2('/api/discord/state/set', { key: 'xp', value: { u1: 10 } }, { tamper: { key: 'xp', value: { u1: 999999 } } }));
  ok('a changed value under the same signature is refused', tampered.status === 403);
  const req = v2('/api/discord/balance', { uid: '1' });
  const moved = await send({ url: `${origin}/api/discord/referral`, init: req.init });
  ok('a signature made for one endpoint is worthless on another', moved.status === 403, String(moved.status));
  const stale = await send(v2('/api/discord/digest', {}, { ts: String(Date.now() - 6 * 60_000) }));
  ok('an old timestamp is refused', stale.status === 403);
  const review = await send(v2('/api/reviews/ingest', { author: 'Sam', stars: 5, body: 'Snel geleverd', externalId: `msg_${Date.now()}`, avatarUrl: 'https://cdn.discordapp.com/a.png' }));
  ok('the review ingest takes v2 too (avatar inside the signature)', review.status === 201 || review.status === 200, `${review.status} ${JSON.stringify(review.body)}`);
}

console.log('— Each signature works once —');
{
  const once = v2('/api/discord/state/set', { key: 'meta', value: { v: 1 } });
  const first = await send(once);
  const again = await send(once);
  ok('the first use is accepted', first.status === 200, String(first.status));
  ok('sending the same signed request again is refused', again.status === 403 && /already used/i.test(again.body?.error?.message || ''),
    `${again.status} ${JSON.stringify(again.body)}`);
}

console.log('— Old signatures, until the bot is redeployed —');
{
  await run(`DELETE FROM kv WHERE key = 'bot_legacy_signature_seen_at'`);
  const old = await send(legacy('/api/discord/balance', { uid: '2' }, 'balance:2'));
  ok('an old-style signature from the running bot still works', old.status === 200, `${old.status} ${JSON.stringify(old.body)}`);
  ok('…and its use is recorded for the owner', !!(await get(`SELECT value FROM kv WHERE key = 'bot_legacy_signature_seen_at'`)));
  config.discord.legacyBotSignatures = false;
  const off = await send(legacy('/api/discord/balance', { uid: '3' }, 'balance:3'));
  ok('with BOT_LEGACY_SIGNATURES=off it is refused', off.status === 403, String(off.status));
  const stillV2 = await send(v2('/api/discord/balance', { uid: '3' }));
  ok('…while v2 keeps working', stillV2.status === 200, String(stillV2.status));
  config.discord.legacyBotSignatures = true;
}

console.log('— /pay-link keeps its own secret —');
{
  const general = await send(v2('/api/discord/pay-link', { number: 'FM-2026-NOPE0000', url: 'https://tikkie.me/pay/x' }));
  ok('the general bot secret cannot attach a payment link', general.status === 403, String(general.status));
  const own = await send(v2('/api/discord/pay-link', { number: 'FM-2026-NOPE0000', url: 'https://tikkie.me/pay/x' }, { secret: 'paylink-secret-for-tests' }));
  ok('…its own secret passes the signature (then the order is looked up)', own.status !== 403, `${own.status} ${JSON.stringify(own.body)}`);
}

console.log('— Bookkeeping —');
{
  const { forgetSpentSignatures } = await import('../src/middleware/ingestSignature.js');
  await run(`UPDATE kv SET value = '2000-01-01T00:00:00.000Z' WHERE starts_with(key, 'bot_sig_used:')`);
  const removed = await forgetSpentSignatures();
  ok('used signatures are forgotten once their window has passed', removed > 0, String(removed));
}

srv.close();
console.log(`\n${fail ? '❌' : '✅'} bot-signature: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
