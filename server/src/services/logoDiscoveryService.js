/**
 * Automatic Logo Discovery — the best available official logo per brand.
 *
 * ── WHERE IT LOOKS, IN THIS ORDER ──────────────────────────────────────────
 *   1 brand_assets      the brand's official brand-assets page   ┐ URLs the owner adds in
 *   2 press_kit         the brand's official press kit           │ Logo Library, after
 *   3 developer_portal  the brand's developer portal             ┘ accepting their terms
 *   4 commons           Wikimedia Commons, through its API, public domain / CC0 only
 *   5 public_svg        Simple Icons (CC0), bundled with the server
 *   6 shop_asset        files already in this shop (public/products/icons)
 * and when none of them has anything: the owner's category logo, else the
 * shop's own drawn artwork — the product card's existing fallback.
 *
 * Why the official tiers are URLs the owner adds and not a crawler: brand
 * asset pages and press kits put their files behind usage terms (and often a
 * click-through), and this shop does not scrape — it fetches exactly the file
 * it was given, checks the site's robots.txt first, and records which licence
 * or guidelines apply. Simple Icons publishes, per brand, a link to the
 * official guidelines where one exists; that link is kept with the logo.
 *
 * ── QUALITY ─────────────────────────────────────────────────────────────
 * Hard rules — a file failing one is kept with its reason, never used:
 *   SVG or PNG/WebP only (a JPEG is a photo or a screenshot, and has no
 *   transparency); at least 512×512 for a raster; a transparent background;
 *   at most 5 MB; nothing named like a screenshot, mockup, photo or preview.
 * Generated or watermarked pictures cannot be recognised from pixels with any
 * honesty, so they are kept out by WHERE a logo may come from: only the six
 * tiers above, each a source that publishes logos, not pictures of them.
 * Then a score (0–100): tier, vector over raster, size, transparency, a known
 * licence. The highest score is chosen; ties go to the higher tier.
 *
 * ── CACHE ───────────────────────────────────────────────────────────────
 * Nothing here runs on a page view. A brand is looked at again at most every
 * 30 days (maintenance, a few brands per run) or when the owner asks; cards
 * read the stored choice.
 */
