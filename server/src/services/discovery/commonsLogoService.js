/**
 * Brand logos with a free licence, from Wikimedia Commons — instead of the
 * shop's own drawn artwork.
 *
 * Why Commons: product pictures on web shops belong to those shops (or the
 * publisher) and may not be copied. Commons publishes files with their licence
 * through an open API, and simple text logos there are public domain
 * ("PD-textlogo"). Only files whose licence the API reports as public domain
 * or CC0 are taken — checked per file, every time — and each stored picture
 * keeps its Commons page, author and licence.
 *
 * What it is: the brand's LOGO, not a picture of the pack. A logo stays a
 * trademark; a shop showing the brand it sells is ordinary practice, and the
 * product pages say the shop is not affiliated. Product media therefore still
 * lists these as "missing an official picture", and a supplier's real product
 * picture replaces the logo when one arrives.
 *
 * Wikimedia asks API clients to identify themselves and to keep requests
 * modest: one User-Agent with contact, one search per brand, cached 30 days.
 */
import { all, get, run } from '../../db/index.js';
import { config } from '../../config/env.js';
import { GAMES, parseTitle } from '../market/normalize.js';

const API = 'https://commons.wikimedia.org/w/api.php';
const CACHE_DAYS = 30;
/* Public domain (including PD-textlogo) and CC0 only: no attribution or
   share-alike duties a product card could not honour. */
export const FREE_LICENCE = /^(public domain|pd\b|pd-|cc0|cc-zero)/i;
const OK_MIME = /^image\/(svg\+xml|png|jpeg|webp)$/;

/* The current logo where it is known by name; otherwise a search. Still
   licence-checked like any search result. */
const PREFERRED = {
  roblox: ['File:Roblox Logo 2025.png', 'File:Roblox Corporation 2025 logo.svg'],
  steam: ['File:Steam logo.svg'],
  fortnite: ['File:FortniteLogo.svg'],
  valorant: ['File:Valorant logo - pink color version.svg'],
};
/* What to search for, where the market's label is not the brand's name. */
const BRAND = { 'ea-fc': 'EA Sports FC', 'xbox-store': 'Xbox', 'nintendo-store': 'Nintendo eShop', 'playstation-store': 'PlayStation',
  apple: 'App Store', 'xbox-game-pass': 'Xbox Game Pass', 'gta-online': 'Grand Theft Auto Online', discord: 'Discord' };

export const logosEnabled = () => (process.env.DISCOVERY_LOGOS ? process.env.DISCOVERY_LOGOS === 'on' : config.isProd);
const strip = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const headers = () => ({ Accept: 'application/json', 'User-Agent': config.market.userAgent });

/** File records from an API answer: title, thumb, page, licence, author, size, type. */
function filesOf(data) {
  return Object.values(data?.query?.pages || {}).map((p) => {
    const ii = p.imageinfo?.[0] || {};
    const meta = ii.extmetadata || {};
    return { title: p.title, mime: ii.mime, width: ii.width, height: ii.height, thumbUrl: ii.thumburl || ii.url,
      pageUrl: ii.descriptionurl, licence: strip(meta.LicenseShortName?.value), author: strip(meta.Artist?.value).slice(0, 200) };
  });
}
const query = (params) => `${API}?${new URLSearchParams({ action: 'query', format: 'json', prop: 'imageinfo',
  iiprop: 'url|size|mime|extmetadata', iiextmetadatafilter: 'LicenseShortName|Artist', iiurlwidth: '800', ...params })}`;

/**
 * The best free logo among `files` for a brand: free licence, an image, "logo"
 * and the brand in the title, not an old or fan version.
 */
export function pickLogo(files, brand) {
  const key = String(brand).toLowerCase().split(/\s+/)[0];
  const scored = files.filter((f) => FREE_LICENCE.test(f.licence || '') && OK_MIME.test(f.mime || '') && f.thumbUrl
    && /logo/i.test(f.title) && f.title.toLowerCase().includes(key)
    && !/\b(fan|unofficial|concept|parody|old|former|beta)\b/i.test(f.title)
    && !/\b(19\d\d|200\d|201[0-7])\b/.test(f.title))
    .map((f) => ({ ...f, score: (/svg/.test(f.mime) ? 2 : 0) + (/\b20(2\d)\b/.test(f.title) ? 1 : 0) }));
  return scored.sort((a, b) => b.score - a.score || (b.width || 0) - (a.width || 0))[0] || null;
}

