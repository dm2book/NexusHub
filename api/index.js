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

const app = createApp({ lazyReady: true });

export default function handler(req, res) {
  // Vercel routes /api/* here via a rewrite. Make sure Express always sees the
  // full, /api-prefixed path regardless of how the rewrite presents req.url.
  if (req.url && !req.url.startsWith('/api')) {
    req.url = '/api' + (req.url === '/' ? '' : req.url);
  }
  return app(req, res);
}
