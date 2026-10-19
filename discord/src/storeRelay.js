/**
 * The bot's link to the store, as pure pieces that can be tested without a
 * Discord token.
 *
 * Every one of these exists because of a way the live bot failed silently: the
 * store reported it as "never seen", and nothing in the bot's own log said why.
 */

/* ── The API address ─────────────────────────────────────────────────────── */

/**
 * The store's origin, from an env value.
 *
 * Empty falls back; a bare domain gets https://; trailing slashes go. A value
 * ending in `/api` (`https://forgemarket.nl/api`) is trimmed to the origin:
 * every path the bot calls already starts with /api, so that value made it call
 * /api/api/discord/outbox — a 404 the relay swallowed, forever.
 */
export function apiBaseUrl(raw, fallback = '') {
  let u = String(raw || '').trim() || String(fallback || '');
  if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/\/+$/, '').replace(/\/api$/i, '');
}

/* ── Saying why a call failed ────────────────────────────────────────────── */

/**
 * One log line for a refused store call: the status, the URL, and the store's
 * own reason ("Ingest is not configured", "Bad signature", "Stale or invalid
 * timestamp"). Only the status was ever logged, which made a missing secret on
 * Vercel and a wrong secret on the bot look identical.
 */
export async function describeRelayFailure(res, url) {
  let reason = '';
  try {
    const body = await res.clone().json();
    reason = typeof body?.error === 'string' ? body.error : (body?.error?.message || body?.message || '');
  } catch { /* not JSON */ }
  const hint = res.status === 404
    ? 'check FORGEMARKET_API_URL — it must be the site origin, e.g. https://www.forgemarket.nl'
    : res.status === 403 || res.status === 401
      ? 'REVIEW_INGEST_SECRET must be set on Vercel AND here, with exactly the same value'
      : '';
  return `${res.status} from ${url}${reason ? ` — ${String(reason).slice(0, 160)}` : ''}${hint ? ` (${hint})` : ''}`;
}

/** Log each key once — a failing call that runs every minute logs its cause once. */
export function createOnceLogger(write = (m) => console.error(m)) {
  const seen = new Set();
  return (key, message) => { if (seen.has(key)) return false; seen.add(key); write(message); return true; };
}

/* ── Startup self-test ───────────────────────────────────────────────────── */

/**
 * Ask the store once at boot whether this bot may talk to it, and say so in
 * plain words: `store relay: ok`, or the exact reason it is not.
 */
export async function selfTestRelay({ enabled, signedPost, url }) {
  if (!enabled) return { ok: false, reason: 'REVIEW_INGEST_SECRET is not set on the bot — the store relay is off' };
  try {
    const res = await signedPost('/api/discord/state/get', { key: 'meta' });
    if (res.ok) return { ok: true, reason: 'store relay: ok' };
    return { ok: false, reason: `store relay: ${await describeRelayFailure(res, `${url}/api/discord/state/get`)}` };
  } catch (e) {
    return { ok: false, reason: `store relay: could not reach ${url} (${e.message})` };
  }
}

/* ── Durable state ───────────────────────────────────────────────────────── */

export const STATE_UNAVAILABLE = Symbol('state unavailable');

/**
 * The bot's durable state (XP, giveaways, META): the store first, the local
 * file as fallback.
 *
 * "The store could not be asked" is not "the store is empty", and a key the
 * store never answered for is never written back to it. One more case closed
 * here: the local file only counts as the fallback when it existed BEFORE this
 * process wrote to it. A fresh container that saved a few scores during an
 * outage used to read its own file back, mark the key loaded, and then push
 * that tiny map over every member's XP in the store.
 */
