/** Admin: moderate the live social-proof feed and customer reviews. */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import { audit } from '../../services/auditService.js';
import { notFound } from '../../utils/errors.js';
import {
  listEventsAdmin, setEventStatus, setEventPinned, deleteEvent, trustStats,
} from '../../services/socialProofService.js';
import {
  listReviewsAdmin, setReviewStatus, setReviewVerified, deleteReview,
  listPendingReviews, reviewInsights,
} from '../../services/reviewsService.js';
import { bustSocialCaches } from '../social.js';

const router = Router();
router.use(requirePermission('social.moderate'));

// ── Overview + live feed events ──────────────────────────────────────────────
router.get('/', asyncHandler(async (_req, res) => {
  const [events, reviews, stats] = await Promise.all([
    listEventsAdmin({ limit: 200 }), listReviewsAdmin({ limit: 200 }), trustStats(),
  ]);
  res.json({ events, reviews, stats });
}));

router.patch('/events/:id', asyncHandler(async (req, res) => {
  const { status, pinned } = z.object({
    status: z.enum(['visible', 'hidden', 'pending']).optional(),
    pinned: z.boolean().optional(),
  }).parse(req.body || {});
  let ok = false;
  if (status) ok = await setEventStatus(req.params.id, status) || ok;
  if (pinned != null) ok = await setEventPinned(req.params.id, pinned) || ok;
  if (!ok) throw notFound('Event not found');
  bustSocialCaches();
  await audit({ actor: req.user, action: 'social.event_update', targetType: 'social_event',
    targetId: req.params.id, metadata: { status, pinned }, req });
  res.json({ ok: true });
}));

router.delete('/events/:id', asyncHandler(async (req, res) => {
  if (!(await deleteEvent(req.params.id))) throw notFound('Event not found');
  bustSocialCaches();
  await audit({ actor: req.user, action: 'social.event_delete', targetType: 'social_event',
    targetId: req.params.id, req });
  res.json({ ok: true });
}));

// ── Reviews ──────────────────────────────────────────────────────────────────
/**
 * The queue, and the numbers behind the star rating.
 *
 * A vouch typed in Discord no longer publishes itself, so there has to be
 * somewhere the waiting ones are visible — a moderation gate with no queue is
 * just a place reviews go to die.
 */
router.get('/reviews/pending', asyncHandler(async (_req, res) => {
  res.json({ reviews: await listPendingReviews({ limit: 100 }) });
}));

router.get('/reviews/insights', asyncHandler(async (_req, res) => {
  res.json({ insights: await reviewInsights() });
}));

router.patch('/reviews/:id', asyncHandler(async (req, res) => {
  const { status, verified } = z.object({
    status: z.enum(['visible', 'hidden', 'pending']).optional(),
    verified: z.boolean().optional(),
  }).parse(req.body || {});
  let ok = false;
  if (status) ok = await setReviewStatus(req.params.id, status) || ok;
  if (verified != null) ok = await setReviewVerified(req.params.id, verified) || ok;
  if (!ok) throw notFound('Review not found');
  bustSocialCaches();
  await audit({ actor: req.user, action: 'review.moderate', targetType: 'review',
    targetId: req.params.id, metadata: { status, verified }, req });
  res.json({ ok: true });
}));

router.delete('/reviews/:id', asyncHandler(async (req, res) => {
  if (!(await deleteReview(req.params.id))) throw notFound('Review not found');
  bustSocialCaches();
  await audit({ actor: req.user, action: 'review.delete', targetType: 'review',
    targetId: req.params.id, req });
  res.json({ ok: true });
}));

export default router;
