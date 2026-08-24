/**
 * Hosting the bot, rather than the bot itself.
 *
 * Three things this found by running the production command instead of reading
 * it:
 *
 *   A missing REVIEW_INGEST_SECRET switched off the entire store relay — order
 *   pings, drops, delivery DMs, durable state — and said nothing. From outside,
 *   a shop that has sold nothing today and a bot that is not listening look
 *   identical.
 *
 *   client.login() with a well-formed but invalid token neither resolved nor
 *   rejected: the handshake never completed, so the process sat there with no
 *   error, no exit and nothing after "connecting to Discord…". A supervisor
 *   sees a running process.
 *
 *   And a bot holds a websocket, not a port, so nothing could tell "connected
 *   and working" from "alive, gateway dead" — the second looks perfectly
 *   healthy to anything that only checks whether the process exists.
 */
import { EventEmitter } from 'node:events';
import { checkEnv, ENV_SPEC, startHealthServer, loginWithRetry, log } from '../src/runtime.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n} ${x}`); } };

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, '..', ...p), 'utf8');
const bot = read('src', 'bot.js');
const envExample = read('.env.example');
const pkg = JSON.parse(read('package.json'));

console.log('— The environment is checked before anything connects —');
{
  ok('nothing configured is not ok', checkEnv({}).ok === false);
  ok('…and names the token', checkEnv({}).missing.some(([k]) => k === 'DISCORD_TOKEN'));
  ok('a token alone is enough to start', checkEnv({ DISCORD_TOKEN: 't' }).ok === true);
  ok('…but the gaps are still reported',
    checkEnv({ DISCORD_TOKEN: 't' }).degraded.length > 0);
  ok('an empty string counts as missing', checkEnv({ DISCORD_TOKEN: '   ' }).ok === false);

  /* The one that mattered: without it the relay is silent and nothing says so. */
  const relay = ENV_SPEC.recommended.find(([k]) => k === 'REVIEW_INGEST_SECRET');
  ok('the relay secret is called out as load-bearing', !!relay);
  ok('…and its description says what stops working', /relay stays silent/.test(relay[1]));

  ok('every recommended variable explains its consequence',
    ENV_SPEC.recommended.every(([, why]) => why.length > 30));
  ok('the bot refuses to start when the check fails',
    /if \(!reportEnv\(\)\) process\.exit\(1\)/.test(bot));
}

console.log('\n— .env.example is generated from that same list —');
{
  const all = [...ENV_SPEC.required, ...ENV_SPEC.recommended, ...ENV_SPEC.optional].map(([k]) => k);
  const documented = [...envExample.matchAll(/^([A-Z_][A-Z_0-9]*)=/gm)].map((m) => m[1]);
  ok('every variable the code knows about is documented',
    all.every((k) => documented.includes(k)),
    all.filter((k) => !documented.includes(k)).join(', '));
  ok('and nothing is documented that the code does not know about',
    documented.every((k) => all.includes(k)),
    documented.filter((k) => !all.includes(k)).join(', '));
  ok('it says it is generated', /GENERATED from ENV_SPEC/.test(envExample));
  ok('…and how to regenerate it', !!pkg.scripts['env:example']);
  ok('no value is filled in', [...envExample.matchAll(/^[A-Z_][A-Z_0-9]*=(.+)$/gm)].length === 0,
    'a secret may have been committed');

  /* Every variable the source actually reads must be in the spec, or the
     documentation is a list of what someone remembered. */
  const src = ['bot.js', 'setup.js', 'register-commands.js', 'invite.js', 'config.js', 'panels.js']
    .map((f) => read('src', f)).join('\n');
  const used = new Set([
    ...[...src.matchAll(/process\.env\.([A-Z_][A-Z_0-9]*)/g)].map((m) => m[1]),
    ...[...src.matchAll(/\{([^}]*)\}\s*=\s*process\.env/g)]
      .flatMap((m) => [...m[1].matchAll(/([A-Z_][A-Z_0-9]*)/g)].map((x) => x[1])),
  ]);
  const undocumented = [...used].filter((k) => !all.includes(k));
  ok('every variable the source reads is in the spec', undocumented.length === 0,
    undocumented.join(', '));
}

console.log('\n— The production start command —');
{
  ok('npm start runs the bot', pkg.scripts.start === 'node src/bot.js');
  ok('the Procfile agrees', /worker: npm start/.test(read('Procfile')));
  ok('railway.json agrees', JSON.parse(read('railway.json')).deploy.startCommand === 'npm start');
  ok('the Dockerfile agrees', /CMD \["npm", "start"\]/.test(read('Dockerfile')));
  ok('Railway restarts a crash', /ON_FAILURE/.test(read('railway.json')));
}

