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
/* Which marks are raster is decided once, in src/lib/brandMarks.js — the
   storefront and the seed read the same list. */
import { RASTER_ICONS as RASTER, markPath } from '../../src/lib/brandMarks.js';
/* The same marks, bundled as a module for where public/ is not on disk — the
   API on Vercel, which renders tiles for products the build never drew. Disk
   wins whenever it has the file, so the shipped boards come out byte-for-byte
   as before. Kept current by scripts/gen-art-assets.mjs and its --check. */
import { ASSETS as BUNDLED, INK as BUNDLED_INK } from '../../server/src/generated/artAssets.js';

const PUBLIC = path.join(process.cwd(), 'public');

const onDisk = (src) => fs.existsSync(path.join(PUBLIC, String(src).replace(/^\/+/, '')));
const hasAsset = (src) => onDisk(src) || !!BUNDLED[src];


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
/** The brand's own mark for a slug (netflix, googleplay, itunes, …), or null. */
export function brandMark(slug) {
  if (!slug) return null;
  const candidate = markPath(slug);
  if (hasAsset(candidate)) return candidate;
  const svg = `/products/icons/${slug}.svg`;
  return hasAsset(svg) ? svg : null;
}

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
  const candidate = markPath(slug);
  if (hasAsset(candidate)) return candidate;
  const svg = `/products/icons/${slug}.svg`;
  return hasAsset(svg) ? svg : null;
}

/**
 * How much of the circle the mark's INK should span.
 *
 * Measured before this existed: the 64 SVG marks painted 52-62% of the 176px
 * stage while the 10 WebP marks painted 88.1% — because preserveAspectRatio
 * fits the CANVAS, and the SVGs are drawn on a 512 square with generous
 * padding while the WebPs are cropped tight. So 24 products showed a logo half
 * again as large as the other 47, in the same grid, for no reason connected to
 * the products. Exactly the unevenness the artboard system was built to remove,
 * reintroduced one level down.
 *
 * Fitting by ink instead of by canvas makes the stage mean the same thing for
 * every mark. 0.74 keeps a square logo clear of the ring it sits in: the stage
 * is inscribed in a circle of the same diameter, so a square can reach 1/√2 =
 * 70.7% of it before its corners cross the stroke, and the few marks that are
 * round rather than square can afford the rest.
 */
const MARK_SPAN = 0.74;

/** Ink boxes, measured by scripts/art/measure-marks.mjs. Absent → fit by canvas. */
const INK = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(PUBLIC, 'products/icons/_ink.json'), 'utf8')); }
  catch { return BUNDLED_INK || {}; }
})();

/**
 * Read an icon file and return something that can be dropped into an SVG at a
 * given box, or null when the file is missing.
 */
export function inlineMark(src, { x, y, w, h }) {
  if (!src) return null;
  /* A logo handed over as bytes — the owner's own category logo, or a brand
     logo the shop holds under a free licence — drawn on the stage, clipped to
     the round plate so a square picture sits in the ring like the drawn marks. */
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(String(src))) {
    const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) / 2;
    return `<clipPath id="logoclip"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>`
      + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#0b0918"/>`
      + `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" clip-path="url(#logoclip)" href="${src}"/>`;
  }
  const file = path.join(PUBLIC, String(src).replace(/^\/+/, ''));
  const bundled = BUNDLED[String(src)];
  const disk = fs.existsSync(file);
  if (!disk && !bundled) return null;
  const ink = INK[path.basename(file)];

  if (file.endsWith('.svg')) {
    const raw = disk ? fs.readFileSync(file, 'utf8') : bundled.text;
    const vb = raw.match(/viewBox="([^"]+)"/);
    const viewBox = vb ? vb[1] : '0 0 512 512';
    // Everything between the outer <svg …> and </svg>, minus any XML prologue.
    const inner = raw
      .replace(/^[\s\S]*?<svg[^>]*>/i, '')
      .replace(/<\/svg>\s*$/i, '')
      .replace(/<\?xml[\s\S]*?\?>/gi, '');
    /* A nested <svg> gives the mark its own coordinate system, so the source
       file's ids and gradients keep working and nothing has to be rewritten.
       With an ink box we hand it the ink rather than the canvas, so the mark
       fills the stage and preserveAspectRatio still keeps its proportions. */
    const box = ink ? `${ink.x} ${ink.y} ${ink.w} ${ink.h}` : viewBox;
    const [bx, by, bw, bh] = ink ? fitInk(ink, { x, y, w, h }) : [x, y, w, h];
    return `<svg x="${bx}" y="${by}" width="${bw}" height="${bh}" viewBox="${box}" `
      + `preserveAspectRatio="xMidYMid meet" overflow="visible">${inner}</svg>`;
  }

  const b64 = disk ? fs.readFileSync(file).toString('base64') : bundled.b64;
  const mime = file.endsWith('.webp') ? 'image/webp'
    : file.endsWith('.png') ? 'image/png' : 'image/jpeg';
  /* A raster cannot be re-cropped by a viewBox, so instead the whole image is
     scaled and offset until its ink lands on the same stage every SVG mark
     gets. Same result, arrived at from the other side. */
  const [bx, by, bw, bh] = ink ? fitInkRaster(ink, { x, y, w, h }) : [x, y, w, h];
  return `<image x="${bx}" y="${by}" width="${bw}" height="${bh}" `
    + `preserveAspectRatio="xMidYMid meet" href="data:${mime};base64,${b64}"/>`;
}

