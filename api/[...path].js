/**
 * Vercel serverless entrypoint for the ForgeMarket API.
 *
 * Vercel routes every /api/* request (see vercel.json) to this function. We
 * build the Express app once per warm instance with lazy migrations enabled, so
 * the schema is ensured on cold start without a separate deploy step.
 *
 * The backend's dependencies are declared in the ROOT package.json so a single
 * `npm install` covers both the SPA build and this function.
 */
import { createApp } from '../server/src/app.js';

const app = createApp({ lazyReady: true });

export default function handler(req, res) {
  return app(req, res);
}
