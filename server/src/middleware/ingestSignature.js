/**
 * HMAC signature verification for server-to-server ingest endpoints (e.g. the
 * Discord bot posting /vouch reviews). Defends against forged payloads and
 * replay attacks:
 *   - x-timestamp + x-signature headers,
 *   - signature = HMAC-SHA256(secret, `${timestamp}.${canonical(body)}`),
 *   - timestamp must be within ±5 minutes (replay window),
 *   - constant-time comparison.
 *
 * A legacy `x-ingest-secret` shared-secret header is still accepted so a not-yet-
 * updated bot keeps working during rollout; prefer the signed path.
 */
import { hmacSha256, safeEqual } from '../utils/crypto.js';
import { forbidden } from '../utils/errors.js';

const REPLAY_WINDOW_MS = 5 * 60_000;

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

export function verifyIngest(canonical) {
  return (secret) => (req, _res, next) => {
    if (!secret) return next(forbidden('Ingest is not configured'));

    const sig = req.get('x-signature');
    const ts = req.get('x-timestamp');
    if (sig && ts) {
      const tsNum = Number(ts);
      if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > REPLAY_WINDOW_MS) {
        return next(forbidden('Stale or invalid timestamp'));
      }
      const expected = hmacSha256(secret, `${ts}.${canonical(req.body || {})}`);
      if (!safeEqual(sig, expected)) return next(forbidden('Bad signature'));
      return next();
    }

    // Legacy shared-secret fallback.
    const hdr = req.get('x-ingest-secret');
    if (hdr && safeEqual(hdr, secret)) return next();
    return next(forbidden('Missing or invalid signature'));
  };
}
