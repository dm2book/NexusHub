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

// The standalone server (server/src/index.js) has always run this check, but
// THIS file is what Vercel actually deploys — so in production the check never
// ran. Without it a missing JWT_SECRET silently falls back to the dev default
// that is committed to this repository, and anyone who reads the repo can mint
// a token for any account. Failing to boot is the correct outcome: a function
// that refuses to start is visible in the deploy log, a forgeable session is not.
assertProductionConfig();

const app = createApp({ lazyReady: true });

export default function handler(req, res) {
  // Vercel routes /api/* here via a rewrite. Make sure Express always sees the
  // full, /api-prefixed path regardless of how the rewrite presents req.url.
  if (req.url && !req.url.startsWith('/api')) {
    req.url = '/api' + (req.url === '/' ? '' : req.url);
  }
  return app(req, res);
}
