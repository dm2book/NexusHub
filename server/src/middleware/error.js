import { ApiError } from '../utils/errors.js';
import { ZodError } from 'zod';
import { alertOwner } from '../services/notifyService.js';

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

  /* A 500 goes to the owner through the same path as everything else.

     This used to call postErrorAlert, which posted to a Discord webhook and
     nowhere else, throttled by an in-memory Map. Two problems with that on a
     serverless platform: an owner running Telegram or Pushover never saw a
     single system error, and the throttle is per-instance — under the load that
     actually causes 500s there are many instances, so the throttle multiplies
     by however many happened to be warm.

     alertOwner reaches every configured channel, keeps the record, and does its
     rate limiting in the database where the count is shared. The key is the
     route plus the minute: a burst on one endpoint is one page, and the storm
     rules fold the rest of an outage into a single summary. */
  const route = `${req.method} ${req.path}`;
  alertOwner('system.error', {
    title: `500 on ${route}`,
    lines: [
      `Error: ${String(err?.message || 'unknown').slice(0, 200)}`,
      'The stack trace is in the function logs.',
    ],
    key: `${route}:${new Date().toISOString().slice(0, 16)}`,
  }).catch(() => {});

  res.status(500).json({ error: { message: 'Internal server error' } });
}
