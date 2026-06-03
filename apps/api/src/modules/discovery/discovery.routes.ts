import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../../lib/http.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { getDiscovery, runDiscoveryScan } from './discovery.service.js';

export const discoveryRouter = Router();
discoveryRouter.use(authenticate);

discoveryRouter.get(
  '/',
  validate(z.object({ limit: z.coerce.number().min(1).max(100).default(30) }), 'query'),
  asyncHandler(async (req, res) => ok(res, await getDiscovery(Number(req.query.limit)))),
);

// Force a fresh scan.
discoveryRouter.post(
  '/scan',
  asyncHandler(async (_req, res) => ok(res, await runDiscoveryScan())),
);
