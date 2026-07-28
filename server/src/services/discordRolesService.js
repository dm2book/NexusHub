/**
 * Discord automation for buyers, driven straight from the API (bot token via
 * REST — no separate bot process required). All best-effort: any failure is
 * logged and swallowed so it can never affect the order itself.
 *
 * - grantTierForOrder(): "Verified Customer" / "VIP Customer" role on paid orders.
 * - syncLoyaltyRoles(): mirrors the site's loyalty tier (Bronze/Silver/Gold/
 *   Platinum) as Discord roles, removing outdated tier roles.
 * - sendDeliveryDm(): DMs Discord-linked buyers their delivered codes the moment
 *   an order completes, with a /vouch prompt (closed vouch loop).
 *
 * Requires DISCORD_BOT_TOKEN + DISCORD_GUILD_ID, the bot to outrank the target
 * roles, and the buyer to be a member of the server (DMs additionally require
 * the member to allow DMs from server members).
 */
import { config } from '../config/env.js';
import { get } from '../db/index.js';
import { TIERS, loyaltyFor } from './loyaltyService.js';
import { relayDm } from './discordService.js';

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

/**
 * Mirror the buyer's loyalty tier (Bronze/Silver/Gold/Platinum, derived from
 * lifetime paid spend) as a Discord role. Adds the current tier's role and
 * removes any other tier roles the member still carries, so exactly one is
 * active. Roles are matched by name; missing roles are skipped silently.
 */
export async function syncLoyaltyRoles(userId) {
  try {
    const { botToken, guildId } = config.discord;
    if (!botToken || !guildId || !userId) return;
    const uid = await discordUidForUser(userId);
    if (!uid) return;

    const { tierName } = await loyaltyFor(userId);
    const member = await discord(`/guilds/${guildId}/members/${uid}`).catch(() => null);
    if (!member) return; // not in the server

    const memberRoles = new Set(member.roles || []);
    for (const tier of TIERS) {
      const roleId = await getRoleId(guildId, tier.name);
      if (!roleId) continue;
      const shouldHave = tier.name === tierName;
      if (shouldHave && !memberRoles.has(roleId)) {
        await discord(`/guilds/${guildId}/members/${uid}/roles/${roleId}`, { method: 'PUT' });
        console.log(`[discord] loyalty role "${tier.name}" granted to ${uid}`);
      } else if (!shouldHave && memberRoles.has(roleId)) {
        await discord(`/guilds/${guildId}/members/${uid}/roles/${roleId}`, { method: 'DELETE' });
      }
    }
  } catch (err) {
    console.error('[discord] loyalty sync failed:', err.message);
  }
}

/** Open (or reuse) the DM channel with a Discord user and send a payload. */
async function dmUser(uid, payload) {
  const channel = await discord('/users/@me/channels', {
    method: 'POST', body: JSON.stringify({ recipient_id: uid }),
  });
  await discord(`/channels/${channel.id}/messages`, {
    method: 'POST', body: JSON.stringify(payload),
  });
}

/**
 * DM a Discord-linked buyer their delivered items the moment the order
 * completes — instant delivery where the customer already hangs out — and
 * close the loop with a /vouch prompt that feeds the on-site reviews.
 */
export async function sendDeliveryDm(order) {
  try {
    if (!order?.userId) return;
    const uid = await discordUidForUser(order.userId);
    if (!uid) return;

    const items = (order.items || [])
      .map((i) => `• **${i.name}** × ${i.quantity}`).join('\n') || '—';
    const codes = (order.deliveries || [])
      .filter((d) => d.content)
      .map((d) => `\`\`\`${String(d.content).slice(0, 100)}\`\`\``).join('') || '';

    const embed = {
      title: `🎁 Your order ${order.number} is delivered!`,
      thumbnail: { url: `${config.appUrl}/icon-512.png` },
      description:
        `Thanks for shopping with **${config.email.fromName}** — here are your items:\n\n${items}\n${codes}\n` +
        `📧 A copy is in your email. Keep your codes private and never share them in public channels.\n\n` +
        `💚 Happy with your order? Type **/vouch** in the server — it posts in #vouchers *and* on the website, and helps us a lot!` +
        // The one message a buyer reads while the order is still in their
        // hands. Links the form rather than the profile: this is an ask.
        (config.shop.trustpilotReviewUrl
          ? `\n⭐ A line on [Trustpilot](${config.shop.trustpilotReviewUrl}) helps even more — that one is public and we can't edit it.`
          : ''),
      color: 0x10b981,
      // Was "instant delivery", which is the exact claim the storefront, the
      // emails and the Discord panels all stopped making — most orders are
      // delivered by hand. A promise we break in a delivery message is worse
      // than no footer at all.
      footer: { text: config.email.fromName },
      timestamp: new Date().toISOString(),
    };
    // Direct DM with a server-side bot token; otherwise relay via the outbox
    // so the community bot (which has the token) sends it.
    if (config.discord.botToken) await dmUser(uid, { embeds: [embed] });
    else await relayDm(uid, { embeds: [embed] });
    console.log(`[discord] delivery DM ${config.discord.botToken ? 'sent' : 'queued'} for ${uid} · order ${order.number}`);
  } catch (err) {
    // Common: user disallows DMs (50007) — never let that affect the order.
    console.error('[discord] delivery DM failed:', err.message);
  }
}
