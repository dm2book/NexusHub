/**
 * Customer reviews / vouches. The Discord bot ingests `/vouch` posts here via a
 * secret-protected endpoint, and the storefront reads the visible ones.
 */
import { run, get, all, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { bustSocialCaches } from '../routes/social.js';

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
  bustSocialCaches(); // rating + review count changed → refresh public stats now
  return { id, deduped: false };
}

/**
 * Add a VERIFIED review tied to a real, completed order. One review per order
 * (enforced by a unique index + an explicit check). Only callable from the
 * authenticated account flow, so the "Verified buyer" badge is trustworthy.
 */
export async function addVerifiedReview({ userId, email, orderId, author, stars, body, product, city }) {
  const clean = String(body || '').trim().slice(0, 600);
  if (clean.length < 3) throw new Error('Please write a few words about your purchase.');
  const s = Math.min(5, Math.max(1, Number(stars) || 5));
  const dupe = await get(`SELECT id FROM reviews WHERE order_id = @o`, { o: orderId });
  if (dupe) return { id: dupe.id, deduped: true };
  const id = newId('rev');
  await run(
    `INSERT INTO reviews (id, author, stars, body, product, source, status, verified, order_id, user_id, email, city, created_at)
     VALUES (@id, @author, @stars, @body, @product, 'purchase', 'visible', 1, @oid, @uid, @email, @city, @at)`,
    { id, author: String(author || 'Verified buyer').slice(0, 80), stars: s, body: clean,
      product: product || null, oid: orderId, uid: userId || null,
      email: email ? String(email).toLowerCase() : null, city: city || null, at: nowIso() });
  bustSocialCaches(); // verified review just added → the average rating updates instantly
  return { id, deduped: false };
}

/** Visible reviews, newest first. */
export async function listReviews({ limit = 24 } = {}) {
  return all(
    `SELECT id, author, avatar_url AS avatarUrl, stars, body, product, source,
            verified, city, created_at AS createdAt
       FROM reviews WHERE status='visible' ORDER BY verified DESC, created_at DESC LIMIT @limit`,
    { limit: Math.min(100, Math.max(1, limit)) });
}

// ── Admin moderation ────────────────────────────────────────────────────────

/** All reviews (any status) for the moderation queue, newest first. */
export async function listReviewsAdmin({ limit = 200 } = {}) {
  return all(
    `SELECT id, author, stars, body, product, source, status, verified, city,
            order_id AS orderId, created_at AS createdAt
       FROM reviews ORDER BY created_at DESC LIMIT @limit`,
    { limit: Math.min(500, Math.max(1, limit)) });
}

export async function setReviewStatus(id, status) {
  if (!['visible', 'hidden'].includes(status)) throw new Error('Bad status');
  const r = await run('UPDATE reviews SET status=@s WHERE id=@id', { s: status, id });
  return (r?.changes || 0) > 0;
}

export async function setReviewVerified(id, verified) {
  const r = await run('UPDATE reviews SET verified=@v WHERE id=@id', { v: verified ? 1 : 0, id });
  return (r?.changes || 0) > 0;
}

export async function deleteReview(id) {
  const r = await run('DELETE FROM reviews WHERE id=@id', { id });
  return (r?.changes || 0) > 0;
}

/** Aggregate rating + count over visible reviews. */
export async function reviewStats() {
  const r = await get(
    `SELECT COUNT(*) AS n, COALESCE(AVG(stars),0) AS avg FROM reviews WHERE status='visible'`);
  return { count: Number(r?.n || 0), average: Math.round(Number(r?.avg || 0) * 10) / 10 };
}
