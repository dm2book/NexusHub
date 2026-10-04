/**
 * The parts of running this bot that are about hosting it, not about Discord.
 *
 * Kept out of bot.js because none of it is bot logic and all of it is what a
 * platform needs: a log line a machine can read, an answer to "is it actually
 * connected?", and a refusal to start half-configured rather than a mystery two
 * hours later.
 */
import http from 'node:http';

/* ── Structured logs ──────────────────────────────────────────────────────
 *
 * Railway ingests stdout and lets you search it. `✅ Bot online — AI: on` is
 * readable by a person standing in front of it and useless to everything else:
 * you cannot filter it by level, alert on it, or tell an error from a decorated
 * success. The API already emits {"lvl":"info",…}; this matches it so both
 * halves of the system search the same way.
 *
 * Pretty output is kept for a TTY, because a developer running `npm start` is
 * not grepping — they are reading.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[String(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;
const pretty = process.env.LOG_FORMAT
  ? process.env.LOG_FORMAT === 'pretty'
  : process.stdout.isTTY;

function emit(lvl, msg, fields = {}) {
  if (LEVELS[lvl] < threshold) return;
  if (pretty) {
    const tag = { debug: '·', info: 'ℹ', warn: '⚠', error: '✖' }[lvl];
    const extra = Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : '';
    (lvl === 'error' ? console.error : console.log)(`${tag} ${msg}${extra}`);
    return;
  }
  // One line, one JSON object — anything else breaks log ingestion on a
  // multi-line stack trace.
  const line = JSON.stringify({ lvl, msg, at: new Date().toISOString(), ...fields });
  (lvl === 'error' ? console.error : console.log)(line);
}

export const log = {
  debug: (msg, f) => emit('debug', msg, f),
  info: (msg, f) => emit('info', msg, f),
  warn: (msg, f) => emit('warn', msg, f),
  error: (msg, f) => emit('error', msg, f),
};

/* ── Environment ──────────────────────────────────────────────────────────
 *
 * Split into what the bot cannot run without and what it merely needs to be
 * useful. A missing token is fatal and always was; a missing REVIEW_INGEST_SECRET
 * silently turned off the entire store relay — order pings, drops, delivery DMs
 * — and the only symptom was a quiet server, which reads as "nothing sold
 * today" rather than "the bot is not listening".
 */
