/**
 * Which brand marks are raster, and why that list is short.
 *
 * ── ONE LIST, THREE READERS ───────────────────────────────────────────────
 * This decision used to be written out three times — src/lib/sampleCatalog.js,
 * server/src/db/demoSeed.js and scripts/art/render.mjs — each with a comment
 * telling the reader to keep it in sync with the others. That is the same shape
 * as every drift this codebase has shipped: carriesOwnBackground in catalog.js
 * and seo.js, the Roblox delivery sentence in deliveryInfo.js and the Discord
 * bot. So the list lives here once and the three read it.
 *
 * ── WHY ONLY FOUR ─────────────────────────────────────────────────────────
 * Ten categories had a WebP mark. Rendered side by side at 46 CSS px — the size
 * a phone's product grid actually gives a mark — six of them failed:
 *
 *   cod            a black box with the CALL OF DUTY wordmark. A wordmark at
 *                  46px is texture, and pure black on a dark artboard is a hole.
 *   discord-nitro  a grey-blue abstract blob. Not Discord's mark, not legible,
 *                  and not purple — on the one product named after Discord.
 *   eafc           a photograph of a pile of FC Points cards. Photographic
 *                  noise, unreadable at any small size.
 *   giftcard       a photograph of a gift card, its own small print included.
 *   v-bucks        a photograph of a pile of coins.
 *   steam          the real Steam logo, but dark navy on a near-black board.
 *                  The vector twin is the same logo in steel and reads.
 *
 * In each of those six the SVG in the repo is a clean, legible, on-brand icon,
 * so the raster was costing legibility AND bytes AND resolution independence.
 *
 * The four that remain are the ones where the raster genuinely is the
 * rights-holder's mark and the vector twin is a generic stand-in: the Roblox
 * hexagon, the PlayStation logo, the Valorant disc, the Xbox sphere. Swapping
 * those would replace a real trademark with something a tool drew, which is a
 * worse mistake than a soft edge.
 */
export const RASTER_ICONS = new Set(['playstation', 'robux', 'valorant', 'xbox']);

/** Path to a brand mark by its own slug — the one place the extension is chosen. */
export const markPath = (slug) => `/products/icons/${slug}.${RASTER_ICONS.has(slug) ? 'webp' : 'svg'}`;
