/**
 * Owner notifications: one event, every configured channel, in parallel.
 *
 * This is the "something happened to my money" channel, not the customer's.
 * Five events reach it — a paid order, a failed payment, a refund, a chargeback
 * and low stock — and each one is a thing the owner would want to know about
 * before the customer asks.
 *
 * Three design decisions worth stating, because each was a real trade-off:
 *
 * **Parallel, not sequential.** Three channels awaited one after another means
 * the slowest ones stack. `Promise.allSettled` makes the cost max(channels)
 * instead of sum(channels), so adding a fourth channel later costs nothing in
 * latency.
 *
 * **Every call has a deadline.** The existing Discord helper has none: a webhook
 * endpoint that accepts the connection and then never answers would hold the
 * request open until the platform kills it. These calls sit inside the payment
 * webhook and the order transition, so a hung notifier would stall an ORDER.
 *
 * **Awaited, not fired and forgotten.** On a serverless platform the function
 * can be frozen the moment the response is sent, which kills anything still in
 * flight — the classic way "best effort" silently becomes "never". All five
 * call sites are server-to-server or background (a PSP webhook, an admin
 * action, post-dispense upkeep), so nobody is watching a spinner; correctness
 * is worth the few hundred milliseconds.
 *
 * Nothing here can throw. A notification failing must never be the reason an
 * order does not settle.
 */
import { config } from '../config/env.js';

/** One attempt gets this long before we stop waiting for it. */
const TIMEOUT_MS = 5_000;

/**
 * And a channel gets this long in total, retry included.
 *
 * Per-attempt timeouts stack: a 5xx at five seconds plus one retry at five more
 * is ten seconds spent inside a Mollie webhook, which has its own patience and
 * replays the call when it runs out. One budget for the whole channel means the
 * retry only happens if there is time for it, so the worst case is bounded by
 * this number rather than by attempts × timeout.
 */
const BUDGET_MS = 7_000;

/**
 * How loud each event is.
 *
 * Colour for Discord, priority for Pushover, sound for the phone. A chargeback
 * at 3am should behave differently from a restock reminder — otherwise the
 * owner silences the channel and then misses the one that mattered.
 */
export const EVENTS = {
  'order.paid':      { emoji: '💰', color: 0x10b981, priority: 0,  label: 'Paid order' },
  'payment.failed':  { emoji: '⚠️', color: 0xf59e0b, priority: 0,  label: 'Payment failed' },
  'order.refunded':  { emoji: '↩️', color: 0xec4899, priority: 0,  label: 'Refund' },
  'chargeback':      { emoji: '🚨', color: 0xef4444, priority: 1,  label: 'Chargeback' },
  /* Three rungs of the same ladder, deliberately not equally loud.

     "Ten left" is a note for whenever you next sit down. "Out of stock" means
     the shop is selling something nobody can deliver, and every hour it stays
     that way is orders that have to be filled by hand or refunded — so that one
     is allowed to make a phone ring at 3am, and the other two are not. An owner
     woken by a restock reminder mutes the channel and then misses this. */
  'stock.low':       { emoji: '📉', color: 0xf97316, priority: -1, label: 'Low stock' },
  'stock.critical':  { emoji: '🟠', color: 0xf59e0b, priority: 0,  label: 'Stock critical' },
  'stock.out':       { emoji: '🔴', color: 0xef4444, priority: 1,  label: 'Out of stock' },

  /* The four things that break quietly.

     Everything above is an event in the shop's own story — a sale, a refund, a
     shelf running out. These four are the shop failing to do its job, and they
     share a property that makes them worse than the ones above: nobody
     complains about them. A buyer whose payment failed tries again. A buyer
     whose fulfilment failed just waits, and the first anyone hears is a ticket
     hours later; a webhook Mollie could not deliver is money that arrived with
     no order to attach it to; an email that did not send is a code sitting in a
     database table nobody reads.

     All four are priority 1 except email, because a single bounced address is
     usually the address and not the mailer — it becomes loud through the storm
     rules instead, when it turns out to be all of them. */
  'fulfillment.failed': { emoji: '📦', color: 0xdc2626, priority: 1, label: 'Fulfilment failed' },
  'webhook.failed':     { emoji: '🔌', color: 0xdc2626, priority: 1, label: 'Payment webhook failed' },
  'email.failed':       { emoji: '📧', color: 0xf59e0b, priority: 0, label: 'Email delivery failed' },
  'system.error':       { emoji: '🚨', color: 0xef4444, priority: 1, label: 'System error' },

  /* Market intelligence. All of these are decisions to make, not fires to put
     out, so none of them is priority 1 — a pricing observation that wakes
     somebody at 3am is a pricing observation that gets the whole channel muted.
     They are deduplicated by canonical product and day, because the job that
     raises them runs on a schedule and would otherwise repeat itself forever. */
  'market.new_product':      { emoji: '🆕', color: 0x6366f1, priority: -1, label: 'New product on the market' },
  'market.price_moved':      { emoji: '📊', color: 0x0ea5e9, priority: 0,  label: 'Competitor price moved' },
  'market.uncompetitive':    { emoji: '🐢', color: 0xf59e0b, priority: 0,  label: 'We are uncompetitive' },
  'market.margin_low':       { emoji: '📉', color: 0xf97316, priority: 0,  label: 'Margin below target' },
  'market.unavailable':      { emoji: '🚫', color: 0x94a3b8, priority: -1, label: 'Product unavailable in market' },
  'market.suspicious_price': { emoji: '🧐', color: 0xef4444, priority: 0,  label: 'Suspicious price' },
  'market.stale':            { emoji: '🕰️', color: 0x94a3b8, priority: -1, label: 'Price evidence stale' },
};

