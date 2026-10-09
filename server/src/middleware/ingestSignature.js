/**
 * HMAC signatures on the calls the Discord bot makes to the store (and on the
 * /vouch review ingest it posts to).
 *
 * Every signed request carries x-timestamp (milliseconds since the epoch,
 * within ±5 minutes of our clock) and x-signature, compared in constant time.
 * Two signature formats exist:
 *
 *   v2  `x-signature: v2=<hex>`, the HMAC-SHA256 of
 *       `v2.${ts}.${METHOD}.${path}.${sha256(canonicalJson(body))}`.
 *       One rule for every endpoint, checked here and nowhere else. It covers
 *       the method, the path and the WHOLE body, so no field a route acts on
 *       can be changed on the way, a signature made for one endpoint is
 *       worthless on another, and a field added later is covered the day it is
 *       added — nobody has to remember to extend a per-route string.
 *
 *   old `x-signature: <hex>`, the HMAC of `${ts}.${canonical(body)}`, where
 *       each route chose which fields went into `canonical`. Some routes act on
 *       fields their string leaves out (a backup's whole snapshot, a review's
 *       avatar and product), and no string names the endpoint it was made for.
 *       Still accepted, because the bot already running on its host sends
 *       these until it is redeployed, and that happens separately from this
 *       site. Every one seen stamps kv 'bot_legacy_signature_seen_at' (at most
 *       once a minute), and BOT_LEGACY_SIGNATURES=off refuses them.
 *
 * Either way a signature is good for ONE request. Inside the five minutes a
 * captured request could otherwise simply be sent again: putting the bot's
 * saved state back to how it was, re-attaching a payment link the owner had
 * just corrected, or filing copies of a backup until the two real ones were
 * rotated out. A used signature is kept in kv until its timestamp could no
 * longer pass the window check anyway, and a second use is refused.
 *
 * The old plain `x-ingest-secret` header is not accepted at all: it carried no
 * timestamp, so one captured request could be replayed forever.
 */
import { hmacSha256, safeEqual, v2SignedString } from '../utils/crypto.js';
import { forbidden } from '../utils/errors.js';
import { config } from '../config/env.js';
import { get, run, nowIso } from '../db/index.js';

const REPLAY_WINDOW_MS = 5 * 60_000;
const V2_PREFIX = 'v2=';

/** kv key prefix under which used signatures are remembered (value = expiry, ISO). */
export const SPENT_SIGNATURE_PREFIX = 'bot_sig_used:';
/** kv key stamped when an old-style signature is seen (value = ISO time, like discord_bot_seen_at). */
export const LEGACY_SEEN_KEY = 'bot_legacy_signature_seen_at';

/** Deterministic canonical string for a review payload (must match the sender). */
export function canonicalReview(b = {}) {
  const parts = [b.author, b.stars ?? 5, b.body, b.externalId || ''];
  // The author's Discord id is only appended when it is present, which keeps a
  // bot that predates it signing exactly what it signed before.
  //
  // It has to be inside the signature, not merely alongside it: this id decides
  // which account receives the reviewer role, so an unsigned one could be
  // swapped for somebody else's and hand them a badge. Appending it also means
  // adding a uid to a captured four-part payload makes the server compute five
  // parts and reject it.
  if (b.discordUid) parts.push(String(b.discordUid));
  return parts.join('\u0000');
}

/**
 * The path a v2 signature covers: the one the caller asked for (originalUrl,
 * before anything in this app rewrites req.url), without the query string.
 * No signed route reads a query, and the hosting platform's rewrite to the
 * function is free to add one of its own. A route that starts reading
 * req.query must take that value in the body instead, where it is signed.
 */
export const signedPath = (req) => String(req.originalUrl || req.url || '').split('?')[0];

/* Once a minute per warm instance is plenty to answer "is an old bot still
   out there?". The SQL repeats the rule, so several instances together still
   write the row at most once a minute. */
