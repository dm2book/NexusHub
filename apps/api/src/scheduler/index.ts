import cron from 'node-cron';
import { ReportType } from '@memeforge/shared';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { runDiscoveryScan } from '../modules/discovery/discovery.service.js';
import { scanWhales } from '../modules/whales/whale.service.js';
import { runProfitLock } from '../modules/automation/automation.service.js';
import { generateReport } from '../modules/ai/ai.service.js';
import { notifications } from '../modules/notifications/notification.service.js';

const tasks: cron.ScheduledTask[] = [];

/** Register all cron jobs. Price ticking is handled by the PriceTicker loop. */
export function startScheduler() {
  if (!env.flags.cron) {
    logger.warn('Scheduler disabled (ENABLE_CRON=false)');
    return;
  }

  // Discovery scan — every minute.
  tasks.push(
    cron.schedule('* * * * *', () => {
      runDiscoveryScan().catch((err) => logger.error({ err }, 'discoveryScan failed'));
    }),
  );

  // Whale scan — every 30s (two crons offset).
  tasks.push(
    cron.schedule('* * * * *', () => {
      scanWhales().catch((err) => logger.error({ err }, 'whaleScan failed'));
      setTimeout(() => void scanWhales().catch(() => undefined), 30_000);
    }),
  );

  // Profit lock — daily at 23:59.
  tasks.push(
    cron.schedule('59 23 * * *', () => {
      runProfitLock().catch((err) => logger.error({ err }, 'profitLock failed'));
    }),
  );

  // Daily report — 08:00.
  tasks.push(
    cron.schedule('0 8 * * *', () => {
      void emailReportToAll(ReportType.DAILY);
    }),
  );

  // Weekly report — Monday 08:00.
  tasks.push(
    cron.schedule('0 8 * * 1', () => {
      void emailReportToAll(ReportType.WEEKLY);
    }),
  );

  logger.info(`Scheduler started with ${tasks.length} jobs`);
}

async function emailReportToAll(type: ReportType) {
  const users = await prisma.user.findMany({ where: { role: { in: ['OWNER', 'ADMIN'] } }, select: { id: true } });
  for (const u of users) {
    try {
      const report = await generateReport(u.id, type);
      await notifications.dispatch(u.id, {
        type: 'REPORT',
        emoji: type === ReportType.DAILY ? '📊' : '📈',
        title: report.title,
        body: report.summary,
        meta: { reportId: report.id },
      });
    } catch (err) {
      logger.error({ err, userId: u.id, type }, 'Report generation failed');
    }
  }
}

export function stopScheduler() {
  for (const t of tasks) t.stop();
}
