/**
 * Discord integration.
 *
 * - getServerInfo(): live community stats via Discord's public widget.json
 *   (no bot/token needed; the server just needs the Widget enabled). Cached
 *   briefly. Returns a graceful, always-renderable shape even when unconfigured.
 * - postOrderEvent(): posts a branded embed to an ops/sales channel webhook
 *   when an order is placed/completed/refunded. Best-effort; never throws.
 * - postDropEvent(): announces new products / restocks / coupons / bundles in
 *   the community #drops-and-deals channel (DISCORD_DROPS_WEBHOOK_URL).
 * - postStockAlert(): pings staff when a product's code stock runs low
 *   (DISCORD_STOCK_WEBHOOK_URL, falls back to the order webhook).
 */
import { config } from '../config/env.js';
import { run, get, all, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';

let cache = { at: 0, data: null };
const TTL_MS = 60_000;

// ── Relay outbox ─────────────────────────────────────────────────────────────
// No webhook/bot token on the server? Queue the event; the community bot polls
// the signed /api/discord/outbox endpoint and posts it — so Discord automation
// works with ZERO Discord secrets in the hosting environment.

async function enqueueOutbox(channel, body) {
  try {
    await run(
      `INSERT INTO discord_outbox (id, kind, payload, created_at) VALUES (@id, @k, @p, @at)`,
      { id: newId('dox'), k: channel, p: JSON.stringify(body), at: nowIso() });
    return true;
  } catch (err) {
    console.error('[discord] outbox enqueue failed:', err.message);
    return false;
  }
}

/** Direct webhook when configured, otherwise queue for the bot relay. */
async function deliver(channel, url, body) {
  if (url) return postWebhook(url, body);
  return enqueueOutbox(channel, body);
}

/** Queue a DM for the bot relay (used when no bot token on the server). */
export async function relayDm(discordUserId, body) {
  return enqueueOutbox('dm', { discordUserId, ...body });
}

/** Bot relay: claim pending events (marks them delivered) + housekeeping. */
export async function claimOutbox(limit = 20) {
  const rows = await all(
    `SELECT id, kind, payload FROM discord_outbox
      WHERE delivered_at IS NULL ORDER BY created_at ASC LIMIT @l`, { l: limit });
  if (rows.length) {
    await run(`UPDATE discord_outbox SET delivered_at=@at WHERE id = ANY(@ids)`,
      { at: nowIso(), ids: rows.map((r) => r.id) });
  }
  // Housekeeping: delivered events older than 14 days can go.
  run(`DELETE FROM discord_outbox WHERE delivered_at IS NOT NULL AND delivered_at < @old`,
    { old: new Date(Date.now() - 14 * 864e5).toISOString() }).catch(() => {});
  return rows.map((r) => {
    try { return { id: r.id, channel: r.kind, body: JSON.parse(r.payload) }; }
    catch { return null; }
  }).filter(Boolean);
}

/** Stamp/read when the bot last polled — powers the launch-check status. */
export async function stampBotSeen() {
  const at = nowIso();
  await run(`INSERT INTO kv (key, value, updated_at) VALUES ('discord_bot_seen_at', @v, @v)
             ON CONFLICT (key) DO UPDATE SET value=@v, updated_at=@v`, { v: at }).catch(() => {});
}
export async function botSeenRecently(hours = 24) {
  try {
    const r = await get(`SELECT value FROM kv WHERE key='discord_bot_seen_at'`);
    return !!r && Date.now() - Date.parse(r.value) < hours * 3_600_000;
  } catch { return false; }
}

// ── Live invite link ─────────────────────────────────────────────────────────
// Discord invites created with default settings expire after 7 days — a dead
// invite on the storefront silently kills community sign-ups. The bot creates a
// PERMANENT invite (maxAge 0) on boot and pushes it here; everything that shows
// an invite reads this live value first, then falls back to the env-configured
// link.
export async function setLiveInviteUrl(url) {
  await run(`INSERT INTO kv (key, value, updated_at) VALUES ('discord_invite_url', @v, @at)
             ON CONFLICT (key) DO UPDATE SET value=@v, updated_at=@at`,
    { v: url, at: new Date().toISOString() });
}
export async function getLiveInviteUrl() {
  try {
    const r = await get(`SELECT value FROM kv WHERE key='discord_invite_url'`);
    return r?.value || config.discord.inviteUrl || null;
  } catch { return config.discord.inviteUrl || null; }
}

export async function getServerInfo() {
  const base = {
    configured: !!config.discord.guildId,
    name: config.discord.serverName,
    // Only send a tagline the owner actually wrote. Handing the built-in
    // English default to the storefront left a Dutch page with one English
    // line in it — the storefront has a translated fallback and can use it
    // whenever there is nothing custom to show.
    tagline: process.env.DISCORD_TAGLINE ? config.discord.tagline : null,
    // Bot-maintained permanent invite first; env-configured link as fallback.
    inviteUrl: await getLiveInviteUrl(),
    online: null,
    memberPreview: [],
  };

  if (!config.discord.guildId) return base;
  if (cache.data && Date.now() - cache.at < TTL_MS) return cache.data;

  try {
    const res = await fetch(`https://discord.com/api/guilds/${config.discord.guildId}/widget.json`);
    if (!res.ok) throw new Error(`widget ${res.status}`);
    const w = await res.json();
    const data = {
      ...base,
      name: w.name || base.name,
      online: w.presence_count ?? null,
      inviteUrl: base.inviteUrl || w.instant_invite || null,
      memberPreview: (w.members || []).slice(0, 12).map((m) => ({
        name: m.username, avatar: m.avatar_url, status: m.status,
      })),
    };
    cache = { at: Date.now(), data };
    return data;
  } catch {
    // Widget disabled or unreachable — return static info, don't error the page.
    return base;
  }
}

const COLORS = { received: 0x6366f1, completed: 0x10b981, refunded: 0xec4899 };

/** Post an order event embed to the configured Discord webhook (best-effort). */
export async function postOrderEvent(order, event = 'received') {
  const url = config.discord.orderWebhookUrl;
  const title = {
    received: '🧾 New order received',
    completed: '✅ Order completed',
    refunded: '↩️ Order refunded',
  }[event] || 'Order update';

  const embed = {
    title,
    color: COLORS[event] || 0x6366f1,
    thumbnail: { url: `${config.appUrl}/icon-512.png` },
    fields: [
      { name: 'Order', value: `\`${order.number}\``, inline: true },
      { name: 'Total', value: order.totalFormatted || String(order.total), inline: true },
      { name: 'Items', value: String(order.items?.length ?? '—'), inline: true },
    ],
    footer: { text: config.email.fromName },
    timestamp: new Date().toISOString(),
  };

  await deliver('leads', url, { embeds: [embed] });
}

/**
 * Ping staff the moment a customer submits payment proof — manual (Tikkie/
 * PayPal) orders deliver only as fast as the owner confirms them, so an instant
 * heads-up in the staff channel is the difference between minutes and hours.
 * Best-effort: a Discord hiccup never blocks the proof submission.
 */
export async function postPaymentProofAlert(order, proof = {}) {
  const flags = Array.isArray(proof.flags) ? proof.flags : [];
  const embed = {
    title: '💸 Payment proof submitted — verify now',
    color: flags.length ? 0xf59e0b : 0x10b981, // amber when fraud flags, green otherwise
    fields: [
      { name: 'Order', value: `\`${order.number}\``, inline: true },
      { name: 'Amount', value: money(order.total, order.currency), inline: true },
      { name: 'Method', value: proof.method || 'manual', inline: true },
      ...(proof.transactionId ? [{ name: 'Transaction ID', value: `\`${String(proof.transactionId).slice(0, 100)}\`` }] : []),
      ...(flags.length ? [{ name: '⚠️ Flags', value: flags.join(', ') }] : []),
      { name: 'Review', value: `${config.appUrl}/admin/payments` },
    ],
    footer: { text: config.email.fromName },
    timestamp: new Date().toISOString(),
  };
  await deliver('leads', config.discord.orderWebhookUrl, { embeds: [embed] });
}

/** Fire a webhook payload; best-effort, logs and swallows every failure. */
async function postWebhook(url, payload) {
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: config.email.fromName, ...payload }),
    });
    if (!res.ok) throw new Error(`webhook ${res.status}`);
    return true;
  } catch (err) {
    console.error('[discord] webhook failed:', err.message);
    return false;
  }
}

