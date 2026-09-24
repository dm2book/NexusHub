/**
 * A real photo for a product, from the supplier who actually sells it.
 *
 * ── WHERE THE PICTURES COME FROM, AND WHERE THEY DO NOT ───────────────────
 * From the product data a supplier returns through its own API — the same
 * listing the shop would buy from. Kinguin sends a cover image with every
 * product; a CSV price list can carry an `image` column. That is a source this
 * shop is a customer of and is entitled to read.
 *
 * Not from a search engine and not from anybody's website. Scraping Google
 * Images for "1000 Robux" returns whatever ranks, with no licence and no
 * guarantee it shows the right amount, and it is exactly the kind of bypass
 * this codebase refuses for competitor prices as well.
 *
 * ── THE PICTURE HAS TO BE OF THE RIGHT THING ──────────────────────────────
 * A photo prints its product. The Kinguin listing for 10,000 Robux shows
 * "10,000" on the card, and putting that beside a 1,000 Robux price is the
 * shop advertising one thing and selling another — the reason the shipped art
 * only matches on an exact denomination. So a photo is only taken from a
 * listing that passes the same check the bulk mapping uses: every amount in
 * our name is in theirs, and it is not an account or a code for one platform.
 *
 * ── WHAT IT NEVER REPLACES ────────────────────────────────────────────────
 * A picture the owner uploaded, and the shop's own shipped artwork. Only an
 * empty image or a drawn placeholder tile is upgraded, and the product keeps a
 * note of where its picture came from.
 */
import { all } from '../../db/index.js';
import { scanSources, matchCheck } from './bestSourceService.js';
import { searchCandidates } from './catalogScanService.js';
import { storeImage } from '../imageStoreService.js';
import { audit } from '../auditService.js';

/** What a product photo may be. SVG is refused, as it is for uploads. */
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;

/** How long before a product with no photo anywhere is looked for again. */
export const RETRY_AFTER_DAYS = 14;

/** Image sources this service may overwrite. Anything else is somebody's choice. */
const REPLACEABLE_SOURCES = new Set(['generated']);
const TILE = /^\/api\/products\/[^/]+\/tile\.svg$/;

/**
 * Does this product still need a real picture?
 * Empty, or the drawn tile the shop makes when it has nothing better.
 */
export function needsPhoto(product) {
  const meta = product?.metadata || {};
  const image = product?.image ?? meta.image;
  if (!image) return true;
  if (TILE.test(String(image))) return true;
  return REPLACEABLE_SOURCES.has(meta.imageSource);
}

/**
 * The best photo among one product's candidates, or null.
 *
 * Only safe matches with an https image. In stock first — a live listing's
 * picture is the one most likely to be current — then the supplier's own
 * order.
 */