import { all, get, run, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { publicFetch } from '../utils/imageUrl.js';
import { config } from '../config/env.js';
import { LIBRARY } from '../generated/brandLogos.js';
import { ASSETS as SHOP_ASSETS } from '../generated/artAssets.js';
import { FREE_LICENCE } from './discovery/commonsLogoService.js';

export const CACHE_DAYS = 30;
export const MIN_SIDE = 512;
export const MAX_BYTES = 5 * 1024 * 1024;
export const TIERS = ['brand_assets', 'press_kit', 'developer_portal', 'commons', 'public_svg', 'shop_asset'];
export const OFFICIAL = new Set(['brand_assets', 'press_kit', 'developer_portal']);
const TIER_POINTS = { brand_assets: 40, press_kit: 36, developer_portal: 32, commons: 24, public_svg: 18, shop_asset: 8 };
export const LOGO_TYPES = ['svg logo', 'png logo', 'app icon', 'wordmark', 'brand icon', 'publisher mark', 'related brand'];

/**
 * The 21 brands, what the cards call them, and what each source knows them by.
 * `cards`: product categories / brand slugs whose card shows this brand.
 * `shop`:  the shop's own files for it ({ path, type }); `commons`: the search.
 */
export const BRANDS = {
  roblox: { label: 'Roblox', cards: ['robux'], shop: [{ path: '/products/icons/robux.webp', type: 'app icon' }], commons: 'Roblox logo' },
  valorant: { label: 'Valorant', cards: ['valorant'], shop: [{ path: '/products/icons/valorant.webp', type: 'app icon' }], commons: 'Valorant logo' },
  riot: { label: 'Riot Games', cards: [], shop: [], commons: 'Riot Games logo' },
  league: { label: 'League of Legends', cards: ['league'], shop: [], commons: 'League of Legends logo' },
  steam: { label: 'Steam', cards: ['steam'], shop: [{ path: '/products/icons/steam.webp', type: 'app icon' }], commons: 'Steam logo' },
  playstation: { label: 'PlayStation', cards: ['playstation'], shop: [{ path: '/products/icons/playstation.webp', type: 'app icon' }], commons: 'PlayStation logo' },
  xbox: { label: 'Xbox', cards: ['xbox', 'gamepass'], shop: [{ path: '/products/icons/xbox.webp', type: 'app icon' }], commons: 'Xbox logo' },
  nintendo: { label: 'Nintendo', cards: ['nintendo'], shop: [], commons: 'Nintendo logo' },
  eafc: { label: 'EA SPORTS FC', cards: ['eafc'], shop: [{ path: '/products/icons/eafc.webp', type: 'app icon' }], commons: 'EA Sports FC logo', libraryType: 'publisher mark' },
  fortnite: { label: 'Fortnite', cards: ['v-bucks'], shop: [], commons: 'Fortnite logo' },
  epic: { label: 'Epic Games', cards: ['epicgames'], shop: [], commons: 'Epic Games logo' },
  cod: { label: 'Call of Duty', cards: ['cod'], shop: [{ path: '/products/icons/cod.webp', type: 'app icon' }], commons: 'Call of Duty logo' },
  discord: { label: 'Discord', cards: ['discord-nitro'], shop: [{ path: '/products/icons/discord-nitro.webp', type: 'app icon' }], commons: 'Discord logo' },
  spotify: { label: 'Spotify', cards: ['spotify'], shop: [], commons: 'Spotify logo' },
  netflix: { label: 'Netflix', cards: ['netflix'], shop: [], commons: 'Netflix logo' },
  crunchyroll: { label: 'Crunchyroll', cards: ['crunchyroll'], shop: [], commons: 'Crunchyroll logo' },
  minecraft: { label: 'Minecraft', cards: ['minecraft'], shop: [], commons: 'Minecraft logo' },
  googleplay: { label: 'Google Play', cards: ['googleplay'], shop: [], commons: 'Google Play logo' },
  apple: { label: 'Apple', cards: ['itunes'], shop: [], commons: 'Apple logo' },
  amazon: { label: 'Amazon', cards: ['amazon'], shop: [], commons: 'Amazon logo' },
  blizzard: { label: 'Blizzard', cards: ['battlenet'], shop: [], commons: 'Blizzard Entertainment logo', libraryType: 'related brand' },
};

/** The library brand a product card belongs to (by its brand slug or category). */
export function brandForCard(slug) {
  if (!slug) return null;
  return Object.entries(BRANDS).find(([, b]) => b.cards.includes(slug))?.[0] || null;
}

/* ── Looking at a file ────────────────────────────────────────────────── */

const ascii = (buf, a, b) => buf.subarray(a, b).toString('latin1');

/** Width, height and whether a background shows through, from the bytes alone. */
export function inspect(mime, buf) {
  try {
    if (mime === 'image/png' && ascii(buf, 1, 4) === 'PNG') {
      const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20), colorType = buf[25];
      /* Alpha channel (types 4, 6), or a transparency chunk for palette/grey. */
      const transparent = colorType === 4 || colorType === 6 || buf.includes(Buffer.from('tRNS'));
      return { width, height, transparent };
    }
    if (mime === 'image/webp' && ascii(buf, 8, 12) === 'WEBP') {
      const tag = ascii(buf, 12, 16);
      if (tag === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3), transparent: !!(buf[20] & 0x10) };
      if (tag === 'VP8L') { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1, transparent: !!((b >> 28) & 1) }; }
      if (tag === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, transparent: false };
    }
    if (mime === 'image/svg+xml') {
      const s = buf.toString('utf8');
      const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
      const w = /<svg[^>]*\swidth\s*=\s*["']?([\d.]+)/i.exec(s), h = /<svg[^>]*\sheight\s*=\s*["']?([\d.]+)/i.exec(s);
      /* An SVG is transparent unless it starts by painting the whole canvas. */
      const opaque = /<svg[^>]*>\s*(<title>[^<]*<\/title>\s*)?<rect[^>]*(width\s*=\s*["']100%["'][^>]*height\s*=\s*["']100%["']|x\s*=\s*["']0["'][^>]*y\s*=\s*["']0["'])[^>]*fill\s*=\s*["'](?!none)/i.test(s)
        || /<svg[^>]*style\s*=\s*["'][^"']*background(-color)?\s*:/i.test(s);
      return { width: Math.round(Number(vb?.[1] || w?.[1] || 0)) || null, height: Math.round(Number(vb?.[2] || h?.[1] || 0)) || null, transparent: !opaque };
    }
  } catch { /* unreadable header: judged below as unknown */ }
  return { width: null, height: null, transparent: null };
}

/** Make an SVG safe to serve from this origin: no scripts, handlers or outside references. */
export function sanitizeSvg(text) {
  const ACTIVE = 'script|foreignObject|iframe|embed|object|animate|animateMotion|animateTransform|set|handler|listener';
  return String(text || '')
    .replace(/<\?xml[\s\S]*?\?>/gi, '').replace(/<!DOCTYPE[\s\S]*?(\]\s*)?>/gi, '')
    .replace(new RegExp(`<(${ACTIVE})\\b[\\s\\S]*?<\\/\\1\\s*>`, 'gi'), '')
    .replace(new RegExp(`<(${ACTIVE})\\b[^>]*>`, 'gi'), '')
    /* Event handlers, also written as <svg/onload=…>. */
    .replace(/[\s/]on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ' ')
    /* Links: only same-document (#id) and raster data — quoted or not. */
    .replace(/(href|xlink:href)\s*=\s*("(?!#|data:image\/(png|webp);)[^"]*"|'(?!#|data:image\/(png|webp);)[^']*'|(?!["'#])[^\s>]+)/gi, '')
    .replace(/@import[^;]*;?|javascript:/gi, '')
    .trim();
}

/** What must never be left in a file the shop serves, after sanitizeSvg. */
const SVG_ACTIVE = /<script|<foreignObject|<animate|<set\b|[\s/]on[a-z]+\s*=|javascript:|<!ENTITY/i;

const SUSPECT_NAME = /screenshot|screen-shot|mockup|photo|preview|watermark|thumbnail|banner|wallpaper|render\b/i;

/**
 * Judge one candidate. Returns { status, reason?, score, width, height, transparent }.
 */
export function assess({ tier, mime, bytes, url = '', license = null, recentYear = false }) {
  const size = bytes?.length || 0;
  const { width, height, transparent } = inspect(mime, bytes || Buffer.alloc(0));
  const isSvg = mime === 'image/svg+xml';
  const reject = (reason) => ({ status: 'rejected', reason, score: 0, width, height, transparent });
  if (!['image/svg+xml', 'image/png', 'image/webp'].includes(mime)) return reject(`${mime || 'unknown type'} — only SVG, PNG or WebP (a JPEG is a photo or a screenshot)`);
  if (size > MAX_BYTES) return reject(`${(size / 1048576).toFixed(1)} MB — over 5 MB`);
  if (SUSPECT_NAME.test(decodeURIComponent(String(url).split('?')[0]))) return reject('named like a screenshot, mockup, photo or preview, not a logo');
  if (!isSvg && (!width || !height || Math.min(width, height) < MIN_SIDE)) return reject(`${width || '?'}×${height || '?'} — a raster logo must be at least ${MIN_SIDE}×${MIN_SIDE}`);
  if (transparent === false) return reject('no transparent background');
  if (isSvg && SVG_ACTIVE.test(bytes.toString('utf8'))) return reject('contains script or animation');
  let score = TIER_POINTS[tier] || 0;
  score += isSvg ? 25 : 10 + Math.min(10, Math.round((Math.min(width, height) - MIN_SIDE) / 100));
  score += transparent ? 15 : 0;
  score += 10;                                        // passed the size rule (vector, or ≥ 512)
  score += license ? 10 : 0;
  /* Current, not just free: Simple Icons follows the brands' logo changes;
     a Commons file without a recent year in its name may be any vintage. */
  if (tier === 'public_svg') score += 8;
  if (tier === 'commons') score += recentYear ? 6 : -10;
  return { status: 'ok', score: Math.max(0, Math.min(100, score)), width, height, transparent };
}

/* ── Fetching, politely ───────────────────────────────────────────────── */

/* Every network wait is cut to what is left of the caller's budget: one brand
   could otherwise spend 10 s searching Commons and 3 × 12 s downloading, and
   "Refresh all brands" ran into Vercel's 30-second limit in production. */
const left = (deadline, cap) => Math.max(1, Math.min(cap, (deadline || Infinity) - Date.now()));
const UA = () => config.market?.userAgent || 'ForgeMarketBot/1.0 (+https://www.forgemarket.nl)';
const robotsCache = new Map();

/** Does the site's robots.txt let this bot fetch this path? Missing robots.txt = yes. */
export async function robotsAllow(url, { fetchImpl = fetch, deadline = Infinity } = {}) {
  const u = new URL(url);
  let rules = robotsCache.get(u.origin);
  if (!rules) {
    let text = '';
    try {
      const r = await publicFetch(`${u.origin}/robots.txt`, { headers: { 'User-Agent': UA() }, signal: AbortSignal.timeout(left(deadline, 8_000)) }, fetchImpl);
      text = r.ok ? await r.text() : '';
    } catch { text = ''; }
    rules = []; let applies = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/#.*/, '').trim();
      const m = /^(user-agent|disallow|allow)\s*:\s*(.*)$/i.exec(line);
      if (!m) continue;
      const k = m[1].toLowerCase(), v = m[2].trim();
      if (k === 'user-agent') applies = v === '*' || /forgemarket/i.test(v);
      else if (applies && v) rules.push({ allow: k === 'allow', path: v });
    }
    robotsCache.set(u.origin, rules);
  }
  const path = u.pathname + u.search;
  const hit = rules.filter((r) => path.startsWith(r.path.replace(/\*$/, ''))).sort((a, b) => b.path.length - a.path.length)[0];
  return !hit || hit.allow;
}

