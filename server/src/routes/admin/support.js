/** Admin support: tickets + refund-request review. */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import * as support from '../../services/supportService.js';
import { transitionOrder } from '../../services/orderService.js';
import { audit } from '../../services/auditService.js';

const router = Router();

// Tickets
router.get('/tickets', requirePermission('tickets.read'), (req, res) => {
  res.json({ tickets: support.listTickets({ status: req.query.status }) });
});
router.get('/tickets/:id', requirePermission('tickets.read'), (req, res) => {
  const t = support.getTicket(req.params.id);
  if (!t) return res.status(404).json({ error: { message: 'Ticket not found' } });
  res.json({ ticket: t });
});
router.post('/tickets/:id/reply', requirePermission('tickets.manage'),
  asyncHandler(async (req, res) => {
    const { body } = z.object({ body: z.string().min(1) }).parse(req.body);
    res.json({ ticket: support.replyTicket(req.params.id,
      { authorId: req.user.id, authorKind: 'staff', body }) });
  }));
router.post('/tickets/:id/status', requirePermission('tickets.manage'),
  asyncHandler(async (req, res) => {
    const { status } = z.object({
      status: z.enum(['open', 'pending', 'resolved', 'closed']),
    }).parse(req.body);
    res.json({ ticket: support.setTicketStatus(req.params.id, status, req.user.id) });
  }));

// Refund requests
router.get('/refunds', requirePermission('orders.refund'), (req, res) => {
  res.json({ refunds: support.listRefundRequests({ status: req.query.status }) });
});
router.post('/refunds/:id/decide', requirePermission('orders.refund'),
  asyncHandler(async (req, res) => {
    const { status, processOrder } = z.object({
      status: z.enum(['approved', 'rejected', 'processed']),
      processOrder: z.boolean().optional(),
    }).parse(req.body);
    const decision = support.decideRefund(req.params.id, { status, decidedBy: req.user.id });
    // Optionally push the order to refunded when approved+processed.
    if (processOrder && (status === 'approved' || status === 'processed')) {
      transitionOrder(decision.order_id, 'refunded',
        { actorId: req.user.id, reason: 'Customer refund request approved' });
    }
    audit({ actor: req.user, action: 'refund.decide', targetType: 'refund_request',
      targetId: req.params.id, metadata: { status }, req });
    res.json({ refund: decision });
  }));

export default router;
