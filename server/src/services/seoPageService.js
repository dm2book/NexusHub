/**
 * The generated SEO pages (src/lib/seoCatalog.js), served and ranked.
 *
 * ── PRIORITY WITHOUT INVENTED SEARCH VOLUME ──────────────────────────────
 * This shop has no keyword-volume data: no Search Console connection, no paid
 * keyword tool. A "monthly searches" column would therefore be made up, so
 * there is none. Pages are ranked on four signals that ARE real, each shown
 * next to the score so the ranking can be checked:
 *
 *   market   how many marketplace listings the market scanner has observed for
 *            this game / brand / platform — supply, the best available proxy
 *            for demand on other shops (weight 0.35)
 *   sales    this shop's own completed sales in the last 90 days (0.35)
 *   visits   this shop's own page views on the page's path in the last 30
 *            days, and how many came from a search engine (0.15)
 *   depth    how many products the page lists (0.15)
 *
 * Each signal is scaled 0–1 against the best page, so the score says which
 * page to work on first — not how many people search for anything. Once
 * Search Console is connected its impressions belong in this list first.
 */
import { all } from '../db/index.js';
import { config, manualPayMethods } from '../config/env.js';
import { isEnabled as stripeEnabled } from './stripeService.js';
import { listProducts } from './productService.js';
import { buildSeoPages, schemaFor, missingKeywords, SEO_LANGS } from '../../../src/lib/seoCatalog.js';
import { LANDING } from '../../../src/content/seo.js';

/* Catalogue category / brand / platform → the market scanner's game keys. */
const MARKET_KEY = {
  robux: ['roblox'], 'v-bucks': ['fortnite'], eafc: ['ea-fc'], valorant: ['valorant'], cod: ['call-of-duty'],
  apex: ['apex-legends'], brawl: ['brawl-stars'], clash: ['clash-of-clans'], clashroyale: ['clash-royale'],
  genshin: ['genshin-impact'], league: ['league-of-legends'], pokemongo: ['pokemon-go'], pubg: ['pubg-mobile'],
  freefire: ['free-fire'], mlbb: ['mobile-legends'], minecraft: ['minecraft'], gta: ['gta-online'],
  'discord-nitro': ['discord'], gamepass: ['xbox-game-pass'], spotify: ['spotify'],
  steam: ['steam'], playstation: ['playstation-store'], xbox: ['xbox-store'], nintendo: ['nintendo-store'],
  netflix: ['netflix'], 'google-play': ['google-play'], apple: ['apple'], amazon: ['amazon'],
};
const PLATFORM_KEY = { playstation: 'playstation', xbox: 'xbox', pc: 'pc', switch: 'nintendo' };
const WEIGHTS = { market: 0.35, sales: 0.35, visits: 0.15, depth: 0.15 };

/** The payment methods the checkout really offers, as a buyer would name them —
    the same list /api/config hands the checkout. */
export function payMethodLabels() {
  const out = [];
  try { if (stripeEnabled()) out.push('iDEAL'); } catch { /* not configured */ }
  for (const m of manualPayMethods() || []) if (m?.label) out.push(m.label);
  return [...new Set(out)];
}

let cache = null; let cachedAt = 0;
const TTL = 5 * 60_000;

/** The pages, built from the live catalogue (cached five minutes). */
export async function seoPages({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cachedAt < TTL) return cache;
  const products = (await listProducts({ activeOnly: true }).catch(() => []))
    .map((p) => ({ id: p.id, name: p.name, price: Number(p.price) || 0, category: p.category, metadata: p.metadata || {},
      image: p.image || p.metadata?.image || null, deliveryMode: p.deliveryMode, active: p.active !== false }));
  const landing = Object.fromEntries(Object.entries(LANDING).map(([path, def]) => [def.category, path]));
  const pages = buildSeoPages(products, { landing, payMethods: payMethodLabels() });
  cache = { pages, products, builtAt: new Date().toISOString() };
  cachedAt = Date.now();
  return cache;
}

/** One page by path, or null. Hand-written landing pages are not served here. */
export async function seoPageByPath(path) {
  const { pages } = await seoPages();
  return pages.find((p) => p.path === path) || null;
}

