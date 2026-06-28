/**
 * Public social-proof API. Real data only — when the store has had no activity
 * the feed is empty (the client simply renders nothing). Cached briefly so the
 * storefront stays fast under load.
 */
import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { liveFeed, trustStats } from '../services/socialProofService.js';

const router = Router();

let feedCache = { at: 0, data: null };
let statsCache = { at: 0, data: null };

/** Live purchases feed: "John from Amsterdam · 1,700 Robux · delivered in 34s". */
router.get('/feed', asyncHandler(async (_req, res) => {
  if (!feedCache.data || Date.now() - feedCache.at > 15_000) {
    feedCache = { at: Date.now(), data: await liveFeed({ limit: 12 }) };
  }
  res.json({ feed: feedCache.data });
}));

/** Real trust statistics (orders delivered, avg/fastest delivery, reviews…). */
router.get('/stats', asyncHandler(async (_req, res) => {
  if (!statsCache.data || Date.now() - statsCache.at > 30_000) {
    statsCache = { at: Date.now(), data: await trustStats() };
  }
  res.json(statsCache.data);
}));

/** Let other modules bust the caches when activity changes. */
export function bustSocialCaches() { feedCache = { at: 0, data: null }; statsCache = { at: 0, data: null }; }

export default router;
