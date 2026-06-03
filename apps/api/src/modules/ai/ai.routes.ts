import { Router } from 'express';
import { z } from 'zod';
import { ReportType } from '@memeforge/shared';
import { asyncHandler, ok } from '../../lib/http.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { explainToken, generateReport, listReports } from './ai.service.js';

export const aiRouter = Router();
aiRouter.use(authenticate);

// List stored reports.
aiRouter.get(
  '/reports',
  validate(z.object({ type: z.nativeEnum(ReportType).optional() }), 'query'),
  asyncHandler(async (req, res) => ok(res, await listReports(req.user!.id, req.query.type as ReportType | undefined))),
);

// Generate a fresh report on demand.
aiRouter.post(
  '/reports',
  validate(z.object({ type: z.nativeEnum(ReportType).default(ReportType.DAILY) })),
  asyncHandler(async (req, res) => ok(res, await generateReport(req.user!.id, req.body.type))),
);

// Why am I up / Why am I down.
aiRouter.get(
  '/explain/:address',
  asyncHandler(async (req, res) => ok(res, await explainToken(req.params.address))),
);
