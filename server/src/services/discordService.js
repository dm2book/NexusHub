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

let cache = { at: 0, data: null };
const TTL_MS = 60_000;

export async function getServerInfo() {
  const base = {
    configured: !!config.discord.guildId,
    name: config.discord.serverName,
    tagline: config.discord.tagline,
    inviteUrl: config.discord.inviteUrl || null,
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
  if (!url) return;
  const title = {
    received: '🧾 New order received',
    completed: '✅ Order completed',
    refunded: '↩️ Order refunded',
  }[event] || 'Order update';

  const embed = {
    title,
    color: COLORS[event] || 0x6366f1,
    fields: [
      { name: 'Order', value: `\`${order.number}\``, inline: true },
      { name: 'Total', value: order.totalFormatted || String(order.total), inline: true },
      { name: 'Items', value: String(order.items?.length ?? '—'), inline: true },
    ],
    footer: { text: config.email.fromName },
    timestamp: new Date().toISOString(),
  };

  await postWebhook(url, { embeds: [embed] });
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
  if (!url) return;
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

  embed.footer = { text: `${config.email.fromName} · drops & deals` };
  embed.timestamp = new Date().toISOString();
  await postWebhook(url, { embeds: [embed] });
}

/** Ping staff that a product's pre-loaded code stock is running low. */
export async function postStockAlert(product, remaining) {
  const url = config.discord.stockWebhookUrl || config.discord.orderWebhookUrl;
  if (!url) return;
  const embed = {
    title: remaining === 0 ? `🔴 OUT OF STOCK: ${product.name}` : `🟠 Low stock: ${product.name}`,
    description: `**${remaining}** code${remaining === 1 ? '' : 's'} left` +
      ` (threshold ${config.discord.lowStockThreshold}).\n` +
      `Top up in the admin panel → Products → Codes.`,
    color: remaining === 0 ? 0xef4444 : 0xf59e0b,
    footer: { text: `${config.email.fromName} · stock monitor` },
    timestamp: new Date().toISOString(),
  };
  await postWebhook(url, { embeds: [embed] });
}
