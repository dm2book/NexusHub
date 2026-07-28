/**
 * Brand avatar generator — the square profile picture used on Trustpilot and
 * any other platform that wants one (Instagram, TikTok, Google Business).
 *
 * Writes public/brand/forgemarket-avatar.svg. Set CHROME_PATH to also render
 * the PNGs next to it:
 *
 *   node scripts/gen-avatar.mjs
 *   CHROME_PATH=/path/to/chrome node scripts/gen-avatar.mjs
 *
 * Three constraints drive every choice here:
 *
 *  1. It is the SAME mark as the site, in the same gradient — sampled out of
 *     public/icon-512.png rather than eyeballed. Someone who clicks through
 *     from forgemarket.nl and meets a different logo wonders whether this is
 *     even the right company; matching IS the trust signal.
 *  2. It survives a CIRCLE crop. Trustpilot shows company avatars round next
 *     to reviews, so the mark is sized against the inscribed circle, not the
 *     square.
 *  3. It reads at 40px — the size it actually appears at beside a review.
 *     That rules out a wordmark and rules out fine detail.
 *
 * Full-bleed, no rounded corners: transparent corners would show whatever
 * background the platform puts behind it, and every platform rounds it its own
 * way regardless.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'brand');
const S = 1024;

// Sampled from public/icon-512.png at (70,70), (256,256) and (442,442).
const G0 = '#7661f2', G1 = '#a855f7', G2 = '#d94bb2';

// The site's bolt, in its native 32-unit viewBox (public/favicon.svg).
const BOLT = 'M13 6 L9 18 h5 l-2 8 L23 12 h-6 l2-6 z';

// Sized against the circle, not the square. The bolt's furthest point from
// centre is (12,26) → 10.77 units, so at 0.67 the mark reaches ~72% of the
// 512px inscribed radius: as bold as the app icon (which fills 74% of its
// square) with real margin before any crop can touch it.
const SCALE = (S * 0.67) / 20;

const avatarSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${G0}"/>
      <stop offset="0.52" stop-color="${G1}"/>
      <stop offset="1" stop-color="${G2}"/>
    </linearGradient>
    <!-- One light from the top-left, same direction as the product icons. -->
    <radialGradient id="light" cx="0.26" cy="0.2" r="0.85">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/>
      <stop offset="0.55" stop-color="#ffffff" stop-opacity="0.05"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <!-- Lifts the bolt off the gradient without reading as a visible shadow at
         40px, where a hard shadow just turns into grey mush. -->
    <filter id="lift" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="${Math.round(S * 0.012)}" stdDeviation="${Math.round(S * 0.018)}"
                    flood-color="#2c0f52" flood-opacity="0.28"/>
    </filter>
  </defs>

  <rect width="${S}" height="${S}" fill="url(#bg)"/>
  <rect width="${S}" height="${S}" fill="url(#light)"/>

  <g filter="url(#lift)"
     transform="translate(${S / 2} ${S / 2}) scale(${SCALE}) translate(-16 -16)">
    <path d="${BOLT}" fill="#ffffff"/>
  </g>
</svg>`;

mkdirSync(OUT, { recursive: true });
const svg = avatarSvg();
writeFileSync(join(OUT, 'forgemarket-avatar.svg'), svg);
console.log(`✓ ${join(OUT, 'forgemarket-avatar.svg')}`);

// PNGs are what the platforms actually accept, but rendering them needs a
// browser this repo does not depend on. Opt in by pointing CHROME_PATH at one;
// the committed PNGs were produced exactly this way.
if (process.env.CHROME_PATH) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
  for (const size of [1024, 512, 256]) {
    const ctx = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.setContent(
      `<style>html,body{margin:0;padding:0;overflow:hidden}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    await page.screenshot({ path: join(OUT, `forgemarket-avatar-${size}.png`) });
    await ctx.close();
    console.log(`✓ forgemarket-avatar-${size}.png`);
  }
  await browser.close();
} else {
  console.log('  (set CHROME_PATH to also render the PNGs)');
}