/** Place a nested <svg> whose viewBox is the ink box, centred, spanning MARK_SPAN. */
function fitInk(ink, { x, y, w, h }) {
  const target = Math.min(w, h) * MARK_SPAN;
  const s = target / Math.max(ink.w, ink.h);
  const bw = ink.w * s, bh = ink.h * s;
  return [round(x + (w - bw) / 2), round(y + (h - bh) / 2), round(bw), round(bh)];
}

/** Same target, but reached by scaling the whole raster around its ink centre. */
function fitInkRaster(ink, { x, y, w, h }) {
  const [, , vbW, vbH] = ink.box;
  const target = Math.min(w, h) * MARK_SPAN;
  const s = target / Math.max(ink.w, ink.h);
  const bw = vbW * s, bh = vbH * s;
  // where the ink centre lands inside the scaled image, then align it to centre
  const cx = (ink.x + ink.w / 2) * s, cy = (ink.y + ink.h / 2) * s;
  return [round(x + w / 2 - cx), round(y + h / 2 - cy), round(bw), round(bh)];
}

const round = (n) => Math.round(n * 100) / 100;

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
 *
 * "Left empty" was off by a hair. Measured in the real card: the pill's top edge
 * sits at 81.4% of the media box and the unit line's baseline at 81.3% — 0.16
 * CSS pixels apart on a phone, which is not a gap, it is a coincidence.
 *
 * The line now sits at 478, which puts real air under it, and it got BIGGER
 * rather than smaller: at 28 it rendered 7.3 CSS px on a 182px phone tile, under
 * anything anyone can read. At 34 it is 8.8. It also shrinks with its own length
 * now, so "IN-GAME CASH" does not run the width of the tile the way a five-letter
 * "COINS" comfortably does.
 */
