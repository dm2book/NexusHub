/**
 * The shop's own artwork on every product — the look of the products the owner
 * made by hand (the EA FC cards): a dark board with the brand's mark and the
 * product's OWN amount.
 *
 * Where the shop ships a drawn board for exactly this product (public/products/
 * art, matched by SKU or by shelf and amount) that file is used; otherwise the
 * same board is drawn live for this product at /api/products/:id/tile.svg
 * (productFitService.renderTileArt — the same renderer as the shipped files).
 * Either way the amount on the picture is the product's own: no picture is
 * borrowed from another product, so a 475 VP card never shows "1,000" and a
 * Netflix card never shows Apple.
 *
 * Never touched: the owner's own uploads — they ARE the look. Replaced: brand
 * logos, supplier photos, linked pictures, shop icons, empty pictures and
 * anything an earlier version of this borrowed. The picture it replaces is kept
 * in metadata.imagePrevious, so nothing is lost.
 */
import { all } from '../../db/index.js';
import { config } from '../../config/env.js';
import { matchArt, tilePath } from '../productFitService.js';

/* Applied by the scheduled run in production; elsewhere (tests, local) only
   when asked — the admin button and the add path always apply it. */
export const artworkEnabled = () => (process.env.DISCOVERY_ARTWORK ? process.env.DISCOVERY_ARTWORK === 'on' : config.isProd);

export const OWN = 'own-artwork';
const parse = (m) => { try { return typeof m === 'string' ? JSON.parse(m || '{}') : (m || {}); } catch { return {}; } };
const STORED = /^\/api\/images\//;

/** Is this the owner's own upload — the look, never replaced? */
export function isOwnerArtwork(meta = {}) {
  return STORED.test(String(meta.image || '')) && meta.source !== 'discovery'
    && [undefined, null, '', 'upload', 'official'].includes(meta.imageSource);
}

/** The shop's own board for one product: a shipped file for its amount, or the live board. */
export function artworkFor(product) {
  const meta = parse(product.metadata);
  const hit = matchArt({ sku: product.sku || meta.sku || null, name: product.name, category: product.category,
    denomination: meta.denomination ?? null });
  return hit.image ? { image: hit.image, from: hit.reason } : { image: tilePath(product.id), from: 'drawn for this product' };
}

/**
 * Put the shop's own board on every product that is not an owner upload.
 * Stops at `deadline` and carries on when called again — products already done
 * are unchanged. Returns { applied, unchanged, kept (owner uploads), remaining }.
 */
export async function applyCategoryArtwork({ actor = null, deadline = Infinity } = {}) {
  const { updateProduct } = await import('../productService.js');
  const rows = await all(`SELECT id, sku, name, category, metadata FROM products`);
  const out = { applied: 0, unchanged: 0, kept: 0, remaining: 0 };
  for (const r of rows) {
    if (Date.now() > deadline) { out.remaining += 1; continue; }
    const meta = parse(r.metadata);
    if (isOwnerArtwork(meta)) { out.kept += 1; continue; }
    if (r.category === 'mystery') { out.unchanged += 1; continue; }
    const art = artworkFor(r);
    if (meta.image === art.image && meta.imageSource === OWN) { out.unchanged += 1; continue; }
    const previous = meta.imageSource === OWN ? meta.imagePrevious : meta.image;
    // eslint-disable-next-line no-await-in-loop
    await updateProduct(r.id, { metadata: { ...meta, image: art.image, imageSource: OWN, imageFrom: art.from,
      imagePrevious: previous || null, imagePreviousSource: meta.imageSource === OWN ? meta.imagePreviousSource : (meta.imageSource || null),
      imageDisplay: undefined, imageLicence: undefined, imageAuthor: undefined, imageFile: undefined, imageOfficial: false,
      imageUpdatedAt: new Date().toISOString() } });
    out.applied += 1;
  }
  if (out.applied) {
    const { audit } = await import('../auditService.js');
    await audit({ actor, action: 'catalog.own_artwork', targetType: 'products', targetId: String(out.applied), metadata: out }).catch(() => {});
  }
  return out;
}
