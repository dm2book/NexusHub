/**
 * Category icon generator — builds the 3D-style SVG icon set in
 * public/products/icons/.
 *
 * Everything is drawn from primitives so the whole set shares one look:
 * a single light from the top-left, a real extruded side face, a glossy
 * specular highlight and a soft contact shadow. Run with:
 *
 *   node scripts/gen-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = process.env.ICON_OUT || join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'products', 'icons');
const S = 512;                     // viewBox size
const CX = 256, CY = 238;          // object centre (slightly high — shadow sits below)

/* ── colour helpers ──────────────────────────────────────────────────────── */
const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
const hex2rgb = (h) => { const v = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)); };
const rgb2hex = (r, g, b) => '#' + [r, g, b].map((n) => clamp(n).toString(16).padStart(2, '0')).join('');
/** amount > 0 lightens toward white, < 0 darkens toward black. */
const shade = (hexColor, amount) => {
  const [r, g, b] = hex2rgb(hexColor);
  const t = amount > 0 ? 255 : 0, p = Math.abs(amount);
  return rgb2hex(r + (t - r) * p, g + (t - g) * p, b + (t - b) * p);
};
const mix = (a, b, t) => {
  const [r1, g1, b1] = hex2rgb(a), [r2, g2, b2] = hex2rgb(b);
  return rgb2hex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
};

/* ── geometry helpers ────────────────────────────────────────────────────── */
const pts = (list) => list.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');
const round = (n) => Math.round(n * 100) / 100;

const polyPath = (list) => `M${list.map(([x, y]) => `${round(x)} ${round(y)}`).join('L')}Z`;

const hexagon = (cx, cy, r, flat = false) => {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - (flat ? 0 : Math.PI / 2);
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
};

const roundRectPath = (x, y, w, h, r) =>
  `M${round(x + r)} ${round(y)}H${round(x + w - r)}A${r} ${r} 0 0 1 ${round(x + w)} ${round(y + r)}` +
  `V${round(y + h - r)}A${r} ${r} 0 0 1 ${round(x + w - r)} ${round(y + h)}` +
  `H${round(x + r)}A${r} ${r} 0 0 1 ${round(x)} ${round(y + h - r)}` +
  `V${round(y + r)}A${r} ${r} 0 0 1 ${round(x + r)} ${round(y)}Z`;

const circlePath = (cx, cy, r) =>
  `M${round(cx - r)} ${round(cy)}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;

/* ── the 3D engine ───────────────────────────────────────────────────────── */
// Gradient/clip ids are namespaced per icon: several of these SVGs can end up
// inlined in one document, where duplicate ids would silently cross-wire and
// every icon would inherit the first one's colours.
let uid = 0, ns = 'i';
const nid = (p) => `${ns}-${p}${++uid}`;

/**
 * Extrude a path downwards to fake solid depth: the shape is stamped once per
 * pixel of depth, darkening as it goes, so any silhouette gets a real side face.
 */
function extrude(d, depth, base) {
  const id = nid('s');
  let body = `<defs><path id="${id}" d="${d}"/></defs>`;
  const dark = shade(base, -0.55), mid = shade(base, -0.28);
  for (let i = depth; i >= 1; i--) {
    const t = i / depth;                       // 1 = deepest
    body += `<use href="#${id}" y="${round(i)}" fill="${mix(mid, dark, t)}"/>`;
  }
  return { defsRef: id, body };
}

/**
 * A finished 3D piece: extruded side, gradient top face, rim light and gloss.
 * `d` is the top-face path.
 */
function solid(d, { color, depth = 26, gloss = true, rim = true } = {}) {
  const g = nid('g'), cl = nid('c'), sp = nid('p');
  const light = shade(color, 0.42), deep = shade(color, -0.2);
  const { body } = extrude(d, depth, color);
  return `
  <defs>
    <linearGradient id="${g}" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="${light}"/>
      <stop offset="0.5" stop-color="${color}"/>
      <stop offset="1" stop-color="${deep}"/>
    </linearGradient>
    <clipPath id="${cl}"><path d="${d}"/></clipPath>
    <radialGradient id="${sp}" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#fff" stop-opacity="0.72"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  ${body}
  <path d="${d}" fill="url(#${g})"/>
  ${rim ? `<path d="${d}" fill="none" stroke="${shade(color, 0.55)}" stroke-opacity="0.75" stroke-width="3"/>` : ''}
  ${gloss ? `<g clip-path="url(#${cl})"><ellipse cx="${CX - 40}" cy="${CY - 66}" rx="96" ry="54"
      fill="url(#${sp})" transform="rotate(-24 ${CX - 40} ${CY - 66})"/></g>` : ''}`;
}

/** Soft ellipse the object appears to rest on. */
function contactShadow(rx = 132, ry = 26, y = CY + 150, opacity = 0.4) {
  const id = nid('sh');
  return `
  <defs><radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#0b1220" stop-opacity="${opacity}"/>
    <stop offset="0.6" stop-color="#0b1220" stop-opacity="${opacity * 0.4}"/>
    <stop offset="1" stop-color="#0b1220" stop-opacity="0"/>
  </radialGradient></defs>
  <ellipse cx="${CX}" cy="${y}" rx="${rx}" ry="${ry}" fill="url(#${id})"/>`;
}

const svg = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" fill="none">\n${inner}\n</svg>\n`;

