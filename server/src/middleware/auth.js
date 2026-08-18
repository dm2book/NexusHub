/**
 * Authentication middleware. Reads a bearer token (Authorization header) or the
 * session cookie, verifies the access JWT, confirms the backing session is
 * still active, and attaches `req.user` + `req.auth`.
 */
import { config } from '../config/env.js';
import { verifyAccess, isSessionActive } from '../services/authService.js';
import { publicUser } from '../services/userService.js';
import { unauthorized } from '../utils/errors.js';

function extractToken(req) {
  const header = req.get('authorization');
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  return req.cookies?.[config.auth.cookieName] || null;
}

/** Populate req.user if a valid token is present; never throws. */
export async function attachUser(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const claims = verifyAccess(token);
    /* Both lookups depend only on `claims`, which verifyAccess returns
       synchronously — so waiting for the session check before starting the user
       load added a round trip to every signed-in request for no reason. The
       trade is that a token whose session was just revoked still loads a user we
       then throw away: one wasted read on a rare path, against a saved round
       trip on the common one. */
    const [sessionOk, user] = await Promise.all([
      claims.sid ? isSessionActive(claims.sid) : true,
      publicUser(claims.sub),
    ]);
    if (!sessionOk) return next();
    req.auth = claims;
    req.user = user;
  } catch {
    /* invalid/expired token → treat as anonymous */
  }
  next();
}

/** Require an authenticated user. */
export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}
