#!/usr/bin/env node
/**
 * Burnt-in captions, rendered in the shop's own type.
 *
 * Most of these are watched with the sound off, so a caption is not a courtesy —
 * it is the copy. They are drawn in a browser for the same reason the cards are:
 * ffmpeg's drawtext needs a TTF and this shop's faces are woff2, so anything
 * drawn by ffmpeg would be set in a font that belongs to nobody.
 *
 * Called by compose.mjs, which knows the timings. Runnable on its own for a
 * quick look at what a variant will say:
 *
 *   node scripts/ad/captions.mjs --out=/tmp/caps \
 *     --lines='[{"text":"€9.99","style":"big"}]'
 *
 * Styles:
 *   hook   the first two seconds — the biggest thing on screen
 *   big    a number or a claim
 *   small  a supporting line
 *   quote  a customer's own words
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};

const W = 1080; const H = 1920;

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* Positions keep out of the platforms' own furniture: TikTok's right rail and
   caption area eat the bottom ~420px and the right ~180px, Reels a little less.
   Everything sits inside that, and the hook sits high where nothing overlaps. */
const STYLES = {
  hook: `
    .wrap{align-items:flex-start;padding:300px 90px 0}
    .t{font-family:'Bricolage Grotesque','Inter',sans-serif;font-weight:800;font-size:96px;
       line-height:1.04;letter-spacing:-.02em;color:#fff;text-align:left;
       text-shadow:0 8px 40px rgba(0,0,0,.75),0 2px 10px rgba(0,0,0,.6)}`,
  big: `
    .wrap{align-items:flex-end;padding:0 80px 470px}
    .t{font-family:'Bricolage Grotesque','Inter',sans-serif;font-weight:800;font-size:82px;
       line-height:1.08;letter-spacing:-.02em;color:#fff;text-align:center;
       text-shadow:0 6px 34px rgba(0,0,0,.75),0 2px 8px rgba(0,0,0,.6)}`,
  small: `
    .wrap{align-items:flex-end;padding:0 80px 430px}
    .t{font-family:'Inter',system-ui,sans-serif;font-weight:700;font-size:46px;line-height:1.25;
       color:#fff;text-align:center;
       text-shadow:0 4px 24px rgba(0,0,0,.8),0 1px 6px rgba(0,0,0,.7)}`,
  quote: `
    .wrap{align-items:flex-end;padding:0 80px 450px}
    .t{font-family:'Inter',system-ui,sans-serif;font-weight:600;font-size:52px;line-height:1.3;
       color:#fff;text-align:center;font-style:italic;
       text-shadow:0 4px 26px rgba(0,0,0,.8)}`,
  /* The email arrival card. Pinned to the TOP of the frame with nothing above
     it, because compose.mjs slides this one down into place from off-frame
     instead of fading it — the arrival is the effect, and a notification that
     dissolves into view is not one anybody recognises. Everything below the
     card is transparent, so the slide reveals the recording underneath. */
  notify: `
    .wrap{align-items:flex-start;padding:150px 54px 0}
    .t{font-family:'Inter',system-ui,sans-serif;font-weight:700;font-size:44px;line-height:1.2;
       color:#fff;text-align:left;width:100%;
       display:flex;align-items:center;gap:26px;
       padding:30px 36px;border-radius:34px;
       background:linear-gradient(180deg,rgba(18,16,34,.96),rgba(12,10,26,.94));
       box-shadow:0 26px 70px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.10) inset,
                  0 0 0 3px rgba(124,92,255,.35)}
    .t .ic{flex:0 0 auto;width:74px;height:74px;border-radius:22px;display:grid;place-items:center;
       background:linear-gradient(135deg,#7c5cff,#a855f7);font-size:40px}
    .t .tx{min-width:0}
    .t .sub{display:block;font-size:30px;font-weight:600;color:#a9a3c9;padding-top:4px}`,
};

/* A slab behind the words. Screen recordings are mostly light UI, and white
   type on a white product page is unreadable however heavy the shadow. */
const SLAB = `
  .t{display:inline-block;padding:22px 34px;border-radius:26px;
     background:linear-gradient(180deg,rgba(9,9,18,.82),rgba(9,9,18,.72));
     box-shadow:0 20px 60px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.08) inset;
     backdrop-filter:blur(2px)}`;

export async function renderCaptions({ lines, out, base, chrome }) {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: chrome });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const written = [];

  for (const [i, line] of lines.entries()) {
    const style = STYLES[line.style] || STYLES.small;
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      @font-face{font-family:'Bricolage Grotesque';src:url('${base}/fonts/bricolage-800.woff2') format('woff2');font-weight:800;font-display:block}
      @font-face{font-family:'Inter';src:url('${base}/fonts/inter-700.woff2') format('woff2');font-weight:700;font-display:block}
      @font-face{font-family:'Inter';src:url('${base}/fonts/inter-600.woff2') format('woff2');font-weight:600;font-display:block}
      *{margin:0;padding:0;box-sizing:border-box}
      html,body{width:${W}px;height:${H}px;background:transparent;overflow:hidden}
      .wrap{height:100%;display:flex;justify-content:center}
      ${style}${SLAB}
    </style></head><body><div class="wrap"><div class="t">${
      line.style === 'notify'
        ? `<span class="ic">\u2709</span><span class="tx">${esc(line.text)}`
          + (line.sub ? `<span class="sub">${esc(line.sub)}</span>` : '') + '</span>'
        : esc(line.text)
    }</div></div></body></html>`;

    /* Same-origin so the webfonts load — see cards.mjs; a caption in the
       fallback face is the most visible place for the brand to slip. */
    await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await p.evaluate((h) => { document.open(); document.write(h); document.close(); }, html);
    await p.evaluate(async () => {
      await Promise.all([
        document.fonts.load('800 96px "Bricolage Grotesque"'),
        document.fonts.load('700 46px "Inter"'),
        document.fonts.load('600 52px "Inter"'),
      ]).catch(() => {});
      await document.fonts.ready;
    }).catch(() => {});
    await p.waitForTimeout(180);

    const file = path.join(out, `cap-${String(i).padStart(2, '0')}.png`);
    await p.screenshot({ path: file, omitBackground: true });
    written.push({ ...line, file });
  }

  await browser.close();
  return written;
}

// Runnable on its own for a look at the copy.
if (import.meta.url === `file://${process.argv[1]}`) {
  const lines = JSON.parse(arg('lines') || '[]');
  if (!lines.length) { console.error('Pass --lines=\'[{"text":"…","style":"big"}]\''); process.exit(1); }
  const written = await renderCaptions({
    lines,
    out: path.resolve(arg('out') || '/tmp/captions'),
    base: (arg('base') || 'http://localhost:5000').replace(/\/+$/, ''),
    chrome: arg('chrome') || process.env.AD_CHROME
      || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  for (const w of written) console.log(`  ${w.file}  "${w.text}"`);
}