async function download(url, { fetchImpl = fetch, deadline = Infinity } = {}) {
  if (Date.now() >= deadline) throw new Error('out of time this run — next run');
  if (!(await robotsAllow(url, { fetchImpl, deadline }))) throw new Error('robots.txt does not allow fetching this file');
  const r = await publicFetch(url, { headers: { 'User-Agent': UA(), Accept: 'image/svg+xml,image/png,image/webp' }, signal: AbortSignal.timeout(left(deadline, 12_000)) }, fetchImpl);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const mime = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    || (/\.svg(\?|$)/i.test(url) ? 'image/svg+xml' : /\.png(\?|$)/i.test(url) ? 'image/png' : '');
  const bytes = Buffer.from(await r.arrayBuffer());
  return { mime: mime === 'text/xml' || mime === 'application/xml' ? 'image/svg+xml' : mime, bytes };
}

/* ── Candidates, per tier ─────────────────────────────────────────────── */

async function officialCandidates(brand, opts) {
  const rows = await all(`SELECT * FROM logo_sources WHERE brand = @b`, { b: brand });
  const out = [];
  for (const s of rows) {
    try {
      const { mime, bytes } = await download(s.url, opts);
      out.push({ tier: s.tier, url: s.url, mime, bytes, license: s.license || 'brand guidelines', guidelines: s.guidelines, logoType: s.logo_type || (mime === 'image/svg+xml' ? 'svg logo' : 'png logo') });
    } catch (e) {
      out.push({ tier: s.tier, url: s.url, failed: e.message, license: s.license, guidelines: s.guidelines, logoType: s.logo_type });
    }
  }
  return out;
}