const money = (cents, cur = 'EUR') =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: cur }).format((cents || 0) / 100);

/**
 * Announce a storefront event in the community #drops-and-deals channel.
 * kind: 'product' | 'restock' | 'coupon' | 'bundle'. Best-effort.
 */
export async function postDropEvent(kind, data = {}) {
  const url = config.discord.dropsWebhookUrl;
  const shop = `${config.appUrl}/shop`;
  let embed;
  if (kind === 'product') {
    embed = {
      title: `🆕 New drop: ${data.name}`,
      description: `Fresh in the shop — **${money(data.price, data.currency)}**, instant delivery.\n[Grab it now](${config.appUrl}/product/${data.id})`,
      color: 0x6366f1,
    };
  } else if (kind === 'restock') {
    embed = {
      title: `📦 Restocked: ${data.name}`,
      description: `**${data.added}** new codes just landed${data.price ? ` — ${money(data.price, data.currency)}` : ''}.\n[Shop before it's gone](${config.appUrl}/product/${data.id})`,
      color: 0x10b981,
    };
  } else if (kind === 'coupon') {
    const off = data.kind === 'fixed' ? money(data.value, 'EUR') : `${data.value}%`;
    embed = {
      title: `🏷️ New discount code: ${data.code}`,
      description: `Use code **\`${data.code}\`** for **${off} OFF** at checkout.` +
        (data.minSubtotal ? `\nMinimum spend ${money(data.minSubtotal, 'EUR')}.` : '') +
        (data.expiresAt ? `\nValid until <t:${Math.floor(new Date(data.expiresAt).getTime() / 1000)}:D>.` : '') +
        `\n[Start shopping](${shop})`,
      color: 0xec4899,
    };
  } else if (kind === 'bundle') {
    embed = {
      title: `🎁 New bundle: ${data.name}`,
      description: `${data.description || 'Buy them together and save.'}\n**${data.discountPercent}% OFF** when bought together.\n[View bundles](${shop})`,
      color: 0xa855f7,
    };
  } else return;

  // Product announcements show the product's own art when available; every
  // drop gets the brand banner so the channel looks consistently premium.
  const banner = { product: 'products', restock: 'products', coupon: 'deals', bundle: 'deals' }[kind];
  embed.image = { url: `${config.appUrl}/discord/banner-${banner}.png` };
  embed.thumbnail = { url: (kind === 'product' && data.image) ? data.image : `${config.appUrl}/icon-512.png` };
  embed.footer = { text: `${config.email.fromName} · drops & deals` };
  embed.timestamp = new Date().toISOString();
  await deliver('deals', url, { embeds: [embed] });
}