console.log('\n— Health: a websocket has no port, so give it one —');
{
  const fake = (ready, ping = 42) => ({
    isReady: () => ready,
    ws: { ping },
    guilds: { cache: { size: ready ? 1 : 0 } },
    user: ready ? { tag: 'Bot#0001' } : null,
  });

  const get = async (port, path = '/health') => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const down = startHealthServer(fake(false), { port: 8091 });
  await new Promise((r) => down.once('listening', r));
  const a = await get(8091);
  ok('a disconnected bot answers 503', a.status === 503, `${a.status}`);
  ok('…and says so', a.body.ok === false && a.body.status === 'connecting', JSON.stringify(a.body));
  ok('…with no invented ping', a.body.gateway.ping === 42 || a.body.gateway.ping === null);
  const nf = await get(8091, '/anything');
  ok('anything else is a 404', nf.status === 404, `${nf.status}`);
  down.close();

  const up = startHealthServer(fake(true), { port: 8092 });
  await new Promise((r) => up.once('listening', r));
  const b = await get(8092);
  ok('a connected bot answers 200', b.status === 200, `${b.status}`);
  ok('…and reports the gateway', b.body.gateway.ping === 42 && b.body.gateway.guilds === 1,
    JSON.stringify(b.body.gateway));
  ok('…and which bot it is', b.body.bot === 'Bot#0001');
  ok('…and how long it has been up', typeof b.body.uptimeSeconds === 'number');
  up.close();

  ok('no PORT means no server, not a crash', startHealthServer(fake(true), { port: '' }) === null);
  ok('the bot starts one', /startHealthServer\(client\)/.test(bot));
  ok('…and closes it on the way out', /healthServer\.close/.test(bot));
}

console.log('\n— Login: retry what a retry can fix, and nothing else —');
{
  let tries = 0;
  const flaky = { login: async () => { tries += 1; if (tries < 3) throw new Error('getaddrinfo ENOTFOUND'); } };
  const okd = await loginWithRetry(flaky, 't', { attempts: 5, baseMs: 1, onFatal: () => false });
  ok('a transient failure is retried until it works', okd === true && tries === 3, `tries=${tries}`);

  let fatalCalls = 0;
  const bad = { login: async () => { throw new Error('An invalid token was provided'); } };
  await loginWithRetry(bad, 't', { attempts: 5, baseMs: 1, onFatal: () => { fatalCalls += 1; return false; } });
  ok('an invalid token is not retried', fatalCalls === 1, `${fatalCalls}`);

  let intentCalls = 0;
  const noIntents = { login: async () => { throw new Error('Used disallowed intents'); } };
  await loginWithRetry(noIntents, 't', { attempts: 5, baseMs: 1, onFatal: () => { intentCalls += 1; return false; } });
  ok('missing intents are not retried either', intentCalls === 1);

  /* The hang. A login that never settles used to stop the process dead. */
  const hangs = { login: () => new Promise(() => {}) };
  const started = Date.now();
  const res = await loginWithRetry(hangs, 't', { attempts: 2, baseMs: 1, timeoutMs: 120, onFatal: () => 'gave-up' });
  ok('a login that never answers gives up instead of hanging', res === 'gave-up',
    String(res));
  ok('…promptly', Date.now() - started < 3000, `${Date.now() - started}ms`);
}

console.log('\n— Logs a machine can read —');
{
  ok('there is one logger', /export const log = \{/.test(read('src', 'runtime.js')));
  ok('json is the default off a terminal', /process\.stdout\.isTTY/.test(read('src', 'runtime.js')));
  ok('one line per event, even for an error',
    /JSON\.stringify\(\{ lvl, msg, at:/.test(read('src', 'runtime.js')));
  ok('the level is filterable', /LOG_LEVEL/.test(read('src', 'runtime.js')));
  ok('the bot uses it for startup', /log\.info\('connecting to Discord/.test(bot));
  ok('…and for shutdown', /log\.info\('shutdown signal received'/.test(bot));
}

console.log('\n— A gateway that will not come back is handed to the platform —');
{
  ok('terminal close codes are recognised', /4004, 4010, 4011, 4012, 4013, 4014/.test(bot));
  ok('…and exit rather than idle forever', /gateway closed permanently/.test(bot));
  ok('an ordinary disconnect just reconnects', /ShardReconnecting/.test(bot));
  ok('…and a resume is logged', /ShardResume/.test(bot));
}

console.log('\n— No local filesystem state is depended on —');
{
  /* The store is authoritative; the file is a convenience for a bot pointed at
     no site. A container that throws its disk away on every deploy must lose
     nothing that matters. */
  ok('state is read from the store first', /async function stateGet\([\s\S]{0,600}api\/discord\/state\/get/.test(bot));
  ok('…and only then from a file', /stateGet[\s\S]{0,1400}existsSync\(file\)/.test(bot));
  ok('writes go to the store as well as the file', /async function stateSet\([\s\S]{0,700}api\/discord\/state\/set/.test(bot));
  ok('nothing else writes to disk',
    [...bot.matchAll(/writeFileSync\(/g)].length <= 2,
    `${[...bot.matchAll(/writeFileSync\(/g)].length} write sites`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
