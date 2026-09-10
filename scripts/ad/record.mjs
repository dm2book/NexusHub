#!/usr/bin/env node
/**
 * Record a REAL purchase on a REAL ForgeMarket, in portrait, with the beats
 * marked as they happen.
 *
 * Nothing here is mocked or re-enacted. The browser walks the live storefront,
 * places an order through the checkout everyone else uses, and waits for the
 * order to actually reach `completed` — which means the code really was claimed
 * from stock and the delivery email really was sent. If the shop cannot deliver,
 * this fails instead of producing an advert for something that did not happen.
 *
 *   node scripts/ad/record.mjs --base=https://forgemarket.nl --sku=ROBUX-1000
 *
 * What it writes into --out (default scripts/ad/out/<slug>):
 *   raw.webm    the screen recording, 1080x1920
 *   beats.json  { label, atMs } for every moment the edit needs to cut on
 *   order.json  the real order this recording is of
 *
 * PAYMENT. `--pay` decides how the money moves, and the honest options are:
 *   mollie-test  a real checkout round trip through Mollie's sandbox (default)
 *   demo         DEMO_PAYMENTS self-pay, dev environments only
 *   manual       stop at the payment step and wait for a human to pay for real
 * Whatever you pick, the FULFILMENT is real: real stock, real code, real email.
 * `demo` and `mollie-test` are test purchases and the toolkit says so in the
 * manifest — never let an advert imply money changed hands when it did not.
 *
 * PRIVACY. The buyer address is a throwaway you pass in, and the delivered code
 * is masked in the edit (see compose.mjs). A working code read off a phone
 * screen is a code somebody else redeems.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const flag = (k) => process.argv.includes(`--${k}`);

const BASE = (arg('base') || process.env.AD_BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');
const SKU = arg('sku');
const PRODUCT_ID = arg('product');
const PAY = arg('pay', 'mollie-test');
const EMAIL = arg('email') || process.env.AD_BUYER_EMAIL || '';
const CHROME = arg('chrome') || process.env.AD_CHROME
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SLOW = Number(arg('slow', '120'));           // ms between actions, for legible footage
const TIMEOUT = Number(arg('timeout', '120')) * 1000;

if (!SKU && !PRODUCT_ID) {
  console.error('Pick a product: --sku=ROBUX-1000 or --product=prd_xxx');
  process.exit(1);
}
if (!EMAIL) {
  console.error('Pass --email=ads@yourdomain — a throwaway you own, never a customer address.');
  process.exit(1);
}

const slug = (SKU || PRODUCT_ID).toLowerCase().replace(/[^a-z0-9]+/g, '-');
const OUT = path.resolve(arg('out') || path.join('scripts', 'ad', 'out', slug));
fs.mkdirSync(OUT, { recursive: true });

/* Beats are wall-clock offsets from the first frame. The editor cuts on these
   rather than on guesses, so a slow page makes a slower cut instead of a cut in
   the wrong place. */
const beats = [];
let t0 = 0;
const beat = (label, extra = {}) => {
  const atMs = t0 ? Date.now() - t0 : 0;
  beats.push({ label, atMs, ...extra });
  console.log(`  ${String(atMs).padStart(6)}ms  ${label}`);
};

const api = async (p, init) => {
  const res = await fetch(`${BASE}${p}`, init);
  if (!res.ok) throw new Error(`${p} → ${res.status}`);
  return res.json();
};

console.log(`\n▶ Recording a real purchase on ${BASE}\n`);

// 1. Resolve the product on the live site, so the advert is of something real.
const { products } = await api('/api/products?limit=200');
const product = products.find((p) => (PRODUCT_ID && p.id === PRODUCT_ID)
  || (SKU && String(p.sku || '').toUpperCase() === SKU.toUpperCase()));
if (!product) {
  console.error(`No active product matching ${SKU || PRODUCT_ID} on ${BASE}`);
  process.exit(1);
}
console.log(`  product: ${product.name} — €${(product.price / 100).toFixed(2)}\n`);

/* A mystery box pays out as store credit, and store credit needs an account —
   createOrder refuses a guest one outright. This recorder buys as a guest, the
   way most of the shop's customers do, so it would reach the checkout and be
   turned away there. Said here instead, where the reason is obvious. */
