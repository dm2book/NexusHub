/**
 * Discord roles, reconciled from what the account has actually earned.
 *
 * This used to be three one-way grants: a customer role on a paid order, a
 * loyalty role on a spend change, and nothing else. Roles went on and never came
 * off, which meant Discord slowly filled up with claims that were no longer
 * true — a VIP badge on someone who charged back, a Gold tier on an account
 * whose only order was refunded. A role that lies is worse than no role.
 *
 * So there is now one function that matters, `syncMemberRoles`. It works out
 * the full set of roles an account should hold, compares it with what the member
 * actually has in the guild, and applies the difference in both directions. It
 * is idempotent, safe to call from anywhere, and the only thing that ever writes
 * a managed role.
 *
 * It also fixes the quiet failure that made the whole thing unreliable: roles
 * were granted at the moment an order was paid, so anyone who linked their
 * account and joined the server *afterwards* never received them. Nothing
 * retried. A maintenance sweep now re-syncs the stalest members, so the roles
 * arrive whenever the member does.
 *
 * Everything here is best-effort. Discord being down, the bot lacking a
 * permission or a member having left must never affect an order — every entry
 * point catches and logs.
 *
 * Requires DISCORD_BOT_TOKEN + DISCORD_GUILD_ID, the bot's own role to sit ABOVE
 * every managed role in the guild's role list, and the member to have joined.
 */
import { config } from '../config/env.js';
import { run, get, all, nowIso } from '../db/index.js';
import { TIERS, loyaltyFor } from './loyaltyService.js';
import { relayDm } from './discordService.js';

const API = 'https://discord.com/api/v10';

