/** Admin API surface. All routes require an authenticated staff user; each
 * sub-route additionally enforces fine-grained permissions via RBAC. */
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireStaff, requirePermission } from '../../middleware/rbac.js';
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
import categories from './categories.js';
import market from './market.js';
import daily from './daily.js';
import money from './money.js';
import { asyncHandler } from '../../middleware/error.js';
import { launchChecks } from '../../services/launchCheckService.js';
import { sellerIdentity, setSellerIdentity, FIELDS }
  from '../../services/sellerIdentityService.js';
import { secretStatus, setSecret, missingEssentials } from '../../services/secretStore.js';
import { listBackups, takeBackup, readBackup, backupStatus }
  from '../../services/backupService.js';
import { launchPlan } from '../../services/launchPlanService.js';
import { launchCenter } from '../../services/launchCenterService.js';
import { listAll as listAllDrops, createDrop, deleteDrop } from '../../services/dropService.js';
import { z } from 'zod';
import { get } from '../../db/index.js';

const router = Router();
router.use(requireAuth, requireStaff);

// Live "can I sell today?" readiness report for the admin dashboard.
router.get('/launch-check', asyncHandler(async (_req, res) => {
  res.json(await launchChecks());
}));

/**
 * Who is selling.
 *
 * Read is open to staff, like the rest of this router; writing is behind
 * settings-level permission, because this is the block that appears on every
 * invoice and in the terms a customer agreed to. The service audits both sides
 * of the change.
 */
router.get('/legal-identity', asyncHandler(async (_req, res) => {
  res.json(await sellerIdentity());
}));

router.put('/legal-identity', requirePermission('analytics.write'),
  asyncHandler(async (req, res) => {
    const body = z.object(Object.fromEntries(
      Object.keys(FIELDS).map((k) => [k, z.string().max(200).nullish()]),
    )).parse(req.body || {});
    res.json(await setSellerIdentity(body, { actor: req.user }));
  }));

/**
 * The keys the shop runs on.
 *
 * Read gives status only — set or not, from the admin or from the build, and
 * the last four characters. A value is never sent to a browser, because a
 * screen that can show a Stripe key is a screen that can leak one.
 */
router.get('/settings/keys', requirePermission('analytics.read'), asyncHandler(async (_req, res) => {
  res.json({ keys: await secretStatus(), missing: await missingEssentials() });
}));

router.put('/settings/keys/:id', requirePermission('analytics.write'),
  asyncHandler(async (req, res) => {
    const { value } = z.object({ value: z.string().max(4000).nullish() }).parse(req.body || {});
    res.json({ keys: await setSecret(req.params.id, value ?? '', { actor: req.user }),
      missing: await missingEssentials() });
  }));

/**
 * Snapshots of everything that cannot be re-derived.
 *
 * The list and the status never carry a payload — a snapshot is megabytes and
 * this endpoint is polled by a dashboard. The download is its own request, and
 * it records that it happened, because whether an off-site copy exists is the
 * one thing nobody else can know.
 */
router.get('/backups', requirePermission('analytics.read'), asyncHandler(async (_req, res) => {
  res.json({ backups: await listBackups({ limit: 10 }), status: await backupStatus() });
}));

router.post('/backups', requirePermission('analytics.write'), asyncHandler(async (req, res) => {
  res.json({ backup: await takeBackup({ actor: req.user, reason: 'manual' }),
    status: await backupStatus() });
}));

router.get('/backups/:id/download', requirePermission('analytics.write'),
  asyncHandler(async (req, res) => {
    const b = await readBackup(req.params.id, { actor: req.user });
    if (!b) return res.status(404).json({ error: { message: 'No such backup.' } });
    const name = `forgemarket-${b.kind}-${String(b.createdAt).slice(0, 19).replace(/[:T]/g, '')}.json`;
    res.set({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    });
    return res.send(b.json);
  }));

/**
 * The launch plan: what has to be true today, and what has to be true on the day.
 *
 * Separate from /launch-check on purpose. That one answers "can I sell today?"
 * for a shop that is meant to be selling; this one answers "am I in the phase I
 * think I am in?", which before launch is a different and more urgent question —
 * a shop that has quietly opened early looks perfectly healthy to the other
 * report.
 */
router.get('/launch-plan', asyncHandler(async (_req, res) => {
  res.json(await launchPlan());
}));

/**
 * The launch command centre: today's money, today's failures, today's people.
 *
 * Polled every few seconds by the page, so two things matter more than usual.
 * `no-store` — a cached "live" number is worse than a stale one that admits it,
 * and both this app's edge and any proxy in front of it will happily serve a
 * five-minute-old JSON body otherwise. And the payload carries its own age, so
 * the page can render "updated 3s ago" instead of the word "live".
 */
router.get('/launch-center', requirePermission('analytics.read'), asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await launchCenter());
}));

// Action-item counts for the admin sidebar badges, so open tickets / pending
// payments / orders awaiting fulfillment are visible at a glance instead of
// hidden inside a page.
router.get('/nav-counts', asyncHandler(async (_req, res) => {
  const n = async (sql) => Number((await get(sql).catch(() => null))?.n || 0);
  const [tickets, payments, orders, fulfillment] = await Promise.all([
    // Only tickets the customer is waiting on ('pending' = waiting on customer,
    // 'resolved'/'closed' = done) — so the badge clears when you resolve one.
    n(`SELECT COUNT(*) AS n FROM support_tickets WHERE status = 'open'`),
    n(`SELECT COUNT(*) AS n FROM payment_proofs WHERE status = 'pending'`),
    // Paid orders that still need delivering → badge on the Orders page.
    n(`SELECT COUNT(*) AS n FROM orders
        WHERE status IN ('payment_received', 'processing', 'awaiting_fulfillment')`),
    // Matches exactly what the Fulfillment page's manual queue shows.
    n(`SELECT COUNT(*) AS n FROM fulfillment_requests
        WHERE mode='manual' AND status IN ('pending','in_progress')`),
  ]);
  res.json({ tickets, payments, orders, fulfillment });
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
router.use('/categories', categories);
router.use('/market', market);
router.use('/daily', daily);
router.use('/money', money);

export default router;
