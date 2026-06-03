/**
 * Discord integration.
 *
 * - getServerInfo(): live community stats via Discord's public widget.json
 *   (no bot/token needed; the server just needs the Widget enabled). Cached
 *   briefly. Returns a graceful, always-renderable shape even when unconfigured.
 * - postOrderEvent(): posts a branded embed to an ops/sales channel webhook
 *   when an order is placed/completed/refunded. Best-effort; never throws.
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

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: config.email.fromName, embeds: [embed] }),
    });
  } catch (err) {
    console.error('[discord] webhook failed:', err.message);
  }
}
