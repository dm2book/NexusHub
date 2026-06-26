/**
 * Customer reviews / vouches. The Discord bot ingests `/vouch` posts here via a
 * secret-protected endpoint, and the storefront reads the visible ones.
 */
import { run, get, all, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';

/** Insert a review. De-dupes on external_id (the Discord message/user id). */
export async function addReview({ author, avatarUrl, stars, body, product, source = 'discord', externalId }) {
  const clean = String(body || '').trim().slice(0, 600);
  if (!clean) throw new Error('Empty review');
  const s = Math.min(5, Math.max(1, Number(stars) || 5));
  if (externalId) {
    const dupe = await get(`SELECT id FROM reviews WHERE external_id = @e`, { e: String(externalId) });
    if (dupe) return { id: dupe.id, deduped: true };
  }
  const id = newId('rev');
  await run(
    `INSERT INTO reviews (id, author, avatar_url, stars, body, product, source, external_id, status, created_at)
     VALUES (@id, @author, @avatar, @stars, @body, @product, @source, @ext, 'visible', @at)`,
    { id, author: String(author || 'Anonymous').slice(0, 80), avatar: avatarUrl || null,
      stars: s, body: clean, product: product || null, source, ext: externalId || null, at: nowIso() });
  return { id, deduped: false };
}

/** Visible reviews, newest first. */
export async function listReviews({ limit = 24 } = {}) {
  return all(
    `SELECT id, author, avatar_url AS avatarUrl, stars, body, product, source, created_at AS createdAt
       FROM reviews WHERE status='visible' ORDER BY created_at DESC LIMIT @limit`,
    { limit: Math.min(100, Math.max(1, limit)) });
}

/** Aggregate rating + count over visible reviews. */
export async function reviewStats() {
  const r = await get(
    `SELECT COUNT(*) AS n, COALESCE(AVG(stars),0) AS avg FROM reviews WHERE status='visible'`);
  return { count: Number(r?.n || 0), average: Math.round(Number(r?.avg || 0) * 10) / 10 };
}
