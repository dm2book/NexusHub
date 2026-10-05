/**
 * Product media: is each product's picture the real, official one — and how
 * good, and how fresh, is it?
 *
 * ── WHAT COUNTS AS OFFICIAL ───────────────────────────────────────────────
 * The publisher's own artwork as it reaches the shop through a channel the
 * shop is entitled to use:
 *   supplier   the product image a supplier returns through its own API for
 *              the listing the shop buys (Kinguin sends the publisher's cover
 *              art with every product) — see supplierImageService;
 *   official   a file the owner uploaded and marked as official artwork
 *              (a publisher press kit or a distributor's asset pack).
 * Never official: the shop's own drawn tiles and category icons, anything
 * generated, a stock photo, or an image found by searching the web. The shop
 * does not scrape: a picture with no licence behind it is not "official"
 * just because it shows the right logo.
 *
 * ── THE FOUR STATES THE ADMIN SEES ────────────────────────────────────────
 *   missing      no picture, or only a placeholder, icon, generated or drawn
 *                one, or an upload nobody marked as official
 *   low_quality  official, but too small or too badly shaped to sell with
 *   outdated     official, but not refreshed in MEDIA_MAX_AGE_DAYS (store
 *                artwork changes with seasons and redesigns)
 *   official     official, good, and recent
 *
 * Each product carries, in its metadata: imageSource, imageSourceUrl,
 * imageUpdatedAt, imageQuality (0–100), imageWidth, imageHeight and
 * imageOfficial.
 */
import { all } from '../db/index.js';
import { audit } from './auditService.js';

export const MEDIA_MAX_AGE_DAYS = Number(process.env.MEDIA_MAX_AGE_DAYS || 180);
export const MIN_QUALITY = 60;
export const STATUSES = ['missing', 'low_quality', 'outdated', 'own', 'official'];

const TILE = /^\/api\/products\/[^/]+\/tile\.svg$/;
const parse = (m) => { try { return typeof m === 'string' ? JSON.parse(m || '{}') : (m || {}); } catch { return {}; } };

/**
 * A 0–100 score for a picture as a shop image.
 *   resolution  0–60  the short side: 200 px or less is 0, 1000 px or more is 60
 *   shape       0–20  square or 4:3/3:4 is ideal; long banners score low
 *   format      0–10  webp/png/avif 10, jpeg 8, gif 3
 *   weight      0–10  a file under 8 KB is usually a thumbnail or a blank
 */
export function qualityScore({ width = 0, height = 0, bytes = 0, mime = '' } = {}) {
  const w = Number(width) || 0, h = Number(height) || 0;
  if (!w || !h) return 0;
  const short = Math.min(w, h), ratio = Math.max(w, h) / short;
  const resolution = Math.round(Math.max(0, Math.min(1, (short - 200) / 800)) * 60);
  const shape = ratio <= 1.4 ? 20 : ratio <= 1.8 ? 12 : ratio <= 2.5 ? 5 : 0;
  const format = /webp|png|avif/.test(mime) ? 10 : /jpe?g/.test(mime) ? 8 : /gif/.test(mime) ? 3 : 0;
  const weight = bytes >= 20_000 ? 10 : bytes >= 8_000 ? 6 : bytes > 0 ? 2 : 0;
  return Math.min(100, resolution + shape + format + weight);
}

/** Is this picture the publisher's own artwork, through a channel we may use? */
export function isOfficial(meta = {}) {
  if (!meta.image) return false;
  if (meta.imageSource === 'supplier') return true;
  return meta.imageOfficial === true && /^\/api\/images\//.test(String(meta.image));
}

