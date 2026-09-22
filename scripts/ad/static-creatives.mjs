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
 * All four were marked `retire` here, with the reason — and then kept shipping
 * for months, because marking a PNG does not redraw it and nothing in this
 * repo could. They are now drawn by scripts/art/social.mjs and the four claims
 * are gone: the welcome banner says what is sold, the support banner says a
 * person answers, the vouches banner describes the mechanism instead of
 * asserting buyers who do not exist yet, and og.png carries none of them.
 *
 * ── WHY THIS FILE NO LONGER RETYPES THE COPY ──────────────────────────────
 * It used to hold a hand-written `copy: [...]` per file, which was the best
 * available answer while the art came from outside the repo. It also meant the
 * test was reading a transcription, and a transcription can be wrong in the
 * one direction that matters: a banner could gain a claim and the record could
 * fail to mention it. Now that the artwork is generated FROM a spec, the spec
 * is the copy, and this derives from it. There is no second version to drift.
 *
 * `sha` stays written by hand. It pins each entry to the exact bytes it
 * describes, so a redrawn creative has to be acknowledged here rather than
 * quietly inheriting an old record. Regenerate with:
 *
 *     node scripts/art/social-generate.mjs
 */
import { SOCIAL, OG } from '../art/social.mjs';

/** Every word a spec prints, in the order it appears on the artwork. */
const wordsOf = (s) => [
  'FORGEMARKET',
  ...(s.chip ? [s.chip] : []),
  s.title,
  s.sub,
  ...(s.pills || []),
  ...(s.facts || []),
];

export const STATIC_CREATIVES = [
  {
    ...OG, size: OG.size || '1200x630', sha: '7dad09e14d9a0294',
    copy: wordsOf(OG),
  },
  ...SOCIAL.map((s) => ({
    file: s.file, where: s.where, size: '2200x720',
    sha: {
      welcome: 'ff710d194d40cd9a',
      rules: 'e144095a1328f01a',
      verify: '67cbd42fb88b01d7',
      products: '750e032b008da79f',
      deals: 'fe6d198c78fc9cac',
      giveaways: 'e9aa014e693c4327',
      support: '4e29c7265b55ff0b',
      vouches: 'e99581753a3b10df',
      'start-here': '228db0c3b53cf78f',
      'how-to-buy': '12f79c27e0b1d27c',
      announcements: '9d36d00304b5e62b',
      proof: '5f01c4498fd488a8',
      links: '228b0ba508f8ef8b',
      'report-a-scam': 'dc5fb25af96302b2',
      partners: '0f12430275ab9aee',
      roles: '7f8984bf84c6bef9',
      suggestions: '9a0f115b250bd283',
    }[s.id],
    copy: wordsOf(s),
  })),
];

/** The ones still shipping a claim the shop cannot back. */
export const retiring = () => STATIC_CREATIVES.filter((c) => c.retire);
