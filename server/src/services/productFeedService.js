/**
 * The product catalogue as a feed for Meta and TikTok dynamic product ads
 * (and Google Merchant, which reads the same columns).
 *
 * This is how the large marketplaces run most of their paid social: the ad
 * platform fetches the whole catalogue on a schedule and builds the ads itself
 * — the product someone looked at, shown back to them, with its current price.
 * One URL per network, set once in Commerce Manager / TikTok Catalog Manager:
 *
 *   https://www.forgemarket.nl/api/feeds/products.csv?network=meta&lang=nl
 *
 * The image a platform shows is a 1080×1080 JPG drawn by the Static ads page
 * (the product's card, its brand's colours, name and platform — NO price,
 * because the platform prints the feed's price over it, so an image can never
 * show a stale one) and stored in the shop's own image store. A product
 * without such an image is left out of the feed, with the count on the admin
 * page: the platforms reject SVG, and a feed row without a usable image fails
 * their review anyway.
 */
import { all, run, get } from '../db/index.js';
import { config } from '../config/env.js';
import { availableCounts } from './codeStockService.js';
import { brandSlug } from './productFitService.js';

const parse = (m) => { try { return typeof m === 'string' ? JSON.parse(m || '{}') : (m || {}); } catch { return {}; } };
const site = () => String(config.appUrl || 'https://www.forgemarket.nl').replace(/\/+$/, '');
const FEED_LANGS = ['nl', 'en', 'de', 'fr'];
const NETWORKS = ['meta', 'tiktok', 'google', 'facebook', 'instagram'];

/* CSV cell: quoted, doubled quotes, no line breaks. */
const cell = (v) => `"${String(v ?? '').replace(/[\r\n]+/g, ' ').replace(/"/g, '""')}"`;
const plain = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const BRAND_NAME = { robux: 'Roblox', 'v-bucks': 'Fortnite', eafc: 'EA SPORTS FC', cod: 'Call of Duty', valorant: 'Valorant',
  apex: 'Apex Legends', brawl: 'Brawl Stars', clash: 'Clash of Clans', clashroyale: 'Clash Royale', genshin: 'Genshin Impact',
  league: 'League of Legends', pokemongo: 'Pokémon GO', pubg: 'PUBG Mobile', freefire: 'Free Fire', mlbb: 'Mobile Legends',
  minecraft: 'Minecraft', gta: 'GTA Online', steam: 'Steam', playstation: 'PlayStation', xbox: 'Xbox', nintendo: 'Nintendo',
  netflix: 'Netflix', googleplay: 'Google Play', itunes: 'Apple', amazon: 'Amazon', spotify: 'Spotify', 'discord-nitro': 'Discord', gamepass: 'Xbox' };

/** The brand a buyer would name: "Roblox", "Steam", "EA SPORTS FC". */
export function feedBrand(row) {
  const b = brandSlug(row.name || '');
  return BRAND_NAME[b] || BRAND_NAME[row.category] || 'ForgeMarket';
}

const describe = (row, lang) => {
  const meta = parse(row.metadata);
  const own = lang === 'nl' ? meta.descriptionNl : lang === 'en' ? null : meta[`description${lang[0].toUpperCase()}${lang[1]}`];
  const text = plain(own || meta.content?.[lang]?.long || row.description || row.name);
  return text.slice(0, 4900);
};

/** Every active product with a catalogue image, as feed rows. */
export async function feedRows({ network = 'meta', lang = 'nl' } = {}) {
  const L = FEED_LANGS.includes(lang) ? lang : 'nl';
  const net = NETWORKS.includes(network) ? network : 'meta';
  const rows = await all(`SELECT id, name, description, price, currency, category, metadata
                            FROM products WHERE active = 1 AND price > 0 ORDER BY category, price`);
  const stock = await availableCounts(rows.map((r) => r.id)).catch(() => ({}));
  const out = []; let withoutImage = 0;
  for (const r of rows) {
    const meta = parse(r.metadata);
    const img = typeof meta.adFeedImage === 'string' && /^\/api\/images\//.test(meta.adFeedImage) ? meta.adFeedImage : null;
    if (!img) { withoutImage++; continue; }
    const inStock = Number(stock?.[r.id] || 0) > 0;
    out.push({
      id: r.id,
      title: String(r.name).slice(0, 150),
      description: describe(r, L),
      /* "available for order" where a person delivers it: honest, and a value
         both Meta and TikTok accept. */
      availability: inStock ? 'in stock' : 'available for order',
      condition: 'new',
      price: `${(Number(r.price) / 100).toFixed(2)} ${r.currency || 'EUR'}`,
      link: `${site()}/product/${r.id}?utm_source=${net}&utm_medium=paid_social&utm_campaign=catalog&utm_content=${encodeURIComponent(r.id)}`,
      image_link: `${site()}${img}`,
      brand: feedBrand(r),
      product_type: `Digital > ${r.category || 'other'}`,
      google_product_category: '5032',   // Electronics > Video Game Software … nearest standard category for game codes
    });
  }
  return { rows: out, withoutImage, total: rows.length };
}

export const FEED_COLUMNS = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand', 'product_type', 'google_product_category'];

export async function feedCsv(opts) {
  const { rows } = await feedRows(opts);
  return [FEED_COLUMNS.join(','), ...rows.map((r) => FEED_COLUMNS.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}

/** Record the drawn catalogue image for a product (after the page uploaded it). */
export async function setFeedImage(productId, url) {
  await run(`UPDATE products SET metadata = (COALESCE(NULLIF(metadata, ''), '{}')::jsonb || jsonb_build_object('adFeedImage', @u::text))::text
              WHERE id = @id`, { id: productId, u: url });
  return get(`SELECT id FROM products WHERE id = @id`, { id: productId });
}

/** For the admin page: how complete the feed is. */
export async function feedStatus() {
  const { rows, withoutImage, total } = await feedRows({});
  return { inFeed: rows.length, withoutImage, total,
    urls: Object.fromEntries(['meta', 'tiktok', 'google'].map((n) => [n, `${site()}/api/feeds/products.csv?network=${n}&lang=nl`])) };
}