/** The admin's view of one product's picture: status, the reasons, and the record. */
export function mediaStatus(product, { now = Date.now() } = {}) {
  const meta = parse(product?.metadata);
  const image = product?.image ?? meta.image ?? null;
  const record = {
    image, source: meta.imageSource || (image ? 'unknown' : null), sourceUrl: meta.imageSourceUrl || null,
    updatedAt: meta.imageUpdatedAt || null, quality: Number.isFinite(meta.imageQuality) ? meta.imageQuality : null,
    width: meta.imageWidth || null, height: meta.imageHeight || null, from: meta.imageFrom || null,
  };
  const official = isOfficial({ ...meta, image });
  if (!image) return { status: 'missing', reasons: ['no picture'], official, ...record };
  /* The owner's own artwork — the shop's drawn boards they put on every
     product, or a picture they uploaded themselves — is a choice, not a gap.
     Listing it under "missing" made the "own artwork" button look as if it had
     saved nothing. */
  const ownBoard = ['own-artwork', 'category-artwork'].includes(meta.imageSource);
  const ownUpload = /^\/api\/images\//.test(String(image)) && meta.source !== 'discovery' && [undefined, null, '', 'upload'].includes(meta.imageSource);
  if (!official && (ownBoard || ownUpload)) {
    return { status: 'own', reasons: [ownBoard ? `the shop's own artwork${meta.imageFrom ? ` (${meta.imageFrom})` : ''}` : 'your own upload'], official, ...record };
  }
  if (!official) {
    /* The owner's choice first: a drawn board they put on on purpose is their
       own artwork, not a placeholder. */
    const why = ['own-artwork', 'category-artwork'].includes(meta.imageSource) ? `the shop's own artwork${meta.imageFrom ? ` (${meta.imageFrom})` : ''}, not the publisher's product picture`
      : TILE.test(String(image)) ? 'a drawn placeholder tile'
        : String(image).startsWith('/products/') ? 'the shop’s own icon or artwork, not the publisher’s'
        : meta.imageSource === 'licensed' ? `the brand's logo under a free licence (${meta.imageLicence || 'Wikimedia Commons'}), not a product picture`
        : meta.imageSource === 'generated' ? 'a generated picture'
          : /^https?:/.test(String(image)) ? 'a linked picture with no known licence'
            : 'an upload not marked as official artwork';
    return { status: 'missing', reasons: [why], official, ...record };
  }
  if (record.quality != null && record.quality < MIN_QUALITY) {
    return { status: 'low_quality', reasons: [`quality ${record.quality}/100${record.width ? ` (${record.width}×${record.height})` : ''}`], official, ...record };
  }
  const at = Date.parse(record.updatedAt || '');
  if (!Number.isFinite(at)) return { status: 'outdated', reasons: ['never checked — no date on record'], official, ...record };
  const days = Math.floor((now - at) / 86_400_000);
  if (days > MEDIA_MAX_AGE_DAYS) return { status: 'outdated', reasons: [`last updated ${days} days ago`], official, ...record };
  return { status: 'official', reasons: [], official, ...record };
}

/** Every active product with its media status, worst first, and the counts. */
export async function mediaReport({ now = Date.now() } = {}) {
  const rows = await all(`SELECT id, name, category, metadata FROM products WHERE active = 1 ORDER BY name`);
  const order = { missing: 0, low_quality: 1, outdated: 2, own: 3, official: 4 };
  const items = rows.map((r) => ({ id: r.id, name: r.name, category: r.category, ...mediaStatus(r, { now }) }))
    .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  const counts = Object.fromEntries(STATUSES.map((s) => [s, items.filter((i) => i.status === s).length]));
  return { counts, total: items.length, maxAgeDays: MEDIA_MAX_AGE_DAYS, minQuality: MIN_QUALITY, items };
}

/** The record a freshly stored picture leaves on its product. */
export function mediaRecord({ source, sourceUrl = null, width, height, bytes, mime, official, now = new Date() }) {
  return {
    imageSource: source, imageSourceUrl: sourceUrl, imageUpdatedAt: now.toISOString(),
    imageWidth: width || null, imageHeight: height || null,
    imageQuality: qualityScore({ width, height, bytes, mime }),
    imageOfficial: official === true,
  };
}

/** Products the enrichment run should look at: everything that is not "official". */
export async function enrichmentQueue({ limit = 8, now = Date.now() } = {}) {
  const { items } = await mediaReport({ now });
  return items.filter((i) => i.status !== 'official')
    /* An upload the owner chose is theirs: a supplier photo never replaces it. */
    .filter((i) => !['upload', 'link', 'own-artwork'].includes(i.source))
    .slice(0, limit).map((i) => i.id);
}

/**
 * Look for the official picture of these products and apply it: missing ones
 * get one, and outdated or low-quality supplier pictures are fetched again.
 * At most a few per call — each is a search at every supplier.
 */
export async function enrichMedia(productIds, { actor = null, sources = null, fetchImpl = fetch } = {}) {
  const { findPhotos } = await import('./supplier/supplierImageService.js');
  const out = await findPhotos(productIds.slice(0, 8), { apply: true, actor, sources, fetchImpl, scope: 'all', refresh: true });
  return out;
}

/**
 * The owner marks an uploaded picture as the publisher's official artwork —
 * or takes that back. Only a stored upload qualifies: a linked URL has no
 * copy here and no licence we can point at.
 */
export async function setOfficial(productId, official, { actor = null, sourceUrl = null } = {}) {
  const { getProduct, updateProduct } = await import('./productService.js');
  const product = await getProduct(productId);
  if (!product) { const e = new Error('Product not found'); e.status = 404; throw e; }
  const meta = product.metadata || {};
  if (official && !/^\/api\/images\//.test(String(meta.image || ''))) {
    const e = new Error('Upload the picture first — only a stored upload can be marked as official artwork'); e.status = 400; throw e;
  }
  const next = { ...meta, imageOfficial: official === true,
    ...(official ? { imageSource: meta.imageSource === 'supplier' ? 'supplier' : 'official', imageUpdatedAt: meta.imageUpdatedAt || new Date().toISOString(),
      ...(sourceUrl ? { imageSourceUrl: String(sourceUrl).slice(0, 500) } : {}) } : {}) };
  await updateProduct(productId, { metadata: next });
  await audit({ actor, action: official ? 'catalog.image_official' : 'catalog.image_unofficial', targetType: 'product', targetId: productId }).catch(() => {});
  return mediaStatus({ metadata: next });
}