export function createStateStore({ enabled, signedPost, fs, url = '', log = console, waits = [0, 1_000, 3_000, 9_000],
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const loaded = new Set();
  const writtenByUs = new Set();
  const once = createOnceLogger((m) => log.error(m));
  const fileKey = (file) => (file ? String(file) : '');
  const readFile = (file) => {
    try { if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* ignore */ }
    return undefined;
  };

  async function get(key, file) {
    if (!enabled) {
      loaded.add(key);
      return readFile(file) ?? null;
    }
    for (const wait of waits) {
      if (wait) await sleep(wait);
      try {
        const res = await signedPost('/api/discord/state/get', { key });
        if (res.ok) {
          loaded.add(key);
          const { value } = await res.json();
          if (value !== null && value !== undefined) return value;
          break;                                   // answered: nothing stored
        }
        if (res.status === 404) {
          // A site without the state store — or a wrong URL. Say which, once.
          once('state-404', `[state] ${await describeRelayFailure(res, `${url}/api/discord/state/get`)} — using local files only`);
          loaded.add(key);
          break;
        }
        once(`state-get-${res.status}`, `[state] get ${key}: ${await describeRelayFailure(res, `${url}/api/discord/state/get`)}`);
      } catch (e) { log.error(`[state] get ${key} failed: ${e.message}`); }
    }
    if (!loaded.has(key)) {
      // A file from before this process started is real state; one we wrote is not.
      if (file && !writtenByUs.has(fileKey(file))) {
        const v = readFile(file);
        if (v !== undefined) { loaded.add(key); return v; }
      }
      return STATE_UNAVAILABLE;
    }
    // Nothing stored yet (or no store) — the file is how old state migrates.
    return (file && !writtenByUs.has(fileKey(file)) ? readFile(file) : undefined) ?? null;
  }

  async function set(key, value, file) {
    try { if (file) { fs.writeFileSync(file, JSON.stringify(value)); writtenByUs.add(fileKey(file)); } } catch { /* ignore */ }
    if (!enabled) return;
    if (!loaded.has(key)) { log.warn(`[state] not saving ${key}: it was never loaded`); return; }
    try {
      const res = await signedPost('/api/discord/state/set', { key, value: value ?? null });
      if (!res.ok && res.status !== 404) {
        once(`state-set-${res.status}`, `[state] set ${key}: ${await describeRelayFailure(res, `${url}/api/discord/state/set`)}`);
      }
    } catch (e) { log.error(`[state] set ${key} failed: ${e.message}`); }
  }

  return { get, set, isLoaded: (key) => loaded.has(key) };
}

/* ── META merge ──────────────────────────────────────────────────────────── */

/**
 * Stored META plus whatever this process recorded before the load landed.
 *
 * `{ ...stored, ...live }` was shallow: a giveaway that ended while offline
 * created `endedGiveaways = { one }` before the load finished and replaced the
 * stored 30-day history /reroll relies on; one suggestion vote replaced every
 * stored vote; one starboard hit replaced the starred list, so old messages
 * were starred again. Collections now merge per entry.
 */
export function mergeMeta(stored = {}, live = {}) {
  const out = { ...(stored || {}), ...(live || {}) };
  for (const k of ['endedGiveaways', 'suggestions']) {
    if (stored?.[k] || live?.[k]) out[k] = { ...(stored?.[k] || {}), ...(live?.[k] || {}) };
  }
  if (stored?.starred || live?.starred) {
    out.starred = [...new Set([...(stored?.starred || []), ...(live?.starred || [])])].slice(-500);
  }
  // Once announced, always announced — whichever side knows it.
  if (stored?.launchAnnounced && !live?.launchAnnounced) out.launchAnnounced = stored.launchAnnounced;
  return out;
}

/* ── Guild guard ─────────────────────────────────────────────────────────── */

/**
 * Leave this guild? Only when it is not ours AND ours is confirmed present.
 *
 * With a wrong DISCORD_GUILD_ID (a channel id, the application id) the bot used
 * to leave every guild on its first boot — including the real server, which
 * then had to re-invite it.
 */
export const shouldLeaveGuild = ({ guildId, homeId, homePresent }) =>
  !!homePresent && String(guildId) !== String(homeId);

/* ── Fast cached loader (Discord's 3-second reply window) ───────────────── */

/**
 * A value fetched over the network, without ever making an interaction wait
 * long: a cached value (even stale) answers at once and refreshes in the
 * background; with nothing cached, the first caller waits at most `firstWaitMs`
 * and gets `fallback` if the load is slower — the load still finishes and
 * fills the cache for the next caller.
 */
export function createCachedLoader({ load, ttlMs = 300_000, firstWaitMs = 1_500, fallback = null, now = () => Date.now() }) {
  let cache = { at: 0, has: false, value: fallback };
  let inflight = null;
  const refresh = () => {
    inflight ??= Promise.resolve().then(load)
      .then((v) => { cache = { at: now(), has: true, value: v }; return v; })
      .catch(() => { cache = { at: now(), has: cache.has, value: cache.value }; return cache.value; })
      .finally(() => { inflight = null; });
    return inflight;
  };
  return async function get() {
    if (cache.has) {
      if (now() - cache.at >= ttlMs) refresh();          // stale: answer now, refresh behind
      return cache.value;
    }
    const p = refresh();
    let timer;
    const timeout = new Promise((r) => { timer = setTimeout(() => r(fallback), firstWaitMs); });
    try { return await Promise.race([p, timeout]); } finally { clearTimeout(timer); }
  };
}
