/**
 * Put an uploaded photo on the ForgeMarket card artboard, in the browser.
 *
 * ── WHY THIS IS CLIENT-SIDE ───────────────────────────────────────────────
 * The compositing has to happen somewhere, and the two obvious places do not
 * work: a native image library is a dependency this project should not grow
 * for one feature, and a headless browser cannot run in a Vercel function. The
 * owner's own browser already has a canvas and already turns their file into a
 * data URI, so it does the work — no service, no terminal, nothing to install.
 *
 * ── WHAT IT PRODUCES ──────────────────────────────────────────────────────
 * A 1400x1200 WebP: exactly 7:6, which is the ratio of the card's media box.
 * Art authored at the ratio of its container needs no letterboxing, so every
 * product fills its tile identically instead of the fourteen different ratios
 * the live catalogue had.
 *
 * The photo itself is fitted into 86% of that board — scaled in BOTH
 * directions, up as well as down. Capping with max-width/max-height was the
 * first attempt and it was wrong: it never enlarges a small picture, so a
 * 232x264 upload stayed 232px inside a 1400px board and came out a fifth of
 * the tile. Nothing is cropped and nothing is stretched.
 *
 * The ground is the same near-black, purple-bloomed board the generated art
 * uses, so a grid mixing the two reads as one shop.
 */

const W = 1400;
const H = 1200;          // 7:6
const INSET = 0.86;

/** Matches ACCENT in scripts/art/design.mjs — one palette, two renderers. */
const ACCENT = {
  robux: '#22c55e', 'v-bucks': '#38bdf8', eafc: '#4ade80', valorant: '#fb7185',
  cod: '#f97316', apex: '#ef4444', clash: '#facc15', clashroyale: '#60a5fa',
  brawl: '#fbbf24', genshin: '#22d3ee', gta: '#f472b6', league: '#38bdf8',
  mlbb: '#818cf8', pubg: '#fb923c', freefire: '#f87171', minecraft: '#84cc16',
  pokemongo: '#facc15', 'discord-nitro': '#818cf8', giftcard: '#c084fc',
  gamepass: '#4ade80', spotify: '#22c55e', mystery: '#a855f7',
};
export const accentFor = (category) => ACCENT[category] || '#a855f7';

const load = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('Could not read that image.'));
  img.src = src;
});

/**
 * @param src       a data: URI or a same-origin URL
 * @param category  decides the accent; anything unknown falls back to purple
 * @returns a WebP data URI, or a JPEG one where WebP is unavailable
 */
export async function toArtboard(src, { category, quality = 0.88 } = {}) {
  const img = await load(src);
  if (!img.naturalWidth || !img.naturalHeight) throw new Error('Could not read that image.');

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process that image.');

  const accent = accentFor(category);

  // ── The ground, painted bottom-up in the same order as the SVG system ────
  const base = ctx.createLinearGradient(0, 0, W, H);
  base.addColorStop(0, '#07060f');
  base.addColorStop(0.55, '#0e0b1e');
  base.addColorStop(1, '#07060f');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  const bloom = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, W * 0.7);
  bloom.addColorStop(0, 'rgba(168,85,247,0.26)');
  bloom.addColorStop(0.45, 'rgba(99,102,241,0.12)');
  bloom.addColorStop(1, 'rgba(99,102,241,0)');
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, W, H);

  const cat = ctx.createRadialGradient(W / 2, H * 0.34, 0, W / 2, H * 0.34, W * 0.62);
  cat.addColorStop(0, `${accent}2e`);
  cat.addColorStop(1, `${accent}00`);
  ctx.fillStyle = cat;
  ctx.fillRect(0, 0, W, H);

  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, W * 0.72);
  vig.addColorStop(0, 'rgba(4,3,12,0)');
  vig.addColorStop(1, 'rgba(4,3,12,0.62)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // ── The photo, fitted into the inset box in both directions ─────────────
  const boxW = W * INSET, boxH = H * INSET;
  const scale = Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight);
  const dw = Math.round(img.naturalWidth * scale);
  const dh = Math.round(img.naturalHeight * scale);
  const dx = Math.round((W - dw) / 2);
  const dy = Math.round((H - dh) / 2);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 46;
  ctx.shadowOffsetY = 26;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();

  // The brand hairline along the bottom, as on every generated artboard.
  const bar = ctx.createLinearGradient(0, 0, W, 0);
  bar.addColorStop(0, '#6366f1');
  bar.addColorStop(0.5, '#a855f7');
  bar.addColorStop(1, accent);
  ctx.fillStyle = bar;
  ctx.fillRect(0, H - 9, W, 9);

  /* WebP where it exists — every current browser — and JPEG as the fallback,
     checked by asking rather than by sniffing the user agent. */
  const webp = canvas.toDataURL('image/webp', quality);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', quality);
}

/** Is this something we put on an artboard, or something we leave alone? */
export const isOwnerUpload = (src) => {
  const s = String(src || '');
  return !!s && (s.startsWith('data:') || s.startsWith('/api/images/'));
};
