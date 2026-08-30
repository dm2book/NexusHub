/**
 * Three artboards per product, from one system.
 *
 *   main    700x600  (7:6 — exactly the card media box, so it fills the tile)
 *   hover   700x600  (the same artwork, lit)
 *   banner 1600x900  (16:9 — TikTok end-card, Discord embed, site banner)
 *
 * The brand mark is INLINED from the official file in the repo. For an SVG that
 * means a nested <svg> carrying the source viewBox, which scales cleanly and
 * needs no network. For the two WebP marks it means a base64 <image>, because
 * those are the real Xbox and PlayStation logos and there is no vector twin of
 * them in the repo — the SVG files of the same name are generic stand-ins, not
 * the same artwork. (Checked by rendering both side by side: xbox.svg is a
 * green circle with a cross; xbox.webp is the actual Xbox sphere.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { BRAND, accentFor, CATEGORY_LABEL, esc, headline, fitSize } from './design.mjs';

const PUBLIC = path.join(process.cwd(), 'public');

/** The ten icons that exist only as WebP. Mirrors RASTER_ICONS in sampleCatalog. */
const RASTER = new Set(['cod', 'discord-nitro', 'eafc', 'giftcard', 'playstation',
  'robux', 'steam', 'v-bucks', 'valorant', 'xbox']);

/** Gift cards share one category but keep their own brand mark. */
const BRAND_BY_SKU = {
  'STEAM-10': 'steam', 'STEAM-25': 'steam', 'STEAM-50': 'steam',
  'PSN-25': 'playstation', 'XBOX-25': 'xbox', 'NINTENDO-25': 'nintendo',
  'AMAZON-25': 'amazon', 'GPLAY-25': 'googleplay', 'ITUNES-25': 'itunes',
  'NETFLIX-25': 'netflix',
};

/**
 * WHICH mark belongs on the stage.
 *
 * Not simply metadata.image. For 62 of the 72 products that value is a 480x300
 * pack COVER — a whole card with its own gradient, its own denomination and its
 * own small print. Dropping that into a 176px circle produces a card inside a
 * card: the number appears twice at two sizes and the small print becomes
 * illegible texture. Caught by rendering the first proof sheet rather than by
 * reading the code.
 *
 * So a pack cover is replaced by the brand logo the cover was made from, which
 * is what the composition actually wants: one mark, one number, one voice.
 */
export function markFor(product) {
  /* Never composite our own output. After one --apply the product's image IS a
     generated artboard, so a second run drew the previous card inside the new
     card's circle — a €25 tile with a tiny €25 tile in the middle of it. Only
     visible by re-running and looking; the first run is always correct, which
     is exactly the kind of bug that ships. */
  const raw = String(product.image || '');
  const img = raw.includes('/products/art/') ? String(product.imageLegacy || '') : raw;
  if (img && !img.includes('/products/packs/') && !img.includes('/products/art/')) return img;
  const slug = BRAND_BY_SKU[product.sku] || product.category;
  if (!slug) return null;
  const ext = RASTER.has(slug) ? 'webp' : 'svg';
  const candidate = `/products/icons/${slug}.${ext}`;
  if (fs.existsSync(path.join(PUBLIC, candidate.slice(1)))) return candidate;
  const svg = `/products/icons/${slug}.svg`;
  return fs.existsSync(path.join(PUBLIC, svg.slice(1))) ? svg : null;
}

/**
 * Read an icon file and return something that can be dropped into an SVG at a
 * given box, or null when the file is missing.
 */
