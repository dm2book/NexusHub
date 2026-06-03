import type { NextFunction, Request, Response } from 'express';
import { Role } from '@memeforge/shared';
import { forbidden, unauthorized } from '../lib/errors.js';

const RANK: Record<Role, number> = {
  [Role.VIEWER]: 0,
  [Role.ADMIN]: 1,
  [Role.OWNER]: 2,
};

/** Require the user to have at least the given role. */
export function requireRole(min: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (RANK[req.user.role] < RANK[min]) {
      return next(forbidden(`Requires ${min} role`));
    }
    next();
  };
}

/** Owner-only — used to gate ALL trading & automation mutations. */
export const requireOwner = requireRole(Role.OWNER);