/**
 * How many of one event may be sent before the rest are folded together.
 *
 * A storm is not a volume problem, it is an attention problem: thirty pages in
 * two minutes is thirty pages nobody reads, and the thirty-first — the one that
 * was different — arrives to a muted phone. So each event gets a small budget
 * per window, and past it the alerts are recorded and suppressed, with one
 * summary sent at the end saying how many there were.
 *
 * The budgets differ because the events do. Ten paid orders in five minutes is
 * a good day and every one of them is worth seeing. Ten system errors in five
 * minutes is one outage, and the tenth adds nothing the first did not.
 */
export const STORM = {
  windowMs: 5 * 60_000,
  perEvent: {
    'order.paid': 20,
    'payment.failed': 5,
    'order.refunded': 10,
    chargeback: 10,              // rare and expensive: almost never suppress
    'stock.low': 5,
    'stock.critical': 5,
    'stock.out': 10,
    'fulfillment.failed': 3,
    'webhook.failed': 3,
    'email.failed': 3,
    'system.error': 3,
    // Market events arrive in batches by nature — a discovery run finds twenty
    // new products at once — so the budgets are small and the summary does the
    // talking.
    'market.new_product': 5,
    'market.price_moved': 5,
    'market.uncompetitive': 5,
    'market.margin_low': 5,
    'market.unavailable': 5,
    'market.suspicious_price': 5,
    'market.stale': 3,
  },
  default: 5,
};

/**
 * Which Discord webhook the owner alerts would use, or '' when none is set.
 *
 * Exported so a caller that ALSO posts to Discord by another route can tell
 * whether the two would land in the same channel. The stock alert does exactly
 * that: it has its own staff webhook, and when that is unset it falls back to
 * the order webhook — which is the same place these alerts go, so the owner got
 * every stock warning twice in one channel.
 */
export function discordTarget() {
  return config.notify.discordWebhookUrl || config.discord.orderWebhookUrl || '';
}

/** fetch with a deadline, so one dead endpoint cannot hold an order open. */
async function timedFetch(url, init = {}, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One retry, and only for the failures a retry can actually fix.
 *
 * A 4xx means the message or the credentials are wrong and will be wrong again;
 * retrying it just doubles the load. A network blip or a 5xx is worth one more
 * go. Telegram answers 429 with the seconds to wait, so that one is honoured
 * rather than guessed at — but only while the budget above still allows it.
 */
async function sendOnce(name, fn) {
  const deadline = Date.now() + BUDGET_MS;
  const left = () => deadline - Date.now();
  // Below this there is no point starting anything: the request would be
  // aborted before an answer could arrive, and the abort itself costs time.
  const worthRetrying = () => left() > 500;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fn(Math.min(TIMEOUT_MS, left()));
      if (res.ok) return true;
      if (res.status === 429) {
        const wait = (Number(res.headers.get('retry-after')) || 1) * 1000;
        if (attempt === 1 && wait + 500 < left()) {
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
      }
      if (res.status >= 500 && attempt === 1 && worthRetrying()) continue;
      console.error(`[notify] ${name} refused: ${res.status}`);
      return false;
    } catch (err) {
      // An abort means the time is already spent; retrying spends it twice.
      if (attempt === 1 && err.name !== 'AbortError' && worthRetrying()) continue;
      console.error(`[notify] ${name} failed: ${err.message}`);
      return false;
    }
  }
  return false;
}