export const ENV_SPEC = {
  required: [
    ['DISCORD_TOKEN', 'Bot token — Developer Portal → your app → Bot → Reset Token.'],
    /* Required, not recommended: without it the bot acted in every guild it was
       added to — posting store announcements, granting roles and pinging staff
       in any server that invited it. It now serves this one guild and leaves
       any other on sight. */
    ['DISCORD_GUILD_ID', 'Your server id (right-click the server → Copy Server ID). The bot only works in this '
      + 'guild and leaves any other one it is added to.'],
  ],
  recommended: [
    ['DISCORD_CLIENT_ID', 'Application ID. Needed by `npm run invite` and command registration. '
      + 'DISCORD_APPLICATION_ID is accepted as an alias.'],
    ['DISCORD_OWNER_IDS', 'Comma-separated Discord user ids allowed to run owner commands (/paylink, /digest, '
      + '/stock, /launch, /coupon, /announce). Without it only members with Manage Server can.'],
    ['STORE_URL', 'Your storefront, e.g. https://forgemarket.nl. Every link the bot posts starts here.'],
    ['FORGEMARKET_API_URL', 'Usually the same as STORE_URL. Without it /price, /order and the relay are off.'],
    ['REVIEW_INGEST_SECRET', 'Must match the value in Vercel exactly, or the store relay stays silent: '
      + 'no order pings, no drops, no delivery DMs, and no durable state.'],
  ],
  optional: [
    ['ANTHROPIC_API_KEY', 'AI answers in #ask-the-bot. Without it a rule-based FAQ answers instead.'],
    ['AI_MODEL', 'Defaults to claude-sonnet-4-6.'],
    ['DISCORD_INVITE_URL', 'Invite shown by /invite until the bot has made its own permanent one. '
      + 'No default: unset, /invite says the link is not ready yet.'],
    ['DISCORD_PAYLINK_SECRET', 'Separate shared secret for /paylink (must match the API\u2019s DISCORD_PAYLINK_SECRET). '
      + 'Unset = /paylink is disabled.'],
    ['PAYLINK_HOSTS', 'Optional comma-separated extra check for /paylink hosts (e.g. tikkie.me,bunq.me). '
      + 'The API always enforces its own payment-host allow-list.'],
    ['LAUNCH_DATE', 'When the one-off launch announcement may post (ISO time). Default 2026-10-23T22:00:00Z '
      + '(24 Oct 00:00 Amsterdam). Posted once, never before this moment.'],
    ['AI_DAILY_CAP', 'Maximum AI answers per day across the server (/ask, /recommend, #ask-the-bot). Default 300.'],
    ['SUPPORT_HOURS', 'Support availability text shown in #support-info. Default: '
      + '"Elke dag, reactie meestal binnen 24 uur (NL tijd)".'],
    ['TRUSTPILOT_URL', 'Usually leave blank: the bot reads the profile from the website\u2019s /api/config, so setting it there is enough. Set it here only to override that.'],
    ['TRUSTPILOT_REVIEW_URL', 'Derived from TRUSTPILOT_URL when blank.'],
    ['PORT', 'Health endpoint port. Railway sets this for you; leave it unset on PebbleHost.'],
    ['LOG_LEVEL', 'debug | info | warn | error. Default info.'],
    ['LOG_FORMAT', 'json | pretty. Default: pretty on a terminal, json otherwise.'],
    ['REPOST', 'One-off, for `npm run setup` only: re-post every panel. Never set on the host.'],
    ['PRUNE', 'One-off, for `npm run setup` only: PRUNE=off reports strays instead of removing them.'],
    ['DISCORD_APPLICATION_ID', 'Alias for DISCORD_CLIENT_ID. Set either one, not both.'],
  ],
};

/**
 * Check the environment and say what is missing, before connecting.
 *
 * Returns the problems rather than exiting, so a caller can decide — the tests
 * need to inspect this without taking the process down with them.
 */
export function checkEnv(env = process.env) {
  const missing = ENV_SPEC.required.filter(([k]) => !String(env[k] || '').trim());
  const degraded = ENV_SPEC.recommended.filter(([k]) => !String(env[k] || '').trim());
  return { ok: missing.length === 0, missing, degraded };
}

/** Print the verdict. Returns false when the bot must not start. */
export function reportEnv(env = process.env) {
  const { ok, missing, degraded } = checkEnv(env);
  for (const [key, why] of missing) log.error(`missing required env: ${key}`, { key, why });
  for (const [key, why] of degraded) log.warn(`running without ${key}`, { key, why });
  if (!ok) {
    log.error('refusing to start', {
      hint: 'See discord/.env.example for every variable and what it does.',
    });
  }
  return ok;
}

/* ── Health ───────────────────────────────────────────────────────────────
 *
 * A Discord bot holds a websocket, not a port, so a platform has no way to tell
 * "connected and working" from "process alive, gateway dead" — and the second
 * one looks perfectly healthy to a process supervisor while the server sits
 * silent. This is the smallest honest answer to that question.
 *
 * `ready` is the gateway's own view (client.isReady + a live websocket ping),
 * not a flag we set once and forgot.
 */
