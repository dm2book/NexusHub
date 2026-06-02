/** Admin email template management (customizable branded templates). */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import { all, get, run, nowIso } from '../../db/index.js';
import { renderTemplate, baseContext } from '../../services/templateService.js';
import { sendEmail } from '../../services/emailService.js';
import { audit } from '../../services/auditService.js';
import { notFound } from '../../utils/errors.js';

const router = Router();

router.get('/', requirePermission('emails.manage'), asyncHandler(async (_req, res) => {
  res.json({ templates: await all('SELECT * FROM email_templates ORDER BY name') });
}));

router.get('/log', requirePermission('emails.manage'), asyncHandler(async (_req, res) => {
  res.json({ log: await all('SELECT * FROM email_log ORDER BY created_at DESC LIMIT 100') });
}));

router.get('/:id', requirePermission('emails.manage'), asyncHandler(async (req, res) => {
  const t = await get('SELECT * FROM email_templates WHERE id=@id', { id: req.params.id });
  if (!t) throw notFound('Template not found');
  res.json({ template: t });
}));

router.put('/:id', requirePermission('emails.manage'), asyncHandler(async (req, res) => {
  const t = await get('SELECT * FROM email_templates WHERE id=@id', { id: req.params.id });
  if (!t) throw notFound('Template not found');
  const body = z.object({
    name: z.string().optional(),
    subject: z.string().min(1).optional(),
    bodyHtml: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
  }).parse(req.body);
  await run(`UPDATE email_templates SET name=@name, subject=@subj, body_html=@body,
        enabled=@en, updated_by=@by, updated_at=@at WHERE id=@id`,
      { name: body.name ?? t.name, subj: body.subject ?? t.subject,
        body: body.bodyHtml ?? t.body_html,
        en: body.enabled != null ? (body.enabled ? 1 : 0) : t.enabled,
        by: req.user.id, at: nowIso(), id: req.params.id });
  await audit({ actor: req.user, action: 'email.template_update', targetType: 'email_template',
    targetId: req.params.id, req });
  res.json({ template: await get('SELECT * FROM email_templates WHERE id=@id', { id: req.params.id }) });
}));

// Live preview with sample tokens (no email sent).
router.post('/:id/preview', requirePermission('emails.manage'), asyncHandler(async (req, res) => {
  const t = await get('SELECT * FROM email_templates WHERE id=@id', { id: req.params.id });
  if (!t) throw notFound('Template not found');
  const ctx = baseContext({
    user: { name: 'Alex Customer' },
    order: { number: 'FM-2026-DEMO123', total: '€49.99', status: 'Completed',
      url: 'https://example.com/account/orders/demo' },
    refund: { amount: '€49.99' }, otp: { code: '123456', ttl: 10 },
  });
  res.json(renderTemplate(t, ctx));
}));

// Send a test email to the requesting admin.
router.post('/:id/test', requirePermission('emails.manage'), asyncHandler(async (req, res) => {
  await sendEmail(req.params.id, req.user.email, {
    user: { name: req.user.displayName || 'Admin' },
    order: { number: 'FM-2026-TEST', total: '€0.00', status: 'Test', url: '#' },
  });
  res.json({ ok: true, sentTo: req.user.email });
}));

export default router;
