/** In-app notifications (the customer dashboard "Notifications" feed). */
import { run, all, get, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';

export function notify(userId, { type, title, body, link } = {}) {
  if (!userId) return null;
  const id = newId('ntf');
  run(`INSERT INTO notifications (id, user_id, type, title, body, link, created_at)
       VALUES (@id, @uid, @type, @title, @body, @link, @at)`,
      { id, uid: userId, type: type || 'system', title, body: body || null,
        link: link || null, at: nowIso() });
  return id;
}

export function listNotifications(userId, { unreadOnly = false } = {}) {
  const clause = unreadOnly ? 'AND read_at IS NULL' : '';
  return all(`SELECT * FROM notifications WHERE user_id = @uid ${clause}
              ORDER BY created_at DESC LIMIT 100`, { uid: userId });
}

export function unreadCount(userId) {
  return get(`SELECT COUNT(*) AS n FROM notifications
              WHERE user_id = @uid AND read_at IS NULL`, { uid: userId }).n;
}

export function markRead(userId, id) {
  run(`UPDATE notifications SET read_at = @at WHERE id = @id AND user_id = @uid`,
      { at: nowIso(), id, uid: userId });
}

export function markAllRead(userId) {
  run(`UPDATE notifications SET read_at = @at WHERE user_id = @uid AND read_at IS NULL`,
      { at: nowIso(), uid: userId });
}
