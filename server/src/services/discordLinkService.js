/**
 * Connecting a Discord account to a ForgeMarket account.
 *
 * Signing in WITH Discord already produced a link, but only as a side effect,
 * and only for people whose Discord email happens to be the address they shop
 * under. Everyone else — which is most people, because the site's primary login
 * is a code sent to your email — had no way to connect at all. There was also no
 * way to disconnect, which is a problem in its own right: the link drives roles
 * that are visible to every other member of the server.
 *
 * Linking is now its own action, started from a signed-in session:
 *
 *   1. `beginLink` records an intent server-side and returns Discord's consent
 *      URL. Only an opaque state string travels through the browser.
 *   2. Discord sends the user back with that state.
 *   3. `completeLink` looks the state up, attaches the Discord account to the
 *      user it was created for, and syncs their roles.
 *
 * The intent lives in the database rather than in a cookie so the callback can
 * never be talked into attaching someone else's account: the state resolves to a
 * user id here, and nothing about the target user crosses the network.
 */
import { config } from '../config/env.js';
import { run, get, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { badRequest, conflict } from '../utils/errors.js';
import { PROVIDERS } from './oauthService.js';
import { syncMemberRoles, stripManagedRoles, discordUidForUser } from './discordRolesService.js';
import { audit } from './auditService.js';

const INTENT_TTL_MS = 10 * 60_000;
const linkRedirectUri = () => `${config.apiUrl}/api/auth/oauth/discord/link/callback`;

export const linkEnabled = () => PROVIDERS.discord.enabled();

/** Start a link. Returns the URL to send the browser to. */
export async function beginLink(userId, state) {
  if (!linkEnabled()) throw badRequest('Discord login is not configured');
  if (!userId) throw badRequest('You need to be signed in to connect Discord');

  await run(
    `INSERT INTO oauth_link_intents (state, user_id, provider, created_at, expires_at)
     VALUES (@s, @u, 'discord', @at, @exp)`,
    { s: state, u: userId, at: nowIso(), exp: new Date(Date.now() + INTENT_TTL_MS).toISOString() });

  const params = new URLSearchParams({
    client_id: config.oauth.discord.clientId,
    redirect_uri: linkRedirectUri(),
    response_type: 'code',
    // `identify` is all a link needs: the account id, name and avatar. The
    // login flow asks for `email` because it has to create an account from it;
    // connecting to an account that already exists does not, so it does not ask.
    scope: 'identify guilds.join',
    state,
    prompt: 'consent',
  });
  return `${PROVIDERS.discord.authUrl}?${params}`;
}

/**
 * Finish a link.
 *
 * Returns `{ userId, discord }` on success. Throws with a message the storefront
 * can show — every failure here is something the person can act on ("that
 * Discord account is already connected to another ForgeMarket account") rather
 * than a generic error.
 */
export async function completeLink(state, code) {
  const intent = await get(
    "SELECT * FROM oauth_link_intents WHERE state = @s AND provider = 'discord'", { s: state });
  // Consumed immediately, whatever happens next: a state is single-use, and
  // leaving a spent one behind is a replay waiting to happen.
  if (intent) await run('DELETE FROM oauth_link_intents WHERE state = @s', { s: state });
  if (!intent) throw badRequest('That link request is not valid any more. Try connecting again.');
  if (new Date(intent.expires_at) < new Date()) {
    throw badRequest('That link request expired. Try connecting again.');
  }

  const tokenRes = await fetch(PROVIDERS.discord.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.oauth.discord.clientId,
      client_secret: config.oauth.discord.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: linkRedirectUri(),
    }),
  });
  if (!tokenRes.ok) throw badRequest('Discord refused the connection. Try again.');
  const token = await tokenRes.json();

  const infoRes = await fetch(PROVIDERS.discord.userInfoUrl, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!infoRes.ok) throw badRequest('Could not read your Discord profile. Try again.');
  const profile = await infoRes.json();
  const uid = profile.id;
  if (!uid) throw badRequest('Discord did not return an account id.');

  // One Discord account, one ForgeMarket account. Without this a single Discord
  // user could collect the customer role through somebody else's purchases.
  const taken = await get(
    "SELECT user_id FROM oauth_accounts WHERE provider = 'discord' AND provider_uid = @uid",
    { uid });
  if (taken && taken.user_id !== intent.user_id) {
    throw conflict('That Discord account is already connected to another ForgeMarket account.');
  }

  const display = profile.global_name || profile.username || null;
  const avatar = profile.avatar
    ? `https://cdn.discordapp.com/avatars/${uid}/${profile.avatar}.png`
    : null;

  if (taken) {
    // Already linked to this same user — refresh the stored profile so a rename
    // does not leave a stale username on the account page.
    await run(
      `UPDATE oauth_accounts SET raw_profile = @raw
        WHERE provider = 'discord' AND provider_uid = @uid`,
      { raw: JSON.stringify({ uid, displayName: display, avatarUrl: avatar }), uid });
  } else {
    await run(
      `INSERT INTO oauth_accounts (id, user_id, provider, provider_uid, email, raw_profile, created_at)
       VALUES (@id, @u, 'discord', @uid, @email, @raw, @at)`,
      { id: newId('oau'), u: intent.user_id, uid, email: profile.email || null,
        raw: JSON.stringify({ uid, displayName: display, avatarUrl: avatar }), at: nowIso() });
  }

  await audit({
    actor: { id: intent.user_id, email: intent.user_id }, action: 'account.discord_linked',
    targetType: 'user', targetId: intent.user_id, metadata: { uid, displayName: display },
  }).catch(() => {});

  // The reward for connecting is immediate rather than at the next order — the
  // roles a person has already earned appear the moment they link.
  const sync = await syncMemberRoles(intent.user_id, { reason: 'linked' });

  return { userId: intent.user_id, discord: { uid, displayName: display, avatarUrl: avatar }, sync };
}