async function commonsCandidates(brand, { fetchImpl = fetch, deadline = Infinity } = {}) {
  if (deadline - Date.now() < 4_000) throw new Error('out of time this run — next run');
  const def = BRANDS[brand];
  const q = new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrsearch: def.commons, gsrnamespace: '6', gsrlimit: '15',
    prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiextmetadatafilter: 'LicenseShortName|Artist', iiurlwidth: '1024' });
  const r = await fetchImpl(`https://commons.wikimedia.org/w/api.php?${q}`, { headers: { 'User-Agent': UA(), Accept: 'application/json' }, signal: AbortSignal.timeout(left(deadline, 10_000)) });
  if (!r.ok) throw new Error(`Commons HTTP ${r.status}`);
  const data = await r.json();
  const files = Object.values(data?.query?.pages || {}).map((p) => {
    const ii = p.imageinfo?.[0] || {}; const m = ii.extmetadata || {};
    return { title: p.title, mime: ii.mime, url: ii.mime === 'image/svg+xml' ? ii.url : (ii.thumburl || ii.url), page: ii.descriptionurl,
      licence: String(m.LicenseShortName?.value || '').replace(/<[^>]+>/g, '').trim() };
  });
  const judged = files.filter((f) => FREE_LICENCE.test(f.licence) && /\.(svg|png)$/i.test(f.title))
    .map((f) => ({ ...f, v: commonsVerdict(f.title, def) }));
  /* Newest first, vector first: Commons keeps every logo a brand ever had. */
  const picked = judged.filter((f) => f.v.ok)
    .sort((a, b) => (b.v.year || 0) - (a.v.year || 0) || (b.mime === 'image/svg+xml') - (a.mime === 'image/svg+xml') || a.title.length - b.title.length)
    .slice(0, 3);
  const turnedDown = judged.filter((f) => !f.v.ok).slice(0, 4)
    .map((f) => ({ tier: 'commons', url: f.page || f.url, failed: null, rejected: f.v.reason, license: f.licence }));
  const out = [];
  for (const f of picked) {
    try {
      const { mime, bytes } = await download(f.url, { fetchImpl, deadline });
      out.push({ tier: 'commons', url: f.page || f.url, mime: mime || f.mime, bytes, license: f.licence, recentYear: f.v.year >= RECENT_YEAR,
        logoType: /wordmark|text/i.test(f.title) ? 'wordmark' : /icon|symbol/i.test(f.title) ? 'brand icon' : (f.mime === 'image/svg+xml' ? 'svg logo' : 'png logo') });
    } catch (e) { out.push({ tier: 'commons', url: f.page || f.url, failed: e.message, license: f.licence }); }
  }
  return [...out, ...turnedDown];
}

