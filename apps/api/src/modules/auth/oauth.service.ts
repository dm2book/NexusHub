import { env } from '../../config/env.js';
import { badRequest } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { OAuthProvider } from '@prisma/client';
import { findOrCreateUser } from './auth.service.js';

/**
 * Minimal but real OAuth2 (authorization-code) helpers for Google & Discord.
 * The routes build an authorize URL; the callback exchanges the code, fetches
 * the profile, and links/creates the user.
 */

export function googleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.google.clientId,
    redirect_uri: `${env.oauthRedirectBase}/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export function discordAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.discord.clientId,
    redirect_uri: `${env.oauthRedirectBase}/discord/callback`,
    response_type: 'code',
    scope: 'identify email',
    state,
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

async function exchange(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw badRequest('OAuth token exchange failed');
  return (await res.json()) as Record<string, unknown>;
}

export async function handleGoogleCallback(code: string) {
  if (!env.google.clientId) throw badRequest('Google OAuth not configured');
  const token = await exchange('https://oauth2.googleapis.com/token', {
    code,
    client_id: env.google.clientId,
    client_secret: env.google.clientSecret,
    redirect_uri: `${env.oauthRedirectBase}/google/callback`,
    grant_type: 'authorization_code',
  });
  const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const profile = (await profileRes.json()) as { id: string; email: string; name?: string; picture?: string };
  return linkAccount(OAuthProvider.GOOGLE, profile.id, profile.email, profile.name, profile.picture);
}

export async function handleDiscordCallback(code: string) {
  if (!env.discord.clientId) throw badRequest('Discord OAuth not configured');
  const token = await exchange('https://discord.com/api/oauth2/token', {
    code,
    client_id: env.discord.clientId,
    client_secret: env.discord.clientSecret,
    redirect_uri: `${env.oauthRedirectBase}/discord/callback`,
    grant_type: 'authorization_code',
  });
  const profileRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const p = (await profileRes.json()) as {
    id: string;
    email: string;
    username: string;
    avatar?: string;
  };
  const avatar = p.avatar ? `https://cdn.discordapp.com/avatars/${p.id}/${p.avatar}.png` : undefined;
  return linkAccount(OAuthProvider.DISCORD, p.id, p.email, p.username, avatar);
}

async function linkAccount(
  provider: OAuthProvider,
  providerUserId: string,
  email: string,
  name?: string,
  avatarUrl?: string,
) {
  const user = await findOrCreateUser(email, { name, avatarUrl });
  await prisma.oAuthAccount.upsert({
    where: { provider_providerUserId: { provider, providerUserId } },
    update: {},
    create: { provider, providerUserId, userId: user.id },
  });
  return user;
}
