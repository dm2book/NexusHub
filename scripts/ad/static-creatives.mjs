/**
 * The words printed on every shipped raster creative, written down in text.
 *
 * ── WHY ───────────────────────────────────────────────────────────────────
 * honest-copy.test.mjs exists to stop this shop promising what it cannot do.
 * It reads .jsx and index.html. It cannot read a PNG — and that is exactly
 * where the claims it was written to remove survived:
 *
 *   og.png              "Digital goods, delivered instantly", "Instant
 *                       delivery", "4.9/5", "24/7 support" — on the card that
 *                       appears on every shared link.
 *   banner-welcome.png  "INSTANT DELIVERY", "Instant game top-ups, delivered
 *                       in seconds" — the header of the Discord server.
 *   banner-support.png  "24/7", "Open a ticket — we reply fast, 24/7".
 *   banner-vouches.png  "★★★★★", "Real buyers, real proof of delivery" — on a
 *                       shop with 0 orders and 0 reviews.
 *
 * Every one of those strings is on the banned list. The shop is one person; the
 * product pages say "delivered by hand, usually within a few hours" and "order
 * late at night and it goes out first thing in the morning"; /api/stats returns
 * reviews: 0 and rating: null.
 *
 * So the copy lives here, in text, and the test reads it like any other
 * buyer-facing surface. A creative whose copy trips the banned list must be
 * marked `retire` with the reason — which is a fact recorded in code review
 * rather than a claim hidden in pixels. `sha` pins the entry to the exact bytes
 * it describes, so a redrawn banner cannot quietly keep an old, wrong entry.
 *
 * Update path: replace the artwork, update `copy` and `sha`, drop `retire`.
 * Nothing else changes.
 */

export const STATIC_CREATIVES = [
  {
    file: 'public/og.png', sha: 'f349cd14f9bd970f', size: '1200x630',
    where: 'the link preview on every share, and the fallback share card for any product',
    copy: ['FORGEMARKET', 'Digital goods, delivered instantly',
      'Instant delivery', 'Buyer protection', '4.9/5', '24/7 support'],
    retire: 'claims instant delivery on a shop where 0 of 72 products auto-deliver, '
      + 'a 4.9/5 rating on 0 reviews, and 24/7 support from one person',
  },
  {
    file: 'public/discord/banner-welcome.png', sha: 'b2cd69b5cd51e7ec', size: '2200x720',
    where: 'the top of the Discord server',
    copy: ['FORGEMARKET', 'WELCOME', 'Instant game top-ups, delivered in seconds',
      'INSTANT DELIVERY', 'Robux', 'V-Bucks', 'Valorant', 'CoD', 'Apex', 'Nitro'],
    retire: 'says instant twice, and "delivered in seconds" is on the banned list verbatim',
  },
  {
    file: 'public/discord/banner-support.png', sha: 'e5e9d9e27ad3c243', size: '2200x720',
    where: 'the Discord support channel',
    copy: ['FORGEMARKET', 'SUPPORT', 'Open a ticket — we reply fast, 24/7',
      '24/7', 'Orders', 'Payments', 'Refunds', 'Partnerships'],
    retire: 'one person cannot answer 24/7, and the shop’s own delivery copy says '
      + 'a late-night order is handled the next morning',
  },
  {
    file: 'public/discord/banner-vouches.png', sha: '006de2e098570f41', size: '2200x720',
    where: 'the Discord vouches channel',
    copy: ['FORGEMARKET', 'VOUCHES & REVIEWS', 'Real buyers, real proof of delivery',
      'VERIFIED', 'Proof of delivery', 'Buyer-protected'],
    retire: 'a five-star row and "real buyers" on a shop that has never taken an order',
  },

  // ── The five that are already true ──────────────────────────────────────
  {
    file: 'public/discord/banner-deals.png', sha: '00c85d0a5bbc9a6a', size: '2200x720',
    where: 'the Discord deals channel',
    copy: ['FORGEMARKET', 'DROPS & DEALS', 'Flash sales, restocks & discount codes',
      'LIMITED TIME', 'Flash sales', 'Restocks', 'Coupons', 'VIP perks'],
  },
  {
    file: 'public/discord/banner-giveaways.png', sha: 'a73a50c86657c143', size: '2200x720',
    where: 'the Discord giveaways channel',
    copy: ['FORGEMARKET', 'GIVEAWAYS', 'Free drops for verified members, every week',
      'FREE STUFF', 'Weekly', 'VIP bonus entries', 'Real prizes'],
    // Not a delivery or rating claim, but it IS a cadence promise. It stays
    // true only while there really is a weekly giveaway.
    watch: '"every week" is a commitment, not a description — retire it if the cadence stops',
  },
  {
    file: 'public/discord/banner-products.png', sha: '2e5ecf8025efcd90', size: '2200x720',
    where: 'the Discord products channel',
    copy: ['FORGEMARKET', 'SHOP & PRICES', 'Live prices, synced straight from the store',
      'LIVE PRICES', 'Robux', 'V-Bucks', 'Valorant', 'Genshin', 'Brawl Stars'],
  },
  {
    file: 'public/discord/banner-rules.png', sha: 'efe8df32f5dbb0fa', size: '2200x720',
    where: 'the Discord rules channel',
    copy: ['FORGEMARKET', 'RULES', 'Keep it safe — staff never DM you first',
      'READ FIRST', 'Be respectful', 'No scams', 'One account'],
  },
  {
    file: 'public/discord/banner-verify.png', sha: '258e8c64c82a2daa', size: '2200x720',
    where: 'the Discord verify channel',
    copy: ['FORGEMARKET', 'VERIFY & UNLOCK', 'One tap opens the whole server',
      'SECURE', 'Marketplace', 'Community', 'Giveaways', 'Support'],
  },
];

/** The ones still shipping a claim the shop cannot back. */
export const retiring = () => STATIC_CREATIVES.filter((c) => c.retire);
