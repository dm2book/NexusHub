/**
 * Two phases, one checklist.
 *
 * Before the 24th and after it are different shops, and a single list of
 * "things that should be green" cannot describe both. Discord being fully
 * operational is required NOW; a public checkout is required LATER and is a
 * defect now. So every item declares which phase it belongs to, and an item
 * that is wrong for the current phase is wrong regardless of which way round.
 *
 *   BEFORE   Discord live: invites, community, support, reviews, proof of
 *            delivery, restock alerts. Website browsable, purchase refused,
 *            CTAs hidden. The gate closed and closed for the right reason.
 *
 *   ON THE DAY   purchase open, CTAs live, banners on, ads pointed at tagged
 *            links — and payment, fulfilment, email and owner alerts each
 *            verified rather than assumed.
 *
 * The launch-day items are checked in BOTH phases, and before the day they are
 * reported as "not yet, and here is what is missing". That is the whole point:
 * finding out on the day that no product has a code loaded is finding out too
 * late, and a checklist that only starts working at launch is a checklist that
 * has never been run.
 */
import { config, manualPayMethods } from '../config/env.js';
import { launchState, launchAtIso, launchDayLabel } from './launchGateService.js';
import { configuredChannels, EVENTS as ALERT_EVENTS } from './notifyService.js';
import { isEnabled as mollieEnabled } from './mollieService.js';
import { get } from '../db/index.js';

/** BEFORE = must be true today. DAY = must be true on the 24th. */
export const PHASE = { BEFORE: 'before', DAY: 'day' };

const okFail = (cond) => (cond ? 'ok' : 'fail');