let legacyNotedAt = 0;
async function noteLegacySignature(req, accepted, now = Date.now()) {
  if (now - legacyNotedAt < 60_000) return;
  legacyNotedAt = now;
  console.warn(`[ingest] old-style bot signature on ${signedPath(req)} ${accepted ? 'accepted' : 'refused'}`
    + ' — redeploy the Discord bot, then set BOT_LEGACY_SIGNATURES=off.');
  const at = new Date(now).toISOString();
  await run(
    `INSERT INTO kv (key, value, updated_at) VALUES (@k, @v, @v)
     ON CONFLICT (key) DO UPDATE SET value = @v, updated_at = @v WHERE kv.updated_at < @cut`,
    { k: LEGACY_SEEN_KEY, v: at, cut: new Date(now - 60_000).toISOString() },
  ).catch(() => {}); // bookkeeping must never fail the request it describes
}

/**
 * Drop the record of used signatures whose timestamps have expired anyway.
 * Runs by itself at most every ten minutes per warm instance; exported so a
 * maintenance job (or a test) can ask for it directly.
 */
export async function forgetSpentSignatures(now = Date.now()) {
  const r = await run(
    'DELETE FROM kv WHERE starts_with(key, @p) AND value < @now',
    { p: SPENT_SIGNATURE_PREFIX, now: new Date(now).toISOString() });
  return r?.changes ?? 0;
}

let sweptAt = 0;
/**
 * Mark a signature as used: true the first time, false ever after. One
 * statement, so two copies of a request arriving together cannot both win.
 */
async function spendSignature(hex, tsNum) {
  const row = await get(
    `INSERT INTO kv (key, value, updated_at) VALUES (@k, @exp, @at)
     ON CONFLICT (key) DO NOTHING RETURNING key`,
    /* Kept until the timestamp alone would fail the window check, plus a
       minute for instances whose clocks disagree a little. */
    { k: SPENT_SIGNATURE_PREFIX + hex, exp: new Date(tsNum + REPLAY_WINDOW_MS + 60_000).toISOString(), at: nowIso() });
  if (Date.now() - sweptAt > 10 * 60_000) {
    sweptAt = Date.now();
    await forgetSpentSignatures().catch(() => {});
  }
  return !!row;
}

/**
 * `verifyIngest(canonical)(secret)` — `canonical` is the route's old-style
 * string, used only for signatures without the v2 prefix.
 */
export function verifyIngest(canonical) {
  return (secret) => async (req, _res, next) => {
    try {
      if (!secret) throw forbidden('Ingest is not configured');

      const sig = req.get('x-signature');
      const ts = req.get('x-timestamp');
      if (!sig || !ts) throw forbidden('Missing or invalid signature');
      const tsNum = Number(ts);
      if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > REPLAY_WINDOW_MS) {
        throw forbidden('Stale or invalid timestamp');
      }

      let hex;
      if (sig.startsWith(V2_PREFIX)) {
        hex = sig.slice(V2_PREFIX.length);
        const expected = hmacSha256(secret,
          v2SignedString({ ts, method: req.method, path: signedPath(req), body: req.body }));
        if (!safeEqual(hex, expected)) throw forbidden('Bad signature');
      } else {
        hex = sig;
        if (!safeEqual(hex, hmacSha256(secret, `${ts}.${canonical(req.body || {})}`))) {
          throw forbidden('Bad signature');
        }
        /* Stamped whether or not it is let through: after the switch is off,
           a stamp that keeps moving says an old bot is still running
           somewhere (a second host, a forgotten container) and failing. */
        const accepted = config.discord.legacyBotSignatures;
        await noteLegacySignature(req, accepted);
        if (!accepted) throw forbidden('This signature format is no longer accepted — update the bot');
      }

      // Only a signature that verified is remembered, so garbage cannot fill kv.
      if (!(await spendSignature(hex, tsNum))) throw forbidden('This signed request was already used');
    } catch (err) {
      return next(err);
    }
    return next();
  };
}
