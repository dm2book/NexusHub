import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      ok: false,
      error: { code: err.code, message: err.message, details: err.details },
    });
  }
  logger.error({ err }, 'Unhandled error');
  const message = err instanceof Error ? err.message : 'Internal server error';
  res.status(500).json({ ok: false, error: { code: 'INTERNAL', message } });
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
}