export async function launchPlan() {
  const items = [];
  const add = (phase, id, label, status, detail, action = null) =>
    items.push({ phase, id, label, status, detail, ...(action ? { action } : {}) });

  const state = await launchState();
  const at = launchAtIso();

  // ── Phase 0: which shop are we? ───────────────────────────────────────────
  add(PHASE.BEFORE, 'gate', 'Purchase gate',
    state.prelaunch ? 'ok' : 'warn',
    state.prelaunch
      ? `Closed to the public — ${state.reason}.`
      : `OPEN — ${state.reason}. If that is not what you intended, this shop is `
        + 'selling to anyone who finds it.',
    state.prelaunch ? null : 'Set LAUNCH_MODE=prelaunch to close it immediately.');

  /* Two different sentences, because the same missing variable means two
     different things. Written as one, it told an OPEN shop that its gate was
     being held closed — a checklist contradicting the line above it is worse
     than one that says nothing. */
  add(PHASE.BEFORE, 'gate.date', 'Launch moment',
    at ? 'ok' : 'warn',
    at ? `LAUNCH_DATE is ${at} — the gate lifts by itself, with no deploy.`
      : state.prelaunch
        ? 'LAUNCH_DATE is not set. The gate is held closed only by the fact that this shop has '
          + 'never taken a payment — a safety net rather than a plan. It opens the moment one '
          + 'succeeds, and visitors get no countdown in the meantime.'
        : 'LAUNCH_DATE is not set, and this shop is already open. Nothing is scheduled; the '
          + 'gate is simply not in the way any more.',
    at ? null : 'Set LAUNCH_DATE=2026-09-24T00:00:00Z so the shop opens on its own.');

  /* The trap this whole file exists to catch: an override left switched on.
     LAUNCH_MODE is the manual release, and a manual release nobody remembers
     pulling back is how a shop opens three weeks early. */
  if (config.launch.mode) {
    const early = config.launch.mode === 'open' && at && Date.now() < Date.parse(at);
    add(PHASE.BEFORE, 'gate.override', 'Manual override',
      early ? 'fail' : 'warn',
      early
        ? `LAUNCH_MODE=open is forcing the shop open ${launchDayLabel()} ahead of LAUNCH_DATE. `
          + 'Anyone can buy right now.'
        : `LAUNCH_MODE=${config.launch.mode} is overriding the date. Remember it is there.`,
      'Unset LAUNCH_MODE to let LAUNCH_DATE decide.');
  }

  // ── Phase 1: Discord, which must be working NOW ───────────────────────────
  const d = config.discord || {};
  const invite = !!d.inviteUrl;
  add(PHASE.BEFORE, 'discord.invite', 'Discord invite',
    okFail(invite),
    invite ? `Visitors can join: ${d.inviteUrl}` : 'No DISCORD_INVITE_URL — every "join us" link is dead.',
    invite ? null : 'Set DISCORD_INVITE_URL.');

  const botToken = !!d.botToken;
  const guild = !!d.guildId;
  add(PHASE.BEFORE, 'discord.bot', 'Discord bot',
    okFail(botToken && guild),
    botToken && guild
      ? 'Token and guild are set — tickets, reviews, proof of delivery and restock roles work.'
      : `Missing ${[!botToken && 'DISCORD_BOT_TOKEN', !guild && 'DISCORD_GUILD_ID'].filter(Boolean).join(' and ')}. `
        + 'Without it there is no community, no support tickets, no review flow and no restock pings — '
        + 'which is everything the shop is supposed to have running before it opens.',
    // Only when there is something to do. An "ok" line with an instruction
    // under it reads as a failure and teaches people to skim the list.
    botToken && guild ? null : 'Set them and start the bot (npm start in discord/).');

  /* The relay is what makes a webhook-less setup work, and it is the documented
     one. Worth reporting separately because "no webhook" looks like a failure
     and usually is not. */
  const relay = !!(d.orderWebhookUrl || d.stockWebhookUrl || botToken);
  add(PHASE.BEFORE, 'discord.delivery', 'Discord message delivery',
    okFail(relay),
    d.orderWebhookUrl || d.stockWebhookUrl
      ? 'Direct webhooks configured — proof of delivery and restock alerts post immediately.'
      : botToken
        ? 'No webhooks; events queue for the bot, which delivers them within a minute.'
        : 'Nothing can deliver a Discord message: no webhook and no bot.',
    relay ? null : 'Set DISCORD_ORDER_WEBHOOK_URL or run the bot.');

  // ── Phase 1: the website, which must be browsable and unbuyable ───────────
  add(PHASE.BEFORE, 'site.browsable', 'Website reachable',
    'ok',
    'The catalogue, product pages, Discord page and legal pages are public and ungated. '
    + 'Only buying and signing up wait for the day.');

  add(PHASE.BEFORE, 'site.cta', 'Purchase CTAs',
    state.prelaunch ? 'ok' : 'warn',
    state.prelaunch
      ? 'Add-to-cart and checkout render as "opens on launch day" while the gate is closed — '
        + 'the server refuses anyway, so this is courtesy rather than protection.'
      : 'CTAs are live because the gate is open.');

  // ── Phase 2: what has to be true on the day ───────────────────────────────
  /* The connection string, and specifically whether it goes through Neon's
     pooler. Every serverless instance opens its own pg.Pool — small, five
     connections — and launch traffic means many instances at once. Against a
     DIRECT Neon endpoint that is instances × 5 real Postgres connections
     against a plan that caps them, and the failure mode is not slowness, it is
     the shop being down at exactly the moment it is busiest. The pooled
     endpoint multiplexes them, and the only difference in the URL is
     "-pooler" in the host. */
  {
    const url = config.db.url || '';
    const neon = /\.neon\.tech/i.test(url);
    const pooled = /-pooler\./i.test(url);
    if (neon && !pooled) {
      add(PHASE.DAY, 'dbpool', 'Database connections', 'fail',
        'DATABASE_URL points at a Neon DIRECT endpoint. Every serverless instance opens its '
        + 'own connections, so launch traffic can exhaust the plan\'s limit — which reads as '
        + 'the shop being down, not as it being slow.',
        'Use the pooled connection string (the host contains "-pooler").');
    } else if (neon) {
      add(PHASE.DAY, 'dbpool', 'Database connections', 'ok',
        'Pooled Neon endpoint — connections are multiplexed across instances.');
    }
  }

  if (config.payments.demoMode) {
    add(PHASE.DAY, 'pay', 'Payment', 'fail',
      'DEMO_PAYMENTS is on: orders are marked paid without money arriving.',
      'Set DEMO_PAYMENTS=false.');
  } else if (mollieEnabled()) {
    const test = /^test_/.test(config.payments.mollie.apiKey || '');
    add(PHASE.DAY, 'pay', 'Payment', test ? 'fail' : 'ok',
      test ? 'MOLLIE_API_KEY is a test key — buyers reach the sandbox and no money moves.'
        : 'Mollie live key configured.',
      test ? 'Swap in the live key.' : null);
  } else {
    add(PHASE.DAY, 'pay', 'Payment', manualPayMethods().length ? 'warn' : 'fail',
      manualPayMethods().length
        ? 'Manual payment only — every order waits for a person to confirm a bank app.'
        : 'No way to pay at all.',
      'Set MOLLIE_API_KEY for automatic iDEAL.');
  }

  const stocked = Number((await get(
    `SELECT COUNT(DISTINCT product_id) AS n FROM product_codes WHERE status='available'`)
    .catch(() => ({ n: 0 })))?.n || 0);
  const auto = Number((await get(
    `SELECT COUNT(*) AS n FROM products WHERE active=1`).catch(() => ({ n: 0 })))?.n || 0);
  add(PHASE.DAY, 'fulfil', 'Fulfilment', stocked ? 'ok' : 'fail',
    stocked
      ? `${stocked} of ${auto} active product(s) have codes on the shelf.`
      : `No product has a single code loaded. All ${auto} active products would need delivering `
        + 'by hand from the first minute.',
    stocked ? null : 'Load codes: admin → Products → Codes.');

  const mailer = !!(config.email.resendApiKey || config.email.smtpUrl);
  const sharedSender = config.email.fromAddress === 'onboarding@resend.dev';
  add(PHASE.DAY, 'email', 'Email', mailer && !sharedSender ? 'ok' : 'fail',
    !mailer ? 'No RESEND_API_KEY or SMTP_URL — codes are written to a table and never sent.'
      : sharedSender
        ? 'EMAIL_FROM_ADDRESS is Resend\'s shared sender, which only delivers to your own inbox. '
          + 'Customers would receive nothing.'
        : `Sending as ${config.email.fromAddress}.`,
    mailer && !sharedSender ? null : 'Verify your domain with Resend and set EMAIL_FROM_ADDRESS.');

  const channels = configuredChannels();
  let undelivered = 0;
  try {
    undelivered = Number((await get(
      `SELECT COUNT(*) AS n FROM owner_alerts WHERE status IN ('pending','failed')`))?.n || 0);
  } catch { /* not migrated yet */ }
  add(PHASE.DAY, 'alerts', 'Owner alerts',
    channels.length ? (undelivered ? 'warn' : 'ok') : 'fail',
    !channels.length
      ? `Nothing is configured, so all ${Object.keys(ALERT_EVENTS).length} alerts — including a `
        + 'chargeback and a failed fulfilment — go nowhere.'
      : undelivered
        ? `${channels.join(' + ')} configured, but ${undelivered} alert(s) never got through.`
        : `${channels.join(' + ')} — ${Object.keys(ALERT_EVENTS).length} events.`,
    channels.length ? null : 'Set NOTIFY_DISCORD_WEBHOOK_URL, or Telegram, or Pushover.');

  /* Ads point at tagged links, and a tagged link to a shop that refuses to sell
     spends money to show somebody a countdown. Only a problem on the day. */
  add(PHASE.DAY, 'ads', 'Advertising links',
    state.prelaunch ? 'warn' : 'ok',
    state.prelaunch
      ? 'The gate is closed, so any advert running now sends paid clicks to a page that cannot sell. '
        + 'Discord invite links are unaffected and should keep running.'
      : 'The shop sells, so tagged ad links convert.',
    state.prelaunch ? 'Keep paid ads off until the gate opens; the ad workflow is ready either way.' : null);

  const blocking = (phase) => items.filter((i) => i.phase === phase && i.status === 'fail');
  return {
    prelaunch: state.prelaunch,
    reason: state.reason,
    launchAt: at,
    items,
    before: { blocking: blocking(PHASE.BEFORE).length },
    day: { blocking: blocking(PHASE.DAY).length },
    /* Named for what it means. "Ready" would be a verdict; this is a count of
       things this process could check and found wrong. */
    blockingNow: blocking(PHASE.BEFORE).length,
    blockingOnTheDay: blocking(PHASE.DAY).length,
  };
}
