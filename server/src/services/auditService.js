/**
 * Append-only audit logging for security-relevant actions. Audit entries are
 * never updated or deleted by the application.
 */
import { run, all, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';

/**
 * Record an audit event. Awaitable so the write completes before a serverless
 * function suspends.
 */
export async function audit(e) {
  await run(`INSERT INTO audit_logs
        (id, actor_id, actor_email, action, target_type, target_id, ip, user_agent, metadata, created_at)
       VALUES (@id, @aid, @aemail, @action, @tt, @tid, @ip, @ua, @meta, @at)`, {
    id: newId('aud'),
    aid: e.actor?.id || null,
    aemail: e.actor?.email || null,
    action: e.action,
    tt: e.targetType || null,
    tid: e.targetId || null,
    ip: e.req?.ip || e.ip || null,
    ua: e.req?.get?.('user-agent') || null,
    meta: e.metadata ? JSON.stringify(e.metadata) : null,
    at: nowIso(),
  });
}

export async function listAuditLogs({ limit = 100, offset = 0, action, targetId } = {}) {
  const where = [];
  const params = { limit, offset };
  if (action) { where.push('action = @action'); params.action = action; }
  if (targetId) { where.push('target_id = @targetId'); params.targetId = targetId; }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return all(`SELECT * FROM audit_logs ${clause}
              ORDER BY created_at DESC LIMIT @limit OFFSET @offset`, params);
}
