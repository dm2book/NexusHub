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
import { productPayload } from '../services/productPayload.js';

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
function withHead(html, { title, description, canonical, image, ld, ldProductId, preloadImage, boot }) {
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
    /* The product's own picture, discoverable in the first 200ms.
       Measured before this line existed: the image request did not START until
       1819ms, because its URL was inside a JSON body that could not be asked
       for until the bundle had downloaded, parsed and booted. HTML → JS → API →
       image is four serial hops for one picture, and the last one is the thing
       the visitor is actually waiting to see. The server already knows the URL —
       it is three lines above, in the og:image tag. */
    /* The Product block is tagged with the id the SPA writes to, and with the
       product it describes.

       Without that there were two Product blocks on every product page saying
       different things: this one said PreOrder (honest — no code in stock, so
       it is delivered by hand) while React appended a second saying InStock,
       off a `products.stock` column nothing enforces and nothing displays.
       Google reads one of them, and a contradiction between two blocks on one
       page is the kind of thing that earns a manual action.

       The id alone would have let React replace this block with its own,
       thinner one — no seller, no return policy, no @id. The data-product
       attribute is what lets it tell "this describes the product I am showing"
       from "this is left over from the page the visitor arrived on". */
    ...(ld || []).map((d) => `<script type="application/ld+json"${
      d['@type'] === 'Product' && ldProductId
        ? ` id="jsonld-product" data-product="${esc(ldProductId)}"` : ''
    }>${JSON.stringify(d)}</script>`),
    /* The product itself, so React draws it on its first render.
       Same object /api/products/:id returns, from the same two queries this
       handler already ran. The page still refetches in the background — the
       HTML is edge-cached for five minutes and a price must not be five minutes
       old — but the visitor reads the product while that happens instead of
       watching a spinner. JSON.stringify cannot emit `</script>`, but it can
       emit the characters, so `<` is escaped. */
    ...(boot
      ? [`<script>window.__FM_BOOT__=${JSON.stringify(boot).replace(/</g, '\\u003c')}</script>`]
      : []),
  ].join('\n    ');

  out = out.replace('</head>', `    ${head}\n  </head>`);

  /* The picture goes at the TOP of the head, ahead of the module script Vite
     puts there. The preload scanner reads the whole head before anything
     executes, so it was found either way — measured: the image left at 191ms
     and the bundle at 197ms. But the order is what the browser ranks by when it
     has to choose between them, and the page has nothing to show without the
     picture. */
  return preloadImage
    ? out.replace('<head>', `<head>\n    <link rel="preload" as="image" href="${esc(preloadImage)}" fetchpriority="high" />`)
    : out;
}

/**
 * Paint the product into the pre-React shell.
 *
 * index.html carries a shell (#fm-shell) that is on screen in the first frame,
 * because an SPA draws nothing until its bundle has downloaded, parsed and run.
 * For every route but the homepage and /shop that shell is deliberately grey
 * shapes: index.html is served for every URL, so anything specific there would
 * be a lie on some other page.
 *
 * This route is the exception, and the only one: the server has already read
 * this product out of the database to write the title and the JSON-LD. Its name
 * and its picture are not a guess. So they go on screen at first paint —
 * measured, ~800ms earlier than React can manage — while everything that could
 * go stale (price, stock, delivery) still waits for React, because a shell that
 * states a price is a shell that can be wrong.
 *
 * The boxes mirror the real hero's geometry (h-80 = 320px, rounded-3xl = 24px,
 * p-8 = 32px, bg-slate-100) so the swap is invisible, and so that LCP — which
 * only ever moves to a LARGER element — settles here instead of jumping to
 * whatever React paints a second later.
 */
/* Mirrors carriesOwnBackground() in src/lib/catalog.js, which is what the real
   hero branches on. A looser rule here would paint the neutral panel React is
   about to replace with a category gradient — the picture would not move, but
   the panel behind it would change colour a second later, which is the one
   thing a shell like this must never do. Bare .svg is the icon set: transparent
   badges drawn for a gradient plinth. */
const CARRIES_OWN_BG = (src) =>
  /\.(webp|png|jpe?g|avif)(\?|$)/i.test(src) || /^\/products\/packs\//.test(src);

function withProductShell(html, product) {
  // Only artwork that brings its own background can sit on the neutral panel
  // the real hero uses. Anything else keeps the grey skeleton rather than
  // guessing a gradient and flashing a different colour a moment later.
  if (!product?.image || product.image.startsWith('data:') || !CARRIES_OWN_BG(product.image)) return html;

  const shell = `<div id="fm-shell" aria-hidden="true">
      <div class="b"><span class="m"></span><span class="n">${esc(config.email.fromName)}</span></div>
      <div class="pdp">
        <span class="back"></span>
        <div class="hero"><img src="${esc(product.image)}" alt="" decoding="async" /></div>
        <h2 class="pn">${esc(product.name)}</h2>
      </div>
    </div>`;

  const css = `<style>
      #fm-shell .pdp{padding:40px 20px;max-width:1280px;margin:0 auto}
      #fm-shell .back{display:block;height:14px;width:96px;border-radius:7px;background:#e2e8f0;margin-bottom:26px}
      #fm-shell .hero{height:320px;border-radius:24px;background:#f1f5f9;overflow:hidden;position:relative}
      #fm-shell .hero img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;padding:32px;box-sizing:border-box}
      #fm-shell .pn{font-family:'Bricolage Grotesque','Inter',system-ui,sans-serif;font-size:30px;line-height:1.15;letter-spacing:-.02em;font-weight:800;color:#0f172a;margin:26px 0 0}
      @media (min-width:640px){#fm-shell .pdp{padding:40px 24px}#fm-shell .pn{font-size:36px}}
      @media (min-width:1024px){#fm-shell .hero{height:420px;max-width:calc(50% - 20px)}}
      @media (prefers-color-scheme:dark){#fm-shell .back{background:#1b1930}#fm-shell .pn{color:#fff}}
    </style>`;

  return html.replace(/<div id="fm-shell"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/, css + shell);
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

  /* Stock and review totals do not depend on each other, and neither depends on
     anything computed between them. Awaited one after the other they were three
     serial round trips to the database; against a managed Postgres over the
     network that is three times the link latency for one page, paid on every
     cache miss. */
  const [stock, stats] = await Promise.all([
    availableCount(product.id).catch(() => 0),
    reviewStats().catch(() => null),
  ]);
  const inStock = product.deliveryMode === 'auto' && stock > 0;
  const payload = productPayload(product, stock);
  const canonical = `${SITE_URL()}/product/${product.id}`;
  const image = product.image
    ? (product.image.startsWith('http') ? product.image : SITE_URL() + product.image)
    : `${SITE_URL()}/og.png`;

  // A rating is attached ONLY when real reviews exist. schema.org will happily
  // accept an aggregate with nothing behind it; Google treats that as spam, and
  // this shop has spent several rounds removing exactly that kind of claim.
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
  res.type('html').send(withHead(withProductShell(html, product), {
    title: `${product.name} kopen · ${config.email.fromName}`,
    description: describe(product, inStock),
    canonical,
    image,
    ld,
    ldProductId: product.id,
    /* Preload the picture the PAGE shows, not the social card. `image` above is
       absolutised for scrapers; the browser wants the same URL the <img> will
       ask for, or it downloads it twice. Owner-uploaded data URIs are skipped —
       a 2MB base64 blob in a preload tag is not a head start, it is the head. */
    preloadImage: product.image && !product.image.startsWith('data:') ? product.image : null,
    boot: { product: payload },
  }));
}));

export default router;