export function inlineMark(src, { x, y, w, h }) {
  if (!src) return null;
  const file = path.join(PUBLIC, String(src).replace(/^\/+/, ''));
  if (!fs.existsSync(file)) return null;

  if (file.endsWith('.svg')) {
    const raw = fs.readFileSync(file, 'utf8');
    const vb = raw.match(/viewBox="([^"]+)"/);
    const viewBox = vb ? vb[1] : '0 0 512 512';
    // Everything between the outer <svg …> and </svg>, minus any XML prologue.
    const inner = raw
      .replace(/^[\s\S]*?<svg[^>]*>/i, '')
      .replace(/<\/svg>\s*$/i, '')
      .replace(/<\?xml[\s\S]*?\?>/gi, '');
    /* A nested <svg> gives the mark its own coordinate system, so the source
       file's ids and gradients keep working and nothing has to be rewritten.
       preserveAspectRatio keeps the logo's proportions inside our box. */
    return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${viewBox}" `
      + `preserveAspectRatio="xMidYMid meet" overflow="visible">${inner}</svg>`;
  }

  const b64 = fs.readFileSync(file).toString('base64');
  const mime = file.endsWith('.webp') ? 'image/webp'
    : file.endsWith('.png') ? 'image/png' : 'image/jpeg';
  return `<image x="${x}" y="${y}" width="${w}" height="${h}" `
    + `preserveAspectRatio="xMidYMid meet" href="data:${mime};base64,${b64}"/>`;
}

/** The ForgeMarket bolt, drawn rather than referenced so it never 404s. */
const BOLT = (x, y, s, fill, op = 1) =>
  `<path transform="translate(${x} ${y}) scale(${s})" opacity="${op}" fill="${fill}" `
  + `d="M9 6 L4.6 18.6 h5.1 l-2.2 8.4 L23.4 12.2 h-6.4 l2.2-6.2 z"/>`;

/** Shared defs: the dark base, the accent bloom, the grid, the vignette. */
function defs(id, accent, { w, h, bloomX, bloomY, bloomR, lit }) {
  return `<defs>
<linearGradient id="${id}base" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${w}" y2="${h}">
<stop offset="0" stop-color="${BRAND.ink0}"/><stop offset=".55" stop-color="${BRAND.ink1}"/><stop offset="1" stop-color="${BRAND.ink0}"/></linearGradient>
<radialGradient id="${id}bloom" gradientUnits="userSpaceOnUse" cx="${bloomX}" cy="${bloomY}" r="${bloomR}">
<stop offset="0" stop-color="${BRAND.purple}" stop-opacity="${lit ? '.60' : '.42'}"/>
<stop offset=".45" stop-color="${BRAND.indigo}" stop-opacity="${lit ? '.30' : '.20'}"/>
<stop offset="1" stop-color="${BRAND.indigo}" stop-opacity="0"/></radialGradient>
<radialGradient id="${id}cat" gradientUnits="userSpaceOnUse" cx="${w * 0.82}" cy="${h * 0.18}" r="${bloomR * 0.8}">
<stop offset="0" stop-color="${accent}" stop-opacity="${lit ? '.34' : '.22'}"/>
<stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
<radialGradient id="${id}vig" gradientUnits="userSpaceOnUse" cx="${w / 2}" cy="${h / 2}" r="${Math.max(w, h) * 0.72}">
<stop offset=".5" stop-color="#04030c" stop-opacity="0"/><stop offset="1" stop-color="#04030c" stop-opacity=".62"/></radialGradient>
<radialGradient id="${id}fade" gradientUnits="userSpaceOnUse" cx="${w / 2}" cy="${h * 0.42}" r="${Math.max(w, h) * 0.62}">
<stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<mask id="${id}mfade"><rect width="${w}" height="${h}" fill="url(#${id}fade)"/></mask>
<pattern id="${id}grid" width="${Math.round(w / 10)}" height="${Math.round(w / 10)}" patternUnits="userSpaceOnUse">
<path d="M${Math.round(w / 10)} 0V${Math.round(w / 10)}M0 ${Math.round(w / 10)}H${Math.round(w / 10)}" fill="none" stroke="#c7d2fe" stroke-width="1.1"/></pattern>
<linearGradient id="${id}num" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cdc2f7"/></linearGradient>
<linearGradient id="${id}rim" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${w}" y2="0">
<stop offset="0" stop-color="${BRAND.indigo}"/><stop offset=".5" stop-color="${BRAND.purple}"/><stop offset="1" stop-color="${accent}"/></linearGradient>
<filter id="${id}halo" x="-40%" y="-70%" width="180%" height="240%"><feGaussianBlur stdDeviation="${Math.round(w / 40)}"/></filter>
</defs>`;
}

