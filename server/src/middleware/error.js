import { ApiError } from '../utils/errors.js';
import { ZodError } from 'zod';
import { postErrorAlert } from '../services/discordService.js';

/** Wrap an async route handler so thrown/rejected errors hit the error handler. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: { message: 'Route not found' } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { message: 'Validation failed', code: 'validation_error',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
    });
  }
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { message: err.message, code: err.code } });
  }
  console.error('[unhandled]', err);
  // Page staff in Discord — a real 500 should never go unnoticed (throttled).
  postErrorAlert(`${req.method} ${req.path}`, err?.message).catch(() => {});
  res.status(500).json({ error: { message: 'Internal server error' } });
}
