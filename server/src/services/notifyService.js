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

/** Which channels are wired up — used by the launch dashboard. */
export function configuredChannels() {
  const out = [];
  if (config.notify.discordWebhookUrl || config.discord.orderWebhookUrl) out.push('Discord');
  if (config.notify.telegram.botToken && config.notify.telegram.chatId) out.push('Telegram');
  if (config.notify.pushover.token && config.notify.pushover.user) out.push('Pushover');
  return out;
}