/* ── shape archetypes ────────────────────────────────────────────────────── */

/** Hexagonal coin with a square hole — game-currency token. */
const hexCoin = (color, { hole = true, stack = true } = {}) => {
  const R = 122, depth = 30;
  let out = contactShadow();
  if (stack) {
    // two coins peeking out behind, smaller + darker for depth
    out += solid(polyPath(hexagon(CX - 84, CY + 54, 74)), { color: shade(color, -0.12), depth: 20, gloss: false });
    out += solid(polyPath(hexagon(CX + 86, CY + 62, 62)), { color: shade(color, -0.18), depth: 16, gloss: false });
  }
  const face = polyPath(hexagon(CX, CY, R));
  out += solid(face, { color, depth });
  if (hole) {
    const h = 42;
    out += `<path d="${roundRectPath(CX - h, CY - h, h * 2, h * 2, 12)}" fill="${shade(color, -0.62)}"/>`;
    out += `<path d="${roundRectPath(CX - h + 7, CY - h + 7, h * 2 - 14, h * 2 - 14, 8)}" fill="${shade(color, -0.34)}"/>`;
  }
  return out;
};

/** Round coin, optionally carrying a glyph path. */
const roundCoin = (color, glyph, { stack = true } = {}) => {
  const R = 118, depth = 30;
  let out = contactShadow();
  if (stack) {
    out += solid(circlePath(CX - 88, CY + 58, 70), { color: shade(color, -0.12), depth: 20, gloss: false });
    out += solid(circlePath(CX + 90, CY + 66, 58), { color: shade(color, -0.18), depth: 16, gloss: false });
  }
  out += solid(circlePath(CX, CY, R), { color, depth });
  // inner ring for a minted look
  out += `<path d="${circlePath(CX, CY, R - 20)}" fill="none" stroke="${shade(color, 0.4)}" stroke-opacity="0.55" stroke-width="5"/>`;
  if (glyph) out += glyph;
  return out;
};

/**
 * Faceted gem — premium currencies. Built facet-by-facet rather than extruded:
 * each plane gets its own shade so the crystal reads as solid from one light.
 */
const gemIcon = (color) => {
  const w = 218, h = 236;
  const gy = CY - h / 4;                                   // girdle line
  const A = [CX - w / 2, gy], D = [CX + w / 2, gy];         // girdle corners
  const B = [CX - w / 4, CY - h / 2], C = [CX + w / 4, CY - h / 2]; // table edge
  const BL = [CX - w / 4, gy], BR = [CX + w / 4, gy];
  const E = [CX, CY + h / 2];                               // culet
  const outline = [A, B, C, D, E];
  const face = (poly, amt) => `<path d="${polyPath(poly)}" fill="${shade(color, amt)}"/>`;

  let out = contactShadow(104, 20, CY + h / 2 + 30);
  out += `<path d="${polyPath(outline)}" fill="${shade(color, -0.6)}" transform="translate(0 12)"/>`;
  out += face([A, B, BL], 0.30);        // crown, lit side
  out += face([B, C, BR, BL], 0.5);     // table — catches the most light
  out += face([C, D, BR], 0.02);        // crown, shadow side
  out += face([A, BL, E], -0.06);       // pavilion, lit side
  out += face([BL, BR, E], 0.2);        // pavilion, centre
  out += face([BR, D, E], -0.32);       // pavilion, shadow side
  out += `<path d="${polyPath(outline)}" fill="none" stroke="${shade(color, 0.6)}" stroke-opacity="0.5" stroke-width="3"/>`;
  out += `<path d="${polyPath([B, [CX - w / 12, CY - h / 2], [CX - w / 5, gy], BL])}" fill="#fff" opacity="0.22"/>`;
  return out;
};

