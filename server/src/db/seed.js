/**
 * Idempotent seed of CONFIGURATION data only — RBAC roles/permissions and the
 * default branded email templates. No mock products, users, or orders are
 * created; the platform starts empty and is populated through real flows.
 */
import { run, get, nowIso } from './index.js';
import { migrate } from './migrate.js';
import { DEFAULT_TEMPLATES } from '../services/defaultTemplates.js';

// Permission catalog. Granular so roles can be composed precisely.
const PERMISSIONS = {
  'orders.read': 'View orders',
  'orders.update': 'Change order status / edit orders',
  'orders.fulfill': 'Trigger or perform fulfillment',
  'orders.complete': 'Mark orders complete',
  'orders.refund': 'Issue refunds',
  'orders.contact': 'Contact customers about orders',
  'suppliers.read': 'View suppliers',
  'suppliers.manage': 'Create/configure suppliers and connectors',
  'suppliers.sync': 'Trigger supplier syncs',
  'fulfillment.manage': 'Manage fulfillment requests',
  'emails.manage': 'Edit email templates',
  'analytics.read': 'View analytics dashboards',
  'tickets.read': 'View support tickets',
  'tickets.manage': 'Respond to / resolve tickets',
  'users.read': 'View users',
  'users.manage': 'Manage users and roles',
  'audit.read': 'View audit logs',
  'security.manage': 'Manage security settings / fraud rules',
};

// Role → permission map. "owner" implicitly gets everything via '*'.
const ROLES = {
  owner: { name: 'Owner', rank: 100, perms: ['*'] },
  admin: {
    name: 'Admin',
    rank: 80,
    perms: [
      'orders.read', 'orders.update', 'orders.fulfill', 'orders.complete',
      'orders.refund', 'orders.contact', 'suppliers.read', 'suppliers.manage',
      'suppliers.sync', 'fulfillment.manage', 'emails.manage', 'analytics.read',
      'tickets.read', 'tickets.manage', 'users.read', 'users.manage', 'audit.read',
    ],
  },
  support: {
    name: 'Support',
    rank: 40,
    perms: ['orders.read', 'orders.contact', 'orders.refund', 'tickets.read',
            'tickets.manage', 'users.read'],
  },
  fulfillment_manager: {
    name: 'Fulfillment Manager',
    rank: 50,
    perms: ['orders.read', 'orders.update', 'orders.fulfill', 'orders.complete',
            'suppliers.read', 'suppliers.sync', 'fulfillment.manage'],
  },
  customer: { name: 'Customer', rank: 10, perms: [] },
};

export async function seed() {
  await migrate();
  const at = nowIso();

  for (const [id, desc] of Object.entries(PERMISSIONS)) {
    await run(`INSERT INTO permissions (id, description) VALUES (@id, @d)
               ON CONFLICT(id) DO UPDATE SET description = @d`, { id, d: desc });
  }

  for (const [id, role] of Object.entries(ROLES)) {
    await run(`INSERT INTO roles (id, name, description, rank) VALUES (@id, @n, @d, @r)
               ON CONFLICT(id) DO UPDATE SET name=@n, rank=@r`,
              { id, n: role.name, d: role.name, r: role.rank });
    await run('DELETE FROM role_permissions WHERE role_id = @id', { id });
    const perms = role.perms.includes('*') ? Object.keys(PERMISSIONS) : role.perms;
    for (const p of perms) {
      await run(`INSERT INTO role_permissions (role_id, permission_id) VALUES (@r, @p)
                 ON CONFLICT DO NOTHING`, { r: id, p });
    }
  }

  for (const t of DEFAULT_TEMPLATES) {
    const exists = await get('SELECT id FROM email_templates WHERE id = @id', { id: t.id });
    if (!exists) {
      await run(`INSERT INTO email_templates (id, name, subject, body_html, enabled, updated_at)
                 VALUES (@id, @name, @subject, @body, 1, @at)`,
                { id: t.id, name: t.name, subject: t.subject, body: t.body_html, at });
    }
  }

  console.log(`Seed complete: ${Object.keys(ROLES).length} roles, ` +
    `${Object.keys(PERMISSIONS).length} permissions, ${DEFAULT_TEMPLATES.length} templates.`);
}

/** True when core config has been seeded (used by lazy serverless bootstrap). */
export async function isSeeded() {
  const row = await get('SELECT 1 AS x FROM roles LIMIT 1');
  return !!row;
}

/** Promote a user to a role by email — used for bootstrapping the first owner. */
export async function grantRoleByEmail(email, roleId) {
  const user = await get('SELECT id FROM users WHERE email = @e', { e: email.toLowerCase() });
  if (!user) throw new Error(`No user with email ${email}`);
  if (!(await get('SELECT id FROM roles WHERE id = @r', { r: roleId }))) {
    throw new Error(`No role ${roleId}`);
  }
  await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, @r, @at)
             ON CONFLICT(user_id, role_id) DO NOTHING`,
            { u: user.id, r: roleId, at: nowIso() });
  console.log(`Granted ${roleId} to ${email}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , cmd, ...args] = process.argv;
  const job = cmd === 'grant' ? grantRoleByEmail(args[0], args[1]) : seed();
  job.then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
