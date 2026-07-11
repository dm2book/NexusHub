/**
 * Launch readiness — live checks against the real configuration and database,
 * so "can I sell today?" is a glance instead of a guess. Each check returns
 * { id, label, status: 'ok'|'warn'|'fail', detail } with a concrete fix hint.
 */
import { config, manualPayMethods } from '../config/env.js';
import { get } from '../db/index.js';
import { botSeenRecently } from './discordService.js';

export async function launchChecks() {
  const checks = [];
  const add = (id, label, status, detail) => checks.push({ id, label, status, detail });

  // 1. Payments — the hard blocker: without a way to pay, orders dead-end.
  const manual = manualPayMethods();
  const stripe = !!config.payments.stripe.secretKey;
  if (manual.length || stripe) {
    add('payments', 'Payment methods', 'ok',
      stripe ? 'Stripe active' : `Manual: ${manual.map((m) => m.label).join(', ')}`);
  } else if (config.payments.demoMode) {
    add('payments', 'Payment methods', 'warn',
      'DEMO mode only — orders are auto-marked paid without real money. Set PAY_TIKKIE / PAY_REVOLUT / PAY_PAYPAL in Vercel before selling.');
  } else {
    add('payments', 'Payment methods', 'fail',
      'No way to pay: set PAY_TIKKIE / PAY_REVOLUT / PAY_PAYPAL (or Stripe) in Vercel → orders currently dead-end as pending.');
  }

  // 2. Email — login codes + receipts must actually deliver.
  if (config.email.resendApiKey || config.email.smtpUrl) {
    const shared = config.email.fromAddress === 'onboarding@resend.dev';
    add('email', 'Email delivery', shared ? 'warn' : 'ok',
      shared
        ? 'Resend connected, but onboarding@resend.dev only delivers to YOUR own inbox — verify a domain to email customers.'
        : `Sending as ${config.email.fromAddress}`);
  } else {
    add('email', 'Email delivery', 'fail',
      'No RESEND_API_KEY / SMTP_URL — customers cannot receive login codes or order emails.');
  }

  // 3. Catalog — something to sell, with codes ready for instant delivery.
  const products = await get(`SELECT COUNT(*) AS n FROM products WHERE active = 1`);
  const stocked = await get(
    `SELECT COUNT(DISTINCT product_id) AS n FROM product_codes WHERE status = 'available'`);
  const nProducts = Number(products?.n || 0);
  const nStocked = Number(stocked?.n || 0);
  if (!nProducts) add('catalog', 'Catalog', 'fail', 'No active products.');
  else add('catalog', 'Catalog', nStocked ? 'ok' : 'warn',
    `${nProducts} active products, ${nStocked} with pre-loaded codes${nStocked ? '' : ' — without codes every order needs manual delivery'}.`);

  // 4. Security — production must not run on the dev JWT secret.
  add('security', 'Auth secret', config.auth.jwtSecret.startsWith('dev-only') ? 'fail' : 'ok',
    config.auth.jwtSecret.startsWith('dev-only') ? 'JWT_SECRET is the dev default — set a long random value in Vercel.' : 'JWT_SECRET set');

  // 5. Maintenance — self-scheduling with traffic; Vercel Cron is an optional backup.
  add('cron', 'Maintenance', 'ok',
    config.security.cronSecret
      ? 'Self-scheduling (runs with traffic) + Vercel Cron backup (CRON_SECRET set)'
      : 'Self-scheduling — reminders & cleanup run automatically with site traffic.');

  // 6. Discord automation — direct (webhooks/bot token on the server) OR the
  // relay: the community bot polls the signed outbox, so simply running the
  // bot lights this up green with zero hosting-side Discord secrets.
  const d = config.discord;
  const bits = [d.botToken && 'bot', d.orderWebhookUrl && 'orders', d.dropsWebhookUrl && 'drops'].filter(Boolean);
  const relayed = await botSeenRecently(24);
  add('discord', 'Discord automation',
    bits.length >= 2 || relayed ? 'ok' : 'warn',
    relayed && !bits.length
      ? 'Bot connected via relay — delivery DMs, sales pings, drops and alerts flow through your bot.'
      : bits.length
        ? `Configured: ${bits.join(', ')}${relayed ? ' + bot relay' : ''}`
        : 'Start your Discord bot (npm start in discord/) — it connects automatically, no Vercel setup needed.');

  const failing = checks.filter((c) => c.status === 'fail').length;
  const warning = checks.filter((c) => c.status === 'warn').length;
  return {
    ready: failing === 0,
    summary: failing ? `${failing} blocker(s), ${warning} warning(s)` : warning ? `Ready — ${warning} warning(s)` : 'All green',
    checks,
  };
}
