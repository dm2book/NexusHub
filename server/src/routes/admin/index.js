/** Admin API surface. All routes require an authenticated staff user; each
 * sub-route additionally enforces fine-grained permissions via RBAC. */
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireStaff } from '../../middleware/rbac.js';
import orders from './orders.js';
import suppliers from './suppliers.js';
import fulfillment from './fulfillment.js';
import emails from './emails.js';
import analytics from './analytics.js';
import security from './security.js';
import products from './products.js';
import support from './support.js';
import social from './social.js';
import monetization from './monetization.js';
import { asyncHandler } from '../../middleware/error.js';
import { launchChecks } from '../../services/launchCheckService.js';
import { listAll as listAllDrops, createDrop, deleteDrop } from '../../services/dropService.js';
import { z } from 'zod';
import { get } from '../../db/index.js';

const router = Router();
router.use(requireAuth, requireStaff);

// Live "can I sell today?" readiness report for the admin dashboard.
router.get('/launch-check', asyncHandler(async (_req, res) => {
  res.json(await launchChecks());
}));

// Action-item counts for the admin sidebar badges, so open tickets / pending
// payments / orders awaiting fulfillment are visible at a glance instead of
// hidden inside a page.
router.get('/nav-counts', asyncHandler(async (_req, res) => {
  const n = async (sql) => Number((await get(sql).catch(() => null))?.n || 0);
  const [tickets, payments, fulfillment] = await Promise.all([
    n(`SELECT COUNT(*) AS n FROM support_tickets WHERE status <> 'closed'`),
    n(`SELECT COUNT(*) AS n FROM payment_proofs WHERE status = 'pending'`),
    n(`SELECT COUNT(*) AS n FROM orders WHERE status = 'paid'`),
  ]);
  res.json({ tickets, payments, fulfillment });
}));

// Drop calendar management.
router.get('/drops', asyncHandler(async (_req, res) => { res.json({ drops: await listAllDrops() }); }));
router.post('/drops', asyncHandler(async (req, res) => {
  const body = z.object({
    title: z.string().min(1).max(120),
    category: z.string().max(40).optional(),
    note: z.string().max(300).optional(),
    startsAt: z.string().min(1),
  }).parse(req.body || {});
  res.status(201).json({ drop: await createDrop(body, req.user.id) });
}));
router.delete('/drops/:id', asyncHandler(async (req, res) => { await deleteDrop(req.params.id); res.json({ ok: true }); }));

router.use('/orders', orders);
router.use('/suppliers', suppliers);
router.use('/fulfillment', fulfillment);
router.use('/emails', emails);
router.use('/analytics', analytics);
router.use('/security', security);
router.use('/products', products);
router.use('/support', support);
router.use('/social', social);
router.use('/monetization', monetization);

export default router;