/** Rounded-square app tile with a glyph — stores & subscriptions. */
const tile = (color, glyph, { r = 52 } = {}) => {
  const w = 224;
  let out = contactShadow(118, 24);
  out += solid(roundRectPath(CX - w / 2, CY - w / 2, w, w, r), { color, depth: 26 });
  if (glyph) out += glyph;
  return out;
};

/** Gift card tilted in space, with a ribbon. */
const giftCard = (color, accent) => {
  const w = 250, h = 160;
  let out = contactShadow(126, 24);
  // back card, peeking out
  out += solid(roundRectPath(CX - w / 2 + 26, CY - h / 2 - 34, w - 40, h - 20, 20),
    { color: shade(color, -0.22), depth: 16, gloss: false });
  out += solid(roundRectPath(CX - w / 2, CY - h / 2, w, h, 24), { color, depth: 26 });
  // ribbon
  out += `<g>
    <rect x="${CX - 17}" y="${CY - h / 2}" width="34" height="${h}" fill="${accent}" opacity="0.95"/>
    <rect x="${CX - w / 2}" y="${CY - 17}" width="${w}" height="34" fill="${accent}" opacity="0.95"/>
    <rect x="${CX - 17}" y="${CY - h / 2}" width="12" height="${h}" fill="#fff" opacity="0.25"/>
  </g>`;
  return out;
};

/** Glossy sphere. `detail` is drawn on the ball, clipped to it. */
const sphere = (color, detail = '') => {
  const R = 118;
  const g = nid('sg'), s = nid('ss'), c = nid('sc');
  return `${contactShadow(104, 22)}
  <defs>
    <clipPath id="${c}"><circle cx="${CX}" cy="${CY}" r="${R}"/></clipPath>
    <radialGradient id="${g}" cx="0.34" cy="0.28" r="0.82">
      <stop offset="0" stop-color="${shade(color, 0.55)}"/>
      <stop offset="0.55" stop-color="${color}"/>
      <stop offset="1" stop-color="${shade(color, -0.45)}"/>
    </radialGradient>
    <radialGradient id="${s}" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#fff" stop-opacity="0.8"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="${CX}" cy="${CY}" r="${R}" fill="url(#${g})"/>
  ${detail ? `<g clip-path="url(#${c})">${detail}</g>` : ''}
  <ellipse cx="${CX - 38}" cy="${CY - 46}" rx="52" ry="34" fill="url(#${s})" transform="rotate(-28 ${CX - 38} ${CY - 46})"/>`;
};

/** Crossed bars — the mark on the console sphere. */
const detailCross = (color = '#f2fff5') => `<g stroke="${color}" stroke-width="22" stroke-linecap="round" opacity="0.95">
    <path d="M${CX - 46} ${CY - 46}L${CX + 46} ${CY + 46}"/>
    <path d="M${CX + 46} ${CY - 46}L${CX - 46} ${CY + 46}"/>
  </g>`;

/** Stitched panels — turns a sphere into a football. */
const detailPanels = (color = '#0f2a22') => {
  const R = 118;
  const pent = (cx, cy, r, rot = 0) => polyPath(
    Array.from({ length: 5 }, (_, i) => {
      const a = (Math.PI * 2 / 5) * i - Math.PI / 2 + rot;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    }));
  return `<g fill="${color}" opacity="0.9">
    <path d="${pent(CX, CY - 6, 46)}"/>
    <path d="${pent(CX - 96, CY - 62, 34, 0.6)}"/>
    <path d="${pent(CX + 96, CY - 52, 34, -0.4)}"/>
    <path d="${pent(CX - 60, CY + 96, 34, 0.2)}"/>
    <path d="${pent(CX + 66, CY + 92, 34, -0.2)}"/>
  </g>
  <g stroke="${color}" stroke-width="7" fill="none" opacity="0.55">
    <path d="M${CX} ${CY - 52}V${CY - 96}"/><path d="M${CX - 44} ${CY + 20}L${CX - 74} ${CY + 62}"/>
    <path d="M${CX + 44} ${CY + 20}L${CX + 74} ${CY + 58}"/>
    <path d="M${CX - 44} ${CY - 22}L${CX - 84} ${CY - 44}"/><path d="M${CX + 44} ${CY - 22}L${CX + 84} ${CY - 38}"/>
  </g>`;
};