/** The layers every artboard shares, in order. */
function ground(id, w, h, lit) {
  return `<rect width="${w}" height="${h}" fill="url(#${id}base)"/>
<rect width="${w}" height="${h}" fill="url(#${id}bloom)"/>
<rect width="${w}" height="${h}" fill="url(#${id}cat)"/>
<rect width="${w}" height="${h}" fill="url(#${id}grid)" mask="url(#${id}mfade)" opacity="${lit ? '.16' : '.11'}"/>
<rect width="${w}" height="${h}" fill="url(#${id}vig)"/>`;
}

/**
 * The card artboard: 700x600, the exact ratio of the tile it lands in.
 *
 * Layout is fixed for every product so a grid reads as one set: the mark on a
 * lit stage, the quantity beneath it. Type sizes are chosen against 184x158 —
 * the size this is actually seen at on a phone — not against 700x600.
 *
 * NO category line on this artboard, for two reasons found by rendering it into
 * the real card rather than by looking at the SVG. The card already prints the
 * category in text directly underneath, so the artwork was saying it twice. And
 * the card floats its own "Featured" and "By hand" badges over the top-left and
 * top-right corners — which used to sit on empty plinth and now sit on art, so
 * an eyebrow there came out as "RY BOX" and "AME PASS". The banner keeps its
 * category line, because a Discord embed has no card chrome to collide with.
 *
 * The bottom 18% is left empty for the same reason: the card floats "By hand"
 * and "High demand" there, and the unit line under the number ("MONTHS",
 * "COINS") was landing underneath them.
 */
export function mainSvg(product, { lit = false } = {}) {
  const W = 700, H = 600, id = 'a';
  const accent = accentFor(product.category);
  const label = CATEGORY_LABEL[product.category] || String(product.category || '').toUpperCase();
  const hl = headline(product.name);
  const mark = inlineMark(markFor(product), { x: 262, y: 150, w: 176, h: 176 });

  const bigSize = hl ? fitSize(hl.big, 7, 112, 62) : 0;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(product.name)}">
