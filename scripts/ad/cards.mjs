#!/usr/bin/env node
/**
 * The overlays, rendered in a browser rather than drawn by ffmpeg.
 *
 * ffmpeg's drawtext needs a TTF, and this shop's fonts are woff2 — so the end
 * card would have been set in DejaVu Sans, which is nobody's brand. Rendering
 * the cards in the same browser that recorded the footage means they use the
 * real fonts, the real gradient and the real logo, and a change to the site's
 * look shows up in the next advert without anyone re-drawing anything.
 *
 *   node scripts/ad/cards.mjs --out=scripts/ad/out/robux-1000 \
 *     --name="1,000 Robux" --price="€9.99"
 *
 * Writes transparent PNGs at 1080x1920 that compose.mjs lays over the footage:
 *   price.png    the price badge that punches in when the product page opens
 *   endcard.png  the last beat: mark, line, call to action
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};

const OUT = path.resolve(arg('out') || path.join('scripts', 'ad', 'out', 'cards'));
const NAME = arg('name', 'Game top-ups');
const PRICE = arg('price', '');
const CTA = arg('cta', 'forgemarket.nl');
const TAGLINE = arg('tagline', 'Game top-ups & gift cards');
const BASE = (arg('base') || 'http://localhost:5000').replace(/\/+$/, '');
const CHROME = arg('chrome') || process.env.AD_CHROME
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

fs.mkdirSync(OUT, { recursive: true });

/* The site's own faces, pulled from the site itself. If it is unreachable the
   cards still render — the stack falls through to a system sans, which is worse
   looking but never a broken build. */
const FONTS = `
  @font-face{font-family:'Bricolage Grotesque';src:url('${BASE}/fonts/bricolage-800.woff2') format('woff2');font-weight:800;font-display:block}
  @font-face{font-family:'Inter';src:url('${BASE}/fonts/inter-700.woff2') format('woff2');font-weight:700;font-display:block}
  @font-face{font-family:'Inter';src:url('${BASE}/fonts/inter-600.woff2') format('woff2');font-weight:600;font-display:block}
`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const page = (body, extraCss = '') => `<!doctype html><html><head><meta charset="utf-8"><style>
  ${FONTS}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1080px;height:1920px;background:transparent;overflow:hidden}
  body{font-family:'Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  ${extraCss}
</style></head><body>${body}</body></html>`;

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({
  viewport: { width: 1080, height: 1920 },
  deviceScaleFactor: 1,
});
const p = await ctx.newPage();

/** Render one HTML page to a transparent PNG. */
async function shoot(html, file) {
  /* setContent gives the page an about:blank origin, from which a font on
     another origin is a cross-origin request the card silently loses — it
     rendered in the fallback sans, which is exactly the thing that makes an
     advert look like somebody else's. Navigating to the site first means the
     fonts are same-origin, and then the markup is written into that document. */
  await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.evaluate((h) => { document.open(); document.write(h); document.close(); }, html);
  await p.evaluate(async () => {
    // Ask for each face by name so the browser actually fetches it before the
    // screenshot, rather than lazily on first paint of a glyph.
    await Promise.all([
      document.fonts.load('800 118px "Bricolage Grotesque"'),
      document.fonts.load('700 44px "Inter"'),
      document.fonts.load('600 40px "Inter"'),
    ]).catch(() => {});
    await document.fonts.ready;
  }).catch(() => {});
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(OUT, file), omitBackground: true });
  console.log(`  ${file}`);
}

console.log(`\n🎴 ${OUT}`);

