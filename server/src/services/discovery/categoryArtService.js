/**
 * The owner's own artwork on every product — the way the EA FC products look.
 *
 * The reference is what the owner uploaded for the products they made by hand:
 * a product's picture comes from the owner's own product in the same category,
 * the one nearest in amount (so "12,000 FC Points" art goes on 5,900 rather
 * than on 500 when both exist). A category with no owner artwork on any product
 * falls back to the category logo the owner set in the admin. Nothing is taken
 * from the web and nothing is drawn.
 *
 * Never touched: the owner's own uploads (they ARE the reference). Replaced:
 * brand logos, supplier photos, shop icons, drawn tiles and empty pictures —
 * the owner asked for one look across the shop.
 */
import { all } from '../../db/index.js';
import { parseTitle } from '../market/normalize.js';
import { config } from '../../config/env.js';

/* Applied by the scheduled run in production; elsewhere (tests, local) only
   when asked — the admin button and the add path always apply it. */
export const artworkEnabled = () => (process.env.DISCOVERY_ARTWORK ? process.env.DISCOVERY_ARTWORK === 'on' : config.isProd);

const parse = (m) => { try { return typeof m === 'string' ? JSON.parse(m || '{}') : (m || {}); } catch { return {}; } };
const STORED = /^\/api\/images\//;

/** Is this the owner's own artwork — a reference other products may borrow? */
export function isOwnerArtwork(meta = {}) {
  return STORED.test(String(meta.image || '')) && meta.source !== 'discovery'
    && [undefined, null, '', 'upload', 'official'].includes(meta.imageSource);
}

/** The artwork for one product, from the references; null when there is none. */
export function artworkFor(product, references, categoryLogos = {}) {
  const meta = parse(product.metadata);
  const mine = references.filter((r) => r.category === product.category && r.id !== product.id);
  if (mine.length) {
    const want = Number(meta.denomination) || parseTitle(product.name, {}).denomination || 0;
    const best = [...mine].sort((a, b) => {
      const da = want && a.denomination ? Math.abs(Math.log(a.denomination / want)) : 99;
      const db = want && b.denomination ? Math.abs(Math.log(b.denomination / want)) : 99;
      return da - db || a.name.localeCompare(b.name);
    })[0];
    return { image: best.image, from: best.name };
  }
  const logo = categoryLogos[product.category];
  return STORED.test(String(logo || '')) ? { image: logo, from: `category logo (${product.category})` } : null;
}

/** The owner's artwork per product, read once. */
export async function artworkReferences() {
  const rows = await all(`SELECT id, name, category, metadata FROM products`);
  return rows.map((r) => ({ ...r, meta: parse(r.metadata) }))
    .filter((r) => isOwnerArtwork(r.meta))
    .map((r) => ({ id: r.id, name: r.name, category: r.category, image: r.meta.image,
      denomination: Number(r.meta.denomination) || parseTitle(r.name, {}).denomination || null }));
}

/**
 * Put the owner's artwork on every product that does not already carry it.
 * Returns { applied, unchanged, none: [categories with no artwork at all], remaining }.
 * Stops at `deadline` (one write per product against a remote database);
 * calling it again carries on — products already done are unchanged.
 */
export async function applyCategoryArtwork({ actor = null, deadline = Infinity } = {}) {
  const { updateProduct } = await import('../productService.js');
  const { getCategoryLogos } = await import('../settingsService.js');
  const logos = await getCategoryLogos().catch(() => ({}));
  const references = await artworkReferences();
  const rows = await all(`SELECT id, name, category, metadata FROM products`);
  const out = { applied: 0, unchanged: 0, none: [], remaining: 0 };
  for (const r of rows) {
    if (Date.now() > deadline) { out.remaining += 1; continue; }
    const meta = parse(r.metadata);
    if (isOwnerArtwork(meta)) { out.unchanged += 1; continue; }
    const art = artworkFor(r, references, logos);
    if (!art) { if (r.category && !out.none.includes(r.category)) out.none.push(r.category); continue; }
    if (meta.image === art.image && meta.imageSource === 'category-artwork') { out.unchanged += 1; continue; }
    // eslint-disable-next-line no-await-in-loop
    await updateProduct(r.id, { metadata: { ...meta, image: art.image, imageSource: 'category-artwork', imageFrom: art.from,
      imageDisplay: undefined, imageLicence: undefined, imageAuthor: undefined, imageFile: undefined, imageOfficial: false,
      imageUpdatedAt: new Date().toISOString() } });
    out.applied += 1;
  }
  if (out.applied) {
    const { audit } = await import('../auditService.js');
    await audit({ actor, action: 'catalog.category_artwork', targetType: 'products', targetId: String(out.applied), metadata: out }).catch(() => {});
  }
  return out;
}