<title>${esc(product.name)}</title>
${defs(id, accent, { w: W, h: H, bloomX: 350, bloomY: 236, bloomR: 400, lit })}
${ground(id, W, H, lit)}
${BOLT(322, 44, 1.7, '#ddd6fe', lit ? 0.14 : 0.08)}
<ellipse cx="350" cy="344" rx="132" ry="17" fill="${accent}" opacity="${lit ? '.28' : '.16'}"/>
<circle cx="350" cy="238" r="${lit ? 126 : 122}" fill="none" stroke="url(#${id}rim)" stroke-width="3" opacity="${lit ? '.95' : '.6'}"/>
${mark || `<circle cx="350" cy="238" r="88" fill="#1b1636" stroke="${accent}" stroke-width="3" opacity=".8"/>`}
${hl ? `<text x="350" y="${hl.small ? 440 : 456}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="${bigSize}" font-weight="800" letter-spacing="-1" fill="${BRAND.purple}" filter="url(#${id}halo)" opacity="${lit ? '.85' : '.55'}">${esc(hl.big)}</text>
<text x="350" y="${hl.small ? 440 : 456}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="${bigSize}" font-weight="800" letter-spacing="-1" fill="url(#${id}num)">${esc(hl.big)}</text>` : ''}
${hl && hl.small ? `<text x="350" y="488" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="28" font-weight="700" letter-spacing="8" fill="${BRAND.muted}">${esc(hl.small)}</text>` : ''}
<rect x="0" y="${H - 5}" width="${W}" height="5" fill="url(#${id}rim)" opacity="${lit ? '1' : '.75'}"/>
</svg>`;
}

/**
 * The hover artboard.
 *
 * Deliberately the SAME composition, brighter: the bloom comes up, the ring
 * closes, the accent floor glows. A hover state that rearranges the card makes
 * a grid twitch under the cursor; one that lights up reads as a response.
 * Phones never see it, which is why nothing here carries information.
 */
export const hoverSvg = (product) => mainSvg(product, { lit: true });

/**
 * The 16:9 artboard: TikTok end-card, Discord embed, site banner.
 *
 * Left column is type, right is the mark on its stage. Everything sits inside a
 * 6% safe margin so a Discord embed crop or a TikTok caption bar cannot eat the
 * price. Type is sized for ~400px wide, which is what a Discord embed gives it.
 */
export function bannerSvg(product) {
  const W = 1600, H = 900, id = 'b';
  const accent = accentFor(product.category);
  const label = CATEGORY_LABEL[product.category] || String(product.category || '').toUpperCase();
  const hl = headline(product.name);
  const mark = inlineMark(markFor(product), { x: 1010, y: 300, w: 300, h: 300 });
  const price = Number.isFinite(product.price) ? `€${(product.price / 100).toFixed(2).replace('.', ',')}` : null;
  const nameSize = fitSize(product.name, 30, 56, 34);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="ForgeMarket — ${esc(product.name)}">
<title>ForgeMarket — ${esc(product.name)}</title>
${defs(id, accent, { w: W, h: H, bloomX: 1160, bloomY: 420, bloomR: 700, lit: false })}
${ground(id, W, H, false)}
<g><rect x="96" y="74" width="76" height="76" rx="22" fill="url(#${id}rim)"/>${BOLT(101, 73, 2.32, '#ffffff')}
<text x="192" y="130" font-family="Inter, system-ui, sans-serif" font-size="50" font-weight="800" letter-spacing="1" fill="${BRAND.text}">ForgeMarket</text></g>
<text x="96" y="300" font-family="Inter, system-ui, sans-serif" font-size="44" font-weight="700" letter-spacing="11" fill="${accent}">${esc(label)}</text>
${hl ? `<text x="96" y="500" font-family="Inter, system-ui, sans-serif" font-size="196" font-weight="800" letter-spacing="-4" fill="${BRAND.purple}" filter="url(#${id}halo)" opacity=".6">${esc(hl.big)}</text>
<text x="96" y="500" font-family="Inter, system-ui, sans-serif" font-size="196" font-weight="800" letter-spacing="-4" fill="url(#${id}num)">${esc(hl.big)}</text>
${hl.small ? `<text x="96" y="566" font-family="Inter, system-ui, sans-serif" font-size="44" font-weight="700" letter-spacing="10" fill="${BRAND.muted}">${esc(hl.small)}</text>` : ''}`
    : `<text x="96" y="470" font-family="Inter, system-ui, sans-serif" font-size="${nameSize + 24}" font-weight="800" fill="url(#${id}num)">${esc(product.name)}</text>`}
<text x="96" y="${hl && hl.small ? 640 : 610}" font-family="Inter, system-ui, sans-serif" font-size="${nameSize}" font-weight="600" fill="#c3cbf0">${esc(product.name)}</text>
${price ? `<g><rect x="96" y="${hl && hl.small ? 682 : 652}" width="300" height="94" rx="26" fill="#140f2e" fill-opacity=".85" stroke="url(#${id}rim)" stroke-width="3"/>
<text x="126" y="${hl && hl.small ? 744 : 714}" font-family="Inter, system-ui, sans-serif" font-size="56" font-weight="800" fill="${BRAND.text}">${price}</text></g>` : ''}
<ellipse cx="1160" cy="640" rx="290" ry="34" fill="${accent}" opacity=".18"/>
<circle cx="1160" cy="450" r="228" fill="none" stroke="url(#${id}rim)" stroke-width="7" opacity=".8"/>
${mark || `<circle cx="1160" cy="450" r="170" fill="#1b1636" stroke="${accent}" stroke-width="5" opacity=".8"/>`}
<text x="1504" y="846" text-anchor="end" font-family="Inter, system-ui, sans-serif" font-size="40" font-weight="600" letter-spacing="2" fill="#8e9bd9">forgemarket.nl</text>
<rect x="0" y="${H - 7}" width="${W}" height="7" fill="url(#${id}rim)"/>
</svg>`;
}