/**
 * Disconnect.
 *
 * Roles are stripped BEFORE the link is deleted, because stripping them needs to
 * know which Discord account to strip them from. Doing it the other way round
 * leaves someone wearing a VIP badge with nothing behind it and no record of
 * where it came from.
 */
export async function unlinkDiscord(userId) {
  const uid = await discordUidForUser(userId);
  if (!uid) return { ok: true, alreadyUnlinked: true };

  const stripped = await stripManagedRoles(userId);
  await run("DELETE FROM oauth_accounts WHERE user_id = @u AND provider = 'discord'", { u: userId });

  await audit({
    actor: { id: userId, email: userId }, action: 'account.discord_unlinked',
    targetType: 'user', targetId: userId, metadata: { uid, rolesRemoved: stripped.removed },
  }).catch(() => {});

  return { ok: true, rolesRemoved: stripped.removed };
}

/** What the account page shows: whether it is connected, and to whom. */
export async function linkStatus(userId) {
  const row = await get(
    `SELECT provider_uid, raw_profile, created_at, synced_at
       FROM oauth_accounts WHERE user_id = @u AND provider = 'discord' LIMIT 1`,
    { u: userId });
  if (!row) return { linked: false, available: linkEnabled() };
  let profile = {};
  try { profile = JSON.parse(row.raw_profile || '{}'); } catch { /* stored before this shape */ }
  return {
    linked: true,
    available: linkEnabled(),
    uid: row.provider_uid,
    displayName: profile.displayName || null,
    avatarUrl: profile.avatarUrl || null,
    linkedAt: row.created_at,
    syncedAt: row.synced_at || null,
  };
}

/** Housekeeping: intents are single-use and short-lived, so expired ones are junk. */
export async function purgeExpiredLinkIntents() {
  const r = await run('DELETE FROM oauth_link_intents WHERE expires_at < @now', { now: nowIso() });
  return r?.changes ?? 0;
}
