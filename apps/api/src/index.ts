import { createServer } from 'node:http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { createApp } from './app.js';
import { realtime } from './realtime/hub.js';
import { priceTicker } from './services/market/ticker.js';
import { startScheduler, stopScheduler } from './scheduler/index.js';

async function main() {
  const app = createApp();
  const server = createServer(app);

  // Attach the realtime WebSocket hub to the same HTTP server.
  realtime.attach(server);

  server.listen(env.apiPort, () => {
    logger.info(`🔥 MemeForge API listening on :${env.apiPort} (${env.nodeEnv})`);
    logger.info(`   REST  → ${env.apiBaseUrl}/api/v1`);
    logger.info(`   WS    → ${env.apiBaseUrl.replace('http', 'ws')}/realtime`);
  });

  // Start the heartbeat + scheduled jobs.
  priceTicker.start(5000);
  startScheduler();

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down`);
    priceTicker.stop();
    stopScheduler();
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
