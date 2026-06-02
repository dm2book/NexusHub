/**
 * ForgeMarket API server bootstrap.
 *
 * Wires middleware (CORS, JSON, cookies, auth, baseline rate limiting), mounts
 * the route tree, runs migrations + seed on startup, and starts listening.
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { config, assertProductionConfig } from './config/env.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { attachUser } from './middleware/auth.js';
import { rateLimit } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

import authRoutes from './routes/auth.js';
import accountRoutes from './routes/account.js';
import catalogRoutes from './routes/catalog.js';
import adminRoutes from './routes/admin/index.js';

assertProductionConfig();
migrate();
seed();

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: config.appUrl, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(attachUser);

// Baseline rate limit across the whole API; sensitive routes add tighter ones.
app.use('/api', rateLimit({ bucket: 'api' }));

app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/account', accountRoutes);
app.use('/api', catalogRoutes);
app.use('/api/admin', adminRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`ForgeMarket API listening on :${config.port} (${config.env})`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));

export default app;