// ── The price badge ─────────────────────────────────────────────────────────
// Sits low enough to clear a phone's UI and high enough to clear a caption.
if (PRICE) {
  await shoot(page(`
    <div class="wrap">
      <div class="badge">
        <div class="label">${esc(NAME)}</div>
        <div class="price">${esc(PRICE)}</div>
      </div>
    </div>`, `
    .wrap{height:100%;display:flex;align-items:flex-end;justify-content:center;padding-bottom:430px}
    .badge{position:relative;padding:26px 54px 30px;border-radius:34px;
      background:linear-gradient(135deg,rgba(124,92,255,.96),rgba(168,85,247,.96));
      box-shadow:0 26px 70px rgba(124,92,255,.5),0 0 0 3px rgba(255,255,255,.14) inset;
      text-align:center}
    .label{font-size:30px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;
      color:rgba(255,255,255,.82);margin-bottom:6px}
    .price{font-family:'Bricolage Grotesque','Inter',sans-serif;font-weight:800;
      font-size:104px;line-height:1;color:#fff;letter-spacing:-.02em;
      text-shadow:0 6px 30px rgba(0,0,0,.35)}
  `), 'price.png');
}

/* ── The corner tag ─────────────────────────────────────────────────────────
 *
 * The address, small, bottom-left, from the second scene until the end card.
 *
 * The advert this pipeline was measured against shows its call to action at
 * 15.0s of 20.7 — seventy-three per cent in — so everyone who left earlier
 * watched twenty seconds of a shop whose name they could not then type. This
 * costs a corner and means the address has been readable since the third
 * second, however early the viewer goes.
 *
 * Deliberately quiet: it sits under the captions in the visual hierarchy,
 * because the moment it competes with the hook it becomes the splash screen
 * this whole approach exists to avoid.
 */
await shoot(page(`
  <div class="wrap"><div class="tag"><span class="dot"></span>${esc(CTA)}</div></div>`, `
  .wrap{height:100%;display:flex;align-items:flex-end;justify-content:flex-start;padding:0 0 210px 46px}
  .tag{display:flex;align-items:center;gap:14px;padding:16px 30px 17px;border-radius:999px;
    font-family:'Bricolage Grotesque','Inter',sans-serif;font-weight:700;font-size:34px;
    color:rgba(255,255,255,.94);background:rgba(10,10,22,.58);
    box-shadow:0 0 0 1.5px rgba(255,255,255,.16) inset,0 10px 34px rgba(0,0,0,.34);
    backdrop-filter:blur(8px)}
  .dot{width:16px;height:16px;border-radius:999px;background:linear-gradient(135deg,#7c5cff,#d946ef);
    box-shadow:0 0 16px rgba(168,85,247,.9)}
`), 'cta-tag.png');

// ── The end card ────────────────────────────────────────────────────────────
// One mark, one line, one address. An advert that ends on three competing
// messages ends on none of them.
await shoot(page(`
  <div class="wrap">
    <div class="mark">⚡</div>
    <div class="brand">ForgeMarket</div>
    <div class="tag">${esc(TAGLINE)}</div>
    <div class="cta">${esc(CTA)}</div>
  </div>`, `
  .wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;
    background:radial-gradient(120% 80% at 50% 40%,rgba(124,92,255,.30),rgba(7,7,16,.97) 62%),#070710;gap:0}
  .mark{width:200px;height:200px;border-radius:56px;display:flex;align-items:center;justify-content:center;
    font-size:104px;background:linear-gradient(135deg,#7c5cff,#a855f7);
    box-shadow:0 30px 90px rgba(124,92,255,.55);margin-bottom:56px}
  .brand{font-family:'Bricolage Grotesque','Inter',sans-serif;font-weight:800;font-size:118px;
    color:#fff;letter-spacing:-.03em;line-height:1}
  .tag{margin-top:26px;font-size:40px;font-weight:600;color:#b9bfcd}
  .cta{margin-top:74px;padding:26px 62px;border-radius:999px;font-size:44px;font-weight:700;color:#fff;
    background:linear-gradient(135deg,#7c5cff,#a855f7);box-shadow:0 20px 60px rgba(124,92,255,.5)}
`), 'endcard.png');

await browser.close();
console.log('');