async function discord(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${config.discord.botToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const err = new Error(`Discord ${init.method || 'GET'} ${path} → ${res.status} ${await res.text().catch(() => '')}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

export const rolesEnabled = () => !!(config.discord.botToken && config.discord.guildId);

// ── Role lookup ─────────────────────────────────────────────────────────────

let rolesCache = { at: 0, byName: {} };

/** Every role in the guild, by name. Cached — this is read on every sync. */
async function guildRoles() {
  if (Date.now() - rolesCache.at > 60_000) {
    const roles = await discord(`/guilds/${config.discord.guildId}/roles`);
    rolesCache = { at: Date.now(), byName: Object.fromEntries(roles.map((r) => [r.name, r.id])) };
  }
  return rolesCache.byName;
}

/** Drop the cache — used after the setup endpoint creates roles. */
export const bustRoleCache = () => { rolesCache = { at: 0, byName: {} }; };

/**
 * Every role name this site manages, and nothing else.
 *
 * The reconciler only ever adds or removes names on this list. A member's
 * moderator role, their colour role, whatever the server does for fun — all
 * untouched. Removing a role we did not grant is the fastest way to make an
 * owner turn the integration off.
 */
export function managedRoleNames() {
  const { roles } = config.discord;
  return [roles.customer, roles.vip, roles.review, ...TIERS.map((t) => t.name)].filter(Boolean);
}

// ── Who is linked ───────────────────────────────────────────────────────────

/** The Discord account id linked to a site account, if any. */
export async function discordUidForUser(userId) {
  if (!userId) return null;
  const row = await get(
    "SELECT provider_uid FROM oauth_accounts WHERE user_id = @uid AND provider = 'discord' LIMIT 1",
    { uid: userId });
  return row?.provider_uid || null;
}

/** …and the reverse, so a vouch in Discord can find the account behind it. */
export async function userIdForDiscordUid(uid) {
  if (!uid) return null;
  const row = await get(
    "SELECT user_id FROM oauth_accounts WHERE provider = 'discord' AND provider_uid = @uid LIMIT 1",
    { uid: String(uid) });
  return row?.user_id || null;
}

// ── What an account has earned ──────────────────────────────────────────────

/**
 * The roles this account should hold, computed from the database alone.
 *
 * Deliberately separate from anything that talks to Discord: this is the part
 * worth being sure about, and it can be tested without a guild.
 *
 * Refunded, cancelled and failed orders count for nothing. That is the whole
 * point of reconciling — someone whose only order came back is not a customer,
 * and leaving the badge on tells every other member otherwise.
 */
export async function earnedRolesFor(userId) {
  const { roles } = config.discord;
  const earned = new Set();
  const why = [];
  if (!userId) return { earned, why, spend: 0, orders: 0 };

  // The same definition of "paid" the loyalty tier uses, so the two can never
  // disagree about whether an order counted.
  // `xp` is lifetime spend in cents; loyaltyFor already excludes refunded,
  // cancelled and failed orders, which is the definition this needs too.
  const { tierName, xp: spent, orders } = await loyaltyFor(userId);

  if (orders > 0) {
    earned.add(roles.customer);
    why.push(`${orders} paid order${orders === 1 ? '' : 's'}`);
    if (spent >= config.discord.vipThreshold) {
      earned.add(roles.vip);
      why.push(`lifetime spend over €${(config.discord.vipThreshold / 100).toFixed(2)}`);
    }
    // Bronze is what everyone starts at, so it is only a badge worth wearing
    // once there is an order behind it.
    if (tierName) { earned.add(tierName); why.push(`loyalty tier ${tierName}`); }
  }

  // A published review, from either side of the ecosystem: one left on the site
  // against an order, or a /vouch in Discord that carried the author's id.
  const uid = await discordUidForUser(userId);
  const review = await get(
    `SELECT id FROM reviews
      WHERE status = 'visible' AND (user_id = @u ${uid ? 'OR discord_uid = @d' : ''})
      LIMIT 1`,
    uid ? { u: userId, d: uid } : { u: userId }).catch(() => null);
  if (review) { earned.add(roles.review); why.push('published a review'); }

  return { earned, why, spend: spent, orders };
}

// ── Reconciliation ──────────────────────────────────────────────────────────

/**
 * Bring one member's Discord roles in line with what they have earned.
 *
 * Returns what it did rather than throwing, so callers can log it and move on.
 * `added`/`removed` are role names; `skipped` lists managed roles that do not
 * exist in the guild, which is the single most common reason for "the roles
 * aren't working" and used to be invisible.
 */
export async function syncMemberRoles(userId, { reason = 'sync' } = {}) {
  const result = { ok: false, added: [], removed: [], skipped: [], reason };
  try {
    if (!rolesEnabled() || !userId) return { ...result, note: 'not configured' };

    const uid = await discordUidForUser(userId);
    if (!uid) return { ...result, note: 'no Discord account linked' };

    const member = await discord(`/guilds/${config.discord.guildId}/members/${uid}`)
      .catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    // Linked but not in the server. Not an error and not worth retrying now —
    // the maintenance sweep picks them up once they join.
    if (!member) return { ...result, note: 'not a member of the server' };

    const byName = await guildRoles();
    const { earned } = await earnedRolesFor(userId);
    const has = new Set(member.roles || []);

    for (const name of managedRoleNames()) {
      const roleId = byName[name];
      if (!roleId) { result.skipped.push(name); continue; }
      const shouldHave = earned.has(name);
      if (shouldHave && !has.has(roleId)) {
        await discord(`/guilds/${config.discord.guildId}/members/${uid}/roles/${roleId}`, { method: 'PUT' });
        result.added.push(name);
      } else if (!shouldHave && has.has(roleId)) {
        await discord(`/guilds/${config.discord.guildId}/members/${uid}/roles/${roleId}`, { method: 'DELETE' });
        result.removed.push(name);
      }
    }

    await run(
      "UPDATE oauth_accounts SET synced_at = @at WHERE user_id = @u AND provider = 'discord'",
      { at: nowIso(), u: userId }).catch(() => {});

    if (result.added.length || result.removed.length) {
      console.log(`[discord] ${uid} roles +[${result.added}] -[${result.removed}] (${reason})`);
    }
    if (result.skipped.length) {
      console.warn(`[discord] roles missing from the guild, skipped: ${result.skipped.join(', ')}`);
    }
    return { ...result, ok: true };
  } catch (err) {
    console.error(`[discord] role sync failed for ${userId}:`, err.message);
    return { ...result, error: err.message };
  }
}

/**
 * Re-sync the members whose roles were checked longest ago.
 *
 * The reason this exists: roles used to be granted only at the instant an order
 * was paid. Link your account on Tuesday, join the server on Friday, and nothing
 * ever came back to give you the role you earned on Tuesday. Run from the hourly
 * maintenance job, so the roles arrive whenever the member does.
 */
export async function sweepMemberRoles({ limit = 25 } = {}) {
  if (!rolesEnabled()) return { skipped: 'not configured' };
  const rows = await all(
    `SELECT user_id FROM oauth_accounts
      WHERE provider = 'discord'
      ORDER BY synced_at ASC NULLS FIRST
      LIMIT @lim`, { lim: limit });

  let changed = 0;
  for (const r of rows) {
    const out = await syncMemberRoles(r.user_id, { reason: 'sweep' });
    if (out.added?.length || out.removed?.length) changed++;
  }
  return { checked: rows.length, changed };
}

/**
 * What the owner needs to know before wondering why nothing happens.
 *
 * Role automation fails silently by design — a missing role must never break an
 * order — which makes it very hard to debug from the outside. This says exactly
 * which of the managed roles exist, which do not, and whether the bot sits high
 * enough in the hierarchy to assign them at all.
 */
export async function roleDiagnostics() {
  if (!rolesEnabled()) {
    return {
      configured: false,
      reason: !config.discord.botToken ? 'DISCORD_BOT_TOKEN is not set' : 'DISCORD_GUILD_ID is not set',
      managed: managedRoleNames(), present: [], missing: [], linkedAccounts: 0,
    };
  }
  const out = {
    configured: true, managed: managedRoleNames(), present: [], missing: [],
    botCanAssign: null, linkedAccounts: 0,
  };
  try {
    const roles = await discord(`/guilds/${config.discord.guildId}/roles`);
    const byName = Object.fromEntries(roles.map((r) => [r.name, r]));
    for (const name of out.managed) (byName[name] ? out.present : out.missing).push(name);

    // The bot can only assign roles positioned BELOW its own highest role. This
    // is the failure everybody hits once and nobody guesses.
    const me = await discord(`/guilds/${config.discord.guildId}/members/@me`).catch(() => null);
    if (me) {
      const myTop = Math.max(0, ...(me.roles || []).map((id) => roles.find((r) => r.id === id)?.position ?? 0));
      const blocked = out.present.filter((n) => byName[n].position >= myTop);
      out.botCanAssign = blocked.length === 0;
      if (blocked.length) out.blockedByHierarchy = blocked;
    }
  } catch (e) {
    out.error = e.message;
  }
  const c = await get("SELECT COUNT(*) AS n FROM oauth_accounts WHERE provider = 'discord'").catch(() => null);
  out.linkedAccounts = Number(c?.n || 0);
  return out;
}

/**
 * Create any managed role that does not exist yet.
 *
 * Saves the owner making five roles by hand and spelling each one exactly right
 * — a typo there produces an integration that runs perfectly and does nothing.
 * Existing roles are left completely alone, including their colour and
 * permissions: this only ever fills gaps.
 */
export async function ensureRolesExist() {
  if (!rolesEnabled()) return { created: [], skipped: 'not configured' };
  const { roles } = config.discord;
  const colours = {
    [roles.customer]: 0x10b981,
    [roles.vip]: 0xa855f7,
    [roles.review]: 0x38bdf8,
    ...Object.fromEntries(TIERS.map((t) => [t.name, parseInt(t.color.slice(1), 16)])),
  };
  const byName = await discord(`/guilds/${config.discord.guildId}/roles`)
    .then((r) => new Set(r.map((x) => x.name)));

  const created = [];
  for (const name of managedRoleNames()) {
    if (byName.has(name)) continue;
    await discord(`/guilds/${config.discord.guildId}/roles`, {
      method: 'POST',
      body: JSON.stringify({
        name,
        color: colours[name] ?? 0,
        hoist: false,
        mentionable: false,
        // No permissions at all. These are badges; granting anything here would
        // be handing out access nobody asked for.
        permissions: '0',
      }),
    });
    created.push(name);
  }
  bustRoleCache();
  return { created };
}

/**
 * Strip every managed role from a member.
 *
 * Used when someone disconnects their account: the link is the only reason they
 * held these, so leaving them behind would keep asserting something the person
 * has explicitly withdrawn from.
 */
export async function stripManagedRoles(userId) {
  try {
    if (!rolesEnabled()) return { removed: [] };
    const uid = await discordUidForUser(userId);
    if (!uid) return { removed: [] };
    const member = await discord(`/guilds/${config.discord.guildId}/members/${uid}`)
      .catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    if (!member) return { removed: [] };

    const byName = await guildRoles();
    const has = new Set(member.roles || []);
    const removed = [];
    for (const name of managedRoleNames()) {
      const roleId = byName[name];
      if (roleId && has.has(roleId)) {
        await discord(`/guilds/${config.discord.guildId}/members/${uid}/roles/${roleId}`, { method: 'DELETE' });
        removed.push(name);
      }
    }
    return { removed };
  } catch (err) {
    console.error('[discord] could not strip roles:', err.message);
    return { removed: [], error: err.message };
  }
}

// ── Backwards-compatible entry points ───────────────────────────────────────
// Both used to do their own one-way grant. They now route into the reconciler,
// so every caller gets removal as well as addition without knowing about it.

export const grantTierForOrder = (order) =>
  syncMemberRoles(order?.userId, { reason: `order ${order?.number || ''}` });

export const syncLoyaltyRoles = (userId) => syncMemberRoles(userId, { reason: 'loyalty' });

// ── Delivery DM ─────────────────────────────────────────────────────────────

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
 * completes — instant delivery where the customer already is — and close the
 * loop with a /vouch prompt that feeds the on-site reviews.
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
        `Thanks for shopping with **${config.email.fromName}** — here are your items:\n\n${items}\n${codes}\n`
        + '📧 A copy is in your email. Keep your codes private and never share them in public channels.\n\n'
        + '💚 Happy with your order? Type **/vouch** in the server — it posts in #vouchers *and* on the website, '
        + 'and it gets you the reviewer role here.'
        // The one message a buyer reads while the order is still in their
        // hands. Links the form rather than the profile: this is an ask.
        + (config.shop.trustpilotReviewUrl
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