/**
 * Mirror a new customer review into the community.
 *
 * #reviews has always told members that verified reviews "are posted here
 * automatically after real orders" — but nothing ever wrote to it, so the one
 * channel that answers "has anyone actually received their order?" sat empty
 * while the panel above it claimed otherwise. This makes the promise true.
 *
 * Only reviews tied to a real order carry the verified badge; a Discord vouch
 * is mirrored as an ordinary community review, never as a verified one.
 */
export async function postReviewEvent({ author, stars, body, product, verified = false, city } = {}) {
  const text = String(body || '').trim();
  if (!text) return;
  const s = Math.min(5, Math.max(1, Number(stars) || 5));
  const embed = {
    author: { name: String(author || 'Customer').slice(0, 80) },
    description: `${'⭐'.repeat(s)}${s < 5 ? '☆'.repeat(5 - s) : ''}\n\n${text.slice(0, 900)}`,
    color: verified ? 0x22c55e : 0x6366f1,
    fields: [
      ...(product ? [{ name: 'Product', value: String(product).slice(0, 100), inline: true }] : []),
      ...(city ? [{ name: 'From', value: String(city).slice(0, 60), inline: true }] : []),
    ],
    footer: {
      text: verified
        ? `${config.email.fromName} · verified purchase`
        : `${config.email.fromName} · community vouch`,
    },
    timestamp: new Date().toISOString(),
  };
  await deliver('reviews', config.discord.reviewsWebhookUrl, { embeds: [embed] });
}

/**
 * Alert staff when the API throws an unhandled 500. Throttled to one alert per
 * route per 5 minutes so an error storm can't flood the channel. Best-effort.
 */
const errorAlertAt = new Map(); // route -> last alert ts
export async function postErrorAlert(route, message) {
  const url = config.discord.stockWebhookUrl || config.discord.orderWebhookUrl;
  const now = Date.now();
  if (now - (errorAlertAt.get(route) || 0) < 5 * 60_000) return;
  errorAlertAt.set(route, now);
  await deliver('leads', url, { embeds: [{
    title: '🚨 API error (500)',
    description: `**Route:** \`${route}\`\n**Error:** ${String(message || 'unknown').slice(0, 300)}\n\nCheck the Vercel function logs for the stack trace.`,
    color: 0xef4444,
    footer: { text: `${config.email.fromName} · error monitor` },
    timestamp: new Date().toISOString(),
  }] });
}

/** Ping staff that a product's pre-loaded code stock is running low. */
export async function postStockAlert(product, remaining) {
  const url = config.discord.stockWebhookUrl || config.discord.orderWebhookUrl;
  const embed = {
    title: remaining === 0 ? `🔴 OUT OF STOCK: ${product.name}` : `🟠 Low stock: ${product.name}`,
    description: `**${remaining}** code${remaining === 1 ? '' : 's'} left` +
      ` (threshold ${config.discord.lowStockThreshold}).\n` +
      `Top up in the admin panel → Products → Codes.`,
    color: remaining === 0 ? 0xef4444 : 0xf59e0b,
    footer: { text: `${config.email.fromName} · stock monitor` },
    timestamp: new Date().toISOString(),
  };
  await deliver('leads', url, { embeds: [embed] });
}
