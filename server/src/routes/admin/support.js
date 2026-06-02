/** Admin support: tickets + refund-request review. */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import * as support from '../../services/supportService.js';
import { transitionOrder } from '../../services/orderService.js';
import { audit } from '../../services/auditService.js';
import { notFound } from '../../utils/errors.js';

const router = Router();

// Tickets
router.get('/tickets', requirePermission('tickets.read'), asyncHandler(async (req, res) => {
  res.json({ tickets: await support.listTickets({ status: req.query.status }) });
}));
router.get('/tickets/:id', requirePermission('tickets.read'), asyncHandler(async (req, res) => {
  const t = await support.getTicket(req.params.id);
  if (!t) throw notFound('Ticket not found');
  res.json({ ticket: t });
}));
router.post('/tickets/:id/reply', requirePermission('tickets.manage'),
  asyncHandler(async (req, res) => {
    const { body } = z.object({ body: z.string().min(1) }).parse(req.body);
    res.json({ ticket: await support.replyTicket(req.params.id,
      { authorId: req.user.id, authorKind: 'staff', body }) });
  }));
router.post('/tickets/:id/status', requirePermission('tickets.manage'),
  asyncHandler(async (req, res) => {
    const { status } = z.object({
      status: z.enum(['open', 'pending', 'resolved', 'closed']),
    }).parse(req.body);
    res.json({ ticket: await support.setTicketStatus(req.params.id, status, req.user.id) });
  }));

// Refund requests
router.get('/refunds', requirePermission('orders.refund'), asyncHandler(async (req, res) => {
  res.json({ refunds: await support.listRefundRequests({ status: req.query.status }) });
}));
router.post('/refunds/:id/decide', requirePermission('orders.refund'),
  asyncHandler(async (req, res) => {
    const { status, processOrder } = z.object({
      status: z.enum(['approved', 'rejected', 'processed']),
      processOrder: z.boolean().optional(),
    }).parse(req.body);
    const decision = await support.decideRefund(req.params.id, { status, decidedBy: req.user.id });
    if (processOrder && (status === 'approved' || status === 'processed')) {
      await transitionOrder(decision.order_id, 'refunded',
        { actorId: req.user.id, reason: 'Customer refund request approved' });
    }
    await audit({ actor: req.user, action: 'refund.decide', targetType: 'refund_request',
      targetId: req.params.id, metadata: { status }, req });
    res.json({ refund: decision });
  }));

export default router;