/** Banknote — cash / account top-ups. */
const banknote = (color, accent) => {
  const w = 246, h = 148;
  let out = contactShadow(124, 24);
  out += solid(roundRectPath(CX - w / 2 + 22, CY - h / 2 - 30, w - 44, h - 16, 16),
    { color: shade(color, -0.22), depth: 14, gloss: false });
  out += solid(roundRectPath(CX - w / 2, CY - h / 2, w, h, 18), { color, depth: 24 });
  out += `<circle cx="${CX}" cy="${CY}" r="40" fill="none" stroke="${accent}" stroke-width="12" opacity="0.92"/>
    <circle cx="${CX}" cy="${CY}" r="18" fill="${accent}" opacity="0.92"/>
    <g fill="${accent}" opacity="0.6">
      <circle cx="${CX - w / 2 + 34}" cy="${CY - h / 2 + 32}" r="10"/>
      <circle cx="${CX + w / 2 - 34}" cy="${CY + h / 2 - 32}" r="10"/>
    </g>`;
  return out;
};

/** Shopping bag — storefronts. */
const bag = (color) => {
  const w = 208, h = 196, x = CX - w / 2, y = CY - h / 2 + 16;
  let out = contactShadow(112, 22);
  out += solid(roundRectPath(x, y, w, h, 26), { color, depth: 26 });
  // handle
  out += `<path d="M${x + 54} ${y + 6}v-26a${52} ${52} 0 0 1 ${w - 108} 0v26"
    fill="none" stroke="${shade(color, 0.3)}" stroke-width="18" stroke-linecap="round"/>`;
  return out;
};

/** Angular chevron / V mark. */
const chevron = (color) => {
  const w = 220, h = 190;
  const d = polyPath([
    [CX - w / 2, CY - h / 2], [CX - w / 2 + 62, CY - h / 2],
    [CX, CY + h / 2 - 34], [CX + w / 2, CY - h / 2],
    [CX + w / 2 - 62, CY + h / 2], [CX - 4, CY + h / 2],
  ]);
  return contactShadow(110, 22) + solid(d, { color, depth: 24 });
};

/** Treasure chest. */
const chest = (color, lidColor) => {
  const w = 214, h = 132, x = CX - w / 2, y = CY - 18;
  let out = contactShadow(118, 24);
  out += solid(roundRectPath(x, y, w, h, 16), { color, depth: 24 });
  out += solid(`M${x} ${y}a${w / 2} ${w / 2} 0 0 1 ${w} 0Z`, { color: lidColor, depth: 18, gloss: false });
  out += `<rect x="${CX - 20}" y="${y - 14}" width="40" height="62" rx="10" fill="${shade(lidColor, 0.45)}"/>
    <circle cx="${CX}" cy="${y + 16}" r="10" fill="${shade(color, -0.5)}"/>`;
  return out;
};

/** Game controller silhouette. */
const controller = (color) => {
  const w = 236, h = 148, x = CX - w / 2, y = CY - h / 2 + 8;
  let out = contactShadow(120, 24);
  out += solid(roundRectPath(x, y, w, h, 64), { color, depth: 26 });
  const k = shade(color, -0.5);
  out += `<g fill="${k}" opacity="0.9">
    <rect x="${x + 40}" y="${y + 58}" width="52" height="14" rx="7"/>
    <rect x="${x + 59}" y="${y + 39}" width="14" height="52" rx="7"/>
    <circle cx="${x + w - 62}" cy="${y + 54}" r="12"/>
    <circle cx="${x + w - 34}" cy="${y + 78}" r="12"/>
    <circle cx="${x + w - 90}" cy="${y + 78}" r="12"/>
    <circle cx="${x + w - 62}" cy="${y + 102}" r="12"/>
  </g>`;
  return out;
};

