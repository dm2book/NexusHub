/**
 * The v2 request signature the bot puts on every call to the store.
 *
 * Its own module, without the Discord client, so the tests can run these exact
 * functions against the store's verifier (server/src/middleware/ingestSignature.js
 * and canonicalJson in server/src/utils/crypto.js): discord/test/signing.test.mjs
 * and server/test/bot-signature.test.mjs.
 */
import { createHash, createHmac } from 'node:crypto';

/** JSON with every object's keys sorted. Only ever given parsed JSON. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

/** The x-signature header for one request; `raw` is the exact body text sent. */
export function signRequestV2(secret, ts, method, path, raw) {
  // Hashed from the text that goes on the wire, read back the way the store
  // reads it, so nothing JSON.stringify drops or rewrites can make the ends differ.
  const bodyHash = createHash('sha256').update(canonicalJson(JSON.parse(raw))).digest('hex');
  return `v2=${createHmac('sha256', secret).update(`v2.${ts}.${method}.${path}.${bodyHash}`).digest('hex')}`;
}
