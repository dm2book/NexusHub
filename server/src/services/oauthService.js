/**
 * OAuth 2.0 login for Google and Discord.
 *
 * Providers are described declaratively so adding another (GitHub, Apple, ...)
 * is a config entry, not new control flow. Uses the Authorization Code flow
 * with the platform's built-in fetch (Node 18+). No SDKs required.
 */
import { config } from '../config/env.js';
import { run, get, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { badRequest } from '../utils/errors.js';
import { getUserByEmail, upsertUserByEmail } from './userService.js';
import { finalizeLogin } from './authService.js';

const redirectUri = (provider) => `${config.apiUrl}/api/auth/oauth/${provider}/callback`;

export const PROVIDERS = {
  google: {
    enabled: () => !!config.oauth.google.clientId,
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
    clientId: () => config.oauth.google.clientId,
    clientSecret: () => config.oauth.google.clientSecret,
    mapProfile: (p) => ({
      uid: p.sub,
      email: p.email,
      emailVerified: p.email_verified,
      displayName: p.name,
      avatarUrl: p.picture,
    }),
  },
  discord: {
    enabled: () => !!config.oauth.discord.clientId,
    authUrl: 'https://discord.com/api/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userInfoUrl: 'https://discord.com/api/users/@me',
    scope: 'identify email',
    clientId: () => config.oauth.discord.clientId,
    clientSecret: () => config.oauth.discord.clientSecret,
    mapProfile: (p) => ({
      uid: p.id,
      email: p.email,
      emailVerified: p.verified,
      displayName: p.global_name || p.username,
      avatarUrl: p.avatar
        ? `https://cdn.discordapp.com/avatars/${p.id}/${p.avatar}.png`
        : null,
    }),
  },
};

export function listEnabledProviders() {
  return Object.entries(PROVIDERS)
    .filter(([, p]) => p.enabled())
    .map(([id]) => id);
}

/** Build the provider authorization URL (state must be verified on callback). */
export function buildAuthUrl(providerId, state) {
  const p = PROVIDERS[providerId];
  if (!p || !p.enabled()) throw badRequest(`Provider ${providerId} not configured`);
  const params = new URLSearchParams({
    client_id: p.clientId(),
    redirect_uri: redirectUri(providerId),
    response_type: 'code',
    scope: p.scope,
    state,
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${p.authUrl}?${params}`;
}

/** Exchange the auth code, fetch the profile, link/create the user, log in. */
export async function handleOAuthCallback(providerId, code, ctx = {}) {
  const p = PROVIDERS[providerId];
  if (!p || !p.enabled()) throw badRequest(`Provider ${providerId} not configured`);

  const tokenRes = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: p.clientId(),
      client_secret: p.clientSecret(),
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(providerId),
    }),
  });
  if (!tokenRes.ok) throw badRequest(`OAuth token exchange failed (${tokenRes.status})`);
  const token = await tokenRes.json();

  const infoRes = await fetch(p.userInfoUrl, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!infoRes.ok) throw badRequest('Failed to load provider profile');
  const profile = p.mapProfile(await infoRes.json());
  if (!profile.email) throw badRequest('Provider did not return an email address');

  // Link by stable provider uid first, then fall back to email.
  const existingLink = get(
    `SELECT user_id FROM oauth_accounts WHERE provider = @prov AND provider_uid = @uid`,
    { prov: providerId, uid: profile.uid });

  let userId;
  if (existingLink) {
    userId = existingLink.user_id;
  } else {
    const { user } = upsertUserByEmail(profile.email, {
      email_verified: profile.emailVerified,
      display_name: profile.displayName,
      avatar_url: profile.avatarUrl,
    });
    userId = user.id;
    run(`INSERT INTO oauth_accounts (id, user_id, provider, provider_uid, email, raw_profile, created_at)
         VALUES (@id, @uid, @prov, @puid, @email, @raw, @at)`,
        { id: newId('oau'), uid: userId, prov: providerId, puid: profile.uid,
          email: profile.email, raw: JSON.stringify(profile), at: nowIso() });
  }

  const user = get('SELECT * FROM users WHERE id = @id', { id: userId });
  return finalizeLogin(user, ctx, { provider: providerId });
}
