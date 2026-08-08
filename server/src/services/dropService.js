/**
 * Drop calendar — scheduled restocks, launches and sales. Staff add entries;
 * the storefront shows the upcoming ones so customers know what's coming.
 */
import { all, get, run, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { badRequest } from '../utils/errors.js';
import { postDropEvent } from './discordService.js';

/** Upcoming drops (future or started < 24h ago), soonest first. */
export function listUpcoming(limit = 30) {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  return all(
    `SELECT id, title, category, note, starts_at AS "startsAt" FROM drops
      WHERE starts_at >= @since ORDER BY starts_at ASC LIMIT @l`, { since, l: limit });
}

/** Full list for admin (past + future). */
export function listAll(limit = 100) {
  return all(
    `SELECT id, title, category, note, starts_at AS "startsAt", created_at AS "createdAt"
       FROM drops ORDER BY starts_at DESC LIMIT @l`, { l: limit });
}

export async function createDrop({ title, category, note, startsAt }, actorId = null) {
  const t = String(title || '').trim();
  if (!t) throw badRequest('Title is required');
  if (!startsAt || Number.isNaN(Date.parse(startsAt))) throw badRequest('A valid start date/time is required');
  const id = newId('drop');
  await run(
    `INSERT INTO drops (id, title, category, note, starts_at, created_by, created_at)
     VALUES (@id, @t, @cat, @note, @s, @by, @at)`,
    { id, t, cat: category || null, note: note || null, s: new Date(startsAt).toISOString(), by: actorId, at: nowIso() });
  const drop = await get('SELECT id, title, category, note, starts_at AS "startsAt" FROM drops WHERE id=@id', { id });
  postDropEvent('drop-scheduled', drop).catch(() => {}); // announce in Discord (best-effort)
  return drop;
}

export async function deleteDrop(id) {
  await run('DELETE FROM drops WHERE id=@id', { id });
}