/** Pokéball-style two-tone sphere. */
const ball = (top, bottom) => {
  const R = 118;
  const g = nid('bg'), c = nid('bc'), s = nid('bs');
  return `${contactShadow(104, 22)}
  <defs>
    <clipPath id="${c}"><circle cx="${CX}" cy="${CY}" r="${R}"/></clipPath>
    <radialGradient id="${g}" cx="0.34" cy="0.28" r="0.85">
      <stop offset="0" stop-color="#fff" stop-opacity="0.45"/>
      <stop offset="0.6" stop-color="#fff" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.35"/>
    </radialGradient>
    <radialGradient id="${s}" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#fff" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <g clip-path="url(#${c})">
    <rect x="${CX - R}" y="${CY - R}" width="${R * 2}" height="${R}" fill="${top}"/>
    <rect x="${CX - R}" y="${CY}" width="${R * 2}" height="${R}" fill="${bottom}"/>
    <rect x="${CX - R}" y="${CY - 13}" width="${R * 2}" height="26" fill="#161b26"/>
    <circle cx="${CX}" cy="${CY}" r="42" fill="#161b26"/>
    <circle cx="${CX}" cy="${CY}" r="30" fill="#f4f6fb"/>
    <circle cx="${CX}" cy="${CY}" r="18" fill="#d8dde8"/>
    <circle cx="${CX}" cy="${CY}" r="${R}" fill="url(#${g})"/>
  </g>
  <ellipse cx="${CX - 40}" cy="${CY - 52}" rx="46" ry="30" fill="url(#${s})" transform="rotate(-28 ${CX - 40} ${CY - 52})"/>`;
};

/** Stacked cube — blocky sandbox worlds. */
const cube = (top, side, front) => {
  const w = 118, hh = 62;
  const t = polyPath([[CX, CY - 118], [CX + w, CY - 118 + hh], [CX, CY - 118 + hh * 2], [CX - w, CY - 118 + hh]]);
  const l = polyPath([[CX - w, CY - 118 + hh], [CX, CY - 118 + hh * 2], [CX, CY + 112], [CX - w, CY + 112 - hh]]);
  const r = polyPath([[CX + w, CY - 118 + hh], [CX, CY - 118 + hh * 2], [CX, CY + 112], [CX + w, CY + 112 - hh]]);
  return `${contactShadow(116, 24)}
    <path d="${l}" fill="${side}"/>
    <path d="${r}" fill="${front}"/>
    <path d="${t}" fill="${top}"/>
    <path d="${t}" fill="#fff" opacity="0.12"/>`;
};

/* ── glyphs drawn on top of coins/tiles ──────────────────────────────────── */
const glyphV = (color = '#fff') =>
  `<path d="${polyPath([[CX - 56, CY - 56], [CX - 20, CY - 56], [CX, CY + 18], [CX + 20, CY - 56], [CX + 56, CY - 56], [CX + 14, CY + 58], [CX - 14, CY + 58]])}"
    fill="${color}" opacity="0.95"/>`;
const glyphPlay = (color = '#fff') =>
  `<path d="${polyPath([[CX - 34, CY - 52], [CX + 52, CY], [CX - 34, CY + 52]])}" fill="${color}" opacity="0.95"/>`;
const glyphBoltSmall = (color = '#fff') =>
  `<path d="${polyPath([[CX + 12, CY - 62], [CX - 40, CY + 8], [CX - 4, CY + 8], [CX - 14, CY + 64], [CX + 42, CY - 10], [CX + 2, CY - 10]])}"
    fill="${color}" opacity="0.95"/>`;
const glyphBars = (color = '#fff') => `<g fill="${color}" opacity="0.92">
    <rect x="${CX - 52}" y="${CY - 8}" width="26" height="58" rx="13"/>
    <rect x="${CX - 13}" y="${CY - 46}" width="26" height="96" rx="13"/>
    <rect x="${CX + 26}" y="${CY - 24}" width="26" height="74" rx="13"/>
  </g>`;
const glyphCircleWave = (color = '#fff') => `<g fill="none" stroke="${color}" stroke-width="13" stroke-linecap="round" opacity="0.95">
    <path d="M${CX - 48} ${CY - 22}q48 -22 96 0"/>
    <path d="M${CX - 38} ${CY + 6}q38 -18 76 0"/>
    <path d="M${CX - 27} ${CY + 34}q27 -13 54 0"/>
  </g>`;
