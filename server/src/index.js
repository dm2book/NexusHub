/**
 * Standalone server entrypoint (local dev, Render/Railway/Fly, containers).
 * Runs migrations + seed, then listens. On Vercel the app is served via
 * ../../api/index.js instead (no app.listen there).
 */
import { config, assertProductionConfig } from './config/env.js';
import { createApp, ensureReady } from './app.js';

assertProductionConfig();

const app = createApp();

ensureReady()
  .then(() => {
    const server = app.listen(config.port, () => {
      console.log(`ForgeMarket API listening on :${config.port} (${config.env})`);
    });
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  })
  .catch((err) => {
    console.error('Startup failed:', err);
    process.exit(1);
  });

export default app;
