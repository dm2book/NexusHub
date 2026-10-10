/**
 * The platform a game-currency code is tied to, read from the product.
 *
 * FC Points, COD Points and Apex Coins bought for PlayStation do not work on
 * Xbox or PC. That is the single most likely wrong purchase in this shop, so it
 * is said where the choice is made — on the card and next to the name — and
 * only when the product actually names one. A gift card for the PlayStation
 * Store IS that store; it gets no platform chip, its name already says it.
 */
const PLATFORMS = [
  ['playstation', 'PlayStation', /\b(playstation|ps[45]|psn)\b/i, '#0070d1'],
  ['xbox', 'Xbox', /\bxbox\b/i, '#107c10'],
  ['pc', 'PC', /\bpc\b/i, '#334155'],
  ['switch', 'Nintendo Switch', /\b(nintendo\s*)?switch\b/i, '#e60012'],
];
const NOT_PLATFORM_BOUND = new Set(['giftcard', 'gamepass', 'subscription', 'discord-nitro', 'spotify']);

/** { id, label, color } or null. metadata.platform wins over the name. */
export function platformOf(product) {
  if (!product || NOT_PLATFORM_BOUND.has(product.category)) return null;
  const meta = product.metadata || {};
  const named = String(meta.platform || '').toLowerCase();
  const hit = PLATFORMS.find(([id]) => id === named) || PLATFORMS.find(([, , re]) => re.test(String(product.name || '')));
  return hit ? { id: hit[0], label: hit[1], color: hit[3] } : null;
}