export function startHealthServer(client, { port = process.env.PORT } = {}) {
  if (!port) {
    log.info('no PORT set — health endpoint disabled (fine for a local run)');
    return null;
  }
  const startedAt = Date.now();
  const server = http.createServer((req, res) => {
    const ready = !!client?.isReady?.();
    /* No heartbeat yet is `null`, said on purpose. discord.js reports NaN (or
       -1, by version) before the first one completes, and Math.round(NaN)
       serialises to null anyway — which looked deliberate but was an accident,
       and would have started reporting a number the day the library changed. */
    const raw = client?.ws?.ping;
    const ping = Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : null;
    const body = {
      ok: ready,
      status: ready ? 'connected' : 'connecting',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      gateway: { ping, guilds: client?.guilds?.cache?.size ?? 0 },
      bot: client?.user?.tag || null,
      at: new Date().toISOString(),
    };
    /* 503 while disconnected is the point: a platform that restarts on a failing
       health check will recover a bot whose gateway died in a way discord.js
       could not reconnect from, which is the exact failure this endpoint is for.
       Anything other than /health is a 404 rather than a cheerful 200. */
    const path = (req.url || '/').split('?')[0];
    if (path !== '/health' && path !== '/') {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end('{"error":"not found"}');
    }
    res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(body));
  });
  server.listen(port, () => log.info('health endpoint listening', { port: Number(port) }));
  server.on('error', (e) => log.error('health endpoint failed', { err: e.message }));
  return server;
}

/**
 * Log in, and keep trying.
 *
 * A bad token or missing intents is permanent — retrying that forever burns
 * rate limit and hides the real problem, so those still exit and let the
 * platform show a crashed deploy. Everything else (Discord down, DNS blip,
 * network on the way up) is temporary, and exiting on it turns a thirty-second
 * outage into a restart loop that the platform eventually gives up on.
 */
export async function loginWithRetry(client, token, {
  attempts = 6, baseMs = 2000, timeoutMs = 30_000, onFatal = () => process.exit(1),
} = {}) {
  for (let n = 1; n <= attempts; n++) {
    try {
      /* A deadline on the login itself.
         Measured: with a well-formed but invalid token, client.login() neither
         resolves nor rejects — the gateway handshake simply never completes, so
         the process sat there indefinitely with no error, no exit, and nothing
         in the logs after "connecting to Discord…". A supervisor sees a running
         process; only the health endpoint would have known. Racing the attempt
         turns a hang into an ordinary retryable failure. */
      await Promise.race([
        client.login(token),
        new Promise((_, reject) => setTimeout(
          () => reject(new Error(`login did not complete within ${timeoutMs}ms`)), timeoutMs)),
      ]);
      return true;
    } catch (err) {
      const msg = String(err?.message || err);
      const fatal = /disallowed intents/i.test(msg) || /token/i.test(msg);
      if (fatal) {
        if (/disallowed intents/i.test(msg)) {
          log.error('login failed: privileged intents are off', {
            fix: 'Developer Portal → your app → Bot → enable SERVER MEMBERS and MESSAGE CONTENT.',
          });
        } else {
          log.error('login failed: the token is invalid', {
            fix: 'Developer Portal → Bot → Reset Token, then update the host’s variables.',
          });
        }
        return onFatal(err);
      }
      if (n === attempts) {
        log.error('login failed after every attempt', { attempts, err: msg });
        return onFatal(err);
      }
      const wait = Math.min(baseMs * 2 ** (n - 1), 60_000);
      log.warn('login failed — retrying', { attempt: n, of: attempts, inMs: wait, err: msg });
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  return false;
}

/**
 * Exit when the gateway has been gone for too long.
 *
 * discord.js reconnects by itself for almost everything, but there are states
 * — a resume loop, a session the library gave up on without a terminal close
 * code — where the process stays alive and connected to nothing. A supervisor
 * that only checks "is the process running" sees a healthy bot. Railway uses
 * the health check at deploy time only, so this is what actually turns a
 * silent dead bot into a restart: exit 1 and let the restart policy do its job.
 */
export function startWatchdog(client, {
  maxDownMs = 5 * 60_000, everyMs = 30_000, now = () => Date.now(),
  onDead = () => process.exit(1),
} = {}) {
  let downSince = null;
  const tick = () => {
    if (client?.isReady?.()) { downSince = null; return false; }
    downSince ??= now();
    if (now() - downSince > maxDownMs) {
      log.error('gateway not ready for too long — exiting so the host restarts us',
        { downForSeconds: Math.round((now() - downSince) / 1000) });
      onDead();
      return true;
    }
    return false;
  };
  const timer = setInterval(tick, everyMs);
  timer.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}