export function pickPhoto(product, found) {
  const rows = [];
  for (const f of found) {
    for (const c of f.candidates || []) {
      const url = String(c.image || '');
      if (!/^https:\/\//i.test(url)) continue;
      if (!matchCheck(product.name, c).safe) continue;
      rows.push({ url, title: c.name, supplierId: f.supplier.id, supplierName: f.supplier.name,
        inStock: c.status === 'in_stock' });
    }
  }
  rows.sort((a, b) => Number(b.inStock) - Number(a.inStock));
  return rows[0] || null;
}

/**
 * Download one image, refusing anything that is not a small raster picture.
 * Throws with a reason a person can read.
 */
export async function downloadImage(url, { fetchImpl = fetch } = {}) {
  if (!/^https:\/\//i.test(String(url))) throw new Error('only https images are taken');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: ctl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`the supplier's image answered ${res.status}`);
    const mime = String(res.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_MIME.has(mime)) throw new Error(`not a photo (${mime || 'no type'})`);
    const declared = Number(res.headers?.get?.('content-length') || 0);
    if (declared > MAX_IMAGE_BYTES) throw new Error('image is larger than 3 MB');
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('image is larger than 3 MB');
    if (!bytes.length) throw new Error('image is empty');
    return { mime, bytes };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Look for photos for these products at every active supplier, and — with
 * `apply` — store them and put them on the products.
 *
 * Each row says what happened, because "no photo" has three different reasons
 * (nothing carried, carried but not the right product, carried with no image)
 * and only one of them is fixed by waiting.
 */
export async function findPhotos(productIds, { apply = false, actor = null, sources = null, fetchImpl = fetch } = {}) {
  const { getProduct, updateProduct } = await import('../productService.js');
  const srcs = sources || await scanSources();
  const rows = [];

  for (const id of productIds) {
    // eslint-disable-next-line no-await-in-loop -- one product at a time, like every scan here
    const product = await getProduct(id);
    if (!product) continue;
    const base = { productId: id, name: product.name };

    if (!needsPhoto(product)) {
      rows.push({ ...base, status: 'kept', detail: 'already has its own picture' });
      continue;
    }
    if (!srcs.length) {
      rows.push({ ...base, status: 'none', detail: 'no active supplier to ask' });
      continue;
    }

    const found = [];
    for (const { supplier, connector } of srcs) {
      // eslint-disable-next-line no-await-in-loop -- sequential: other people's APIs
      const { candidates } = await searchCandidates(connector, product);
      found.push({ supplier: { id: supplier.id, name: supplier.name }, candidates });
    }
    const photo = pickPhoto(product, found);
    const anyCandidates = found.some((f) => f.candidates?.length);

    if (!photo) {
      rows.push({ ...base, status: 'none',
        detail: anyCandidates ? 'found listings, but none is certainly this product with a photo'
          : 'no supplier carries it' });
    } else if (!apply) {
      rows.push({ ...base, status: 'found', image: photo.url, from: photo.supplierName, title: photo.title });
    } else {
      try {
        // eslint-disable-next-line no-await-in-loop
        const { mime, bytes } = await downloadImage(photo.url, { fetchImpl });
        // eslint-disable-next-line no-await-in-loop
        const stored = await storeImage(mime, bytes, { productId: id, source: `supplier:${photo.supplierName}` });
        // eslint-disable-next-line no-await-in-loop
        await updateProduct(id, { metadata: {
          ...product.metadata, image: stored.url,
          imageSource: 'supplier', imageFrom: photo.supplierName, imageTitle: photo.title,
        } });
        rows.push({ ...base, status: 'applied', image: stored.url, from: photo.supplierName, title: photo.title });
      } catch (e) {
        rows.push({ ...base, status: 'failed', detail: e.message, from: photo.supplierName });
      }
    }

    /* Remember that we looked, so the nightly sweep moves on to the next
       products instead of asking about the same ones every night. Only when a
       supplier was actually asked: "nobody to ask" is not "nothing found". */
    if (apply && srcs.length) {
      const latest = await getProduct(id); // eslint-disable-line no-await-in-loop
      if (latest) {
        // eslint-disable-next-line no-await-in-loop
        await updateProduct(id, { metadata: { ...latest.metadata, imageSearchAt: new Date().toISOString() } });
      }
    }
  }

  const applied = rows.filter((r) => r.status === 'applied').length;
  if (apply && applied) {
    await audit({ actor, action: 'catalog.supplier_photos', targetType: 'products',
      targetId: String(applied), metadata: { applied, looked: rows.length } });
  }
  return { rows, applied, found: rows.filter((r) => r.status === 'found').length };
}

/**
 * The products still waiting for a photo, in the order the sweep takes them:
 * never looked for first, then the ones looked for longest ago — skipping any
 * looked for within RETRY_AFTER_DAYS, so a product nobody carries is not asked
 * about every night.
 */
export async function photoQueue({ limit = 8, now = Date.now(), ignoreBackoff = false } = {}) {
  const { listProducts } = await import('../productService.js');
  const products = await listProducts({ activeOnly: true });
  const cutoff = now - RETRY_AFTER_DAYS * 86_400_000;
  return products
    .filter(needsPhoto)
    .filter((p) => {
      if (ignoreBackoff) return true;
      const at = Date.parse(p.metadata?.imageSearchAt || '');
      return !Number.isFinite(at) || at < cutoff;
    })
    .sort((a, b) => (Date.parse(a.metadata?.imageSearchAt || '') || 0) - (Date.parse(b.metadata?.imageSearchAt || '') || 0))
    .slice(0, limit)
    .map((p) => p.id);
}

/** How many active products still show a placeholder or nothing. */
export async function photoGap() {
  const rows = await all(`SELECT id, metadata FROM products WHERE active = 1`).catch(() => []);
  let waiting = 0;
  for (const r of rows) {
    let meta = {};
    try { meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : (r.metadata || {}); } catch { meta = {}; }
    if (needsPhoto({ metadata: meta })) waiting += 1;
  }
  return { total: rows.length, waiting };
}
