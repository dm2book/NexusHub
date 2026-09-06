/** Admin email template management (customizable branded templates). */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import { all, get, run, nowIso } from '../../db/index.js';
import { renderTemplate, baseContext } from '../../services/templateService.js';
import { sendEmail } from '../../services/emailService.js';
import { sendBroadcast, broadcastAudienceCount, recentBroadcasts } from '../../services/broadcastService.js';
import { audit } from '../../services/auditService.js';
import { notFound } from '../../utils/errors.js';

const router = Router();

// ── Customer broadcast (newsletter / announcement) ──────────────────────────
router.get('/broadcast/audience', requirePermission('emails.manage'), asyncHandler(async (_req, res) => {
  res.json({ audience: await broadcastAudienceCount(), recent: await recentBroadcasts() });
}));

router.post('/broadcast', requirePermission('emails.manage'), asyncHandler(async (req, res) => {
  const { subject, message } = z.object({
    subject: z.string().min(2).max(200),
    message: z.string().min(2).max(20000),
  }).parse(req.body);
  // Plain-text message → simple paragraphs; a couple of safe inline tags allowed.
  const innerHtml = `<h1>${escapeHtml(subject)}</h1>` +
    escapeHtml(message).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
  const summary = await sendBroadcast({ subject, innerHtml });
  await audit({ actor: req.user, action: 'email.broadcast', metadata: { subject, ...summary }, req });
  res.json(summary);
}));

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Every row now belongs to a (template, language) pair, so `id` alone no longer
   identifies one. The language comes in as a query parameter and defaults to
   Dutch — the shop's own — which is also what a client written before this
   existed will keep getting. */
const LANGS = ['nl', 'en', 'de', 'fr'];
const langOf = (req) => (LANGS.includes(req.query.lang) ? req.query.lang : 'nl');
const oneTemplate = (id, lang) =>
  get('SELECT * FROM email_templates WHERE id=@id AND lang=@lang', { id, lang });

router.get('/', requirePermission('emails.manage'), asyncHandler(async (req, res) => {
  res.json({
    templates: await all('SELECT * FROM email_templates WHERE lang=@lang ORDER BY name',
      { lang: langOf(req) }),
    languages: LANGS,
    /* Which languages each template actually has a row for, so the admin can
       show that one is missing rather than silently editing the Dutch one. */
    coverage: await all(`SELECT id, COUNT(*) AS n, MIN(lang) AS any_lang
                           FROM email_templates GROUP BY id`),
  });
}));

router.get('/log', requirePermission('emails.manage'), asyncHandler(async (_req, res) => {
  res.json({ log: await all('SELECT * FROM email_log ORDER BY created_at DESC LIMIT 100') });
}));

router.get('/:id', requirePermission('emails.manage'), asyncHandler(async (req, res) => {
  const t = await oneTemplate(req.params.id, langOf(req));
  if (!t) throw notFound('Template not found');
  res.json({ template: t });
}));

router.put('/:id', requirePermission('emails.manage'), asyncHandler(async (req, res) => {
  const lang = langOf(req);
  const t = await oneTemplate(req.params.id, lang);
  if (!t) throw notFound('Template not found');
  const body = z.object({
    name: z.string().optional(),
    subject: z.string().min(1).optional(),
    bodyHtml: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
  }).parse(req.body);
  await run(`UPDATE email_templates SET name=@name, subject=@subj, body_html=@body,
        enabled=@en, updated_by=@by, updated_at=@at WHERE id=@id AND lang=@lang`,
      { name: body.name ?? t.name, subj: body.subject ?? t.subject,
        body: body.bodyHtml ?? t.body_html,
        en: body.enabled != null ? (body.enabled ? 1 : 0) : t.enabled,
        by: req.user.id, at: nowIso(), id: req.params.id, lang });
  await audit({ actor: req.user, action: 'email.template_update', targetType: 'email_template',
    targetId: req.params.id, metadata: { lang }, req });
  res.json({ template: await oneTemplate(req.params.id, lang) });
}));

// Live preview with sample tokens (no email sent).
router.post('/:id/preview', requirePermission('emails.manage'), asyncHandler(async (req, res) => {
  const t = await oneTemplate(req.params.id, langOf(req));
  if (!t) throw notFound('Template not found');
  const ctx = baseContext({
    user: { name: 'Alex Customer' },
    order: { number: 'FM-2026-DEMO123', total: '€49.99', status: 'Completed',
      url: 'https://example.com/account/orders/demo' },
    refund: { amount: '€49.99' }, otp: { code: '123456', ttl: 10 },
  });
  res.json(renderTemplate(t, ctx));
}));

// Send a test email to the requesting admin, in the language being edited.
router.post('/:id/test', requirePermission('emails.manage'), asyncHandler(async (req, res) => {
  const lang = langOf(req);
  await sendEmail(req.params.id, req.user.email, {
    lang,
    user: { name: req.user.displayName || 'Admin' },
    order: { number: 'FM-2026-TEST', total: '€0.00', status: 'Test', url: '#' },
  });
  res.json({ ok: true, sentTo: req.user.email, lang });
}));

export default router;