/* ── Is this Commons file the brand's CURRENT main logo? ──────────────────
 * Commons is an archive: it keeps the logo from 2006, the one for the console
 * from 2013, the logo of a spin-off and of a long-closed online service, all
 * under the brand's name and all public domain. Its search ranks by words, not
 * by which one is in use. Seen in production: Roblox's old wordmark, "Xbox
 * One", "Nintendo Wi-Fi Connection" and League of Legends: Wild Rift chosen as
 * the brand logos. So a title must be the brand and nothing else — every word
 * left over after the brand, "logo", a year and a file type is a sub-brand or
 * a variant — and a year before RECENT_YEAR in it is an old logo. */
export const RECENT_YEAR = 2019;
const NEUTRAL_WORDS = new Set(['logo', 'logotype', 'icon', 'symbol', 'wordmark', 'svg', 'png', 'official', 'new', 'current', 'primary', 'emblem', 'mark', 'and', 'the', 'file']);
export function commonsVerdict(title, def) {
  const t = String(title || '').replace(/^File:/i, '').replace(/\.(svg|png)$/i, '').toLowerCase().replace(/[_()[\],.–—-]+/g, ' ');
  const brandWords = def.label.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  const words = t.split(/\s+/).filter(Boolean);
  if (!brandWords.every((w) => words.includes(w))) return { ok: false, reason: `not ${def.label}'s own logo` };
  const years = words.filter((w) => /^(19|20)\d{2}$/.test(w)).map(Number);
  const year = years.length ? Math.max(...years) : null;
  if (year && year < RECENT_YEAR) return { ok: false, reason: `an older logo (${year})`, year };
  const extra = words.filter((w) => !brandWords.includes(w) && !NEUTRAL_WORDS.has(w) && !/^(19|20)\d{2}$/.test(w));
  if (extra.length) return { ok: false, reason: `a variant or sub-brand ("${extra.join(' ')}"), not the main logo` };
  if (!/logo|icon|symbol|wordmark|emblem|mark/.test(t)) return { ok: false, reason: 'not marked as a logo' };
  return { ok: true, year };
}