/** Find the logo file for a game: preferred titles first, then a search. */
export async function findLogoFile(gameKey, { fetchImpl = fetch } = {}) {
  const def = GAMES.find((g) => g.key === gameKey);
  if (!def) return null;
  const brand = BRAND[gameKey] || def.label;
  if (PREFERRED[gameKey]) {
    const res = await fetchImpl(query({ titles: PREFERRED[gameKey].join('|') }), { headers: headers() });
    if (res.ok) {
      const hit = pickLogo(filesOf(await res.json()), brand);
      if (hit) return hit;
    }
  }
  const res = await fetchImpl(query({ generator: 'search', gsrnamespace: '6', gsrsearch: `${brand} logo`, gsrlimit: '15' }), { headers: headers() });
  if (!res.ok) throw new Error(`Wikimedia Commons API HTTP ${res.status}`);
  return pickLogo(filesOf(await res.json()), brand);
}

/**
 * The stored logo record for a game (cached 30 days in kv, including "none
 * found", so a brand without a free logo is not searched every hour).
 */
export async function logoFor(gameKey, { fetchImpl = fetch, now = Date.now() } = {}) {
  const k = `commons.logo.${gameKey}`;
  const row = await get(`SELECT value, updated_at FROM kv WHERE key=@k`, { k }).catch(() => null);
  if (row && now - Date.parse(row.updated_at) < CACHE_DAYS * 86_400_000) {
    try { return JSON.parse(row.value); } catch { /* refetch */ }
  }
  const save = async (v) => {
    const at = new Date(now).toISOString();
    await run(`INSERT INTO kv (key, value, updated_at) VALUES (@k, @v, @at) ON CONFLICT (key) DO UPDATE SET value=@v, updated_at=@at`,
      { k, v: JSON.stringify(v), at }).catch(() => {});
    return v;
  };
  const file = await findLogoFile(gameKey, { fetchImpl });
  if (!file) return save(null);
  const { downloadImage } = await import('../supplier/supplierImageService.js');
  const { dimensions, storeImage } = await import('../imageStoreService.js');
  /* Wikimedia asks every request to identify itself — the file download too. */
  const withUa = (url, opts = {}) => fetchImpl(url, { ...opts, headers: { ...(opts.headers || {}), 'User-Agent': config.market.userAgent } });
  const got = await downloadImage(file.thumbUrl, { fetchImpl: withUa });
  const { width, height } = dimensions(got.mime, got.bytes);
  const stored = await storeImage(got.mime, got.bytes, { source: 'commons' });
  return save({ url: stored.url, sourceUrl: file.pageUrl, file: file.title, licence: file.licence, author: file.author,
    width, height, mime: got.mime, lastChecked: new Date(now).toISOString() });
}

/** The metadata a product carries for a Commons logo. */
export function logoMetadata(logo) {
  return {
    image: logo.url, imageSource: 'licensed', imageSourceUrl: logo.sourceUrl, imageLicence: logo.licence,
    imageAuthor: logo.author || null, imageFile: logo.file, imageUpdatedAt: logo.lastChecked,
    imageWidth: logo.width || null, imageHeight: logo.height || null, imageMime: logo.mime, imageOfficial: false,
    imageDisplay: { fit: 'contain' },
  };
}

const SHOP_ART = /^\/products\/(icons|art|packs)\/|\/api\/products\/[^/]+\/tile\.svg$/;
/** Is this product showing the shop's own artwork (or nothing) — what a logo replaces? */
export function showsShopArt(meta = {}) {
  if (!meta.image) return true;
  if (['supplier', 'official', 'upload', 'link', 'licensed'].includes(meta.imageSource)) return false;
  return SHOP_ART.test(String(meta.image)) || ['artwork', 'matched-art', 'generated'].includes(meta.imageSource);
}

/**
 * Give every product that shows shop artwork (or nothing) its brand's free
 * logo. An owner's upload, a supplier's picture and anything official are
 * never touched. Bounded by `limit` and `deadline`; resumes next run.
 */
export async function applyLogos({ fetchImpl = fetch, limit = 40, deadline = Infinity } = {}) {
  const { updateProduct } = await import('../productService.js');
  const rows = await all(`SELECT id, name, metadata FROM products`);
  const out = { applied: 0, none: [], errors: [] };
  for (const r of rows) {
    if (out.applied >= limit || Date.now() > deadline) break;
    let meta = {};
    try { meta = JSON.parse(r.metadata || '{}'); } catch { /* keep */ }
    if (!showsShopArt(meta)) continue;
    const game = meta.game || parseTitle(r.name, {}).game;
    if (!GAMES.some((g) => g.key === game)) continue;
    let logo = null;
    // eslint-disable-next-line no-await-in-loop
    try { logo = await logoFor(game, { fetchImpl }); } catch (e) { out.errors.push(`${game}: ${e.message}`); continue; }
    if (!logo) { if (!out.none.includes(game)) out.none.push(game); continue; }
    // eslint-disable-next-line no-await-in-loop
    await updateProduct(r.id, { metadata: { ...meta, ...logoMetadata(logo) } });
    out.applied += 1;
  }
  return out;
}

