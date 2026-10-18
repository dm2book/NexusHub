/**
 * Role-based access control middleware. Permissions are resolved from the
 * user's roles (see seed.js). `owner` implicitly holds every permission.
 */
import { forbidden, unauthorized, ApiError } from '../utils/errors.js';
import { config } from '../config/env.js';

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

/** The same rule as requirePermission, as a question (for checks that depend on the request). */
export function holdsPermission(user, permission) {
  if (!user) return false;
  if ((user.roles || []).includes('owner')) return true;
  return (user.permissions || []).includes(permission);
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
  /* The owner is exempt so the shop can never be locked out of its own admin;
     the launch check keeps nagging the owner instead. */
  const isOwner = (req.user.roles || []).includes('owner');
  if (config.security.requireStaff2fa && !isOwner && !req.user.totpEnabled) {
    return next(new ApiError(403, 'Zet eerst tweestapsverificatie (authenticator-app) aan onder Account → Instellingen — staff zonder 2FA kan niet in de admin.', 'totp_required'));
  }
  next();
}

/**
 * Staff may not move money or goods on their OWN orders.
 *
 * The admin role can mark an order paid and refund it as store credit. On an
 * order placed from their own account that made unlimited credit (mark the
 * unpaid order paid, refund it to the wallet) — around the ban on granting
 * yourself credit and the €100 staff cap — and free codes (mark paid, let it
 * deliver). The owner is exempt: it is their money. Matched on the account and
 * on the order's e-mail, so a guest checkout with the staff address counts too.
 */
export function assertNotOwnOrder(user, order) {
  if (!user || !order) return;
  if ((user.roles || []).includes('owner')) return;
  const mine = (order.userId && order.userId === user.id)
    || (order.email && user.email && String(order.email).toLowerCase() === String(user.email).toLowerCase());
  if (mine) throw forbidden('You cannot process your own order — ask the owner or another staff member.');
}

