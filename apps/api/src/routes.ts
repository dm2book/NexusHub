import { Router } from 'express';
import { env } from './config/env.js';
import { realtime } from './realtime/hub.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { portfolioRouter } from './modules/portfolio/portfolio.routes.js';
import { automationRouter } from './modules/automation/automation.routes.js';
import { alertRouter } from './modules/alerts/alert.routes.js';
import { discoveryRouter } from './modules/discovery/discovery.routes.js';
import { whaleRouter } from './modules/whales/whale.routes.js';
import { smartMoneyRouter } from './modules/smartmoney/smartmoney.routes.js';
import { riskRouter } from './modules/risk/risk.routes.js';
import { watchlistRouter } from './modules/watchlist/watchlist.routes.js';
import { journalRouter } from './modules/journal/journal.routes.js';
import { analyticsRouter } from './modules/analytics/analytics.routes.js';
import { aiRouter } from './modules/ai/ai.routes.js';
import { notificationRouter } from './modules/notifications/notification.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { cronRouter } from './modules/cron/cron.routes.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) =>
  res.json({
    ok: true,
    data: {
      status: 'healthy',
      provider: env.dataProvider,
      ai: env.ai.provider,
      realtimeConnections: realtime.connectionCount,
      time: new Date().toISOString(),
    },
  }),
);

apiRouter.use('/auth', authRouter);
apiRouter.use('/portfolio', portfolioRouter);
apiRouter.use('/automation', automationRouter);
apiRouter.use('/alerts', alertRouter);
apiRouter.use('/discovery', discoveryRouter);
apiRouter.use('/whales', whaleRouter);
apiRouter.use('/smart-money', smartMoneyRouter);
apiRouter.use('/risk', riskRouter);
apiRouter.use('/watchlist', watchlistRouter);
apiRouter.use('/journal', journalRouter);
apiRouter.use('/analytics', analyticsRouter);
apiRouter.use('/ai', aiRouter);
apiRouter.use('/notifications', notificationRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/cron', cronRouter);
