/**
 * Customer reviews / vouches. The Discord bot ingests `/vouch` posts here via a
 * secret-protected endpoint, and the storefront reads the visible ones.
 */
import { run, get, all, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { bustSocialCaches } from '../routes/social.js';
import { postReviewEvent } from './discordService.js';

/** Insert a review. De-dupes on external_id (the Discord message/user id). */
export async function addReview({ author, avatarUrl, stars, body, product, source = 'discord', externalId, discordUid = null }) {
  const clean = String(body || '').trim().slice(0, 600);
  if (!clean) throw new Error('Empty review');
  const s = Math.min(5, Math.max(1, Number(stars) || 5));
  if (externalId) {
    const dupe = await get(`SELECT id FROM reviews WHERE external_id = @e`, { e: String(externalId) });
    if (dupe) return { id: dupe.id, deduped: true };
  }
  const id = newId('rev');
  /* Unverified reviews wait for a person.
     This is the ingest a Discord /vouch lands on, and the role that unlocks it
     confirms somebody is human, not that they ever bought anything. Published
     on arrival, one message typed in the server was live on the storefront
     immediately — under the shop's own name, next to reviews from real orders.
     Verified ones (addVerifiedReview) still publish instantly: they are tied to
     a completed order, so there is nothing left to check. */
  await run(
    `INSERT INTO reviews (id, author, avatar_url, stars, body, product, source, external_id, discord_uid, status, created_at)
     VALUES (@id, @author, @avatar, @stars, @body, @product, @source, @ext, @duid, 'pending', @at)`,
    { id, author: String(author || 'Anonymous').slice(0, 80), avatar: avatarUrl || null,
      stars: s, body: clean, product: product || null, source, ext: externalId || null,
      duid: discordUid ? String(discordUid) : null, at: nowIso() });
  /* No cache bust, no relay, no role — none of it has happened yet.
     A pending review is not on the site, does not move the rating, and has not
     earned anything. publishReview() below does all three at the moment it
     actually becomes public, which is also what stops the role being handed out
     for something a moderator then hides. */
  return { id, deduped: false, pending: true };
}

/**
 * Give the reviewer role, from either side of the ecosystem.
 *
 * Fire-and-forget: a review must never fail because Discord is unreachable, and
 * the maintenance sweep re-syncs anyone this misses. Resolving a Discord id back
 * to an account is what lets a `/vouch` typed in the server earn a role driven
 * by the site.
 */
function rewardReviewer({ userId = null, discordUid = null }) {
  (async () => {
    const { syncMemberRoles, userIdForDiscordUid } = await import('./discordRolesService.js');
    const id = userId || await userIdForDiscordUid(discordUid);
    if (id) await syncMemberRoles(id, { reason: 'review published' });
  })().catch((e) => console.error('[reviews] reviewer role:', e.message));
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
  /* The check above is a courtesy; idx_reviews_order is the rule.
     Between the SELECT and the INSERT sits a window, and a double-tapped submit
     button is enough to land in it — the loser hit a unique violation that
     travelled all the way out as a 500, telling a customer their review broke
     the site when it had in fact just been saved by their other click. */
  try {
    await run(
      `INSERT INTO reviews (id, author, stars, body, product, source, status, verified, order_id, user_id, email, city, created_at)
       VALUES (@id, @author, @stars, @body, @product, 'purchase', 'visible', 1, @oid, @uid, @email, @city, @at)`,
      { id, author: String(author || 'Verified buyer').slice(0, 80), stars: s, body: clean,
        product: product || null, oid: orderId, uid: userId || null,
        email: email ? String(email).toLowerCase() : null, city: city || null, at: nowIso() });
  } catch (err) {
    if (err?.code === '23505') {
      const won = await get(`SELECT id FROM reviews WHERE order_id = @o`, { o: orderId });
      if (won) return { id: won.id, deduped: true };
    }
    throw err;
  }
  bustSocialCaches(); // verified review just added → the average rating updates instantly
  // This is the one that matters: a review tied to a real, completed order.
  postReviewEvent({ author, stars: s, body: clean, product, verified: true, city })
    .catch((e) => console.error('[reviews] discord relay:', e.message));
  rewardReviewer({ userId });
  return { id, deduped: false };
}

/**
 * Visible reviews, newest first, each with the author's reputation.
 *
 * The counts come back in the same query rather than one lookup per review —
 * a list of twenty-four reviews would otherwise be twenty-five round trips, and
 * this is rendered on the homepage.
 *
 * A review with no account behind it (a Discord vouch) gets no level at all
 * instead of the lowest one: "New here" is a statement about someone, and we do
 * not know who this is.
 */
export async function listReviews({ limit = 24 } = {}) {
  const rows = await all(
    `SELECT r.id, r.author, r.avatar_url AS "avatarUrl", r.stars, r.body, r.product,
            r.source, r.verified, r.city, r.created_at AS "createdAt", r.user_id AS "userId",
            (SELECT COUNT(*) FROM reviews x
              WHERE x.user_id = r.user_id AND x.status='visible' AND x.verified=1) AS "revCount",
            (SELECT COUNT(*) FROM orders o
              WHERE o.user_id = r.user_id AND o.status='completed') AS "orderCount"
       FROM reviews r
      WHERE r.status='visible'
      ORDER BY r.verified DESC, r.created_at DESC LIMIT @limit`,
    { limit: Math.min(100, Math.max(1, limit)) });

  return rows.map(({ userId, revCount, orderCount, ...rev }) => ({
    ...rev,
    reputation: userId
      ? (({ key, label }) => ({ key, label }))(
        reputationFor({ reviews: Number(revCount || 0), orders: Number(orderCount || 0) }))
      : null,
  }));
}

// ── Admin moderation ────────────────────────────────────────────────────────

/** All reviews (any status) for the moderation queue, newest first. */
export async function listReviewsAdmin({ limit = 200 } = {}) {
  return all(
    `SELECT id, author, stars, body, product, source, status, verified, city,
            order_id AS "orderId", created_at AS "createdAt"
       FROM reviews ORDER BY created_at DESC LIMIT @limit`,
    { limit: Math.min(500, Math.max(1, limit)) });
}

/**
 * Move a review between pending, published and hidden.
 *
 * Publishing is the moment everything downstream happens: the public rating
 * changes, the community hears about it, and the author earns the reviewer
 * role. Doing that on arrival instead meant a vouch that a moderator then hid
 * had already moved the number and already paid out.
 *
 * Only the transition INTO visible fires them, and only from a row that was not
 * already visible — so re-approving something twice, or an admin clicking the
 * button again, changes nothing.
 */
export async function setReviewStatus(id, status) {
  if (!['visible', 'hidden', 'pending'].includes(status)) throw new Error('Bad status');
  const before = await get('SELECT status, verified, user_id, discord_uid FROM reviews WHERE id=@id', { id });
  if (!before) return false;
  const r = await run('UPDATE reviews SET status=@s WHERE id=@id AND status <> @s', { s: status, id });
  if (!r?.changes) return false;
  if (status === 'visible') await publishReview(id);
  else bustSocialCaches();   // a hidden review no longer counts towards the rating
  return true;
}

/** Everything that happens the moment a review becomes public. */
async function publishReview(id) {
  const rev = await get(
    `SELECT author, stars, body, product, verified, city, user_id AS "userId",
            discord_uid AS "discordUid", source
       FROM reviews WHERE id=@id`, { id });
  if (!rev) return;
  bustSocialCaches();
  // A Discord vouch already lives in Discord; relaying it would echo the channel.
  if (rev.source !== 'discord') {
    postReviewEvent({
      author: rev.author, stars: rev.stars, body: rev.body,
      product: rev.product, verified: !!rev.verified, city: rev.city,
    }).catch((e) => console.error('[reviews] discord relay:', e.message));
  }
  if (rev.userId || rev.discordUid) {
    rewardReviewer({ userId: rev.userId, discordUid: rev.discordUid });
  }
}

/** Reviews waiting for a decision, oldest first — the queue is a to-do list. */
export async function listPendingReviews({ limit = 100 } = {}) {
  return all(
    `SELECT id, author, stars, body, product, source, verified,
            discord_uid AS "discordUid", created_at AS "createdAt"
       FROM reviews WHERE status='pending' ORDER BY created_at ASC LIMIT @limit`,
    { limit: Math.min(500, Math.max(1, limit)) });
}

export async function setReviewVerified(id, verified) {
  const r = await run('UPDATE reviews SET verified=@v WHERE id=@id', { v: verified ? 1 : 0, id });
  return (r?.changes || 0) > 0;
}

export async function deleteReview(id) {
  const r = await run('DELETE FROM reviews WHERE id=@id', { id });
  return (r?.changes || 0) > 0;
}

/**
 * Reputation, from what the shop can actually prove.
 *
 * Not a score anyone can farm: every input is an event this database recorded —
 * orders that reached `completed`, and reviews that were published against one.
 * There is no "helpful" button to game and no points for posting, because a
 * reputation you can type your way to says nothing about the person.
 *
 * The levels are deliberately few and plainly named. "Regular" is not a claim
 * about someone's character, it is three delivered orders.
 */
export const REPUTATION_LEVELS = [
  { key: 'top',      label: 'Top reviewer', minReviews: 3, minOrders: 3 },
  { key: 'trusted',  label: 'Trusted buyer', minReviews: 1, minOrders: 3 },
  { key: 'regular',  label: 'Regular',       minReviews: 0, minOrders: 3 },
  { key: 'reviewer', label: 'Reviewer',      minReviews: 1, minOrders: 1 },
  { key: 'buyer',    label: 'Verified buyer', minReviews: 0, minOrders: 1 },
  { key: 'new',      label: 'New here',      minReviews: 0, minOrders: 0 },
];

/** The highest level whose thresholds are all met. */
export function reputationFor({ reviews = 0, orders = 0 } = {}) {
  return REPUTATION_LEVELS.find((l) => reviews >= l.minReviews && orders >= l.minOrders)
    || REPUTATION_LEVELS[REPUTATION_LEVELS.length - 1];
}

/**
 * Reputation for one account, counted rather than stored.
 *
 * Kept as a query instead of a column so it cannot drift: a refunded order stops
 * counting the moment it is refunded, and a hidden review stops counting the
 * moment it is hidden. A cached number would have gone on flattering somebody
 * whose orders were all charged back.
 */
export async function reputationOf(userId) {
  if (!userId) return { ...reputationFor({}), reviews: 0, orders: 0 };
  const r = await get(
    `SELECT
       (SELECT COUNT(*) FROM reviews WHERE user_id = @u AND status='visible' AND verified=1) AS reviews,
       (SELECT COUNT(*) FROM orders  WHERE user_id = @u AND status='completed') AS orders`,
    { u: userId });
  const reviews = Number(r?.reviews || 0);
  const orders = Number(r?.orders || 0);
  return { ...reputationFor({ reviews, orders }), reviews, orders };
}

/** Aggregate rating + count over visible reviews. */
export async function reviewStats() {
  // Verified only — a review tied to a real delivered order.
  //
  // The public star rating drives the homepage, the Trust Center and the
  // Product structured data Google shows as stars. It used to average every
  // visible review, and a Discord /vouch counts as visible: the role that
  // unlocks it only confirms you are human, not that you ever bought anything.
  // One five-star from every member of a server would have moved the number the
  // whole shop is judged on.
  //
  // Vouches still show on the site as community vouches. They just no longer
  // vote on a rating that claims to come from customers.
  const r = await get(
    `SELECT COUNT(*) AS n, COALESCE(AVG(stars),0) AS avg
       FROM reviews WHERE status='visible' AND verified=1`);
  return { count: Number(r?.n || 0), average: Math.round(Number(r?.avg || 0) * 10) / 10 };
}

/**
 * The numbers behind the number.
 *
 * `count` and `average` alone say "4.8 from 12 reviews", which a shopper cannot
 * check and a shop owner cannot act on. The rest is the part that is actually
 * useful: how the stars are spread, how many delivered orders ended in a
 * review, and whether the recent ones look like the old ones.
 *
 * Everything is counted from rows that exist. Nothing is estimated, and a shop
 * with no reviews gets zeros and nulls rather than a flattering default —
 * `average` is null, not 5, because "no reviews yet" and "perfect score" are
 * opposite statements.
 */
export async function reviewInsights({ recentDays = 90 } = {}) {
  const since = new Date(Date.now() - recentDays * 864e5).toISOString();

  const [totals, spread, recent, coverage, pending] = await Promise.all([
    get(`SELECT COUNT(*) FILTER (WHERE verified=1) AS verified,
                COUNT(*) FILTER (WHERE verified=0) AS vouches,
                COALESCE(AVG(stars) FILTER (WHERE verified=1), 0) AS avg
           FROM reviews WHERE status='visible'`),
    all(`SELECT stars, COUNT(*)::int AS n FROM reviews
          WHERE status='visible' AND verified=1 GROUP BY stars`),
    get(`SELECT COUNT(*) AS n, COALESCE(AVG(stars),0) AS avg FROM reviews
          WHERE status='visible' AND verified=1 AND created_at > @since`, { since }),
    /* How many delivered orders came back with a review. The honest denominator
       is orders that were ASKED — an order completed an hour ago has not had
       its request yet, and counting it would make the rate look worse the
       better the shop is doing. */
    get(`SELECT COUNT(*) AS asked,
                COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM reviews r WHERE r.order_id = o.id)) AS reviewed
           FROM orders o WHERE o.status='completed' AND o.review_request_sent_at IS NOT NULL`),
    get(`SELECT COUNT(*) AS n FROM reviews WHERE status='pending'`),
  ]);

  const verified = Number(totals?.verified || 0);
  const distribution = Object.fromEntries([5, 4, 3, 2, 1].map((n) => [n, 0]));
  for (const row of spread) distribution[Number(row.stars)] = Number(row.n);

  const asked = Number(coverage?.asked || 0);
  const reviewed = Number(coverage?.reviewed || 0);
  const recentN = Number(recent?.n || 0);

  return {
    // The two the storefront already renders, unchanged in meaning.
    count: verified,
    average: verified ? Math.round(Number(totals.avg) * 10) / 10 : null,
    // Vouches are shown on the site but never vote on the rating — see above.
    vouches: Number(totals?.vouches || 0),
    pending: Number(pending?.n || 0),
    distribution,
    // Share of published verified reviews at 4★ or better.
    positiveShare: verified
      ? Math.round(((distribution[5] + distribution[4]) / verified) * 100) : null,
    recent: {
      days: recentDays,
      count: recentN,
      average: recentN ? Math.round(Number(recent.avg) * 10) / 10 : null,
    },
    coverage: {
      asked,
      reviewed,
      percent: asked ? Math.round((reviewed / asked) * 100) : null,
    },
  };
}
