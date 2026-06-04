import { Router, type NextFunction, type Request, type Response } from 'express';
import { ReportType } from '@memeforge/shared';
import { env } from '../../config/env.js';
import { asyncHandler, ok } from '../../lib/http.js';
import { unauthorized } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { priceTicker } from '../../services/market/ticker.js';
import { runDiscoveryScan } from '../discovery/discovery.service.js';
import { scanWhales } from '../whales/whale.service.js';
import { runProfitLock } from '../automation/automation.service.js';
import { generateReport } from '../ai/ai.service.js';
import { notifications } from '../notifications/notification.service.js';

/**
 * Serverless cron endpoints. On hosts without a long-running process (e.g.
 * Vercel) these replace the in-process PriceTicker + scheduler. A platform
 * scheduler (Vercel Cron) hits them on an interval.
 *
 *   POST /api/v1/cron/tick   → price update + alerts + auto-sell/trailing
 *   POST /api/v1/cron/scan   → discovery scan + whale scan
 *   POST /api/v1/cron/daily  → profit lock + daily report
 *   POST /api/v1/cron/weekly → weekly report
 */
export const cronRouter = Router();

function guard(req: Request, _res: Response, next: NextFunction) {
  if (!env.cronSecret) return next(); // open in local/dev when no secret set
  const auth = req.headers.authorization ?? '';
  const key = req.query.key;
  if (auth === `Bearer ${env.cronSecret}` || key === env.cronSecret) return next();
  next(unauthorized('Invalid cron secret'));
}

cronRouter.use(guard);

cronRouter.all(
  '/tick',
  asyncHandler(async (_req, res) => {
    await priceTicker.tick();
    ok(res, { ran: 'tick', at: new Date().toISOString() });
  }),
);

cronRouter.all(
  '/scan',
  asyncHandler(async (_req, res) => {
    const [discovery] = await Promise.all([runDiscoveryScan(), scanWhales()]);
    ok(res, { ran: 'scan', discovered: discovery.length });
  }),
);

cronRouter.all(
  '/daily',
  asyncHandler(async (_req, res) => {
    await runProfitLock();
    await emitReport(ReportType.DAILY, '📊');
    ok(res, { ran: 'daily' });
  }),
);

cronRouter.all(
  '/weekly',
  asyncHandler(async (_req, res) => {
    await emitReport(ReportType.WEEKLY, '📈');
    ok(res, { ran: 'weekly' });
  }),
);

async function emitReport(type: ReportType, emoji: string) {
  const users = await prisma.user.findMany({ where: { role: { in: ['OWNER', 'ADMIN'] } }, select: { id: true } });
  for (const u of users) {
    try {
      const report = await generateReport(u.id, type);
      await notifications.dispatch(u.id, { type: 'REPORT', emoji, title: report.title, body: report.summary, meta: { reportId: report.id } });
    } catch (err) {
      logger.error({ err, type }, 'cron report failed');
    }
  }
}