// ── Channels ────────────────────────────────────────────────────────────────
// Each returns null when it is not configured, so an owner who only wants
// Telegram is not paying for the other two.

function discord(event, { title, lines, url }) {
  const hook = config.notify.discordWebhookUrl || config.discord.orderWebhookUrl;
  if (!hook) return null;
  const meta = EVENTS[event];
  return sendOnce('discord', (ms) => timedFetch(hook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: config.email.fromName,
      embeds: [{
        title: `${meta.emoji} ${title}`,
        description: lines.join('\n'),
        color: meta.color,
        url: url || undefined,
        timestamp: new Date().toISOString(),
      }],
    }),
  }, ms));
}

/** Telegram renders a subset of HTML; anything from an order has to be escaped. */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function telegram(event, { title, lines, url }) {
  const { botToken, chatId } = config.notify.telegram;
  if (!botToken || !chatId) return null;
  const meta = EVENTS[event];
  const body = [`${meta.emoji} <b>${esc(title)}</b>`, '', ...lines.map(esc)];
  if (url) body.push('', url);
  return sendOnce('telegram', (ms) => timedFetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: body.join('\n'),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      // Low stock is a note, not an interruption.
      disable_notification: meta.priority < 0,
    }),
  }, ms));
}

function pushover(event, { title, lines, url }) {
  const { token, user } = config.notify.pushover;
  if (!token || !user) return null;
  const meta = EVENTS[event];
  const form = new URLSearchParams({
    token, user,
    title: `${meta.emoji} ${title}`,
    message: lines.join('\n'),
    priority: String(meta.priority),
  });
  if (url) { form.set('url', url); form.set('url_title', 'Open in the shop'); }
  return sendOnce('pushover', (ms) => timedFetch('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  }, ms));
}

/**
 * Send one event to every configured channel.
 *
 * @param {keyof EVENTS} event
 * @param {{title: string, lines: string[], url?: string}} message
 * @returns {Promise<{sent: string[], failed: string[], configured: number}>}
 */
export async function notifyOwner(event, message) {
  if (!EVENTS[event]) {
    console.error(`[notify] unknown event "${event}"`);
    return { sent: [], failed: [], configured: 0 };
  }
  const channels = { discord, telegram, pushover };
  const started = Object.entries(channels)
    .map(([name, fn]) => {
      let p = null;
      try { p = fn(event, message); } catch (err) { console.error(`[notify] ${name}:`, err.message); }
      return p ? { name, p } : null;
    })
    .filter(Boolean);

  if (!started.length) return { sent: [], failed: [], configured: 0 };

  const results = await Promise.allSettled(started.map((c) => c.p));
  const sent = [], failed = [];
  results.forEach((r, i) => {
    (r.status === 'fulfilled' && r.value ? sent : failed).push(started[i].name);
  });
  if (failed.length) console.error(`[notify] ${event}: ${sent.length} sent, failed on ${failed.join(', ')}`);
  return { sent, failed, configured: started.length };
}

// ── The durable layer ───────────────────────────────────────────────────────
//
// Everything above is the sending. This is the remembering, and it is what
// turns three best-effort HTTP calls into something an owner can rely on.

/**
 * Record, deduplicate, rate-limit, send, and remember the outcome.
 *
 * This is the entry point every call site should use. `notifyOwner` still
 * exists and still only sends — it is what the retry sweep calls once a row
 * already exists, and using it directly means an alert nobody will ever miss
 * the absence of.
 *
 * @param {keyof EVENTS} event
 * @param {{title: string, lines: string[], url?: string, key?: string}} message
 *   `key` identifies the real-world occurrence. Two calls with the same key are
 *   the same event, however far apart the code paths are: a chargeback observed
 *   by both the webhook and the nightly reconciliation should page once. When
 *   it is omitted the title is used, which deduplicates the common accidents
 *   and nothing else.
 * @returns {Promise<{status: 'sent'|'failed'|'duplicate'|'suppressed'|'unrecorded', id?: string}>}
 */
export async function alertOwner(event, message) {
  const meta = EVENTS[event];
  if (!meta) {
    console.error(`[notify] unknown event "${event}"`);
    return { status: 'failed' };
  }

  /* Everything below is wrapped, and the catch does NOT rethrow.

     This runs inside order transitions and payment webhooks. A missing table, a
     database that has just gone away, a constraint nobody anticipated — none of
     them may be the reason a paid order fails to settle. When the bookkeeping
     is unavailable the alert is still SENT, just not remembered: losing the
     audit trail is bad, losing the page is worse. */
  let db;
  try {
    db = await import('../db/index.js');
  } catch {
    const r = await notifyOwner(event, message);
    return { status: r.sent.length ? 'sent' : 'failed' };
  }

  const { run, get, all, nowIso } = db;
  const key = `${event}:${message.key || message.title}`.slice(0, 300);
  const id = (await import('../utils/ids.js')).newId('oal');
  const at = nowIso();

  try {
    /* The dedup guarantee, and the only correct place for it.
       ON CONFLICT DO NOTHING plus a rowcount check: two workers racing on the
       same event both insert, exactly one row survives, and the loser learns it
       lost from the database rather than from a SELECT it ran a moment earlier. */
    const ins = await run(
      `INSERT INTO owner_alerts
         (id, event, dedupe_key, priority, title, lines, url, status, next_try_at, created_at, updated_at)
       VALUES (@id, @ev, @key, @pri, @title, @lines, @url, 'pending', @at, @at, @at)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      { id, ev: event, key, pri: meta.priority, title: String(message.title || meta.label),
        lines: JSON.stringify(message.lines || []), url: message.url || null, at });
    // `changes`, not `rowCount` — db/index.js normalises the driver's shape, and
    // reading the wrong field would have made every alert look like a duplicate
    // and sent nothing at all.
    if (!ins?.changes) return { status: 'duplicate' };
  } catch (e) {
    // Bookkeeping unavailable. Send anyway; see above.
    console.error('[notify] could not record alert:', e.message);
    const r = await notifyOwner(event, message);
    return { status: r.sent.length ? 'sent' : 'unrecorded' };
  }

  // ── Storm control ─────────────────────────────────────────────────────────
  try {
    const budget = STORM.perEvent[event] ?? STORM.default;
    const since = new Date(Date.now() - STORM.windowMs).toISOString();
    const recent = Number((await get(
      `SELECT COUNT(*) AS n FROM owner_alerts
        WHERE event = @ev AND created_at > @since AND status IN ('sent','suppressed')`,
      { ev: event, since }))?.n || 0);

    if (recent >= budget) {
      /* Over budget. The alert is kept — it is in the table and readable in the
         admin panel — but it does not ring. One summary is sent when the window
         closes instead, by the sweep, so the owner learns "fourteen more of
         these" in a single line rather than fourteen times. */
      await run(`UPDATE owner_alerts SET status='suppressed', updated_at=@at WHERE id=@id`,
        { at: nowIso(), id });
      return { status: 'suppressed', id };
    }
  } catch (e) {
    // Cannot count: send rather than silently swallow.
    console.error('[notify] storm check failed:', e.message);
  }

  return deliverAlert({ id, event, message, run, get, all, nowIso });
}

/** Send one recorded alert and write down what happened. */
async function deliverAlert({ id, event, message, run, nowIso }) {
  const r = await notifyOwner(event, message);
  const ok = r.sent.length > 0;
  try {
    if (ok) {
      await run(
        `UPDATE owner_alerts SET status='sent', attempts=attempts+1, channels=@ch,
                last_error=NULL, next_try_at=NULL, updated_at=@at WHERE id=@id`,
        { ch: JSON.stringify(r.sent), at: nowIso(), id });
    } else if (r.configured === 0) {
      /* No channels at all. Not a failure to retry — retrying an unconfigured
         shop forever fills the table with rows that can never succeed. The row
         stays as the record that something happened and nobody was told. */
      await run(
        `UPDATE owner_alerts SET status='failed', last_error='no channels configured',
                next_try_at=NULL, updated_at=@at WHERE id=@id`, { at: nowIso(), id });
    } else {
      await run(
        `UPDATE owner_alerts SET attempts=attempts+1, last_error=@err,
                next_try_at=@next, updated_at=@at WHERE id=@id`,
        { err: `no channel accepted it (${r.failed.join(', ')})`.slice(0, 300),
          next: backoff(1), at: nowIso(), id });
    }
  } catch (e) { console.error('[notify] could not record outcome:', e.message); }
  return { status: ok ? 'sent' : 'failed', id };
}

/**
 * When to try again.
 *
 * Doubling from a minute, capped at an hour. The cap matters more than the
 * curve: an alert that has failed six times is probably failing because the
 * webhook was deleted, and an hourly retry is a reminder to fix it rather than
 * a queue that quietly gives up.
 */
const backoff = (attempts) =>
  new Date(Date.now() + Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000).toISOString();

/** Alerts are given up on after this many attempts. */
export const MAX_ATTEMPTS = 6;

/**
 * Retry what did not get through, and close out any storm windows.
 *
 * Called by the maintenance sweep. Two jobs in one pass because they share the
 * same table and the same "what happened while nobody was looking" question.
 */
export async function sweepAlerts({ limit = 20 } = {}) {
  const { run, get, all, nowIso } = await import('../db/index.js');
  const out = { retried: 0, delivered: 0, givenUp: 0, summarised: 0 };

  const due = await all(
    `SELECT * FROM owner_alerts
      WHERE status = 'pending' AND (next_try_at IS NULL OR next_try_at <= @now)
      ORDER BY priority DESC, created_at ASC LIMIT @limit`,
    { now: nowIso(), limit });

  for (const row of due) {
    if (row.attempts >= MAX_ATTEMPTS) {
      await run(`UPDATE owner_alerts SET status='failed', updated_at=@at WHERE id=@id`,
        { at: nowIso(), id: row.id });
      out.givenUp++;
      continue;
    }
    out.retried++;
    let lines = [];
    try { lines = JSON.parse(row.lines || '[]'); } catch { /* keep it sendable */ }
    const r = await notifyOwner(row.event, { title: row.title, lines, url: row.url || undefined });
    if (r.sent.length) {
      await run(
        `UPDATE owner_alerts SET status='sent', attempts=attempts+1, channels=@ch,
                last_error=NULL, next_try_at=NULL, updated_at=@at WHERE id=@id`,
        { ch: JSON.stringify(r.sent), at: nowIso(), id: row.id });
      out.delivered++;
    } else {
      await run(
        `UPDATE owner_alerts SET attempts=attempts+1, last_error=@err, next_try_at=@next,
                updated_at=@at WHERE id=@id`,
        { err: `retry failed (${r.failed.join(', ') || 'no channels'})`.slice(0, 300),
          next: backoff(row.attempts + 1), at: nowIso(), id: row.id });
    }
  }

  /* Close out storms. Anything suppressed and now outside its window is
     summarised in one line per event type — the owner is told the count and
     where to read the detail, which is the whole point of suppressing them. */
  const cutoff = new Date(Date.now() - STORM.windowMs).toISOString();
  const storms = await all(
    `SELECT event, COUNT(*) AS n, MIN(created_at) AS first, MAX(created_at) AS last
       FROM owner_alerts WHERE status = 'suppressed' AND created_at <= @cutoff
      GROUP BY event`, { cutoff });
  for (const st of storms) {
    const meta = EVENTS[st.event] || { label: st.event };
    const n = Number(st.n);
    await notifyOwner(st.event, {
      title: `${n} more ${meta.label.toLowerCase()} alert${n === 1 ? '' : 's'} were held back`,
      lines: [
        `${n} further ${st.event} alert${n === 1 ? '' : 's'} arrived in a short burst and were not sent individually.`,
        `First ${String(st.first).slice(0, 19)}Z, last ${String(st.last).slice(0, 19)}Z.`,
        // Names what exists. An earlier draft pointed at an admin page that was
        // never built, which is the same class of mistake this whole file is
        // about: an alert that tells you where to look and is wrong.
        'All of them are recorded — GET /api/admin/alerts lists them.',
      ],
    });
    await run(`UPDATE owner_alerts SET status='summarised', updated_at=@at
                WHERE status='suppressed' AND event=@ev AND created_at <= @cutoff`,
      { at: nowIso(), ev: st.event, cutoff });
    out.summarised += n;
  }

  return out;
}

/** Drop alerts past the retention window. */
export async function pruneAlerts({ days = 30 } = {}) {
  const { run, get, nowIso } = await import('../db/index.js');
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const n = Number((await get('SELECT COUNT(*) AS n FROM owner_alerts WHERE created_at <= @c',
    { c: cutoff }))?.n || 0);
  await run('DELETE FROM owner_alerts WHERE created_at <= @c', { c: cutoff });
  return n;
}

/** Which channels are wired up — used by the launch dashboard. */
export function configuredChannels() {
  const out = [];
  if (config.notify.discordWebhookUrl || config.discord.orderWebhookUrl) out.push('Discord');
  if (config.notify.telegram.botToken && config.notify.telegram.chatId) out.push('Telegram');
  if (config.notify.pushover.token && config.notify.pushover.user) out.push('Pushover');
  return out;
}
