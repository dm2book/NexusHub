/**
 * Vercel serverless entrypoint for the ForgeMarket API.
 *
 * `vercel.json` rewrites every /api/* request to this function. We build the
 * Express app once per warm instance with lazy migrations enabled, so the schema
 * is ensured on cold start without a separate deploy step.
 *
 * A bracket-free filename (api/index.js) is used deliberately — catch-all names
 * like api/[...path].js can be mangled by some Git hosts / upload tools.
 *
 * The backend's dependencies live in the ROOT package.json so a single
 * `npm install` covers both the SPA build and this function.
 */
import { createApp } from '../server/src/app.js';
import { assertProductionConfig } from '../server/src/config/env.js';

/**
 * Refuse to SERVE on a broken configuration — but do not refuse to exist.
 *
 * This used to call assertProductionConfig() bare at module scope. When it threw,
 * Vercel had nothing to invoke and answered every request with its own generic
 * page: "This Serverless Function has crashed / FUNCTION_INVOCATION_FAILED".
 * That page cannot say which setting is wrong, so the one piece of information
 * the owner needs was reachable only by digging through the runtime logs — while
 * the shop looked, from the outside, like it had simply broken.
 *
 * Catching it is not a softening. Every request still fails, so a dev JWT secret
 * still authenticates nobody. What changes is that the failure explains itself:
 * the reason is logged once, loudly, at the top of the function's log, and the
 * response says a configuration problem rather than implying a code crash.
 *
 * The reason names environment variables, so it goes to the log the owner reads
 * and never to the response body.
 */
let bootError = null;
let app = null;
try {
  assertProductionConfig();
  // Building the app is inside the same guard on purpose. A bad setting is only
  // the most LIKELY reason this function fails to come up — a module that throws
  // on import fails identically from the outside, and produces the same
  // uninformative crash page. Whatever the cause, it should be readable.
  app = createApp({ lazyReady: true });
} catch (err) {
  bootError = err;
  console.error(
    '\n════════════════════════════════════════════════════════════\n'
    + '  ForgeMarket is NOT serving. The API failed to start.\n'
    + `  ${err.message}\n`
    + '  If this names an environment variable, set it in Vercel →\n'
    + '  Settings → Environment Variables (make sure Production is\n'
    + '  ticked, not only Preview) and redeploy.\n'
    + '════════════════════════════════════════════════════════════\n',
    err.stack,
  );
}

export default function handler(req, res) {
  if (bootError) {
    // Repeated every invocation on purpose: a cold start that logs once is easy
    // to miss, and this is the line that tells the owner what to fix.
    console.error('[boot] refusing request —', bootError.message);
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    return res.end(JSON.stringify({
      error: {
        message: 'This shop is temporarily unavailable while a setting is corrected.',
        code: 'not_configured',
      },
    }));
  }
  // Vercel routes /api/* here via a rewrite. Make sure Express always sees the
  // full, /api-prefixed path regardless of how the rewrite presents req.url.
  if (req.url && !req.url.startsWith('/api')) {
    req.url = '/api' + (req.url === '/' ? '' : req.url);
  }
  return app(req, res);
}
