/** Admin fulfillment: manual queue, completing manual requests, polling auto. */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import {
  listManualQueue, completeManualFulfillment, refreshFulfillment,
} from '../../services/fulfillmentService.js';
import { audit } from '../../services/auditService.js';

const router = Router();

router.get('/queue', requirePermission('fulfillment.manage'), (_req, res) => {
  res.json({ queue: listManualQueue() });
});

// Complete a manual fulfillment request by recording the delivery payload.
router.post('/:requestId/complete', requirePermission('fulfillment.manage'),
  asyncHandler(async (req, res) => {
    const body = z.object({
      note: z.string().optional(),
      deliveries: z.array(z.object({
        type: z.enum(['code', 'file', 'license', 'message']).optional(),
        content: z.string(),
        filename: z.string().optional(),
        maxDownloads: z.number().int().optional(),
      })).default([]),
    }).parse(req.body);
    const request = await completeManualFulfillment(req.params.requestId, body,
      { actorId: req.user.id });
    audit({ actor: req.user, action: 'fulfillment.manual_complete',
      targetType: 'fulfillment_request', targetId: req.params.requestId, req });
    res.json({ request });
  }));

// Re-poll an in-progress async auto fulfillment.
router.post('/:requestId/refresh', requirePermission('fulfillment.manage'),
  asyncHandler(async (req, res) => {
    const request = await refreshFulfillment(req.params.requestId, { actorId: req.user.id });
    res.json({ request });
  }));

export default router;
