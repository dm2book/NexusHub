/** Admin: manage coupons, gift cards & bundles. */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import { audit } from '../../services/auditService.js';
import { notFound } from '../../utils/errors.js';
import { listCoupons, createCoupon, updateCoupon, deleteCoupon } from '../../services/couponService.js';
import { listGiftCards, issueGiftCard, setGiftCardStatus } from '../../services/giftCardService.js';
import { listBundles, createBundle, updateBundle, deleteBundle } from '../../services/bundleService.js';
import { monetizationReport } from '../../services/analyticsService.js';

const router = Router();
router.use(requirePermission('monetization.manage'));

// Revenue / discount report: top coupons & bundles + gift-card liability.
router.get('/report', asyncHandler(async (req, res) => {
  res.json(await monetizationReport({ days: Math.min(Number(req.query.days) || 90, 365) }));
}));

// Everything on one screen.
router.get('/', asyncHandler(async (_req, res) => {
  const [coupons, giftCards, bundles] = await Promise.all([listCoupons(), listGiftCards(), listBundles()]);
  res.json({ coupons, giftCards, bundles });
}));

// ── Coupons ──────────────────────────────────────────────────────────────────
const couponBody = z.object({
  code: z.string().min(2).max(40),
  kind: z.enum(['percent', 'fixed']).optional(),
  value: z.number().int().positive(),
  minSubtotal: z.number().int().min(0).optional(),
  maxRedemptions: z.number().int().positive().nullable().optional(),
  perUserLimit: z.number().int().positive().nullable().optional(),
  startsAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  active: z.boolean().optional(),
});
router.post('/coupons', asyncHandler(async (req, res) => {
  const c = await createCoupon(couponBody.parse(req.body), req.user.id);
  await audit({ actor: req.user, action: 'coupon.create', targetType: 'coupon', targetId: c.id, metadata: { code: c.code }, req });
  res.status(201).json({ coupon: c });
}));
router.patch('/coupons/:id', asyncHandler(async (req, res) => {
  const c = await updateCoupon(req.params.id, couponBody.partial().parse(req.body));
  await audit({ actor: req.user, action: 'coupon.update', targetType: 'coupon', targetId: req.params.id, req });
  res.json({ coupon: c });
}));
router.delete('/coupons/:id', asyncHandler(async (req, res) => {
  if (!(await deleteCoupon(req.params.id))) throw notFound('Coupon not found');
  await audit({ actor: req.user, action: 'coupon.delete', targetType: 'coupon', targetId: req.params.id, req });
  res.json({ ok: true });
}));

// ── Gift cards ─────────────────────────────────────────────────────────────
router.post('/gift-cards', asyncHandler(async (req, res) => {
  const body = z.object({
    amount: z.number().int().positive(), currency: z.string().length(3).optional(),
    note: z.string().max(200).optional(), recipientEmail: z.string().email().optional(),
  }).parse(req.body);
  const card = await issueGiftCard(body, req.user.id);
  await audit({ actor: req.user, action: 'giftcard.issue', targetType: 'gift_card', targetId: card.id, metadata: { amount: body.amount }, req });
  res.status(201).json({ giftCard: card });
}));
router.patch('/gift-cards/:id', asyncHandler(async (req, res) => {
  const { status } = z.object({ status: z.enum(['active', 'disabled']) }).parse(req.body);
  const card = await setGiftCardStatus(req.params.id, status);
  await audit({ actor: req.user, action: 'giftcard.status', targetType: 'gift_card', targetId: req.params.id, metadata: { status }, req });
  res.json({ giftCard: card });
}));

// ── Bundles ────────────────────────────────────────────────────────────────
const bundleBody = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(400).nullable().optional(),
  productIds: z.array(z.string()).min(2).max(20),
  discountPercent: z.number().int().min(1).max(90),
  active: z.boolean().optional(),
});
router.post('/bundles', asyncHandler(async (req, res) => {
  const b = await createBundle(bundleBody.parse(req.body), req.user.id);
  await audit({ actor: req.user, action: 'bundle.create', targetType: 'bundle', targetId: b.id, req });
  res.status(201).json({ bundle: b });
}));
router.patch('/bundles/:id', asyncHandler(async (req, res) => {
  const b = await updateBundle(req.params.id, bundleBody.partial().parse(req.body));
  await audit({ actor: req.user, action: 'bundle.update', targetType: 'bundle', targetId: req.params.id, req });
  res.json({ bundle: b });
}));
router.delete('/bundles/:id', asyncHandler(async (req, res) => {
  if (!(await deleteBundle(req.params.id))) throw notFound('Bundle not found');
  await audit({ actor: req.user, action: 'bundle.delete', targetType: 'bundle', targetId: req.params.id, req });
  res.json({ ok: true });
}));

export default router;