function bundledCandidates(brand) {
  const def = BRANDS[brand]; const out = [];
  const lib = LIBRARY[brand];
  if (lib) out.push({ tier: 'public_svg', url: lib.sourceUrl, mime: 'image/svg+xml', bytes: Buffer.from(lib.svg), license: lib.license,
    guidelines: lib.guidelines || null, logoType: def.libraryType || 'brand icon', note: lib.title !== def.label ? `${lib.title}` : null });
  for (const s of def.shop) {
    const a = SHOP_ASSETS[s.path];
    if (!a) continue;
    out.push({ tier: 'shop_asset', url: s.path, mime: a.mime || 'image/svg+xml', bytes: a.b64 ? Buffer.from(a.b64, 'base64') : Buffer.from(a.text || ''),
      license: null, logoType: s.type, note: 'shop file, origin not recorded' });
  }
  return out;
}

/* ── Discovering, storing, choosing ───────────────────────────────────── */

const commonsOn = () => (process.env.LOGO_DISCOVERY_NETWORK ? process.env.LOGO_DISCOVERY_NETWORK === 'on' : config.isProd);

/** Look at every source for one brand, store what was found, choose the best. */
export async function discoverBrand(brand, { fetchImpl = fetch, network = commonsOn(), deadline = Date.now() + 20_000 } = {}) {
  if (!BRANDS[brand]) throw new Error(`Unknown brand ${brand}`);
  const cands = [...await officialCandidates(brand, { fetchImpl, deadline })];
  if (network) { try { cands.push(...await commonsCandidates(brand, { fetchImpl, deadline })); } catch (e) { cands.push({ tier: 'commons', url: 'https://commons.wikimedia.org', failed: e.message }); } }
  cands.push(...bundledCandidates(brand));
  const at = nowIso();
  for (const c of cands) {
    /* Not reached this run: keep what was stored before, untouched. Writing it
       down as "rejected" would demote a good official logo for a slow minute. */
    if (/out of time this run/.test(c.failed || '')) continue;
    const verdict = c.rejected ? { status: 'rejected', reason: c.rejected, score: 0 }
      : c.failed ? { status: 'rejected', reason: `could not fetch: ${c.failed}`, score: 0 } : assess(c);
    let imageUrl = null; let svgText = null;
    if (verdict.status === 'ok') {
      if (c.mime === 'image/svg+xml') svgText = sanitizeSvg(c.bytes.toString('utf8'));
      else {
        const { storeImage } = await import('./imageStoreService.js');
        imageUrl = (await storeImage(c.mime, c.bytes, { source: `logo:${c.tier}` })).url;
      }
    }
    await run(`INSERT INTO brand_logos (id, brand, tier, logo_type, source_url, license, guidelines, retrieved_at, mime, width, height, transparent,
                                        image_url, svg_text, score, status, reject_reason, chosen, created_at, updated_at)
               VALUES (@id, @b, @tier, @type, @url, @lic, @gl, @at, @mime, @w, @h, @tr, @img, @svg, @score, @st, @why, 0, @at, @at)
               ON CONFLICT (brand, source_url) DO UPDATE SET tier=@tier, logo_type=@type, license=@lic, guidelines=@gl, retrieved_at=@at,
                 mime=@mime, width=@w, height=@h, transparent=@tr, image_url=@img, svg_text=@svg, score=@score, status=@st, reject_reason=@why, updated_at=@at`,
    { id: newId('blg'), b: brand, tier: c.tier, type: c.logoType || null, url: c.url, lic: c.license || null, gl: c.guidelines || null, at,
      mime: c.mime || null, w: verdict.width ?? null, h: verdict.height ?? null, tr: verdict.transparent == null ? null : (verdict.transparent ? 1 : 0),
      img: imageUrl, svg: svgText, score: verdict.score, st: verdict.status, why: verdict.reason || null });
  }
  return chooseBest(brand);
}

