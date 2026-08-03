/**
 * Write a real HTML file per route, with that route's metadata already in it.
 *
 * The problem this solves, measured before it existed: every URL on the site
 * returned byte-identical `<head>`. Sharing a Robux product on Discord showed
 * "ForgeMarket — Digital Goods Marketplace" and the generic homepage image,
 * because a link scraper does not execute JavaScript and React's meta tags
 * therefore never happened for it. There was no canonical in the HTML at all.
 *
 * Why files rather than a server:
 *
 * Vercel checks the filesystem before applying rewrites, so `dist/shop/index.html`
 * is served for `/shop` without any config and without a function invocation.
 * The pages stay static, stay on the CDN, and keep every millisecond of the
 * performance work. A server-rendered `<head>` would have cost a cold start on
 * the exact pages that most need to be fast.
 *
 * Product pages cannot be built this way — their content lives in the database
 * and changes — so those are handled at request time by the API function, which
 * injects the same tags from the same module. See server/src/routes/seo.js.
 *
 * Run automatically after `vite build`.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const { PAGES, LANDING, ALIASES, NOINDEX, SITE, metaFor, canonicalFor, organizationLd, websiteLd, breadcrumbLd } =
  await import(join(ROOT, 'src/content/seo.js'));

const template = readFileSync(join(DIST, 'index.html'), 'utf8');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Replace the head of the template.
 *
 * The template's tags are removed rather than added to: a page with two
 * `og:title` tags gets whichever the scraper happens to read first, which is
 * exactly the kind of bug that only shows up in someone else's chat window.
 */
function renderHead(path, { title, description, canonical, noindex, ld = [], og = {} }) {
  let html = template;

  const drop = [
    /\s*<title>[\s\S]*?<\/title>/,
    /\s*<meta name="description"[^>]*>/,
    /\s*<meta property="og:(?:type|url|site_name|title|description|image|image:width|image:height)"[^>]*>/g,
    /\s*<meta name="twitter:(?:card|title|description|image)"[^>]*>/g,
    /\s*<link rel="canonical"[^>]*>/g,
  ];
  for (const re of drop) html = html.replace(re, '');

  const image = og.image
    ? (og.image.startsWith('http') ? og.image : SITE.url + og.image)
    : SITE.url + SITE.ogImage;

  const head = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<link rel="canonical" href="${esc(canonical)}" />`,
    noindex ? '<meta name="robots" content="noindex, follow" />' : '',
    `<meta property="og:type" content="${og.type || 'website'}" />`,
    `<meta property="og:site_name" content="${SITE.name}" />`,
    `<meta property="og:url" content="${esc(canonical)}" />`,
    `<meta property="og:title" content="${esc(og.title || title)}" />`,
    `<meta property="og:description" content="${esc(og.description || description)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    `<meta property="og:locale" content="nl_NL" />`,
    `<meta property="og:locale:alternate" content="en_US" />`,
    // summary_large_image needs an image at least 300px wide; og.png is 1200.
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${esc(og.title || title)}" />`,
    `<meta name="twitter:description" content="${esc(og.description || description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
    ...ld.map((d) => `<script type="application/ld+json">${JSON.stringify(d)}</script>`),
  ].filter(Boolean).join('\n    ');

  return html.replace('</head>', `    ${head}\n  </head>`);
}

const write = (route, html) => {
  const dir = route === '/' ? DIST : join(DIST, route);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
};

// Emitted on every page: a search engine building an entity for this site
// should not have to find the one page that happens to mention it.
let legal = {};
try {
  ({ LEGAL: legal } = await import(join(ROOT, 'src/lib/legalIdentity.js')));
} catch { /* identity not filled in yet — organizationLd leaves those fields out */ }
let email = '';
try {
  ({ SUPPORT_EMAIL: email } = await import(join(ROOT, 'src/lib/support.js')));
} catch { /* optional */ }

const org = organizationLd({ email, legal });
const site = websiteLd();

const NAME = { '/': 'Home', '/shop': 'Shop' };
let count = 0;

for (const route of Object.keys(PAGES)) {
  const m = metaFor(route, 'nl');
  const ld = [org, site];
  if (route !== '/') {
    ld.push(breadcrumbLd([
      { name: 'Home', path: '/' },
      { name: NAME[route] || m.title, path: route },
    ]));
  }
  write(route, renderHead(route, {
    title: `${m.title} · ${SITE.name}`,
    description: m.description,
    canonical: canonicalFor(route),
    noindex: NOINDEX.has(route),
    ld,
  }));
  count++;
}

// The keyword landing pages. Same treatment as any other route — they are real
// pages with their own copy, not a redirect to a filtered shop.
for (const [route, def] of Object.entries(LANDING)) {
  const m = def.nl;
  write(route, renderHead(route, {
    title: `${m.title} · ${SITE.name}`,
    description: m.description,
    canonical: canonicalFor(route),
    ld: [org, site, breadcrumbLd([
      { name: 'Home', path: '/' },
      { name: 'Shop', path: '/shop' },
      { name: m.h1, path: route },
    ])],
  }));
  count++;
}

// Dutch aliases get their own file so the URL works, but they point their
// canonical at the English route rather than competing with it for the same
// content. Not noindex: a canonical consolidates, noindex would throw the
// page away entirely.
for (const [alias, target] of Object.entries(ALIASES)) {
  const m = metaFor(target, 'nl');
  write(alias, renderHead(alias, {
    title: `${m.title} · ${SITE.name}`,
    description: m.description,
    canonical: canonicalFor(target),
    ld: [org, site],
  }));
  count++;
}

// Routes with no copy of their own still need to not be indexed as duplicates
// of the homepage.
for (const route of NOINDEX) {
  if (PAGES[route]) continue;
  const m = metaFor('/', 'nl');
  write(route, renderHead(route, {
    title: `${SITE.name}`,
    description: m.description,
    canonical: canonicalFor(route),
    noindex: true,
    ld: [],
  }));
  count++;
}

/**
 * Hand the server the built shell.
 *
 * Product pages cannot be prerendered — their content lives in the database and
 * changes without a deploy — so the API function has to inject their metadata at
 * request time. To do that it needs the same HTML, including the hashed asset
 * filenames this build just produced.
 *
 * Written as a module rather than read from dist/ at runtime: a serverless
 * function is bundled separately from the static output and cannot rely on that
 * directory existing next to it.
 */
const shellDir = join(ROOT, 'server/src/generated');
mkdirSync(shellDir, { recursive: true });
writeFileSync(join(shellDir, 'appShell.js'),
  '/* GENERATED by scripts/prerender.mjs — do not edit. Rebuilt on every build. */\n'
  + '/* The built index.html, so the API can serve product pages with their own\n'
  + '   metadata already in the head. Asset filenames are hashed, which is why\n'
  + '   this is regenerated rather than written by hand. */\n'
  + `export const APP_SHELL = ${JSON.stringify(template)};\n`);

console.log(`prerendered ${count} routes with their own metadata`);
