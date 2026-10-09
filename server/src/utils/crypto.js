import crypto from 'node:crypto';

export const sha256 = (value) =>
  crypto.createHash('sha256').update(String(value)).digest('hex');

/** Constant-time compare of two hex digests. */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

/** HMAC-SHA256 hex digest of `message` with `secret`. */
export const hmacSha256 = (secret, message) =>
  crypto.createHmac('sha256', String(secret)).update(String(message)).digest('hex');

/**
 * JSON with every object's keys in sorted order.
 *
 * Two programs holding the same data do not write the same JSON:
 * JSON.stringify keeps keys in the order they were added. A signature over
 * "the body" therefore needs one agreed spelling of it, and sorting the keys
 * removes the only freedom JSON leaves. For plain data — which is what a
 * parsed request body is — everything else is JSON.stringify's own output
 * (undefined drops out of objects and is null in arrays, NaN is null), so
 * whatever survives the trip over the wire spells the same on both ends.
 *
 * The Discord bot carries its own copy (canonicalJson in discord/src/bot.js),
 * because it is deployed without this folder; the two are tested against each
 * other in discord/test/signing.test.mjs.
 */
export function canonicalJson(value) {
  if (value !== null && typeof value === 'object' && typeof value.toJSON === 'function') {
    return canonicalJson(value.toJSON());
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined && typeof value[k] !== 'function' && typeof value[k] !== 'symbol')
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

/**
 * The text a v2 request signature is computed over.
 *
 * Timestamp, method, path and a hash of the whole body: every input a route
 * can act on, in one fixed shape for every endpoint. See
 * middleware/ingestSignature.js for why it replaced the per-route strings.
 */
export const v2SignedString = ({ ts, method, path, body }) =>
  `v2.${ts}.${String(method || '').toUpperCase()}.${path}.${sha256(canonicalJson(body ?? {}))}`;