const glyphSteam = (color = '#fff') => `<g opacity="0.95">
    <circle cx="${CX + 6}" cy="${CY - 26}" r="40" fill="none" stroke="${color}" stroke-width="12"/>
    <circle cx="${CX + 6}" cy="${CY - 26}" r="15" fill="${color}"/>
    <circle cx="${CX - 44}" cy="${CY + 44}" r="26" fill="${color}"/>
    <path d="M${CX - 30} ${CY + 30}L${CX + 6} ${CY - 26}" stroke="${color}" stroke-width="10" stroke-linecap="round"/>
  </g>`;
const glyphCart = (color = '#fff') => `<g fill="none" stroke="${color}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" opacity="0.95">
    <path d="M${CX - 56} ${CY - 44}h22l16 74h58l18 -52h-84"/>
  </g><g fill="${color}" opacity="0.95">
    <circle cx="${CX - 4}" cy="${CY + 52}" r="12"/><circle cx="${CX + 42}" cy="${CY + 52}" r="12"/></g>`;
const glyphN = (color = '#fff') => `<path d="${polyPath([
  [CX - 46, CY - 58], [CX - 8, CY - 58], [CX + 12, CY + 4], [CX + 12, CY - 58],
  [CX + 46, CY - 58], [CX + 46, CY + 58], [CX + 8, CY + 58], [CX - 12, CY - 2], [CX - 12, CY + 58], [CX - 46, CY + 58],
])}" fill="${color}" opacity="0.95"/>`;
const glyphCrown = (color = '#fff') => `<path d="${polyPath([
  [CX - 62, CY + 40], [CX - 74, CY - 46], [CX - 30, CY - 8], [CX, CY - 58], [CX + 30, CY - 8],
  [CX + 74, CY - 46], [CX + 62, CY + 40],
])}" fill="${color}" opacity="0.95"/>`;
const glyphTarget = (color = '#fff') => `<g fill="none" stroke="${color}" stroke-width="12" opacity="0.95">
    <circle cx="${CX}" cy="${CY}" r="52"/><circle cx="${CX}" cy="${CY}" r="22"/>
    <path d="M${CX} ${CY - 74}v26M${CX} ${CY + 48}v26M${CX - 74} ${CY}h26M${CX + 48} ${CY}h26" stroke-linecap="round"/>
  </g>`;
const glyphNote = (color = '#fff') => `<g fill="${color}" opacity="0.95">
    <rect x="${CX + 8}" y="${CY - 62}" width="16" height="94" rx="8"/>
    <path d="M${CX + 8} ${CY - 62}q46 -11 58 -21v34q-12 10 -58 21Z"/>
    <ellipse cx="${CX - 12}" cy="${CY + 32}" rx="30" ry="24"/>
  </g>`;
const glyphA = (color = '#fff') => `<path d="${polyPath([
  [CX - 58, CY + 58], [CX - 14, CY - 58], [CX + 14, CY - 58], [CX + 58, CY + 58], [CX + 22, CY + 58],
  [CX, CY - 4], [CX - 22, CY + 58],
])}" fill="${color}" opacity="0.95"/>`;


/**
 * Voucher: a card with a notch bitten out of each long edge — the shape a
 * top-up code arrives on. Nothing else in the set reads as "a code on a slip".
 */
const voucher = (color, accent) => {
  const w = 268, h = 172, x = CX - w / 2, y = CY - h / 2;
  const nx = x + w * 0.63;
  // A real mask, not two circles painted in the page colour: these icons sit on
  // tinted product tiles, where painted "holes" would read as light grey dots.
  const m = nid('vm');
  let out = contactShadow(132, 24);
  out += `<mask id="${m}" maskUnits="userSpaceOnUse" x="0" y="0" width="${S}" height="${S}">
      <rect x="0" y="0" width="${S}" height="${S}" fill="#fff"/>
      <circle cx="${round(nx)}" cy="${round(y)}" r="22" fill="#000"/>
      <circle cx="${round(nx)}" cy="${round(y + h)}" r="22" fill="#000"/>
    </mask>
    <g mask="url(#${m})">${solid(roundRectPath(x, y, w, h, 24), { color, depth: 24 })}</g>`;
  out += `<rect x="${round(x + 26)}" y="${round(y + 42)}" width="${round(w * 0.30)}" height="14" rx="7" fill="${accent}" opacity=".92"/>
          <rect x="${round(x + 26)}" y="${round(y + 74)}" width="${round(w * 0.20)}" height="10" rx="5" fill="${accent}" opacity=".6"/>`;
  out += `<g>${[0, 1, 2, 3, 4, 5].map((i) =>
    `<rect x="${round(nx + 18 + i * 13)}" y="${round(y + 40)}" width="${i % 2 ? 5 : 8}" height="${round(h - 80)}" rx="2" fill="${accent}" opacity=".8"/>`).join('')}</g>`;
  return out;
};