if (product.kind === 'mystery') {
  console.error('This is a mystery box, which pays out as store credit and therefore needs');
  console.error('an account. Record it from a signed-in session, or pick another product.');
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--force-device-scale-factor=1'] });
/* Record at the CSS viewport size, not at the delivery size.
   Playwright paints the page at its CSS width and then places that image in a
   frame of `recordVideo.size` — it does not scale to fit, and deviceScaleFactor
   does not apply to the capture. Asking for 1080x1920 around a 540px viewport
   produced exactly that: the shop in the top-left corner of a grey 9:16 frame.
   540x960 is the widest that still gets the PHONE layout (Tailwind's sm
   breakpoint is 640), so the frame is filled here and compose.mjs takes it up
   to 1080x1920 with a proper scaler. */
/* The language the purchase is filmed in.
 *
 * The shop picks a language from the browser, and headless Chromium says
 * en-US — so a Dutch advert was filmed against an English shop, and the
 * delivery email in the last third of it arrived in English. Nothing was
 * broken: the shop served an English buyer an English mail, exactly as it
 * should. The recording simply has to browse the way the advert's audience
 * does, which means both the browser locale AND the shop's own stored choice.
 */
const LANG = arg('lang', 'nl');
const LOCALE = { nl: 'nl-NL', en: 'en-GB', de: 'de-DE', fr: 'fr-FR' }[LANG] || 'en-GB';

const context = await browser.newContext({
  viewport: { width: 540, height: 960 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  locale: LOCALE,
  recordVideo: { dir: OUT, size: { width: 540, height: 960 } },
});
/* Set before the first navigation: the shop reads `fm_lang` on its very first
   render, so setting it afterwards would film one language and email another. */
await context.addInitScript((l) => {
  try { localStorage.setItem('fm_lang', l); } catch { /* private mode */ }
}, LANG);
const page = await context.newPage();

/* A visible cursor. Playwright moves a real mouse but paints nothing, and an
   advert of a phone screen with no finger on it reads as a screenshot slideshow.
   This is a DOM overlay that follows the same coordinates the clicks use, so it
   never points somewhere the click did not go. */
await page.addInitScript(() => {
  const draw = () => {
    if (document.getElementById('__adcur')) return;
    const c = document.createElement('div');
    c.id = '__adcur';
    /* Opaque, ringed and large enough to read at a thumb's distance.
       It used to be a 26px radial gradient fading to nothing — on a light
       storefront page that is not a cursor, it is a lens flare, and a reviewer
       watching the finished advert could not find it at all. A screen recording
       with no visible pointer reads as a slideshow of pages rather than
       somebody buying something. */
    c.style.cssText = 'position:fixed;left:0;top:0;width:34px;height:34px;border-radius:50%;'
      + 'background:radial-gradient(circle at 32% 30%,#ffffff,#cdbcff 42%,#7c5cff 100%);'
      + 'border:2.5px solid rgba(255,255,255,.95);'
      + 'box-shadow:0 3px 14px rgba(0,0,0,.45),0 0 26px 8px rgba(124,92,255,.55);'
      + 'pointer-events:none;z-index:2147483647;'
      + 'transform:translate(-50%,-50%);transition:transform .06s linear;'
      + 'will-change:transform';
    document.documentElement.appendChild(c);
    const ring = document.createElement('div');
    ring.id = '__adring';
    ring.style.cssText = 'position:fixed;left:0;top:0;width:34px;height:34px;border-radius:50%;'
      + 'border:3px solid rgba(124,92,255,.95);pointer-events:none;z-index:2147483647;opacity:0;'
      + 'transform:translate(-50%,-50%) scale(1)';
    document.documentElement.appendChild(ring);
    let x = innerWidth / 2, y = innerHeight / 2;
    const move = (nx, ny) => {
      x = nx; y = ny;
      c.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
      ring.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%) scale(1)`;
    };
    move(x, y);
    window.__adMove = move;

    /* Smooth tracking, not teleporting.
       `move` sets a transform and lets a 90ms CSS transition cover the gap,
       which is fine for a nudge and wrong for the width of a phone screen: the
       cursor arrived before the eye could follow it, so the finished advert
       showed a pointer that was simply in a different place each cut. This
       animates along the path on a cubic ease-out at 60fps, so the recording
       actually contains the movement — which is the whole reason a viewer reads
       it as somebody doing something rather than pages appearing. */
    window.__adGlide = (nx, ny, ms) => new Promise((done) => {
      const sx = x, sy = y;
      const dist = Math.hypot(nx - sx, ny - sy);
      const dur = ms || Math.min(620, Math.max(180, dist * 1.15));
      const t0 = performance.now();
      const ease = (p) => 1 - Math.pow(1 - p, 3);
      const step = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        const e = ease(p);
        move(sx + (nx - sx) * e, sy + (ny - sy) * e);
        if (p < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
    window.__adTap = () => {
      ring.animate(
        [{ opacity: .9, transform: ring.style.transform + ' scale(1)' },
          { opacity: 0, transform: ring.style.transform.replace('scale(1)', '') + ' scale(2.6)' }],
        { duration: 420, easing: 'ease-out' });
    };
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', draw);
  else draw();
  addEventListener('load', draw);
});

/** Move the painted cursor to an element, then click it for real. */
async function tap(locator, label) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const box = await locator.boundingBox();
  if (box) {
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    /* Awaited, so the recording contains the travel rather than the arrival. */
    await page.evaluate(([px, py]) => window.__adGlide?.(px, py), [x, y]).catch(() => {});
    await page.waitForTimeout(Math.max(80, SLOW / 2));
    await page.evaluate(() => window.__adTap?.()).catch(() => {});
    await page.waitForTimeout(120);
  }
  if (label) beat(label, { click: true });
  await locator.click();
  await page.waitForTimeout(SLOW);
}

let order = null;
try {
  // ── 1. Open ForgeMarket ─────────────────────────────────────────────────
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: TIMEOUT });
  t0 = Date.now();
  beat('open');
  await page.getByRole('button', { name: /Accept|Accepteren|Akzeptieren|Accepter/i })
    .click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(600);

  // ── 2. Browse ───────────────────────────────────────────────────────────
  await page.goto(`${BASE}/shop`, { waitUntil: 'networkidle', timeout: TIMEOUT });
  beat('shop');
  await page.waitForTimeout(500);
  /* A real scroll through the catalogue. The edit ramps this hard — it is the
     part of a purchase that carries the least information per second — so it
     needs enough source to ramp: three flicks compressed to nothing is a cut,
     not a montage. */
  for (const dy of [340, 300, 340, 300, 320, 280]) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(320);
  }
  beat('browse');

  // ── 3-4. Pick it, open the product page ─────────────────────────────────
  const card = page.locator(`a[href="/product/${product.id}"]`).first();
  if (await card.count()) await tap(card, 'select');
  else { await page.goto(`${BASE}/product/${product.id}`, { waitUntil: 'networkidle' }); beat('select'); }
  await page.waitForURL(/\/product\//, { timeout: TIMEOUT }).catch(() => {});
  /* Hold here. This is the shot the advert is built around — the product, its
     price, the delivery promise — and the edit cannot show for two seconds
     something that was only on screen for two hundred milliseconds. */
  await page.waitForTimeout(700);
  beat('product', { name: product.name, price: product.price, currency: product.currency });
  /* Hold, then read down the page the way somebody deciding would: the price,
     the delivery promise, what actually arrives. This is the shot the advert is
     built around and the edit cannot show for two seconds something that was
     only on screen for two hundred milliseconds. */
  await page.waitForTimeout(1500);
  for (const dy of [260, 240, 260]) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(420);
  }
  await page.mouse.wheel(0, -760);
  await page.waitForTimeout(700);

  // The price, located on screen so the edit can push in on it.
  const priceBox = await page.locator('text=/€\\s?\\d/').first().boundingBox().catch(() => null);
  if (priceBox) beat('price-onscreen', { box: priceBox });

  // ── 5. Buy ──────────────────────────────────────────────────────────────
  /* Every language the shop speaks, because the shop is filmed in the language
     of the advert now. These were English-only, so a Dutch recording waited
     thirty seconds for a "Buy Now" on a page whose button says "Direct kopen"
     and then failed with a timeout that named a selector rather than a cause. */
  const buy = page.getByRole('button', {
    name: /Buy Now|Direct kopen|Koop|Sofort kaufen|Acheter maintenant|Pay .* securely|Place order/i,
  }).first();
  await tap(buy, 'buy');
  await page.waitForTimeout(900);

  // ── 6. Checkout ─────────────────────────────────────────────────────────
  await page.waitForURL(/\/checkout/, { timeout: TIMEOUT }).catch(() => {});
  beat('checkout');
  const emailField = page.locator('input[type="email"]').first();
  if (await emailField.count()) {
    await emailField.fill(EMAIL);
    await page.waitForTimeout(200);
  }
  /* The delivery target, where the product needs one.
     An account top-up asks for the buyer's in-game username, and that field is
     `required` — so leaving it empty means the browser silently refuses to
     submit and the recording dies at "no order number in the URL" with nothing
     in the server log to explain it, because no request was ever made. Filmed
     with an obviously fictional name: this frame ends up on screen, and a real
     username on a real account is somebody's. */
  const target = page.locator('#co-target');
  if (await target.count()) {
    await target.fill(arg('target-name', 'ForgeDemo_NL'));
    beat('delivery-target');
    await page.waitForTimeout(SLOW);
  }

  /* Consent is a legal checkbox, not decoration, and the submit stays disabled
     until it is ticked. Clicking it can miss — the real input often sits under a
     styled label — so `check()` is used, which asserts the resulting state
     instead of hoping the click landed. */
  const consent = page.locator('input[type="checkbox"]').first();
  if (await consent.count()) {
    const box = await consent.boundingBox().catch(() => null);
    if (box) {
      await page.evaluate(([x, y]) => window.__adGlide?.(x, y),
        [box.x + box.width / 2, box.y + box.height / 2]).catch(() => {});
      await page.evaluate(() => window.__adTap?.()).catch(() => {});
    }
    beat('consent', { click: true });
    await consent.check({ force: true, timeout: 5000 }).catch(async () => {
      // Hidden behind its label: click the label instead, then verify.
      await page.locator('label').filter({ hasText: /agree|akkoord|consent|direct/i })
        .first().click({ timeout: 3000 }).catch(() => {});
    });
    if (!(await consent.isChecked().catch(() => false))) {
      console.warn('  ⚠ consent box would not tick — the checkout will refuse the order');
    }
    await page.waitForTimeout(SLOW);
  }

  /* The checkout renders its submit twice — inline and in a sticky bar — so
     "the last one" is a coin toss between a button that is on screen and one
     that is not. Try each visible, enabled candidate and stop as soon as an
     order actually exists, rather than clicking once and waiting sixty seconds
     to discover nothing happened. */
  const orderSeen = () => page.evaluate(() => {
    const q = new URLSearchParams(location.search);
    return q.get('order') || q.get('number') || null;
  }).catch(() => null);

  /* Why the checkout said no, in its own words. Without this a refused order is
     just a timeout, and the reason — an unticked consent box, a closed
     shop, a product that went out of stock — is in a response nobody read. */
  page.on('response', async (r) => {
    if (!/\/api\/orders(\?|$)/.test(r.url()) || r.status() < 400) return;
    const why = await r.text().catch(() => '');
    console.warn(`  checkout refused (${r.status()}): ${why.slice(0, 200)}`);
  });

  const candidates = await page.getByRole('button', {
    name: /Pay|Place order|Bestellen|Bestelling plaatsen|Betalen|Buy|Bezahlen|Bestellung|Payer|Passer la commande/i,
  }).all();
  let clicked = false;
  for (const c of candidates) {
    if (!(await c.isVisible().catch(() => false))) continue;
    if (await c.isDisabled().catch(() => true)) continue;
    await tap(c, clicked ? null : 'pay');
    clicked = true;
    for (let i = 0; i < 16 && !(await orderSeen()); i++) await page.waitForTimeout(500);
    if (await orderSeen()) break;
  }
  if (!clicked) throw new Error('No enabled checkout button — the shop would not take the order.');
  beats.push({ label: 'payment-mode', atMs: Date.now() - t0, mode: PAY });

  // ── 7. Complete the purchase ────────────────────────────────────────────
  if (PAY === 'manual') {
    console.log('\n  ⏸  --pay=manual: complete the payment now. Waiting…\n');
  }
  /* Read the order number out of the URL, not off the page.
     The checkout puts the real number in ?order= when it succeeds. Scraping the
     body text instead found "FM-2026-XXXXXXXX" — the example in the placeholder
     copy — and then spent two minutes waiting for an order that never existed. */
  /* Polled rather than one long waitForFunction: the checkout navigates, and a
     navigation destroys the execution context the wait is living in — it threw
     until it timed out and only then did a fresh read find the number that had
     been there for two minutes. */
  let orderNumber = null;
  const orderDeadline = Date.now() + 60_000;
  while (!orderNumber && Date.now() < orderDeadline) {
    orderNumber = await page.evaluate(() => {
      const q = new URLSearchParams(location.search);
      return q.get('order') || q.get('number') || null;
    }).catch(() => null);
    if (!orderNumber) await page.waitForTimeout(250);
  }
  if (!orderNumber) throw new Error('No order number in the URL — the purchase did not go through.');
  beat('order-placed', { orderNumber });

  // ── 8. Order confirmation, read back from the site ──────────────────────
  const deadline = Date.now() + TIMEOUT;
  for (;;) {
    /* The same public lookup the track page uses — the order NUMBER is the
       credential, exactly as it is for a real buyer following their link. */
    order = await api(`/api/track/${encodeURIComponent(orderNumber)}`).catch(() => null);
    if (order?.status === 'completed') break;
    if (Date.now() > deadline) {
      throw new Error(`Order ${orderNumber} never reached completed (last: ${order?.status || 'unknown'}). `
        + 'Refusing to make an advert for a delivery that did not happen.');
    }
    await page.waitForTimeout(1500);
  }
  beat('confirmed', { orderNumber, status: order.status });
  // The confirmation screen, held long enough to read the order number.
  await page.waitForTimeout(2200);

  // ── 9-11. The delivery, on the real order page ──────────────────────────
  await page.goto(`${BASE}/track?number=${encodeURIComponent(orderNumber)}`,
    { waitUntil: 'networkidle', timeout: TIMEOUT });
  await page.waitForTimeout(900);
  beat('delivery');
  await page.waitForTimeout(1400);
  // Down to the delivered item itself — the proof the whole advert is for.
  for (const dy of [240, 220]) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(520);
  }
  beat('delivered-detail');
  await page.waitForTimeout(1200);

  /* ── 9-11. The delivery email, actually opened ─────────────────────────
     Rendered from the row the mailer wrote — same template, same context, the
     same bytes that reached the inbox — with the code and the address masked
     before the file is written. Needs DATABASE_URL, because the email lives in
     the shop's own database; without it the advert simply ends on the order
     page, which is still a real delivery, rather than on a mock-up of an inbox. */
  if (process.env.DATABASE_URL) {
    const { execFileSync } = await import('node:child_process');
    try {
      execFileSync(process.execPath, [
        path.join('scripts', 'ad', 'email.mjs'),
        `--order=${orderNumber}`, `--out=${OUT}`,
      ], { stdio: 'pipe' });
      const mail = path.join(OUT, 'email.html');
      if (fs.existsSync(mail)) {
        await page.goto(`file://${mail}`, { waitUntil: 'load', timeout: TIMEOUT });
        await page.waitForTimeout(900);
        beat('email-open');
        await page.waitForTimeout(1500);
        for (const dy of [220, 200]) {
          await page.mouse.wheel(0, dy);
          await page.waitForTimeout(480);
        }
        beat('email-detail');
        await page.waitForTimeout(1500);
      }
    } catch (e) {
      console.warn(`  (no email beat: ${String(e.message).split('\n')[0]})`);
    }
  }

  await page.waitForTimeout(400);
  beat('end');
} catch (err) {
  console.error(`\n✖ ${err.message}\n`);
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(1);
}

await context.close();          // flushes the video file
await browser.close();

/* Playwright names the video after the page; give it the name the editor wants.
 *
 * `raw.webm` is excluded from the candidates on purpose. It used to be in the
 * list, and re-recording into a directory that already held one destroyed the
 * take: sorted, `page@….webm` comes before `raw.webm`, so the new file was
 * renamed over the old one correctly — and then the "extras" sweep deleted
 * `raw.webm`, which was by then the recording that had just been made. The
 * whole purchase, filmed and thrown away, and compose.mjs then reporting a
 * missing file for a run that had just printed a success. */
const vids = fs.readdirSync(OUT).filter((f) => f.endsWith('.webm') && f !== 'raw.webm');
if (!vids.length) { console.error('No video was written.'); process.exit(1); }
for (const extra of vids.slice(1)) fs.unlinkSync(path.join(OUT, extra));
fs.renameSync(path.join(OUT, vids[0]), path.join(OUT, 'raw.webm'));

/* What this footage IS, recorded with it.
 *
 * Two things put text on screen that must never reach a feed: filming against
 * anything but the live shop bakes that host into the delivery email's footer
 * (`© 2026 ForgeMarket — localhost:3000`, legible for a second and a half), and
 * a demo payment makes the checkout say so in Dutch, on camera. Both were
 * console warnings, which is a note to whoever ran the command and nothing at
 * all to whoever uploads the file a week later.
 *
 * So it travels with the recording, and compose.mjs refuses to write a
 * shippable filename without it. */
const provenance = {
  live: /^https:\/\//i.test(BASE) && !/localhost|127\.0\.0\.1|:\d{4,5}$/.test(BASE),
  realPayment: PAY === 'manual',
};
if (!provenance.live || !provenance.realPayment) {
  console.warn(`\n  ⚠ PREVIEW footage — ${!provenance.live ? `filmed against ${BASE}` : ''}`
    + `${!provenance.live && !provenance.realPayment ? ' and ' : ''}`
    + `${!provenance.realPayment ? `paid with --pay=${PAY}` : ''}.`);
  console.warn('    The frame will carry a dev host and/or a demo-mode notice. Not publishable.\n');
}

fs.writeFileSync(path.join(OUT, 'beats.json'), JSON.stringify({
  provenance,
  base: BASE, recordedAt: new Date().toISOString(),
  payment: PAY,
  realPayment: PAY === 'manual',
  product: { id: product.id, sku: product.sku, name: product.name,
    price: product.price, currency: product.currency, image: product.image },
  beats,
}, null, 2));
fs.writeFileSync(path.join(OUT, 'order.json'), JSON.stringify(order, null, 2));

/* The facts a caption is allowed to state, read from the shop at the moment of
   the purchase.
 *
 * Kept next to the footage because they are only true of THAT recording: the
 * stock count moves, a review is published or hidden, a mystery box rolls a
 * different prize every time. A variant that has no real value for what it
 * wants to say is skipped rather than filled in — see variants.mjs.
 */
const extras = { instant: product.instant ?? null, stockLeft: product.stockLeft ?? null };
try {
  const fresh = (await api('/api/products?limit=200')).products.find((p) => p.id === product.id);
  if (fresh) { extras.instant = fresh.instant ?? null; extras.stockLeft = fresh.stockLeft ?? null; }
} catch { /* keep what the first read gave us */ }
try {
  // Published reviews only, and the shop only publishes verified ones — so a
  // quote in an advert is a quote from somebody who actually bought something.
  const { reviews = [] } = await api('/api/reviews');
  const best = reviews.find((r) => r.verified && String(r.body || '').length > 24)
    || reviews.find((r) => r.verified);
  if (best) extras.review = { author: best.author, body: best.body, stars: best.stars };
} catch { /* no review: variant F skips itself */ }
if (product.kind === 'mystery') {
  try {
    const pulls = await api(`/api/track/${encodeURIComponent(order.number)}`);
    const won = pulls?.mystery?.[0] || pulls?.pulls?.[0] || null;
    if (won?.label) extras.mystery = { label: won.label, credit: won.credit ?? won.credit_cents ?? null };
  } catch { /* no prize read: variant H skips itself */ }
}
/* The shop's own figures, so a claim that IS provable can be proven.
   /api/social/stats is computed from the orders table and the published
   reviews and returns nulls until there are some — which is the honest state
   today, and exactly what the claim gate needs to refuse a rating. Absent
   means not proven, so a shop that does not serve this endpoint simply gets a
   quieter advert. */
try {
  const stats = await api('/api/social/stats');
  if (stats && typeof stats === 'object') extras.stats = stats;
} catch { /* no stats: every statistical claim stays unproven, which is right */ }

fs.writeFileSync(path.join(OUT, 'extras.json'), JSON.stringify(extras, null, 2));

console.log(`\n✅ ${path.join(OUT, 'raw.webm')}`);
console.log(`   ${beats.length} beats · order ${order.number} · ${order.status}`);
console.log(`   payment: ${PAY}${PAY === 'manual' ? ' (real)' : ' (TEST — the advert must not imply otherwise)'}\n`);