/** What the browser needs to render a page: copy, FAQ, links, product cards. */
export function pagePayload(page, lang = 'nl') {
  const l = SEO_LANGS.includes(lang) ? lang : 'nl';
  return { path: page.path, type: page.type, key: page.key, handWritten: !!page.handWritten,
    copy: page.copy[l], faq: page.faq[l], links: page.links, hubs: page.hubs,
    productIds: page.products.map((p) => p.id), schema: schemaFor(page, l, { siteUrl: siteUrl() }) };
}
export const siteUrl = () => String(config.appUrl || 'https://www.forgemarket.nl').replace(/\/+$/, '');

/* ── The ranking ────────────────────────────────────────────────────────── */
async function signals() {
  const since90 = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const market = await all(`SELECT mp.game, mp.platform, COUNT(*) AS n FROM market_observations mo
      JOIN market_products mp ON mp.id = mo.market_product_id GROUP BY mp.game, mp.platform`).catch(() => []);
  const sales = await all(`SELECT oi.product_id, SUM(oi.quantity) AS units FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.status = 'completed' AND o.created_at >= @s GROUP BY oi.product_id`, { s: since90 }).catch(() => []);
  const views = await all(`SELECT path, COUNT(*) AS n,
        SUM(CASE WHEN referrer ~* '(google|bing|duckduckgo|ecosia|yahoo)\\.' THEN 1 ELSE 0 END) AS search
      FROM page_views WHERE created_at >= @s GROUP BY path`, { s: since30 }).catch(() => []);
  return {
    market, sales: new Map(sales.map((r) => [r.product_id, Number(r.units) || 0])),
    views: new Map(views.map((r) => [r.path, { n: Number(r.n) || 0, search: Number(r.search) || 0 }])),
  };
}

/** Every page with its real signals and a priority, highest first. */
export async function seoReport() {
  const { pages, products, builtAt } = await seoPages({ fresh: true });
  const s = await signals();
  const rows = pages.map((p) => {
    const keys = p.type === 'platform' ? null : (MARKET_KEY[p.key] || []);
    const market = p.type === 'platform'
      ? s.market.filter((m) => m.platform === PLATFORM_KEY[p.key]).reduce((a, m) => a + Number(m.n), 0)
      : p.type === 'budget' ? 0
        : s.market.filter((m) => keys.includes(m.game)).reduce((a, m) => a + Number(m.n), 0);
    const sales = p.products.reduce((a, x) => a + (s.sales.get(x.id) || 0), 0);
    const v = s.views.get(p.path) || { n: 0, search: 0 };
    return { path: p.path, type: p.type, key: p.key, handWritten: !!p.handWritten,
      title: p.copy.nl.title, description: p.copy.nl.description, titleLength: p.copy.nl.title.length,
      descriptionLength: p.copy.nl.description.length, faq: p.faq.nl.length, links: p.links.length,
      keywords: p.keywords, products: p.products.length,
      signals: { market, sales, visits: v.n, searchVisits: v.search, depth: p.products.length } };
  });
  const max = (k) => Math.max(1, ...rows.map((r) => r.signals[k]));
  const mx = { market: max('market'), sales: max('sales'), visits: max('visits'), depth: max('depth') };
  for (const r of rows) {
    r.priority = Math.round(100 * Object.entries(WEIGHTS).reduce((a, [k, w]) => a + w * (r.signals[k] / mx[k]), 0));
  }
  rows.sort((a, b) => b.priority - a.priority || b.products - a.products);
  const handWrittenCopy = Object.values(LANDING).flatMap((d) => SEO_LANGS.map((l) => `${d[l]?.title || ''} ${d[l]?.h1 || ''} ${d[l]?.description || ''}`));
  return {
    builtAt, pages: rows, weights: WEIGHTS,
    missingKeywords: missingKeywords(pages, products, { extraCovered: handWrittenCopy }),
    note: 'No search-volume data is connected; priority uses marketplace listings observed, own sales (90 days), own visits (30 days) and catalogue depth.',
  };
}