/** Rocket — speed and boosts: battle passes, level-ups, anything "get ahead". */
const rocket = (color, accent) => {
  const bodyD = `M${CX} ${CY - 122}c48 42 68 96 68 146l-26 30h-84l-26-30c0-50 20-104 68-146Z`;
  const finL = `M${CX - 68} ${CY + 30}l-48 42 10 46 46-36Z`;
  const finR = `M${CX + 68} ${CY + 30}l48 42-10 46-46-36Z`;
  let out = contactShadow(120, 24);
  out += solid(finL, { color: shade(accent, -0.1), depth: 16, gloss: false });
  out += solid(finR, { color: shade(accent, -0.1), depth: 16, gloss: false });
  out += solid(bodyD, { color, depth: 26 });
  out += `<circle cx="${CX}" cy="${CY - 40}" r="30" fill="${shade(color, -0.42)}" opacity=".9"/>
          <circle cx="${CX}" cy="${CY - 40}" r="21" fill="${shade(accent, 0.4)}"/>`;
  return out;
};

/** Crate — banded like a shipping crate: bundles, packs and multi-buys. */
const crate = (color, band) => {
  const w = 250, h = 206, x = CX - w / 2, y = CY - h / 2 + 4;
  let out = contactShadow(130, 24);
  out += solid(roundRectPath(x, y, w, h, 18), { color, depth: 28 });
  out += `<rect x="${round(x)}" y="${round(y + h * 0.44)}" width="${w}" height="24" fill="${band}" opacity=".92"/>
          <rect x="${round(CX - 12)}" y="${round(y)}" width="24" height="${h}" fill="${band}" opacity=".92"/>
          <rect x="${round(CX - 30)}" y="${round(y + h * 0.42)}" width="60" height="32" rx="8" fill="${shade(band, -0.32)}"/>`;
  return out;
};

/** Heart — favourites, and "support the creator" style top-ups. */
const heart = (color) => {
  const d = `M${CX} ${CY + 96}c-98-66-130-106-130-152a63 63 0 0 1 130-31 63 63 0 0 1 130 31c0 46-32 86-130 152Z`;
  return contactShadow(122, 24) + solid(d, { color, depth: 26 });
};