export function mainSvg(product, { lit = false, unit = null } = {}) {
  const W = 700, H = 600, id = 'a';
  const accent = accentFor(product.category);
  const label = CATEGORY_LABEL[product.category] || String(product.category || '').toUpperCase();
  /* `unit` is only passed for a tile drawn at runtime, for a product whose
     name headline() has no word for ("2,000 Tokens"). The build never passes
     it, so no shipped board changes. */
  const hl0 = headline(product.name, product.description);
  const hl = hl0 && !hl0.small && unit && !String(hl0.big).startsWith('€')
    ? { ...hl0, small: String(unit).toUpperCase() } : hl0;
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
${hl && hl.small ? `<text x="350" y="478" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="${fitSize(hl.small, 8, 34, 22)}" font-weight="700" letter-spacing="6" fill="${BRAND.muted}">${esc(hl.small)}</text>` : ''}
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
  const hl = headline(product.name, product.description);
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

/* ── The live product card ─────────────────────────────────────────────────
 * What /api/products/:id/tile.svg draws for a product without the owner's own
 * card: the game's or brand's own colours edge to edge, its logo as the hero,
 * and the product's own amount on a glass plate — a store card, not an icon
 * on a dark board. Shipped files keep mainSvg; this is the runtime look. */
const THEMES = {
  eafc: ['#0b3d2e', '#00e676', '#062016'], cod: ['#3a2a12', '#ff9a1f', '#120c05'], valorant: ['#4a0d14', '#ff4655', '#14060a'],
  xbox: ['#0e3d0e', '#3ee03e', '#051405'], playstation: ['#06265e', '#2f8cff', '#030c1f'], steam: ['#122840', '#66c0f4', '#070f19'],
  nintendo: ['#5c0710', '#ff2a3d', '#1a0306'], netflix: ['#4d070b', '#ff2b36', '#140304'], googleplay: ['#083b33', '#34d399', '#03130f'],
  itunes: ['#3d0f3a', '#ff5ec4', '#13050f'], amazon: ['#3d2405', '#ffa31a', '#140b02'], spotify: ['#0b3d1e', '#1ed760', '#04140a'],
  'discord-nitro': ['#1e1f5c', '#7c83ff', '#08081c'], gamepass: ['#0e3d0e', '#9be15d', '#051405'], genshin: ['#3a2c0c', '#f5c451', '#120d03'],
  league: ['#2e2610', '#c89b3c', '#0e0b05'], freefire: ['#4a1a05', '#ff7a1a', '#170802'], robux: ['#1f2933', '#e2e8f0', '#0a0e12'],
  'v-bucks': ['#0f2a4d', '#4fc3ff', '#050d18'], apex: ['#4a0d0d', '#ff4d4d', '#160404'], pubg: ['#3a2f0c', '#f2a900', '#120e03'],
  brawl: ['#3d2a05', '#ffc928', '#140d02'], clash: ['#3d2a05', '#ffcc33', '#140d02'], clashroyale: ['#0d2a4d', '#4da3ff', '#040d18'],
  pokemongo: ['#0d2a4d', '#ffcb05', '#040d18'], mlbb: ['#0d2240', '#5ab0ff', '#040b16'], minecraft: ['#1f3d12', '#7bd34a', '#0a1406'],
  gta: ['#123d1f', '#57d27a', '#06140a'], giftcard: ['#2a1a4d', '#a78bfa', '#0c0718'],
};
const BRAND_LABEL = { steam: 'STEAM', playstation: 'PLAYSTATION STORE', xbox: 'XBOX', nintendo: 'NINTENDO ESHOP', netflix: 'NETFLIX',
  googleplay: 'GOOGLE PLAY', itunes: 'APP STORE & ITUNES', amazon: 'AMAZON', spotify: 'SPOTIFY', 'discord-nitro': 'DISCORD NITRO', gamepass: 'XBOX GAME PASS' };
const CARD_UNITS = [[/\bRP\b/, 'RP'], [/crystals?/i, 'CRYSTALS'], [/\bUC\b/, 'UC'], [/pok[eé]coins/i, 'POKÉCOINS'],
  [/apex coins/i, 'APEX COINS'], [/\bCP\b|cod points/i, 'COD POINTS'], [/valorant points|\bVP\b/i, 'VP'], [/fc points/i, 'FC POINTS'], [/diamonds?/i, 'DIAMONDS'], [/gems?/i, 'GEMS']];
const RASTER_MARK = new Set(['cod', 'discord-nitro', 'eafc', 'playstation', 'robux', 'steam', 'v-bucks', 'valorant', 'xbox']);
const PLATFORMS = [[/playstation|\bps[45]?\b|\bpsn\b/i, 'PLAYSTATION'], [/xbox/i, 'XBOX'], [/\bpc\b/i, 'PC'], [/\bnl\b/i, 'NL'], [/\beu\b/i, 'EU']];

export function cardSvg(product, { logo = null, brand = null, unit = null } = {}) {
  const W = 700, H = 600;
  const key = (brand && THEMES[brand]) ? brand : (THEMES[product.category] ? product.category : 'giftcard');
  const [c1, c2, c3] = THEMES[key];
  const hl0 = headline(product.name, product.description);
  /* The currency's own name where the name says it; the caller's guess last. */
  const named = (CARD_UNITS.find(([re]) => re.test(product.name || '')) || [])[1];
  const unitWord = named || unit;
  const hl = hl0 && (named || (!hl0.small && unitWord)) && !String(hl0.big).startsWith('€') ? { ...hl0, small: String(unitWord).toUpperCase() } : hl0;
  /* The hero: a logo handed over (the owner's or a licensed one), else the
     brand's real raster mark, else its drawn icon. */
  const slug = brand || product.category;
  const src = logo || (RASTER_MARK.has(slug) ? `/products/icons/${slug}.webp` : brandMark(slug) || markPath(product.category));
  const isData = /^data:image\//.test(String(src || ''));
  /* Rasters go in whole and large; drawn icons through inlineMark, which
     trims them to their ink so they fill the same stage. */
  const raster = !isData && /\.webp$/.test(String(src)) && BUNDLED[String(src)];
  const href = isData ? src : raster ? `data:image/webp;base64,${raster.b64}` : null;
  const hero = href
    ? `<g filter="url(#cshadow)"><clipPath id="cherc"><rect x="195" y="62" width="310" height="290" rx="44"/></clipPath><image x="195" y="62" width="310" height="290" preserveAspectRatio="xMidYMid meet" clip-path="url(#cherc)" href="${href}"/></g>`
    : `<g filter="url(#cshadow)">${inlineMark(src, { x: 190, y: 50, w: 320, h: 310 }) || ''}</g>`;
  /* The platform chip, unless the label already says it (a PlayStation card). */
  const plat0 = (PLATFORMS.find(([re]) => re.test(product.name || '')) || [])[1];
  const plat = plat0 && !(BRAND_LABEL[brand] || '').includes(plat0) ? plat0 : null;
  const label = (BRAND_LABEL[brand] || CATEGORY_LABEL[product.category] || '').toUpperCase();
  const big = hl ? hl.big : '';
  const bigSize = hl ? fitSize(big, 7, 118, 64) : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(product.name)}">
<title>${esc(product.name)}</title>
<defs>
<linearGradient id="cbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset=".6" stop-color="${c3}"/><stop offset="1" stop-color="#05040a"/></linearGradient>
<radialGradient id="cglow" cx="350" cy="205" r="300" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${c2}" stop-opacity=".55"/><stop offset=".55" stop-color="${c2}" stop-opacity=".12"/><stop offset="1" stop-color="${c2}" stop-opacity="0"/></radialGradient>
<linearGradient id="csheen" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".07"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="cplate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".10"/><stop offset="1" stop-color="#ffffff" stop-opacity=".03"/></linearGradient>
<linearGradient id="cnum" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="${c2}"/></linearGradient>
<filter id="cshadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#000" flood-opacity=".55"/></filter>
<filter id="cblur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>
<pattern id="cdots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.4" fill="#fff" opacity=".07"/></pattern>
</defs>
<rect width="${W}" height="${H}" fill="url(#cbg)"/>
<rect width="${W}" height="${H}" fill="url(#cdots)"/>
<circle cx="350" cy="205" r="300" fill="url(#cglow)"/>
<circle cx="560" cy="80" r="120" fill="${c2}" opacity=".18" filter="url(#cblur)"/>
<path d="M-60 520 L320 -40 L420 -40 L40 520Z" fill="url(#csheen)"/>
<path d="M300 640 L700 60 L760 60 L360 640Z" fill="url(#csheen)" opacity=".7"/>
${hero}
${label ? `<text x="34" y="52" font-family="Inter, system-ui, sans-serif" font-size="22" font-weight="800" letter-spacing="3" fill="#fff" opacity=".85">${esc(label)}</text>` : ''}
${plat ? `<g><rect x="${W - 34 - (plat.length * 15 + 34)}" y="26" rx="18" width="${plat.length * 15 + 34}" height="36" fill="#000" fill-opacity=".35" stroke="${c2}" stroke-opacity=".7" stroke-width="2"/><text x="${W - 34 - (plat.length * 15 + 34) / 2}" y="51" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="18" font-weight="800" letter-spacing="2" fill="#fff">${plat}</text></g>` : ''}
<rect x="30" y="372" width="${W - 60}" height="196" rx="28" fill="url(#cplate)" stroke="#fff" stroke-opacity=".14" stroke-width="2"/>
${hl ? `<text x="350" y="${hl.small ? 486 : 502}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="${bigSize}" font-weight="900" letter-spacing="-2" fill="${c2}" opacity=".45" filter="url(#cblur)">${esc(big)}</text>
<text x="350" y="${hl.small ? 486 : 502}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="${bigSize}" font-weight="900" letter-spacing="-2" fill="url(#cnum)">${esc(big)}</text>` : `<text x="350" y="490" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="54" font-weight="900" fill="#fff">${esc(String(product.name || '').slice(0, 22))}</text>`}
${hl && hl.small ? `<text x="350" y="536" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="${fitSize(hl.small, 10, 28, 18)}" font-weight="800" letter-spacing="8" fill="${c2}">${esc(hl.small)}</text>` : ''}
<path transform="translate(650 556) scale(1.1)" fill="#fff" opacity=".35" d="M9 6 L4.6 18.6 h5.1 l-2.2 8.4 L23.4 12.2 h-6.4 l2.2-6.2 z"/>
</svg>`;
}