/** Mark the best stored logo of a brand as chosen: highest score, then higher tier. */
export async function chooseBest(brand) {
  const rows = await all(`SELECT id, tier, score FROM brand_logos WHERE brand=@b AND status='ok'`, { b: brand });
  rows.sort((a, b) => b.score - a.score || TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier));
  await run(`UPDATE brand_logos SET chosen = CASE WHEN id = @id THEN 1 ELSE 0 END WHERE brand=@b`, { b: brand, id: rows[0]?.id || '' });
  memo.delete(brand);
  return rows[0] ? get(`SELECT * FROM brand_logos WHERE id=@id`, { id: rows[0].id }) : null;
}

/* Bumped when the way logos are judged changes. A new version drops the
   choices the old rules made (the Commons ones are what changed) and looks
   at every brand again — without waiting 30 days. */
export const LOGIC_VERSION = 2;
export async function ensureLogicVersion() {
  const row = await get(`SELECT value FROM kv WHERE key='logo_discovery_version'`).catch(() => null);
  if (Number(row?.value) === LOGIC_VERSION) return false;
  await run(`DELETE FROM brand_logos WHERE tier = 'commons'`);
  await run(`UPDATE brand_logos SET retrieved_at = '1970-01-01T00:00:00.000Z'`);
  for (const b of Object.keys(BRANDS)) await chooseBest(b);
  await run(`INSERT INTO kv (key, value, updated_at) VALUES ('logo_discovery_version', @v, @at)
             ON CONFLICT (key) DO UPDATE SET value=@v, updated_at=@at`, { v: String(LOGIC_VERSION), at: nowIso() });
  return true;
}

/** Brands whose newest look is older than the cache window (or never). */
export async function staleBrands({ now = Date.now() } = {}) {
  const cut = new Date(now - CACHE_DAYS * 86_400_000).toISOString();
  const seen = await all(`SELECT brand, MAX(retrieved_at) AS at FROM brand_logos GROUP BY brand`);
  const fresh = new Set(seen.filter((r) => r.at >= cut).map((r) => r.brand));
  return Object.keys(BRANDS).filter((b) => !fresh.has(b));
}

/** Maintenance: a few stale brands per run, within a deadline. */
export async function refreshStale({ limit = 4, deadline = Date.now() + 8_000, fetchImpl = fetch } = {}) {
  await ensureLogicVersion();
  const todo = (await staleBrands()).slice(0, limit); const done = [];
  for (const b of todo) {
    if (Date.now() >= deadline) break;
    try { await discoverBrand(b, { fetchImpl, deadline }); done.push(b); } catch (e) { console.error('[logos]', b, e.message); }
  }
  return done;
}

/* ── Reading the choice (cards, admin) ────────────────────────────────── */

const memo = new Map();
/** The chosen logo for a brand, from the database (10-minute memo). Never fetches. */
export async function chosenLogo(brand) {
  const m = memo.get(brand);
  if (m && Date.now() - m.at < 600_000) return m.row;
  const row = await get(`SELECT * FROM brand_logos WHERE brand=@b AND chosen=1 AND status='ok' LIMIT 1`, { b: brand }).catch(() => null);
  memo.set(brand, { at: Date.now(), row });
  return row;
}

/** A logo row as something an <img> / SVG <image> can show. */
export const logoSrc = (row) => (!row ? null : row.image_url || (row.svg_text ? `/api/logos/${row.id}.svg` : null));

