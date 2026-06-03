import type { NextFunction, Request, Response } from 'express';

/** Wrap an async route handler so thrown errors reach the error middleware. */
export const asyncHandler =
  <T extends Request = Request>(
    fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
  ) =>
  (req: T, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ ok: true, data });

export const created = (res: Response, data: unknown) => ok(res, data, 201);
