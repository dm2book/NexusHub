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
import { gatherEvidence, validateText } from './claims.mjs';

const arg = (k, d = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};

const OUT = path.resolve(arg('out') || path.join('scripts', 'ad', 'out', 'cards'));

/* ── The claim gate ─────────────────────────────────────────────────────────
 * The end card and the corner tag are the most-seen text this toolkit
 * produces, and they were the least checked: they arrive on the command line
 * as `--tagline=` and `--cta=` and go straight onto a PNG. Nothing between
 * a typed "Instant delivery, 24/7 support" and a burnt-in frame.
 *
 * Card copy is AUTHORED rather than generated, so an unproven claim is not
 * quietly dropped here — the run stops and says which words and what would
 * have proved them. Somebody typed it; somebody can fix it. */
const said = (label, text, { required = false } = {}) => {
  const r = validateText(text, gatherEvidence({ lang: arg('lang', 'en') }));
  if (!r.changed) return text;
  console.error(`\n✖ ${label}: ${r.findings.filter((f) => !f.proven)
    .map((f) => `${f.label} — ${f.proof}`).join('; ')}`);
  if (r.dropped || required) {
    console.error(`   "${text}"\n   Nothing this shop can show proves it. Change the copy.\n`);
    process.exit(1);
  }
  console.error(`   "${text}" → "${r.text}"\n`);
  return r.text;
};
const NAME = said('--name', arg('name', 'Game top-ups'));
const PRICE = arg('price', '');
const CTA = said('--cta', arg('cta', 'forgemarket.nl'), { required: true });
const TAGLINE = said('--tagline', arg('tagline', 'Game top-ups & gift cards'));
const BASE = (arg('base') || 'http://localhost:5000').replace(/\/+$/, '');
/* The product's OWN artwork, off the shop that is being filmed.
   Every product row carries one and the storefront draws it on the product
   page, so this is the same picture the buyer sees — not a stock image and not
   something drawn for an advert. Absent means absent: a product with no art
   gets no hero rather than a placeholder standing in for one. */
const IMAGE = arg('image', '');
const ART = IMAGE ? (/^https?:/.test(IMAGE) ? IMAGE : `${BASE}${IMAGE.startsWith('/') ? '' : '/'}${IMAGE}`) : '';
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

/* --default-background-color=00000000 is what actually makes
   `omitBackground: true` produce a transparent PNG. Without it this Chromium
   writes an OPAQUE image: the overlay then covers the footage instead of
   sitting on it, and the whole advert renders as black rectangles with the
   captions floating on them. It fails silently — the screenshot is written,
   ffmpeg overlays it happily, and the only way to notice is to watch the
   result. */
const browser = await chromium.launch({ executablePath: CHROME,
  args: ['--default-background-color=00000000'] });
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
  await p.evaluate((h) => {
    document.open(); document.write(h); document.close();
      /* The root keeps the navigated site's background through document.write:
         computed style says rgb(7,7,16), not transparent. `omitBackground` then
         has nothing to omit, Chromium writes an OPAQUE RGB png, and the overlay
         covers the footage instead of sitting on it — the whole advert renders
         as black rectangles with the captions floating on them. It fails
         silently: the screenshot is written, ffmpeg overlays it happily, and
         the only way to notice is to watch the result. */
      document.documentElement.style.setProperty('background', 'transparent', 'important');
      document.body.style.setProperty('background', 'transparent', 'important');
  }, html);
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
    .wrap{height:100%;display:flex;align-items:flex-end;justify-content:center;padding-bottom:640px}
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
  /* Top-left, clear of everything.
     At the bottom it was hidden by TikTok's own caption and buttons; lifted to
     470px it merely joined the queue of captions stacked in the lower third and
     read as clutter. The top-left corner is empty in all three formats, the eye
     passes it on the way to the hook, and it never competes with a line of
     copy. */
  .wrap{height:100%;display:flex;align-items:flex-start;justify-content:flex-start;padding:150px 0 0 46px}
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


/* ── The product, front and centre ───────────────────────────────────────────
 *
 * Every cut in this toolkit opened on a SCREEN RECORDING of a product page: a
 * browser, a header, a breadcrumb, a cookie bar, and somewhere inside all of
 * that, small, the thing being sold. In a feed that is a second spent working
 * out what you are looking at, and the second is the whole budget.
 *
 * These two put the product itself on screen at the size it deserves, using the
 * shop's own artwork and the shop's own name and price. Nothing here is drawn
 * for the advert: `--image=` is the path off the product row, and the cards
 * simply stop existing when a product has no art, rather than a placeholder
 * standing in for one.
 *
 * Type sizes are set for a phone at arm's length rather than for this preview:
 * the name is 104px and the price 128px, which is roughly 6mm and 8mm of glass
 * on a 6-inch screen. The measured mistake they correct is the old price badge
 * at 60px, which is legible on a laptop and a smudge on a phone.
 */
const HERO_NAME = 104;
const HERO_PRICE = 128;

