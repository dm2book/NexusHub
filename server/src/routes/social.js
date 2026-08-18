/**
 * Public social-proof API. Real data only — when the store has had no activity
 * the feed is empty (the client simply renders nothing). Cached briefly so the
 * storefront stays fast under load.
 */
import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { publicCache } from '../utils/httpCache.js';
import { liveFeed, trustStats } from '../services/socialProofService.js';

const router = Router();

/* These two had an in-process cache and no Cache-Control header, which is the
   wrong way round for this deployment. A module-level cache lives inside ONE
   warm function instance: a new instance starts with nothing, and the platform
   creates and freezes instances as it likes — so it helps least exactly when
   traffic arrives. Meanwhile the shared cache in front of the function, the one
   that could have answered for every visitor at once, was told nothing and
   therefore forwarded every request. Measured on a real page load, /social/feed
   was one of only four requests per visit that no cache could absorb.
   Both caches now, edge first. The in-process one still earns its keep for the
   burst a single instance serves between revalidations. */
let feedCache = { at: 0, data: null };
let statsCache = { at: 0, data: null };

/** Live purchases feed: "John from Amsterdam · 1,700 Robux · delivered in 34s". */
router.get('/feed', asyncHandler(async (_req, res) => {
  publicCache(res, 60);
  if (!feedCache.data || Date.now() - feedCache.at > 15_000) {
    feedCache = { at: Date.now(), data: await liveFeed({ limit: 12 }) };
  }
  res.json({ feed: feedCache.data });
}));

/** Real trust statistics (orders delivered, avg/fastest delivery, reviews…). */
router.get('/stats', asyncHandler(async (_req, res) => {
  publicCache(res, 300);
  if (!statsCache.data || Date.now() - statsCache.at > 30_000) {
    statsCache = { at: Date.now(), data: await trustStats() };
  }
  res.json(statsCache.data);
}));

/** Let other modules bust the caches when activity changes. */
export function bustSocialCaches() { feedCache = { at: 0, data: null }; statsCache = { at: 0, data: null }; }

export default router;
