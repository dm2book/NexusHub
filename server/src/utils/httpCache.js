/**
 * Shared-cache directives for responses every visitor gets identically.
 *
 * This lived as a private helper inside routes/catalog.js, which is why the
 * social-proof routes — written later, in another file — silently shipped with
 * no cache header at all and forwarded every single visit to the function. A
 * caching policy only one file can reach is a caching policy the next route
 * will forget.
 *
 * `stale-while-revalidate` is the important half: once the freshness window
 * passes, the next visitor still gets the cached copy instantly while the CDN
 * refreshes in the background. Nobody waits for a cold start.
 *
 * The cost is staleness, so this belongs only on responses that take no user,
 * no cookie and no language — anything order-specific or user-specific must
 * stay uncached, or one visitor's data is served to the next.
 */
export const publicCache = (res, seconds, swr = seconds * 10) => {
  res.set('Cache-Control', `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${swr}`);
};
