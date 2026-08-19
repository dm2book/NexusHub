/** User CRUD + RBAC resolution helpers. */
import { run, get, all, nowIso, tx } from '../db/index.js';
import { membershipActiveFor, FORGE_PLUS } from './membershipService.js';
import { assertLaunched, isAdminEmail } from './launchGateService.js';
import { newId } from '../utils/ids.js';
import { config } from '../config/env.js';

/** Auto-grant the "owner" role to bootstrap admins listed in ADMIN_EMAILS. */
async function ensureAdmin(userId, email) {
  if (!config.auth.adminEmails.includes(String(email).toLowerCase())) return;
  await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, 'owner', @at)
             ON CONFLICT (user_id, role_id) DO NOTHING`, { u: userId, at: nowIso() }).catch(() => {});
}

export function getUserById(id) {
  return get('SELECT * FROM users WHERE id = @id', { id });
}
export function getUserByEmail(email) {
  return get('SELECT * FROM users WHERE email = @e', { e: String(email).toLowerCase() });
}

/** Find or create a user by email (used by OTP + OAuth login). */
export async function upsertUserByEmail(email, profile = {}) {
  const e = String(email).toLowerCase();
  const existing = await getUserByEmail(e);
  const at = nowIso();
  if (existing) {
    if (profile.display_name || profile.avatar_url) {
      await run(`UPDATE users SET display_name = COALESCE(@dn, display_name),
            avatar_url = COALESCE(@av, avatar_url), updated_at = @at WHERE id = @id`,
          { dn: profile.display_name || null, av: profile.avatar_url || null, at, id: existing.id });
    }
    await ensureAdmin(existing.id, e);
    return { user: await getUserById(existing.id), created: false };
  }
  /* New accounts wait for launch; existing ones sign in as normal.

     This sits AFTER the `existing` branch above on purpose: the gate is on
     registration, not on logging in, so everyone who already has an account —
     including the owner — keeps their key to the door. An address listed in
     ADMIN_EMAILS is allowed through even as a brand-new account, because on a
     fresh deployment there is no admin yet to bypass anything, and refusing
     would lock the owner out of the shop they are about to open. */
  if (!isAdminEmail(e)) assertLaunched(null, 'Signing up');

  const id = newId('usr');
  await run(`INSERT INTO users (id, email, email_verified, display_name, avatar_url, created_at, updated_at)
       VALUES (@id, @e, @ev, @dn, @av, @at, @at)`, {
    id, e, ev: profile.email_verified ? 1 : 0,
    dn: profile.display_name || e.split('@')[0], av: profile.avatar_url || null, at,
  });
  // Everyone starts as a customer.
  await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, 'customer', @at)`,
      { u: id, at });
  await ensureAdmin(id, e);
  return { user: await getUserById(id), created: true };
}

/** Find a user by verified phone, or create a phone-first account. */
export async function upsertUserByPhone(phone, profile = {}) {
  const p = String(phone).trim();
  const existing = await get('SELECT * FROM users WHERE phone = @p', { p });
  const at = nowIso();
  if (existing) {
    if (!existing.phone_verified) await run('UPDATE users SET phone_verified = 1 WHERE id = @id', { id: existing.id });
    return { user: await getUserById(existing.id), created: false };
  }
  // Same gate as the email path: a phone number cannot be on the admin list, so
  // a phone-first signup simply waits for launch day.
  assertLaunched(null, 'Signing up');

  // Phone-first signup: email is required+unique, so seed a clearly-marked
  // placeholder the customer can change in Settings.
  const id = newId('usr');
  const placeholderEmail = `${p.replace(/[^0-9]/g, '')}@phone.forgemarket.local`;
  await run(`INSERT INTO users (id, email, email_verified, phone, phone_verified, display_name, created_at, updated_at)
       VALUES (@id, @e, 0, @p, 1, @dn, @at, @at)`,
      { id, e: placeholderEmail, p, dn: profile.display_name || `+${p.replace(/[^0-9]/g, '').slice(-4)}`, at });
  await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, 'customer', @at)`, { u: id, at });
  return { user: await getUserById(id), created: true };
}

export async function touchLogin(userId) {
  await run('UPDATE users SET last_login_at = @at, updated_at = @at WHERE id = @id',
      { at: nowIso(), id: userId });
}

/** Returns the set of role ids assigned to a user. */
export async function getUserRoles(userId) {
  const rows = await all('SELECT role_id FROM user_roles WHERE user_id = @u', { u: userId });
  return rows.map((r) => r.role_id);
}

/** Resolve the flattened permission set for a user (owner => all). */
export async function getUserPermissions(userId) {
  const rows = await all(
    `SELECT DISTINCT rp.permission_id AS p
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = @u`, { u: userId });
  return new Set(rows.map((r) => r.p));
}

export async function hasPermission(userId, permission) {
  return (await getUserPermissions(userId)).has(permission);
}

/** Public-safe view of a user including roles + permissions. */
export async function publicUser(userId) {
  const u = await getUserById(userId);
  if (!u) return null;
  const [roles, perms] = await Promise.all([
    getUserRoles(userId), getUserPermissions(userId),
  ]);
  // The storefront has to know about the standing member discount, or it shows a
  // total the server will not charge. That is exactly how the cart came to quote
  // €4.49 for an order that was billed at €4.27: the discount lived only in
  // createOrder, and the client recomputed the total without it.
  //
  // Read off the row above rather than asked for again: `u` comes from a
  // SELECT *, so it already carries membership_tier and membership_until. The
  // extra query bought nothing here and cost one per user in the admin list.
  const memberPercent = membershipActiveFor(u) ? FORGE_PLUS.discountPercent : 0;
  return {
    id: u.id,
    email: u.email,
    emailVerified: !!u.email_verified,
    phone: u.phone || null,
    phoneVerified: !!u.phone_verified,
    displayName: u.display_name,
    avatarUrl: u.avatar_url,
    status: u.status,
    preferences: safeJson(u.preferences),
    totpEnabled: !!u.totp_enabled_at,
    memberPercent,          // standing % off every order, 0 when not a member
    roles,
    permissions: [...perms],
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
  };
}

export async function setUserRoles(userId, roleIds, grantedBy) {
  await tx(async () => {
    await run('DELETE FROM user_roles WHERE user_id = @u', { u: userId });
    for (const r of roleIds) {
      await run(`INSERT INTO user_roles (user_id, role_id, granted_by, granted_at)
           VALUES (@u, @r, @by, @at) ON CONFLICT (user_id, role_id) DO NOTHING`,
          { u: userId, r, by: grantedBy || null, at: nowIso() });
    }
  });
}

export async function updatePreferences(userId, prefs) {
  const u = await getUserById(userId);
  const merged = { ...safeJson(u?.preferences), ...prefs };
  await run('UPDATE users SET preferences = @p, updated_at = @at WHERE id = @id',
      { p: JSON.stringify(merged), at: nowIso(), id: userId });
  return merged;
}

export async function updateProfile(userId, { displayName, avatarUrl } = {}) {
  await run(`UPDATE users SET display_name = COALESCE(@dn, display_name),
        avatar_url = COALESCE(@av, avatar_url), updated_at = @at WHERE id = @id`,
      { dn: displayName ?? null, av: avatarUrl ?? null, at: nowIso(), id: userId });
  return publicUser(userId);
}

function safeJson(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }
