/**
 * The owner's own artwork on every product — the look of the products the
 * owner made by hand (the EA FC cards, with the EA and FC logos on them).
 *
 * In this order:
 *   1. the owner's own upload for the SAME game — same category and the same
 *      game or brand, the one nearest in amount (12,000 FC Points art goes on
 *      18,500 rather than on 500). A gift card only ever takes the artwork of
 *      its own brand: a Netflix card never shows the Amazon card.
 *   2. the category logo the owner set in the admin, for that game;
 *   3. only when the owner has no artwork for this game at all: the shop's own
 *      board, drawn with this product's own amount (a shipped file from
 *      public/products/art, or /api/products/:id/tile.svg).
 *
 * Never touched: the owner's own uploads — they ARE the look. The picture it
 * replaces is kept in metadata.imagePrevious, so nothing is lost.
 */
import { all } from '../../db/index.js';
import { config } from '../../config/env.js';
import { matchArt, tilePath } from '../productFitService.js';
import { parseTitle } from '../market/normalize.js';

/* Applied by the scheduled run in production; elsewhere (tests, local) only
   when asked — the admin button and the add path always apply it. */
export const artworkEnabled = () => (process.env.DISCOVERY_ARTWORK ? process.env.DISCOVERY_ARTWORK === 'on' : config.isProd);

export const OWN = 'own-artwork';
const parse = (m) => { try { return typeof m === 'string' ? JSON.parse(m || '{}') : (m || {}); } catch { return {}; } };
const STORED = /^\/api\/images\//;
/* Shelves that hold many brands: there the brand must match exactly. */
const MIXED = new Set(['giftcard', 'subscription']);
const gameOf = (name) => { const g = parseTitle(name || '', {}).game; return g && !String(g).startsWith('unknown') ? g : null; };

/** Is this the owner's own upload — the look, never replaced? */
export function isOwnerArtwork(meta = {}) {
  return STORED.test(String(meta.image || '')) && meta.source !== 'discovery'
    && [undefined, null, '', 'upload', 'official'].includes(meta.imageSource);
}

/** May this owner upload stand for that product — same game, same brand? */
function sameGame(ref, product, game) {
  if (ref.category !== product.category || ref.id === product.id) return false;
  if (game && ref.game) return game === ref.game;
  return !MIXED.has(product.category) && !game === !ref.game;
}

/**
 * The artwork for one product. `references` are the owner's uploads
 * (artworkReferences), `categoryLogos` the logos set in the admin; with
 * neither it is the shop's drawn board.
 */
export function artworkFor(product, references = [], categoryLogos = {}) {
  const meta = parse(product.metadata);
  const game = gameOf(product.name);
  const mine = references.filter((r) => sameGame(r, product, game));
  if (mine.length) {
    const want = Number(meta.denomination) || parseTitle(product.name || '', {}).denomination || 0;
    const best = [...mine].sort((a, b) => {
      const da = want && a.denomination ? Math.abs(Math.log(a.denomination / want)) : 99;
      const db = want && b.denomination ? Math.abs(Math.log(b.denomination / want)) : 99;
      return da - db || a.name.localeCompare(b.name);
    })[0];
    return { image: best.image, from: best.name };
  }
  const logo = MIXED.has(product.category) ? null : categoryLogos[product.category];
  if (STORED.test(String(logo || ''))) return { image: logo, from: `category logo (${product.category})` };
  const hit = matchArt({ sku: product.sku || meta.sku || null, name: product.name, category: product.category,
    denomination: meta.denomination ?? null });
  return hit.image ? { image: hit.image, from: hit.reason } : { image: tilePath(product.id), from: 'drawn for this product' };
}

/** The owner's uploads, read once. */
export async function artworkReferences() {
  const rows = await all(`SELECT id, name, category, metadata FROM products`);
  return rows.map((r) => ({ ...r, meta: parse(r.metadata) }))
    .filter((r) => isOwnerArtwork(r.meta))
    .map((r) => ({ id: r.id, name: r.name, category: r.category, image: r.meta.image, game: gameOf(r.name),
      denomination: Number(r.meta.denomination) || parseTitle(r.name || '', {}).denomination || null }));
}

/** Both inputs of artworkFor, for a caller with one product. */
export async function artworkInputs() {
  const { getCategoryLogos } = await import('../settingsService.js');
  return { references: await artworkReferences(), logos: await getCategoryLogos().catch(() => ({})) };
}

/**
 * Put the owner's artwork on every product that is not an owner upload.
 * Stops at `deadline` and carries on when called again — products already done
 * are unchanged. Returns { applied, unchanged, kept (owner uploads), remaining }.
 */
export async function applyCategoryArtwork({ actor = null, deadline = Infinity } = {}) {
  const { updateProduct } = await import('../productService.js');
  const { references, logos } = await artworkInputs();
  const rows = await all(`SELECT id, sku, name, category, metadata FROM products`);
  const out = { applied: 0, unchanged: 0, kept: 0, remaining: 0 };
  for (const r of rows) {
    if (Date.now() > deadline) { out.remaining += 1; continue; }
    const meta = parse(r.metadata);
    if (isOwnerArtwork(meta)) { out.kept += 1; continue; }
    if (r.category === 'mystery') { out.unchanged += 1; continue; }
    const art = artworkFor(r, references, logos);
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
