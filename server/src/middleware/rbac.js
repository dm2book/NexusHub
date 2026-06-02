/**
 * Role-based access control middleware. Permissions are resolved from the
 * user's roles (see seed.js). `owner` implicitly holds every permission.
 */
import { forbidden, unauthorized } from '../utils/errors.js';

export function requirePermission(...permissions) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    const held = new Set(req.user.permissions || []);
    const isOwner = (req.user.roles || []).includes('owner');
    const ok = isOwner || permissions.every((p) => held.has(p));
    if (!ok) return next(forbidden(`Requires permission: ${permissions.join(', ')}`));
    next();
  };
}

/** Require any one of several roles. */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    const has = (req.user.roles || []).some((r) => roles.includes(r));
    if (!has) return next(forbidden(`Requires role: ${roles.join(', ')}`));
    next();
  };
}

/** Convenience: any staff role (anything other than a plain customer). */
export function requireStaff(req, _res, next) {
  if (!req.user) return next(unauthorized());
  const isStaff = (req.user.roles || []).some((r) => r !== 'customer');
  if (!isStaff) return next(forbidden('Staff access required'));
  next();
}
