/**
 * What an ad shows of a product: its card, its brand's colours, its platform.
 *
 * The ads drew the category's generic 3D icon on the same dark purple for every
 * product — a hexagon for Robux, a disc for V-Bucks — while the shop itself
 * shows a proper card per product: the owner's own artwork where it exists,
 * otherwise a store card in the brand's own colours with its logo and amount
 * (/api/products/:id/tile.svg, scripts/art/render.mjs cardSvg). Competitor ads
 * lead with exactly that: the product, big, in its own colours. So the ads now
 * use the same card and the same palette the storefront does.
 *
 * Both are same-origin, so a canvas that draws them can still be recorded.
 */
import { THEMES } from '../../../../scripts/art/render.mjs';
import { brandSlug } from '../productFitService.js';
import { platformOf } from '../../../../src/lib/platform.js';

const parse = (m) => { try { return typeof m === 'string' ? JSON.parse(m || '{}') : (m || {}); } catch { return {}; } };

/** The product's card: the owner's uploaded artwork, else the drawn store card. */
export function adImage(row) {
  if (!row?.id) return null;
  const meta = parse(row.metadata);
  const own = typeof meta.image === 'string' && /^\/api\/images\//.test(meta.image) ? meta.image : null;
  return own || `/api/products/${row.id}/tile.svg`;
}

/** The brand palette the product's card is drawn in: { bg, accent, deep }. */
export function adTheme(row) {
  const brand = brandSlug(row?.name || '');
  const key = brand && THEMES[brand] ? brand : THEMES[row?.category] ? row.category : 'giftcard';
  const [bg, accent, deep] = THEMES[key];
  /* Robux's palette is grey on grey — right for a card, flat for a whole
     frame. Its frame gets Roblox's own blue-green glow instead of white. */
  return key === 'robux' ? { key, bg: '#14202b', accent: '#00b06f', deep: '#070b10' } : { key, bg, accent, deep };
}

/** The platform the code is bound to ("PlayStation"), or null. */
export function adPlatform(row) {
  const p = platformOf({ ...row, metadata: parse(row?.metadata) });
  return p ? { label: p.label, color: p.color } : null;
}
