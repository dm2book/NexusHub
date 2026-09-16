/**
 * The brand banners, and the one place their URLs are written.
 *
 * Discord caches an embed image by URL and does not look at it again, so a
 * redrawn banner reaches nobody unless the URL changes with it. The version is
 * therefore the artwork's own hash rather than a number somebody remembers to
 * bump: regenerate with `node scripts/art/social-generate.mjs` and paste the
 * hashes it prints.
 *
 * It exists because there were three copies of these URLs, on two different
 * file extensions and two different versions:
 *
 *   · discord/src/config.js  the panels, on `?v=2`
 *   · discord/src/bot.js     its own BANNER() helper, also on `?v=2`
 *   · this server            drop and coupon announcements, with no version
 *                            at all — so those embeds would have kept showing
 *                            the old artwork forever, and nothing said so
 *
 * The bot tree keeps its own copy of the map, because its Docker image copies
 * only `discord/` and cannot import this file. That duplicate is deliberate and
 * checked: server/test/creative-freshness.test.mjs fails if the two disagree.
 *
 * JPEG, not PNG: these are full-bleed gradients, the one thing PNG is worst at.
 * Measured on the welcome banner — PNG 888KB, JPEG q92 118KB, and no visible
 * difference at the size Discord shows them.
 */
export const BANNER_VERSION = {
  welcome: 'ff710d19',
  rules: 'e144095a',
  verify: '67cbd42f',
  products: '750e032b',
  deals: 'fe6d198c',
  giveaways: 'e9aa014e',
  support: '4e29c726',
  vouches: 'e9958175',
};

/** The file name on disk, under public/discord/. */
export const bannerFile = (name) => `banner-${name}.jpg`;

/**
 * The absolute URL for a banner.
 *
 * An unknown name falls back to `products` rather than interpolating
 * `undefined` into the path: a kind that was not in the map built
 * /discord/banner-undefined.png, which Discord renders as a broken image.
 */
export const bannerUrl = (name, base = '') => {
  const key = Object.hasOwn(BANNER_VERSION, name) ? name : 'products';
  return `${base}/discord/${bannerFile(key)}?v=${BANNER_VERSION[key]}`;
};
