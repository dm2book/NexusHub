/**
 * HTML for product pages, with that product's metadata already in the head.
 *
 * Every other route is a real file written at build time (scripts/prerender.mjs)
 * and served straight from the CDN. Products cannot be: their name, price and
 * stock live in the database and change without a deploy. So this is the one
 * route that renders HTML at request time.
 *
 * What it fixes: a link scraper — Discord, WhatsApp, Twitter, Slack — does not
 * execute JavaScript, so React's meta tags never happened for it. Sharing a
 * Robux product showed the generic homepage title and image. Measured before
 * this existed; every URL returned byte-identical `<head>`.
 *
 * Cached hard at the edge. A cold start on a product page is exactly what the
 * performance work was for, so the function should run rarely and the CDN should
 * answer almost every request. `stale-while-revalidate` means even the refresh
 * happens behind someone else's instant response.
 */
import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { config } from '../config/env.js';
import { getProduct } from '../services/productService.js';
import { availableCount } from '../services/codeStockService.js';
import { reviewStats } from '../services/reviewsService.js';

const router = Router();

// The built index.html, emitted by the prerender step. Imported lazily so the
// API still boots in a checkout where the frontend has never been built.
let shell = null;
async function appShell() {
  if (shell !== null) return shell;
  try {
    ({ APP_SHELL: shell } = await import('../generated/appShell.js'));
  } catch {
    shell = '';
    console.warn('[seo] no built app shell — run `npm run build`; product pages will fall through');
  }
  return shell;
}

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SITE_URL = () => config.appUrl.replace(/\/+$/, '');

/**
 * Rewrite the head.
 *
 * The template's own tags are REMOVED before the new ones go in. Appending
 * would leave two `og:title` tags and the scraper takes whichever it reads
 * first — a bug that only ever shows up in somebody else's chat window.
 */
function withHead(html, { title, description, canonical, image, ld }) {
  const drop = [
    /\s*<title>[\s\S]*?<\/title>/,
    /\s*<meta name="description"[^>]*>/,
    /\s*<meta property="og:[^"]*"[^>]*>/g,
    /\s*<meta name="twitter:[^"]*"[^>]*>/g,
    /\s*<link rel="canonical"[^>]*>/g,
  ];
  let out = html;
  for (const re of drop) out = out.replace(re, '');

  const head = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<link rel="canonical" href="${esc(canonical)}" />`,
    '<meta property="og:type" content="product" />',
    `<meta property="og:site_name" content="${esc(config.email.fromName)}" />`,
    `<meta property="og:url" content="${esc(canonical)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta property="og:locale" content="nl_NL" />',
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
    ...(ld || []).map((d) => `<script type="application/ld+json">${JSON.stringify(d)}</script>`),
  ].join('\n    ');

  return out.replace('</head>', `    ${head}\n  </head>`);
}

/**
 * A description a person would actually read in a chat preview.
 *
 * Built from what the shop genuinely knows — the price, and whether a code is
 * on the shelf right now — rather than a template with the product name dropped
 * into it. The stock wording matches `instantFor` in catalog.js, so the preview
 * cannot promise something the product page then contradicts.
 */
function describe(product, inStock) {
  const price = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: product.currency || 'EUR' })
    .format((product.price || 0) / 100);
  const delivery = inStock
    ? 'Direct geleverd na betaling'
    : 'Met de hand geleverd, meestal binnen een paar uur';
  const base = (product.description || '').trim().replace(/\s+/g, ' ');
  const tail = `${price} · ${delivery} · Betaal met iDEAL.`;
  // 155 characters is where Google starts truncating; the part that gets cut is
  // always the part you cared about, so the facts go first.
  const room = 155 - tail.length - 3;
  return base && base.length > 20 ? `${base.slice(0, room).trim()}… ${tail}` : tail;
}

router.get('/product/:id', asyncHandler(async (req, res, next) => {
  const html = await appShell();
  if (!html) return next();

  const product = await getProduct(req.params.id).catch(() => null);
  // An unknown id still renders the app, which shows its own not-found screen.
  // Prerendering a title for a product that does not exist would be worse.
  if (!product || !product.active) {
    res.set('Cache-Control', 'public, max-age=0, s-maxage=60');
    return res.type('html').send(html);
  }

  const stock = await availableCount(product.id).catch(() => 0);
  const inStock = product.deliveryMode === 'auto' && stock > 0;
  const canonical = `${SITE_URL()}/product/${product.id}`;
  const image = product.image
    ? (product.image.startsWith('http') ? product.image : SITE_URL() + product.image)
    : `${SITE_URL()}/og.png`;

  // A rating is attached ONLY when real reviews exist. schema.org will happily
  // accept an aggregate with nothing behind it; Google treats that as spam, and
  // this shop has spent several rounds removing exactly that kind of claim.
  const stats = await reviewStats().catch(() => null);
  const rating = stats?.count > 0 && stats?.average
    ? { reviewCount: stats.count, ratingValue: stats.average }
    : {};

  const ld = [{
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${canonical}#product`,
    name: product.name,
    description: (product.description || '').trim() || undefined,
    sku: product.sku || product.id,
    category: product.category || undefined,
    image: product.image ? image : undefined,
    brand: { '@type': 'Brand', name: config.email.fromName },
    offers: {
      '@type': 'Offer',
      url: canonical,
      priceCurrency: product.currency || 'EUR',
      price: ((product.price || 0) / 100).toFixed(2),
      // Honest, and the same flag the product page renders from. Claiming stock
      // that is not there is the most common way a shop loses rich results.
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/PreOrder',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@type': 'Organization', name: config.email.fromName, url: SITE_URL() },
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'NL',
        returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
        merchantReturnLink: `${SITE_URL()}/refunds`,
      },
    },
    ...(rating.reviewCount
      ? {
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: Number(rating.ratingValue).toFixed(1),
          reviewCount: rating.reviewCount,
          bestRating: 5, worstRating: 1,
        },
      }
      : {}),
  }, {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL() },
      { '@type': 'ListItem', position: 2, name: 'Shop', item: `${SITE_URL()}/shop` },
      { '@type': 'ListItem', position: 3, name: product.name, item: canonical },
    ],
  }];

  // Five minutes at the edge, a day of stale-while-revalidate. A price change
  // therefore reaches a scraper within minutes, while the function itself runs
  // a handful of times a day.
  res.set('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
  res.type('html').send(withHead(html, {
    title: `${product.name} kopen · ${config.email.fromName}`,
    description: describe(product, inStock),
    canonical,
    image,
    ld,
  }));
}));

export default router;
