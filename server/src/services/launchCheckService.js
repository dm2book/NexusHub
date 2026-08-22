/**
 * Launch readiness — live checks against the real configuration and database,
 * so "can I sell today?" is a glance instead of a guess. Each check returns
 * { id, label, status: 'ok'|'warn'|'fail', detail } with a concrete fix hint.
 */
import { config, manualPayMethods } from '../config/env.js';
import { get, all } from '../db/index.js';
import { iconFor } from '../db/demoSeed.js';
import { botSeenRecently } from './discordService.js';
import { configuredChannels } from './notifyService.js';
import { isEnabled as mollieEnabled, isTestKey as mollieTestKey, SUPPORTED_METHODS as MOLLIE_METHODS } from './mollieService.js';
// The only place the server reaches into the SPA tree. legalIdentity.js is a
// dependency-free constants module that both sides must agree on: the storefront
// renders it on every legal page, and this check is the owner's warning that it
// is still empty. Duplicating it would guarantee the two drift apart.
import { LEGAL, legalComplete } from '../../../src/lib/legalIdentity.js';
import { artStatus } from '../../../src/lib/shippedArt.js';

export async function launchChecks() {
  const checks = [];
  const add = (id, label, status, detail) => checks.push({ id, label, status, detail });

  // 1. Payments — the hard blocker: without a way to pay, orders dead-end.
  //
  // This has to name the provider the CHECKOUT actually picks, not any provider
  // that happens to be configured. Mollie wins over everything else there, and
  // this check predated it: a shop running live on Mollie was told "no way to
  // pay", and a shop with a Tikkie link but no Mollie key was told it was fine.
  // A readiness dashboard that disagrees with the checkout is worse than none.
  const manual = manualPayMethods();
  const stripe = !!config.payments.stripe.secretKey;
  if (mollieEnabled()) {
    // A test_ key is the expensive one. Checkout works, Mollie's sandbox marks
    // the payment paid, the order delivers — and no money ever moves. It only
    // surfaces when the bank statement does not match the orders.
    add('payments', 'Payment methods', mollieTestKey() ? 'fail' : 'ok',
      mollieTestKey()
        ? 'MOLLIE_API_KEY is a test_ key — buyers reach Mollie’s sandbox, orders are marked paid and NO money arrives. Swap it for the live key in Vercel.'
        : `Mollie live — ${MOLLIE_METHODS.join(', ')}${manual.length ? ` (manual fallback: ${manual.map((m) => m.label).join(', ')})` : ''}`);
  } else if (manual.length || stripe) {
    // Not a failure — it sells — but every order now waits for a person to read
    // a bank app, so say that rather than a flat green.
    add('payments', 'Payment methods', 'warn',
      stripe
        ? 'Stripe active — no MOLLIE_API_KEY, so no iDEAL. Most Dutch buyers pay with iDEAL.'
        : `Manual only: ${manual.map((m) => m.label).join(', ')} — every payment needs confirming by hand. Set MOLLIE_API_KEY for automatic iDEAL.`);
  } else if (config.payments.demoMode) {
    add('payments', 'Payment methods', 'warn',
      'DEMO mode only — orders are auto-marked paid without real money. Set MOLLIE_API_KEY in Vercel before selling. (In production the checkout refuses orders while this is on, so nothing is given away.)');
  } else {
    add('payments', 'Payment methods', 'fail',
      'No way to pay: set MOLLIE_API_KEY (iDEAL, Bancontact, card, PayPal) in Vercel → orders currently dead-end as pending.');
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

  // 3b. Every active product has a picture — checked, not assumed.
  //
  // A product with no art still sells; it just looks like a mistake, and a
  // shopper deciding whether to hand over money to a shop they have never heard
  // of reads a blank tile as one. Nothing else fails when this breaks: a missing
  // image renders as an empty box and the page returns 200.
  //
  // The paths are matched against src/lib/shippedArt.js rather than the disk on
  // purpose — public/ is served by the CDN and is not in the serverless
  // function's bundle, so asking the filesystem here would report every icon in
  // the catalogue as missing. Owner uploads and pasted links are counted as set
  // but not verified: we can see that a link is there, not that it still loads.
  try {
    const rows = await all(`SELECT name, category, metadata FROM products WHERE active = 1`);
    const seen = new Map();          // image src → categories using it
    const blank = [];
    let remote = 0, uploaded = 0;
    for (const r of rows) {
      let meta = {}; try { meta = JSON.parse(r.metadata || '{}'); } catch { /* keep {} */ }
      const src = meta.image || iconFor(r.category);
      const status = artStatus(src);
      if (status === 'none' || status === 'missing') blank.push(`${r.name}${status === 'missing' ? ` → ${src}` : ''}`);
      if (status === 'remote') remote++;
      if (status === 'uploaded') uploaded++;
      if (src) {
        if (!seen.has(src)) seen.set(src, new Set());
        seen.get(src).add(r.category);
      }
    }
    // The same picture on products from different categories is a wiring
    // mistake, not a family of tiers sharing a look.
    const crossed = [...seen.entries()].filter(([, cats]) => cats.size > 1);
    const extra = [remote && `${remote} external link(s)`, uploaded && `${uploaded} upload(s)`]
      .filter(Boolean).join(', ');

    if (!rows.length) {
      add('productart', 'Product images', 'warn', 'No active products to check.');
    } else if (blank.length) {
      add('productart', 'Product images', 'fail',
        `${blank.length} of ${rows.length} active products have no usable image: ${blank.slice(0, 5).join(', ')}${blank.length > 5 ? ` and ${blank.length - 5} more` : ''}. Run: DATABASE_URL=… node scripts/audit-product-art.mjs`);
    } else if (crossed.length) {
      add('productart', 'Product images', 'warn',
        `All ${rows.length} products have art, but ${crossed.length} picture(s) are shared across different categories — likely the wrong image on one of them. Run scripts/audit-product-art.mjs to see which.`);
    } else {
      add('productart', 'Product images', 'ok',
        `All ${rows.length} active products have art${extra ? ` (${extra} — set, not fetch-tested)` : ''}`);
    }
  } catch (e) { add('productart', 'Product images', 'warn', `Could not check: ${e.message}`); }

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

  // 7. Who is selling.
  //
  // Dutch and EU consumer law (Art. 6:230m BW / Consumer Rights Directive)
  // require a webshop to state a legal name and a geographic address BEFORE the
  // buyer is bound. The pages already leave unset fields out rather than print a
  // placeholder, so the site is never wrong — but "not wrong" is not "compliant",
  // and nothing else on the site tells the owner this is still missing. Nobody
  // can fill it in for them: it is their own name and address.
  if (legalComplete()) {
    add('identity', 'Seller identity', LEGAL.kvk ? 'ok' : 'warn',
      LEGAL.kvk
        ? `${LEGAL.legalName} — KvK ${LEGAL.kvk}${LEGAL.vat ? `, BTW ${LEGAL.vat}` : ''}`
        : `${LEGAL.legalName} — no KvK number yet. Fine while you are not a registered business; add it (and the BTW number) in src/lib/legalIdentity.js after registering.`);
  } else {
    add('identity', 'Seller identity', 'fail',
      'The legal pages cannot say who is selling: legalName / address / postcode / city are empty in src/lib/legalIdentity.js. Dutch law requires a name and a geographic address before a consumer buys.');
  }

  // 8. Two-factor on the accounts that can see everything.
  //
  // The admin panel shows every order, every buyer's email and every delivered
  // code. Sign-in here is passwordless, so without a second factor an attacker
  // who reaches the owner's inbox — a reused password on some other site, a
  // SIM swap — owns the shop. This cannot be switched on for someone: it needs
  // their authenticator app and a code only their phone can produce. So the
  // job here is to make forgetting it visible.
  try {
    const staff = await get(
      `SELECT COUNT(*) AS n FROM users u
        WHERE EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id
                        AND r.role_id IN ('owner','admin'))`);
    const armed = await get(
      `SELECT COUNT(*) AS n FROM users u
        WHERE u.totp_enabled_at IS NOT NULL
          AND EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id
                        AND r.role_id IN ('owner','admin'))`);
    const total = Number(staff?.n || 0), on = Number(armed?.n || 0);
    if (!total) {
      add('twofactor', 'Admin two-factor', 'warn',
        'No admin account exists yet — sign in once with an address listed in ADMIN_EMAILS.');
    } else if (on >= total) {
      add('twofactor', 'Admin two-factor', 'ok', `Enabled on all ${total} admin account(s)`);
    } else {
      add('twofactor', 'Admin two-factor', 'fail',
        `${total - on} of ${total} admin account(s) have no second factor. Anyone who reaches that inbox can read every order and every delivered code — turn it on in Account → Settings.`);
    }
  } catch (e) { add('twofactor', 'Admin two-factor', 'warn', `Could not check: ${e.message}`); }

  // 9. Whether anyone finds out that a sale happened.
  //
  // A warning, not a blocker: the shop sells perfectly well with no alerts. What
  // it cannot do is tell you a chargeback arrived, and a chargeback answered a
  // week late is the money gone. The Discord ops webhook checked above is a
  // different thing — without a webhook URL those events queue for the bot,
  // which polls once a minute — so having that set is not the same as being
  // told, and this check says so rather than counting it.
  const notify = configuredChannels();
  add('notify', 'Owner alerts', notify.length ? 'ok' : 'warn',
    notify.length
      ? `${notify.join(' + ')} — paid, failed, refund, chargeback and low stock, within seconds`
      : 'Nothing set, so a chargeback or a sold-out product waits until you happen to look. Set any one of NOTIFY_DISCORD_WEBHOOK_URL, TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID, or PUSHOVER_TOKEN + PUSHOVER_USER.');

  const failing = checks.filter((c) => c.status === 'fail').length;
  const warning = checks.filter((c) => c.status === 'warn').length;
  return {
    ready: failing === 0,
    summary: failing ? `${failing} blocker(s), ${warning} warning(s)` : warning ? `Ready — ${warning} warning(s)` : 'All green',
    checks,
  };
}
