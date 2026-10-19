/**
 * The bot's link to the store fails loudly and safely.
 *
 * The live site reported the bot as "never seen" and nothing in the bot's own
 * log said why. Each block below is one way that happened, or one way the bot
 * could damage its own durable state while the store was unreachable.
 * Runs without Postgres or a Discord token.
 */
import { readFileSync } from 'node:fs';
import {
  apiBaseUrl, describeRelayFailure, createOnceLogger, selfTestRelay, createStateStore, STATE_UNAVAILABLE,
  mergeMeta, shouldLeaveGuild, createCachedLoader,
} from '../src/storeRelay.js';
import { orderStatusView } from '../src/orderStatus.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const bot = readFileSync(new URL('../src/bot.js', import.meta.url), 'utf8');

console.log('— The API address —');
ok('a value ending in /api is the origin (it called /api/api/discord/outbox, a silent 404)',
  apiBaseUrl('https://forgemarket.nl/api') === 'https://forgemarket.nl');
ok('…a bare domain gets https://, slashes go', apiBaseUrl('www.forgemarket.nl/') === 'https://www.forgemarket.nl');
ok('…empty falls back', apiBaseUrl('  ', 'https://www.forgemarket.nl') === 'https://www.forgemarket.nl');
ok('the bot uses it for FORGEMARKET_API_URL', /FORGEMARKET_API_URL = apiBaseUrl\(/.test(bot));

console.log('\n— Saying why a call failed —');
{
  const m403 = await describeRelayFailure(json(403, { error: 'Ingest is not configured' }), 'https://x/api/discord/outbox');
  ok('a 403 names the store\'s own reason and the secret to check',
    /403/.test(m403) && /Ingest is not configured/.test(m403) && /REVIEW_INGEST_SECRET/.test(m403), m403);
  const m404 = await describeRelayFailure(new Response('nope', { status: 404 }), 'https://x/api/api/discord/outbox');
  ok('a 404 names the URL and FORGEMARKET_API_URL', /api\/api\/discord\/outbox/.test(m404) && /FORGEMARKET_API_URL/.test(m404), m404);
  const lines = [];
  const once = createOnceLogger((m) => lines.push(m));
  once('k', 'a'); once('k', 'a'); once('k', 'a');
  ok('a failure that repeats every minute is logged once', lines.length === 1);
  ok('the outbox poll logs the reason instead of swallowing a 404',
    /describeRelayFailure\(res, `\$\{FORGEMARKET_API_URL\}\/api\/discord\/outbox`\)/.test(bot)
    && !/stay quiet about it/.test(bot));
}

console.log('\n— Startup self-test —');
{
  const off = await selfTestRelay({ enabled: false });
  ok('no secret: says the relay is off', !off.ok && /REVIEW_INGEST_SECRET/.test(off.reason));
  const bad = await selfTestRelay({ enabled: true, url: 'https://x', signedPost: async () => json(403, { error: 'Bad signature' }) });
  ok('refused: says why', !bad.ok && /Bad signature/.test(bad.reason), bad.reason);
  const good = await selfTestRelay({ enabled: true, url: 'https://x', signedPost: async () => json(200, { value: null }) });
  ok('works: "store relay: ok"', good.ok && good.reason === 'store relay: ok');
  ok('the bot runs it at startup', /selfTestRelay\(\{ enabled:/.test(bot));
}

console.log('\n— Durable state —');
{
  const files = new Map();
  const fs = {
    existsSync: (f) => files.has(String(f)),
    readFileSync: (f) => files.get(String(f)),
    writeFileSync: (f, v) => files.set(String(f), v),
  };
  const silent = { error() {}, warn() {} };
  const posted = [];
  const down = async (path, body) => { posted.push([path, body]); throw new Error('ECONNREFUSED'); };
  const store = createStateStore({ enabled: true, signedPost: down, fs, log: silent, waits: [0], sleep: async () => {} });

  // A fresh container (no file) saves before the store ever answered.
  await store.set('xp', { u1: { xp: 5 } }, '/app/xp.json');
  ok('the save writes the local file', files.has('/app/xp.json'));
  ok('…but never posts a key the store has not answered for', !posted.some(([p]) => p === '/api/discord/state/set'));
  const got = await store.get('xp', '/app/xp.json');
  ok('a file THIS process wrote is not taken for the stored state', got === STATE_UNAVAILABLE && !store.isLoaded('xp'));

  // A file that was there before boot (VPS, same disk) still is real state.
  files.set('/app/meta.json', JSON.stringify({ launchAnnounced: '2026-10-23T22:00:00Z' }));
  const meta = await store.get('meta', '/app/meta.json');
  ok('a file from before this process started is still the fallback', meta?.launchAnnounced === '2026-10-23T22:00:00Z');

  // The store answers 404 (wrong URL or no store): logged once, not silent.
  const errs = [];
  const s404 = createStateStore({ enabled: true, url: 'https://x', fs, log: { error: (m) => errs.push(m), warn() {} },
    waits: [0], sleep: async () => {}, signedPost: async () => new Response('', { status: 404 }) });
  await s404.get('a', null); await s404.get('b', null);
  ok('a 404 from the store is logged, once, with the URL', errs.length === 1 && /404 from https:\/\/x/.test(errs[0]), errs.join(' | '));
}

console.log('\n— META merge —');
{
  const stored = {
    endedGiveaways: { g1: { prize: 'old' }, g2: { prize: 'older' } },
    suggestions: { s1: { up: ['a'] } },
    starred: ['m1', 'm2'],
    launchAnnounced: '2026-10-23T22:00:05Z',
  };
  const live = { endedGiveaways: { g3: { prize: 'ended while offline' } }, suggestions: { s2: { up: ['b'] } }, starred: ['m3'] };
  const m = mergeMeta(stored, live);
  ok('a giveaway that ended before the load keeps the stored history',
    Object.keys(m.endedGiveaways).sort().join() === 'g1,g2,g3', JSON.stringify(m.endedGiveaways));
  ok('one early vote does not wipe the stored suggestions', !!m.suggestions.s1 && !!m.suggestions.s2);
  ok('starred is a union, so old messages are not starred again', ['m1', 'm2', 'm3'].every((x) => m.starred.includes(x)));
  ok('the launch stays announced', m.launchAnnounced === '2026-10-23T22:00:05Z');
  ok('the bot merges this way, not { ...stored, ...META }', /META = mergeMeta\(stored, META\)/.test(bot) && !/META = \{ \.\.\.stored, \.\.\.META \}/.test(bot));
  ok('giveaways are restored after META is loaded', /loadMeta\(\)\.then\(\(\) => \{[^}]*restoreGiveaways\(c\)/.test(bot));
  ok('the launch post checks the channel for an earlier one', /m\.mentions\?\.everyone/.test(bot));
}

console.log('\n— Guild guard —');
ok('a wrong DISCORD_GUILD_ID (ours absent) leaves nothing',
  shouldLeaveGuild({ guildId: 'real', homeId: 'oops', homePresent: false }) === false);
ok('with ours present, a foreign guild is left', shouldLeaveGuild({ guildId: 'other', homeId: 'home', homePresent: true }) === true);
ok('ours is never left', shouldLeaveGuild({ guildId: 'home', homeId: 'home', homePresent: true }) === false);
ok('the bot asks before leaving', /shouldLeaveGuild\(\{ guildId: guild\.id, homeId: GUILD_ID/.test(bot));

console.log('\n— Discord\'s 3-second reply window —');
{
  let calls = 0;
  const slow = createCachedLoader({ firstWaitMs: 50, load: () => new Promise((r) => { calls++; setTimeout(() => r({ v: 1 }), 400); }) });
  const t0 = Date.now();
  const first = await slow();
  ok('a cold site: the first caller waits at most firstWaitMs', Date.now() - t0 < 300 && first === null, `${Date.now() - t0}ms`);
  await new Promise((r) => setTimeout(r, 450));
  const t1 = Date.now();
  const second = await slow();
  ok('…and the load still lands for the next caller, instantly', second?.v === 1 && Date.now() - t1 < 20 && calls === 1);
  let t = 0;
  const stale = createCachedLoader({ ttlMs: 10, firstWaitMs: 50, now: () => t, load: async () => ({ at: t }) });
  t = 0; await stale(); await new Promise((r) => setTimeout(r, 5));
  t = 100;
  const v = await stale();
  ok('a stale copy answers at once while it refreshes', v?.at === 0);
  ok('siteConfig is built on it', /const siteConfig = createCachedLoader\(/.test(bot));
}

console.log('\n— Secrets and texts —');
ok('REVIEW_INGEST_SECRET is trimmed on the bot', /REVIEW_INGEST_SECRET = String\(process\.env\.REVIEW_INGEST_SECRET \|\| ''\)\.trim\(\)/.test(bot));
{
  const order = { number: 'FM-2026-AAAA1111', status: 'pending', total: 999, currency: 'EUR', history: [] };
  const psp = orderStatusView(order, { lang: 'nl', provider: 'paynl' });
  ok('/order under Pay. says to pay from the order page, not to transfer', /bestelpagina/.test(psp.description) && !/referentie/.test(psp.description), psp.description);
  ok('…and drops the transfer reference', !psp.fields.some((f) => /Betalingsreferentie/.test(f.name)));
  const manual = orderStatusView(order, { lang: 'nl', provider: 'manual' });
  ok('/order for a manual shop still gives the reference', manual.fields.some((f) => /Betalingsreferentie/.test(f.name)));
  const paid = orderStatusView({ ...order, status: 'payment_received' }, { lang: 'nl' });
  ok('no "within a few hours" promise', !/paar uur/.test(paid.description), paid.description);
  ok('the bot passes the provider to /order', /orderStatusView\(await res\.json\(\), \{ money, lang, provider \}\)/.test(bot));
}

console.log('\n— VPS installer —');
{
  const sh = readFileSync(new URL('../deploy/install-vps.sh', import.meta.url), 'utf8');
  ok('an update never overwrites the live bot-meta.json or guild-map.json',
    /--exclude=bot-meta\.json/.test(sh) && /--exclude=guild-map\.json/.test(sh));
}

console.log(`\n${fail ? '❌' : '✅'} store-relay: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
