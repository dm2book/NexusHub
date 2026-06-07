/**
 * Discord role automation for buyers.
 *
 * When an order is paid by a customer who signed in with Discord, grant them a
 * role in the community server based on spend:
 *   • total  < VIP threshold  → "Verified Customer" (normal customer)
 *   • total >= VIP threshold  → "VIP Customer"
 *
 * Uses the Discord REST API directly with the bot token, so no separate bot
 * process is required. Entirely best-effort: any failure is logged and swallowed
 * so it can never affect the order itself. Requires DISCORD_BOT_TOKEN +
 * DISCORD_GUILD_ID, the bot to outrank the target roles, and the buyer to be a
 * member of the server.
 */
import { config } from '../config/env.js';
import { get } from '../db/index.js';

const API = 'https://discord.com/api/v10';

async function discord(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bot ${config.discord.botToken}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Discord ${init.method || 'GET'} ${path} → ${res.status} ${await res.text().catch(() => '')}`);
  return res.status === 204 ? null : res.json();
}

let rolesCache = { at: 0, byName: {} };
async function getRoleId(guildId, name) {
  if (Date.now() - rolesCache.at > 60_000) {
    const roles = await discord(`/guilds/${guildId}/roles`);
    rolesCache = { at: Date.now(), byName: Object.fromEntries(roles.map((r) => [r.name, r.id])) };
  }
  return rolesCache.byName[name];
}

/** Find a user's linked Discord account id, if they signed in with Discord. */
async function discordUidForUser(userId) {
  if (!userId) return null;
  const row = await get(
    `SELECT provider_uid FROM oauth_accounts WHERE user_id = @uid AND provider = 'discord' LIMIT 1`,
    { uid: userId });
  return row?.provider_uid || null;
}

/**
 * Grant the right customer tier for a paid order. Safe to call on every paid
 * transition — Discord ignores adding a role the member already has.
 */
export async function grantTierForOrder(order) {
  try {
    const { botToken, guildId, vipThreshold } = config.discord;
    if (!botToken || !guildId || !order?.userId) return;

    const uid = await discordUidForUser(order.userId);
    if (!uid) return; // buyer didn't link Discord

    const tierName = (order.total || 0) >= vipThreshold ? 'VIP Customer' : 'Verified Customer';
    const roleId = await getRoleId(guildId, tierName);
    if (!roleId) return;

    await discord(`/guilds/${guildId}/members/${uid}/roles/${roleId}`, { method: 'PUT' });
    console.log(`[discord] granted "${tierName}" to ${uid} for order ${order.number}`);
  } catch (err) {
    console.error('[discord] role grant failed:', err.message);
  }
}
