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
    if (claims.sid && !(await isSessionActive(claims.sid))) return next();
    req.auth = claims;
    req.user = await publicUser(claims.sub);
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