/** Add an official source URL for a brand (brand assets, press kit, developer portal). */
export async function addSource({ brand, tier, url, license = null, guidelines = null, logoType = null, actor = null }) {
  if (!BRANDS[brand]) throw new Error('Unknown brand');
  if (!OFFICIAL.has(tier)) throw new Error('Tier must be brand_assets, press_kit or developer_portal');
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('Only https links');
  await run(`INSERT INTO logo_sources (id, brand, tier, url, license, guidelines, logo_type, added_by, created_at)
             VALUES (@id, @b, @t, @u, @l, @g, @lt, @a, @at) ON CONFLICT (brand, url) DO UPDATE SET tier=@t, license=@l, guidelines=@g, logo_type=@lt`,
  { id: newId('lgs'), b: brand, t: tier, u: u.toString(), l: license, g: guidelines, lt: logoType, a: actor, at: nowIso() });
  return all(`SELECT * FROM logo_sources WHERE brand=@b`, { b: brand });
}

/** Everything for the Logo Library page, and the report. */
export async function library() {
  await ensureLogicVersion();
  const rows = await all(`SELECT id, brand, tier, logo_type, source_url, license, guidelines, retrieved_at, mime, width, height, transparent,
                                 image_url, (svg_text IS NOT NULL) AS has_svg, score, status, reject_reason, chosen, updated_at
                            FROM brand_logos ORDER BY brand, chosen DESC, score DESC`);
  const sources = await all(`SELECT * FROM logo_sources ORDER BY brand`);
  const brands = Object.entries(BRANDS).map(([key, def]) => {
    const mine = rows.filter((r) => r.brand === key).map((r) => ({ ...r, src: r.image_url || (r.has_svg ? `/api/logos/${r.id}.svg` : null) }));
    const chosen = mine.find((r) => r.chosen && r.status === 'ok') || null;
    return { key, label: def.label, cards: def.cards, chosen, candidates: mine, sources: sources.filter((s) => s.brand === key),
      updatedAt: mine.reduce((a, r) => (r.retrieved_at > a ? r.retrieved_at : a), '') || null };
  });
  return { brands, report: report(brands), cacheDays: CACHE_DAYS };
}

/** Found, missing, low quality, and what to upload by hand — from the stored state. */
export function report(brands) {
  const LOW = 70;
  const STANDIN = ['publisher mark', 'related brand'];
  const found = brands.filter((b) => b.chosen && b.chosen.score >= LOW && b.chosen.tier !== 'shop_asset' && !STANDIN.includes(b.chosen.logo_type));
  const missing = brands.filter((b) => !b.chosen);
  const low = brands.filter((b) => b.chosen && (b.chosen.score < LOW || b.chosen.tier === 'shop_asset'
    || ['publisher mark', 'related brand'].includes(b.chosen.logo_type)));
  const upload = brands.filter((b) => !b.chosen || !OFFICIAL.has(b.chosen.tier)).map((b) => ({
    brand: b.label, key: b.key,
    why: !b.chosen ? 'no usable logo from any source'
      : b.chosen.tier === 'shop_asset' ? 'only a shop file of unknown origin'
        : ['publisher mark', 'related brand'].includes(b.chosen.logo_type) ? `uses a ${b.chosen.logo_type}, not the brand's own logo`
          : `best is ${b.chosen.tier.replace('_', ' ')} — an official file would rank higher`,
    priority: !b.chosen || b.chosen.tier === 'shop_asset' ? 'high' : b.cards.length ? 'medium' : 'low',
  })).sort((a, b) => ['high', 'medium', 'low'].indexOf(a.priority) - ['high', 'medium', 'low'].indexOf(b.priority));
  return {
    found: found.map((b) => ({ brand: b.label, tier: b.chosen.tier, type: b.chosen.logo_type, score: b.chosen.score })),
    missing: missing.map((b) => b.label),
    lowQuality: low.map((b) => ({ brand: b.label, tier: b.chosen.tier, type: b.chosen.logo_type, score: b.chosen.score })),
    recommendedUploads: upload,
  };
}
