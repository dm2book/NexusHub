/**
 * Daily login rewards, from the owner's side.
 *
 * Read is behind analytics.read; every write is behind analytics.write. The
 * split matters more here than on most screens: changing the curve changes what
 * the shop pays out every day from then on, and resetting a streak takes
 * something away from a named member. Both are audited by the service.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import {
  rewardTable, setRewardRule, clearRewardRule, resetStreak, dailyStats,
  flaggedClaims, streakFor,
} from '../../services/dailyRewardService.js';

const router = Router();

/** The curve the owner would see if somebody claimed every day for a month. */
router.get('/rules', requirePermission('analytics.read'), asyncHandler(async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  res.json({ rules: await rewardTable({ days }) });
}));

router.put('/rules/:day', requirePermission('analytics.write'), asyncHandler(async (req, res) => {
  const body = z.object({
    points: z.coerce.number().int().min(0).max(1_000_000),
    kind: z.enum(['boost', 'coupon']).nullish(),
    value: z.coerce.number().int().min(0).nullish(),
    label: z.string().max(120).nullish(),
  }).parse(req.body || {});
  const rule = await setRewardRule({ day: req.params.day, ...body, actor: req.user });
  res.json({ rule });
}));

/** Back to the built-in curve for that day. */
router.delete('/rules/:day', requirePermission('analytics.write'), asyncHandler(async (req, res) => {
  res.json({ rule: await clearRewardRule(req.params.day, { actor: req.user }) });
}));

router.get('/stats', requirePermission('analytics.read'), asyncHandler(async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const [stats, flagged] = await Promise.all([dailyStats({ days }), flaggedClaims({ limit: 50 })]);
  res.json({ ...stats, flagged });
}));

router.get('/streak/:userId', requirePermission('analytics.read'), asyncHandler(async (req, res) => {
  res.json({ streak: await streakFor(req.params.userId) });
}));

/**
 * Reset a streak.
 *
 * The claim history stays: it is the record of what was paid, and it is
 * usually the reason the reset is happening. A reason is required for the same
 * purpose — an audit row that says only "reset" answers nothing later.
 */
router.post('/streak/:userId/reset', requirePermission('analytics.write'),
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().min(3).max(300) }).parse(req.body || {});
    const streak = await resetStreak(req.params.userId, {
      actor: req.user, reason,
    });
    res.json({ streak });
  }));

export default router;