/* ── the catalogue ───────────────────────────────────────────────────────── */
const ICONS = {
  // game currency — coins & gems
  robux:        () => hexCoin('#2fbe71'),
  'v-bucks':    () => roundCoin('#3fa9f5', glyphV('#eaf6ff')),
  cod:          () => roundCoin('#f0862a', glyphTarget('#fff5e8')),
  brawl:        () => gemIcon('#f0b429'),
  apex:         () => gemIcon('#e0384a'),
  valorant:     () => chevron('#ff4655'),
  genshin:      () => gemIcon('#49c4d9'),
  clash:        () => gemIcon('#8b5cf6'),
  clashroyale:  () => roundCoin('#4f7fe0', glyphCrown('#eef4ff')),
  league:       () => roundCoin('#d4a72c', glyphCrown('#fff8e6')),
  freefire:     () => gemIcon('#f97316'),
  pubg:         () => roundCoin('#eab308', glyphTarget('#fffbea')),
  mlbb:         () => gemIcon('#3b82f6'),
  eafc:         () => sphere('#f2f5fa', detailPanels('#1d2b3a')),
  wildrift:     () => gemIcon('#c9a227'),
  wow:          () => gemIcon('#3f7fbf'),
  gta:          () => banknote('#4f9c6b', '#f4e9c8'),
  minecraft:    () => cube('#6fbf4a', '#7a5a3a', '#96703f'),
  pokemongo:    () => ball('#e8404a', '#f2f4f8'),

  // platforms & stores
  steam:        () => tile('#2a3b52', glyphSteam('#e8eef7')),
  playstation:  () => bag('#1f6fd0'),
  xbox:         () => sphere('#22a447', detailCross('#f2fff5')),
  nintendo:     () => controller('#e0353f'),
  amazon:       () => tile('#f0932b', glyphCart('#fff6e9')),
  googleplay:   () => tile('#3aa76d', glyphPlay('#f2fff8')),
  itunes:       () => tile('#d94c9c', glyphNote('#ffe9f5')),
  spotify:      () => tile('#22b258', glyphCircleWave('#f0fff6')),
  netflix:      () => tile('#d6202c', glyphN('#fff0f0')),
  gamepass:     () => tile('#2f9e4f', glyphBars('#f0fff5')),
  'discord-nitro': () => tile('#5865F2', glyphBoltSmall('#f2f4ff')),

  // more game currency — categories a NL top-up shop grows into. Each is an
  // ORIGINAL stylised object from the primitives above: the colour and the shape
  // evoke the genre, never a company's mark. A green cube reads as a blocky
  // sandbox game; it is not anybody's logo.
  rocketleague: () => rocket('#2f7fd6', '#f0a92a'),
  fallguys:     () => ball('#f25ca2', '#ffd166'),
  amongus:      () => bag('#d8433e'),
  standoff:     () => roundCoin('#e0a53c', glyphTarget('#fff6e0')),
  marvelrivals: () => gemIcon('#e04a4a'),
  honkai:       () => gemIcon('#c9a6ff'),
  zenless:      () => gemIcon('#f0d24a'),
  deltaforce:   () => roundCoin('#6f8f4a', glyphTarget('#f2ffe8')),
  bloodstrike:  () => roundCoin('#c94a4a', glyphTarget('#fff0f0')),
  rust:         () => cube('#b3673a', '#7a4a2a', '#96593a'),
  albion:       () => roundCoin('#d4a72c', glyphCrown('#fff8e6')),
  dota:         () => gemIcon('#c94a3a'),
  csgo:         () => roundCoin('#e08a2a', glyphTarget('#fff5e8')),
  tiktok:       () => roundCoin('#22c9c9', glyphNote('#f0ffff')),
  telegram:     () => tile('#2f9ed6', glyphBoltSmall('#f0faff')),
  crunchyroll:  () => tile('#f08322', glyphPlay('#fff6e9')),
  youtube:      () => tile('#d6202c', glyphPlay('#fff0f0')),
  twitch:       () => tile('#7f4fd6', glyphBars('#f5f0ff')),
  disneyplus:   () => tile('#2f4fa7', glyphN('#f0f4ff')),
  paysafecard:  () => voucher('#3a8f6f', '#f2fff8'),
  epicgames:    () => tile('#3a3f4a', glyphBoltSmall('#eef1f7')),
  battlenet:    () => sphere('#3f7fbf', detailCross('#f0f8ff')),
  ubisoft:      () => sphere('#2f9ed6', detailPanels('#f0faff')),
  eaplay:       () => tile('#e0453f', glyphBars('#fff0f0')),
  psplus:       () => voucher('#1f6fd0', '#eaf3ff'),
  battlepass:   () => rocket('#8b5cf6', '#f5c451'),

  // generic
  giftcard:     () => giftCard('#8b5cf6', '#f5c451'),
  chest:        () => chest('#b3742f', '#e0a63c'),
  coin:         () => roundCoin('#e8b431', glyphA('#fff8e0')),
  gem:          () => gemIcon('#22c9c9'),
  // 'mystery' had no 3D icon at all: mystery boxes fell back to a flat gradient
  // tile with a lucide glyph, the only category in the shop that never got the
  // treatment. It is also the most expensive product on the site.
  mystery:      () => chest('#b3543a', '#f0a92a'),
  bundle:       () => crate('#7c5cff', '#f5c451'),
  voucher:      () => voucher('#8b5cf6', '#f5f0ff'),
  favourite:    () => heart('#e0456f'),
};

/* ── write them out ──────────────────────────────────────────────────────── */
mkdirSync(OUT, { recursive: true });
let n = 0;
for (const [slug, build] of Object.entries(ICONS)) {
  uid = 0; ns = slug.replace(/[^a-z0-9]/g, ''); // deterministic ids, unique per icon
  writeFileSync(join(OUT, `${slug}.svg`), svg(build()));
  n++;
}
console.log(`Wrote ${n} icons → ${OUT}`);
