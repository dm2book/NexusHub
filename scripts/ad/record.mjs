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

const browser = await chromium.launch({ executablePath: CHROME, args: ['--force-device-scale-factor=1'] });
/* Record at the CSS viewport size, not at the delivery size.
   Playwright paints the page at its CSS width and then places that image in a
   frame of `recordVideo.size` — it does not scale to fit, and deviceScaleFactor
   does not apply to the capture. Asking for 1080x1920 around a 540px viewport
   produced exactly that: the shop in the top-left corner of a grey 9:16 frame.
   540x960 is the widest that still gets the PHONE layout (Tailwind's sm
   breakpoint is 640), so the frame is filled here and compose.mjs takes it up
   to 1080x1920 with a proper scaler. */
const context = await browser.newContext({
  viewport: { width: 540, height: 960 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  recordVideo: { dir: OUT, size: { width: 540, height: 960 } },
});
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
    c.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;border-radius:50%;'
      + 'background:radial-gradient(circle at 30% 30%,rgba(255,255,255,.95),rgba(160,140,255,.55) 60%,rgba(124,92,255,0) 70%);'
      + 'box-shadow:0 0 18px 6px rgba(124,92,255,.45);pointer-events:none;z-index:2147483647;'
      + 'transform:translate(-50%,-50%);transition:transform .08s ease-out;will-change:transform';
    document.documentElement.appendChild(c);
    const ring = document.createElement('div');
    ring.id = '__adring';
    ring.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;border-radius:50%;'
      + 'border:2px solid rgba(255,255,255,.9);pointer-events:none;z-index:2147483647;opacity:0;'
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
    await page.evaluate(([px, py]) => window.__adMove?.(px, py), [x, y]).catch(() => {});
    await page.waitForTimeout(SLOW);
    await page.evaluate(() => window.__adTap?.()).catch(() => {});
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
  await page.getByRole('button', { name: /Accept/i }).click({ timeout: 3000 }).catch(() => {});
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
  const buy = page.getByRole('button', { name: /Buy Now|Koop|Pay .* securely|Place order/i }).first();
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
  // Consent is a legal checkbox, not decoration — tick the real one.
  const consent = page.locator('input[type="checkbox"]').first();
  if (await consent.count() && !(await consent.isChecked())) await tap(consent, 'consent');

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

  const candidates = await page.getByRole('button', { name: /Pay|Place order|Bestellen|Buy/i }).all();
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

// Playwright names the video after the page; give it the name the editor wants.
const vids = fs.readdirSync(OUT).filter((f) => f.endsWith('.webm'));
if (!vids.length) { console.error('No video was written.'); process.exit(1); }
fs.renameSync(path.join(OUT, vids[0]), path.join(OUT, 'raw.webm'));
for (const extra of vids.slice(1)) fs.unlinkSync(path.join(OUT, extra));

fs.writeFileSync(path.join(OUT, 'beats.json'), JSON.stringify({
  base: BASE, recordedAt: new Date().toISOString(),
  payment: PAY,
  realPayment: PAY === 'manual',
  product: { id: product.id, sku: product.sku, name: product.name,
    price: product.price, currency: product.currency, image: product.image },
  beats,
}, null, 2));
fs.writeFileSync(path.join(OUT, 'order.json'), JSON.stringify(order, null, 2));

console.log(`\n✅ ${path.join(OUT, 'raw.webm')}`);
console.log(`   ${beats.length} beats · order ${order.number} · ${order.status}`);
console.log(`   payment: ${PAY}${PAY === 'manual' ? ' (real)' : ' (TEST — the advert must not imply otherwise)'}\n`);
