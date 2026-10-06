/** Admin support: tickets + refund-request review. */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import * as support from '../../services/supportService.js';
import { refundOrder } from '../../services/refundService.js';
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
    const { body } = z.object({ body: z.string().min(1).max(5000) }).parse(req.body);
    const ticket = await support.replyTicket(req.params.id, { authorId: req.user.id, authorKind: 'staff', body });
    await audit({ actor: req.user, action: 'ticket.reply', targetType: 'ticket', targetId: req.params.id, req });
    res.json({ ticket });
  }));
router.post('/tickets/:id/status', requirePermission('tickets.manage'),
  asyncHandler(async (req, res) => {
    const { status } = z.object({
      status: z.enum(['open', 'pending', 'resolved', 'closed']),
    }).parse(req.body);
    const ticket = await support.setTicketStatus(req.params.id, status, req.user.id);
    await audit({ actor: req.user, action: 'ticket.status', targetType: 'ticket', targetId: req.params.id, metadata: { status }, req });
    res.json({ ticket });
  }));

// Refund requests
router.get('/refunds', requirePermission('orders.refund'), asyncHandler(async (req, res) => {
  res.json({ refunds: await support.listRefundRequests({ status: req.query.status }) });
}));
router.post('/refunds/:id/decide', requirePermission('orders.refund'),
  asyncHandler(async (req, res) => {
    const { status, processOrder, method } = z.object({
      status: z.enum(['approved', 'rejected', 'processed']),
      processOrder: z.boolean().optional(),
      // The buyer chose when they asked; the owner may still decide otherwise.
      method: z.enum(['money', 'credit']).optional(),
    }).parse(req.body);
    const request = await support.getRefundRequest(req.params.id);
    if (!request) throw notFound('Refund request not found');
    const how = method || request.method || 'money';
    /* The refund FIRST, the decision after. "Approve + refund" used to only
       flip the order to refunded — for a card payment the money stayed with
       the shop while the buyer was told it was on its way. Now it goes back
       through refundOrder, the same path as the order page, and a PSP that
       refuses leaves the request open to try again. */
    let refund = null;
    if (processOrder && (status === 'approved' || status === 'processed')) {
      try {
        refund = (await refundOrder(request.order_id, { method: how, actorId: req.user.id, user: req.user,
          reason: how === 'credit' ? 'Refund request approved — store credit' : 'Customer refund request approved' })).refund;
      } catch (e) {
        if (e.pspFailure) {
          await audit({ actor: req.user, action: 'order.refund_failed', targetType: 'order',
            targetId: request.order_id, metadata: e.pspFailure, req });
        }
        throw e;
      }
    }
    const decision = await support.decideRefund(req.params.id, { status, decidedBy: req.user.id, method: how });
    await audit({ actor: req.user, action: 'refund.decide', targetType: 'refund_request',
      targetId: req.params.id, metadata: { status, method: how }, req });
    res.json({ refund: decision, result: refund });
  }));

export default router;