if (ART) {
  // The opener. Opaque and full-frame: it IS the first second, not an overlay.
  await shoot(page(`
    <div class="hwrap">
      <div class="hart"><img src="${esc(ART)}" alt=""></div>
      <div class="hname">${esc(NAME)}</div>
      ${PRICE ? `<div class="hprice">${esc(PRICE)}</div>` : ''}
    </div>`, `
    html,body{background:#07060f}
    .hwrap{height:100%;display:flex;flex-direction:column;align-items:center;
      justify-content:center;gap:56px;padding:0 70px;
      background:radial-gradient(120% 70% at 50% 34%,#1b1140 0%,#07060f 72%)}
    .hart{width:940px;border-radius:56px;overflow:hidden;
      box-shadow:0 0 0 3px rgba(168,85,247,.42) inset,0 60px 140px rgba(0,0,0,.7),
        0 0 180px rgba(124,92,255,.32)}
    .hart img{display:block;width:100%;height:auto}
    .hname{font-family:'Bricolage Grotesque','Inter',sans-serif;font-weight:800;
      font-size:${HERO_NAME}px;line-height:1.02;letter-spacing:-.03em;color:#fff;
      text-align:center;text-shadow:0 10px 46px rgba(0,0,0,.7)}
    .hprice{font-family:'Bricolage Grotesque','Inter',sans-serif;font-weight:800;
      font-size:${HERO_PRICE}px;line-height:1;letter-spacing:-.03em;color:#fff;
      padding:26px 62px 32px;border-radius:999px;
      background:linear-gradient(135deg,#7c5cff,#d946ef);
      box-shadow:0 26px 70px rgba(124,92,255,.5)}`), 'hero.png');

  /* The card reveal, over the footage. Transparent, and pinned high so the page
     underneath still reads as a real shop rather than being covered.
     
     Art and NAME only. The price is the next reveal and belongs to the badge —
     carrying it here made three things say €11.99 inside two seconds, and it
     forced the name onto two lines, which pushed the card from 233→1400 in the
     frame. Measured: the hook caption sits at 1160, so the card was printing
     straight across it. It now ends around 990. */
  await shoot(page(`
    <div class="cwrap">
      <div class="ccard">
        <div class="cart"><img src="${esc(ART)}" alt=""></div>
        <div class="ctext"><div class="cname">${esc(NAME)}</div></div>
      </div>
    </div>`, `
    /* 120 from the top and 200 in from each side, not 220/170.
       The catalogue hooks carry a second line, and the tallest of them — a
       two-line headline over a two-line sub — runs y 937 to 1344. Measured with
       rows.mjs, the card at its old size ended at 1076 and printed straight
       through it, which is exactly the collision this same tool caught once
       before. Ending around 790 clears the worst hook by 150px — enough that
       the 40px the card RISES through on its way in does not eat the gap,
       which a 22px clearance would have. */
    .cwrap{height:100%;display:flex;align-items:flex-start;justify-content:center;padding:110px 220px 0}
    .ccard{width:100%;border-radius:44px;overflow:hidden;
      background:linear-gradient(165deg,rgba(12,10,26,.96),rgba(20,16,44,.92));
      box-shadow:0 0 0 2px rgba(168,85,247,.4) inset,0 40px 110px rgba(0,0,0,.6)}
    .cart img{display:block;width:100%;height:auto}
    .ctext{display:flex;align-items:center;justify-content:center;padding:26px 36px 34px}
    .cname{font-family:'Bricolage Grotesque','Inter',sans-serif;font-weight:800;
      font-size:66px;line-height:1.04;letter-spacing:-.03em;color:#fff;text-align:center;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`), 'productcard.png');

  /* The last beat. The code is in the footage underneath; this says what the
     code is FOR, small, in the corner, so the final frame is not an anonymous
     string of characters. */
  await shoot(page(`
    <div class="fwrap">
      <div class="fchip">
        <img src="${esc(ART)}" alt="">
        <div>
          <div class="fname">${esc(NAME)}</div>
          ${PRICE ? `<div class="fprice">${esc(PRICE)}</div>` : ''}
        </div>
      </div>
    </div>`, `
    .fwrap{height:100%;display:flex;align-items:flex-end;justify-content:center;padding:0 60px 470px}
    .fchip{display:flex;align-items:center;gap:30px;padding:22px 40px 22px 22px;border-radius:999px;
      background:linear-gradient(165deg,rgba(12,10,26,.95),rgba(20,16,44,.9));
      box-shadow:0 0 0 2px rgba(168,85,247,.4) inset,0 26px 70px rgba(0,0,0,.55)}
    .fchip img{width:150px;height:auto;border-radius:26px;display:block}
    .fname{font-family:'Bricolage Grotesque','Inter',sans-serif;font-weight:800;
      font-size:60px;line-height:1.05;letter-spacing:-.02em;color:#fff}
    .fprice{font-family:'Inter',system-ui,sans-serif;font-weight:700;font-size:46px;
      line-height:1.1;color:#c9bfff;padding-top:4px}`), 'productchip.png');
}

await browser.close();
console.log('');
