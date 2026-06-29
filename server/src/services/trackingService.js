/**
 * Privacy-friendly visitor analytics. We record anonymous page views keyed by a
 * random client-generated session id (no IP, no PII) so we can count REAL unique
 * visitors and compute a true conversion rate. Best-effort: tracking never throws
 * into a request.
 */
import { run, get, all, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';

const clip = (s, n) => (s == null ? null : String(s).slice(0, n));

export async function recordPageView({ sessionId, path, referrer, userId } = {}) {
  try {
    const sid = clip(sessionId, 64);
    if (!sid) return;
    await run(
      `INSERT INTO page_views (id, session_id, path, referrer, user_id, created_at)
       VALUES (@id, @sid, @path, @ref, @uid, @at)`,
      { id: newId('pv'), sid, path: clip(path, 300), ref: clip(referrer, 300),
        uid: userId || null, at: nowIso() });
  } catch (e) { console.error('[track] pageview', e.message); }
}

const sinceIso = (days) => new Date(Date.now() - days * 86_400_000).toISOString();

/** Unique visitors (distinct session ids) + total page views over a window. */
export async function visitorStats({ days = 30 } = {}) {
  const since = sinceIso(days);
  const r = await get(
    `SELECT COUNT(DISTINCT session_id) AS visitors, COUNT(*) AS views
       FROM page_views WHERE created_at > @since`, { since });
  return { uniqueVisitors: Number(r?.visitors || 0), pageViews: Number(r?.views || 0) };
}

/** Daily unique-visitor series for charts. */
export async function visitorSeries({ days = 30 } = {}) {
  const since = sinceIso(days);
  const rows = await all(
    `SELECT substr(created_at,1,10) AS day, COUNT(DISTINCT session_id) AS visitors
       FROM page_views WHERE created_at > @since
      GROUP BY day ORDER BY day ASC`, { since });
  return rows.map((r) => ({ day: r.day, visitors: Number(r.visitors) }));
}
