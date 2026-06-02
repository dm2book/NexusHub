/** User CRUD + RBAC resolution helpers. */
import { run, get, all, nowIso, tx } from '../db/index.js';
import { newId } from '../utils/ids.js';

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
    return { user: await getUserById(existing.id), created: false };
  }
  const id = newId('usr');
  await run(`INSERT INTO users (id, email, email_verified, display_name, avatar_url, created_at, updated_at)
       VALUES (@id, @e, @ev, @dn, @av, @at, @at)`, {
    id, e, ev: profile.email_verified ? 1 : 0,
    dn: profile.display_name || e.split('@')[0], av: profile.avatar_url || null, at,
  });
  // Everyone starts as a customer.
  await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, 'customer', @at)`,
      { u: id, at });
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
  return {
    id: u.id,
    email: u.email,
    emailVerified: !!u.email_verified,
    displayName: u.display_name,
    avatarUrl: u.avatar_url,
    status: u.status,
    preferences: safeJson(u.preferences),
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
