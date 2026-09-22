/**
 * The Discord banners and the link-preview card, drawn from one system.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 * Nine raster creatives shipped in this repo with no way to redraw them. They
 * were made somewhere else and committed as pixels, which had two costs.
 *
 * The first is honesty. static-creatives.mjs writes down the words printed on
 * each one so honest-copy.test can read them, and four were marked `retire`
 * with a reason — and then kept shipping, because there was nothing to redraw
 * them WITH. The header of the Discord server said "Instant game top-ups,
 * delivered in seconds" and wore an INSTANT DELIVERY badge on a shop where
 * most orders are delivered by hand. The support banner promised 24/7 from one
 * person. The vouches banner showed five stars and "real buyers" on a shop
 * that had never taken an order. og.png — the card on every shared link, the
 * most distributed thing here — claimed all three.
 *
 * The second is that they were not the shop. Arial-ish type, no relation to
 * the storefront's own Bricolage/Inter, so the Discord server looked like a
 * different company's.
 *
 * Both are now fixed in the same place: the copy lives in text, in this file,
 * beside the drawing that prints it.
 *
 * ── HOW ───────────────────────────────────────────────────────────────────
 * HTML, not SVG: the layout is a stack of text blocks and the browser is the
 * best text engine available here. social-generate.mjs screenshots each at its
 * exact pixel size. The shop's own woff2 files are inlined as data URIs, so
 * this renders with no network and cannot pick up a different font on another
 * machine.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/** The storefront's own type, inlined so the render is reproducible. */
const font = (file) => {
  const p = path.join(ROOT, 'public', 'fonts', file);
  return fs.existsSync(p) ? fs.readFileSync(p).toString('base64') : null;
};
const FACES = [
  ['Bricolage Grotesque', 800, 'bricolage-800.woff2'],
  ['Bricolage Grotesque', 700, 'bricolage-700.woff2'],
  ['Inter', 700, 'inter-700.woff2'],
  ['Inter', 600, 'inter-600.woff2'],
  ['Inter', 400, 'inter-400.woff2'],
];
const fontFaces = () => FACES.map(([family, weight, file]) => {
  const b64 = font(file);
  return b64 ? `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;font-display:block;
    src:url(data:font/woff2;base64,${b64}) format('woff2')}` : '';
}).join('\n');

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/**
 * The emblem on the right.
 *
 * Flat vector with one gradient and a soft shadow, inside the concentric rings
 * the set already used. Deliberately not a photoreal 3D render: nine of those
 * cannot be kept consistent by hand, and a shape that reads instantly at
 * thumbnail size beats a rendering that does not.
 *
 * Each is drawn in a 0 0 240 240 box and centred by the caller.
 */
export const EMBLEM = {
  bolt: `<path d="M141 18 78 126h44l-19 96 63-112h-45z" fill="url(#g)" stroke="rgba(255,255,255,.35)" stroke-width="3" stroke-linejoin="round"/>`,
  shield: `<path d="M120 22 42 52v62c0 47 33 88 78 104 45-16 78-57 78-104V52z" fill="url(#g)" stroke="rgba(255,255,255,.3)" stroke-width="3"/>
    <path d="M86 118l24 25 46-52" fill="none" stroke="#0b0a18" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/>`,
  badge: `<path d="M120 20l22 20 29-4 9 28 27 12-12 27 12 27-27 12-9 28-29-4-22 20-22-20-29 4-9-28-27-12 12-27-12-27 27-12 9-28 29 4z" fill="url(#g)" stroke="rgba(255,255,255,.3)" stroke-width="3"/>
    <path d="M88 120l23 24 44-50" fill="none" stroke="#0b0a18" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/>`,
  tag: `<path d="M126 26H196a18 18 0 0 1 18 18v70a18 18 0 0 1-5 12l-84 84a18 18 0 0 1-25 0l-70-70a18 18 0 0 1 0-25l84-84a18 18 0 0 1 12-5z" fill="url(#g)" stroke="rgba(255,255,255,.3)" stroke-width="3"/>
    <circle cx="172" cy="68" r="15" fill="#0b0a18"/>`,
  ticket: `<path d="M26 74a14 14 0 0 1 14-14h160a14 14 0 0 1 14 14v26a22 22 0 0 0 0 44v26a14 14 0 0 1-14 14H40a14 14 0 0 1-14-14v-26a22 22 0 0 0 0-44z" fill="url(#g)" stroke="rgba(255,255,255,.3)" stroke-width="3"/>
    <path d="M118 72v96" fill="none" stroke="#0b0a18" stroke-width="9" stroke-linecap="round" stroke-dasharray="4 18"/>`,
  /* The lid seams stop at the fold. Drawn all the way down, the vertical one
     ran straight through the tick and the two shapes fought. */
  parcel: `<path d="M120 22l92 46v104l-92 46-92-46V68z" fill="url(#g)" stroke="rgba(255,255,255,.3)" stroke-width="3" stroke-linejoin="round"/>
    <path d="M28 68l92 46 92-46" fill="none" stroke="rgba(11,10,24,.45)" stroke-width="7"/>
    <path d="M88 152l25 26 50-56" fill="none" stroke="#0b0a18" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>`,
  gift: `<rect x="30" y="94" width="180" height="120" rx="14" fill="url(#g)" stroke="rgba(255,255,255,.3)" stroke-width="3"/>
    <rect x="18" y="62" width="204" height="44" rx="12" fill="url(#g)" stroke="rgba(255,255,255,.3)" stroke-width="3"/>
    <path d="M120 62V214" fill="none" stroke="#0b0a18" stroke-width="16"/>
    <path d="M120 62c-30-6-50-14-50-28s24-16 32-4 18 32 18 32zM120 62c30-6 50-14 50-28s-24-16-32-4-18 32-18 32z" fill="url(#g)" stroke="rgba(255,255,255,.3)" stroke-width="3"/>`,
  percent: `<circle cx="120" cy="120" r="96" fill="url(#g)" stroke="rgba(255,255,255,.3)" stroke-width="3"/>
    <path d="M78 162 162 78" fill="none" stroke="#0b0a18" stroke-width="16" stroke-linecap="round"/>
    <circle cx="90" cy="92" r="19" fill="#0b0a18"/><circle cx="150" cy="150" r="19" fill="#0b0a18"/>`,
  cart: `<path d="M24 44h30l28 104h92l30-74H74" fill="none" stroke="url(#g)" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="96" cy="190" r="20" fill="url(#g)"/><circle cx="166" cy="190" r="20" fill="url(#g)"/>`,
};

/**
 * One banner.
 *
 * Every creative is the same six parts: wordmark, chip, headline, subline,
 * pill row, emblem. Nothing in a spec chooses a layout — that is what keeps
 * nine of them looking like one set.
 */
export function bannerHtml(spec, { width = 2200, height = 720 } = {}) {
  const { title, sub, chip, pills = [], emblem = 'bolt', accent = '#a855f7', accent2 = '#6366f1' } = spec;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaces()}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${width}px;height:${height}px;overflow:hidden}
body{background:#07060f;font-family:'Inter',sans-serif;-webkit-font-smoothing:antialiased}
.stage{position:relative;width:${width}px;height:${height}px;
  background:
    radial-gradient(880px 600px at 86% 48%, ${accent}40, transparent 60%),
    radial-gradient(780px 540px at 4% 10%, ${accent2}38, transparent 58%),
    linear-gradient(118deg,#140f2c 0%,#080713 52%,#0f0b22 100%);
  overflow:hidden}
/* The grid the set has always had, kept faint enough to be texture. */
.grid{position:absolute;inset:0;
  background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),
                   linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);
  background-size:88px 88px;
  -webkit-mask-image:radial-gradient(1500px 700px at 30% 50%,#000 30%,transparent 88%)}
.mark{position:absolute;left:96px;top:74px;display:flex;align-items:center;gap:22px}
.mark .tile{width:78px;height:78px;border-radius:22px;
  background:linear-gradient(135deg,#8b5cf6,#d946ef);
  box-shadow:0 18px 44px rgba(139,92,246,.45);position:relative}
.mark .tile svg{position:absolute;inset:0;margin:auto}
.mark .name{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:44px;letter-spacing:.02em;color:#fff}
.mark .name span{color:#8f86bd}
.chip{position:absolute;right:96px;top:80px;padding:18px 34px;border-radius:999px;
  border:1px solid ${accent}80;background:rgba(255,255,255,.05);
  font-weight:700;font-size:25px;letter-spacing:.16em;color:#efeaff}
.copy{position:absolute;left:96px;bottom:104px;max-width:1180px}
h1{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:132px;line-height:.92;
   letter-spacing:-.035em;
   background:linear-gradient(96deg,#ffffff 4%,${accent} 62%,${accent2} 100%);
   -webkit-background-clip:text;background-clip:text;color:transparent;padding-bottom:8px}
.sub{font-size:41px;font-weight:400;color:#b7b0d6;padding-top:22px;letter-spacing:-.005em}
.pills{display:flex;gap:18px;padding-top:36px}
.pill{padding:15px 30px;border-radius:999px;border:1px solid rgba(255,255,255,.14);
  background:rgba(255,255,255,.045);font-weight:600;font-size:27px;color:#d7d2ee}
.art{position:absolute;right:140px;top:50%;transform:translateY(-50%);width:600px;height:600px}
.ring{position:absolute;border-radius:50%;border:1px solid ${accent}38;inset:0}
.ring.mid{inset:80px;border-color:${accent}33}
.ring.in{inset:160px;border-color:${accent}2b;background:radial-gradient(circle,${accent}33,transparent 72%)}
.art svg{position:absolute;inset:0;margin:auto;filter:drop-shadow(0 26px 56px rgba(0,0,0,.6))}
/* The accent bar the set closes on. */
.foot{position:absolute;left:0;right:0;bottom:0;height:9px;
  background:linear-gradient(90deg,${accent2},${accent},#ec4899)}
</style></head><body><div class="stage">
  <div class="grid"></div>
  <div class="mark">
    <span class="tile"><svg width="42" height="42" viewBox="0 0 240 240"><path d="M141 18 78 126h44l-19 96 63-112h-45z" fill="#fff"/></svg></span>
    <span class="name">FORGE<span>MARKET</span></span>
  </div>
  ${chip ? `<div class="chip">${esc(chip)}</div>` : ''}
  <div class="copy">
    <h1>${esc(title)}</h1>
    <div class="sub">${esc(sub)}</div>
    ${pills.length ? `<div class="pills">${pills.map((p) => `<span class="pill">${esc(p)}</span>`).join('')}</div>` : ''}
  </div>
  <div class="art">
    <span class="ring"></span><span class="ring mid"></span><span class="ring in"></span>
    <svg width="376" height="376" viewBox="0 0 240 240">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${accent}"/><stop offset="1" stop-color="${accent2}"/>
      </linearGradient></defs>
      ${EMBLEM[emblem] || EMBLEM.bolt}
    </svg>
  </div>
  <div class="foot"></div>
</div></body></html>`;
}

/**
 * The link-preview card.
 *
 * Not a squeezed banner: at 1200x630 it is nearly square, and the banner's
 * left-aligned headline with a big emblem beside it leaves a hole. Centred,
 * with the three things a stranger seeing this link needs to know — what is
 * sold, what happens if it does not arrive, and that a person answers.
 */
export function ogHtml(spec, { width = 1200, height = 630 } = {}) {
  const { title, sub, facts = [], accent = '#a855f7', accent2 = '#6366f1' } = spec;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaces()}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${width}px;height:${height}px;overflow:hidden}
body{background:#07060f;font-family:'Inter',sans-serif;-webkit-font-smoothing:antialiased}
.stage{position:relative;width:${width}px;height:${height}px;display:flex;flex-direction:column;
  align-items:center;justify-content:center;text-align:center;
  background:
    radial-gradient(760px 520px at 50% 0%, ${accent}30, transparent 62%),
    radial-gradient(620px 460px at 12% 100%, ${accent2}2b, transparent 60%),
    linear-gradient(160deg,#110d26 0%,#07060f 58%,#0d0a1e 100%)}
.grid{position:absolute;inset:0;
  background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),
                   linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);
  background-size:64px 64px;
  -webkit-mask-image:radial-gradient(760px 420px at 50% 45%,#000 25%,transparent 86%)}
.mark{display:flex;align-items:center;gap:16px;position:relative}
.tile{width:62px;height:62px;border-radius:18px;background:linear-gradient(135deg,#8b5cf6,#d946ef);
  box-shadow:0 14px 34px rgba(139,92,246,.45);position:relative}
.tile svg{position:absolute;inset:0;margin:auto}
.name{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:38px;letter-spacing:.02em;color:#fff}
.name span{color:#8f86bd}
h1{position:relative;font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:82px;line-height:1.02;
   letter-spacing:-.035em;padding:38px 0 0;max-width:1000px;
   background:linear-gradient(96deg,#ffffff 10%,${accent} 72%,${accent2} 100%);
   -webkit-background-clip:text;background-clip:text;color:transparent}
.sub{position:relative;font-size:30px;color:#b7b0d6;padding-top:22px;max-width:880px;line-height:1.45}
.facts{position:relative;display:flex;gap:14px;padding-top:40px}
.fact{padding:14px 26px;border-radius:999px;border:1px solid rgba(255,255,255,.14);
  background:rgba(255,255,255,.05);font-weight:600;font-size:22px;color:#d7d2ee}
.foot{position:absolute;left:0;right:0;bottom:0;height:8px;
  background:linear-gradient(90deg,${accent2},${accent},#ec4899)}
</style></head><body><div class="stage">
  <div class="grid"></div>
  <div class="mark">
    <span class="tile"><svg width="34" height="34" viewBox="0 0 240 240"><path d="M141 18 78 126h44l-19 96 63-112h-45z" fill="#fff"/></svg></span>
    <span class="name">FORGE<span>MARKET</span></span>
  </div>
  <h1>${esc(title)}</h1>
  <div class="sub">${esc(sub)}</div>
  ${facts.length ? `<div class="facts">${facts.map((f) => `<span class="fact">${esc(f)}</span>`).join('')}</div>` : ''}
  <div class="foot"></div>
</div></body></html>`;
}

/**
 * What each creative says.
 *
 * Every line here is checked by honest-copy.test through static-creatives.mjs,
 * and the four that used to trip it are rewritten rather than re-drawn:
 *
 *   welcome  "Instant game top-ups, delivered in seconds" + INSTANT DELIVERY
 *            → what is actually sold, and the promise the refund policy makes.
 *   support  "we reply fast, 24/7"
 *            → one person answers, which is the true and better claim.
 *   vouches  "Real buyers, real proof of delivery" + a five-star row
 *            → describes the mechanism (a vouch is tied to an order) instead of
 *              asserting buyers and ratings that do not exist yet.
 *   og       all three of the above at once.
 *
 * giveaways also loses "every week": the old entry carried a `watch` note
 * saying that was a commitment rather than a description, and it is not this
 * banner's job to hold the owner to a cadence.
 */
export const SOCIAL = [
  {
    id: 'welcome', file: 'public/discord/banner-welcome.jpg',
    where: 'the top of the Discord server',
    accent: '#a855f7', accent2: '#6366f1', emblem: 'bolt',
    chip: 'MONEY BACK', title: 'WELCOME',
    sub: 'Game top-ups and gift cards, without the hassle',
    pills: ['Robux', 'V-Bucks', 'Valorant', 'CoD', 'Apex', 'Nitro'],
  },
  {
    id: 'rules', file: 'public/discord/banner-rules.jpg',
    where: 'the Discord rules channel',
    accent: '#94a3b8', accent2: '#6366f1', emblem: 'shield',
    chip: 'READ FIRST', title: 'RULES',
    sub: 'Keep it safe — staff never DM you first',
    pills: ['Be respectful', 'No scams', 'One account'],
  },
  {
    id: 'verify', file: 'public/discord/banner-verify.jpg',
    where: 'the Discord verify channel',
    accent: '#22d3ee', accent2: '#6366f1', emblem: 'badge',
    chip: 'SECURE', title: 'VERIFY',
    sub: 'One tap opens the whole server',
    pills: ['Marketplace', 'Community', 'Giveaways', 'Support'],
  },
  {
    id: 'products', file: 'public/discord/banner-products.jpg',
    where: 'the Discord products channel',
    accent: '#38bdf8', accent2: '#6366f1', emblem: 'cart',
    chip: 'LIVE PRICES', title: 'SHOP & PRICES',
    sub: 'Live prices, synced straight from the store',
    pills: ['Robux', 'V-Bucks', 'Valorant', 'Genshin', 'Brawl Stars'],
  },
  {
    id: 'deals', file: 'public/discord/banner-deals.jpg',
    where: 'the Discord deals channel',
    accent: '#f59e0b', accent2: '#ec4899', emblem: 'percent',
    chip: 'LIMITED TIME', title: 'DROPS & DEALS',
    sub: 'Flash sales, restocks & discount codes',
    pills: ['Flash sales', 'Restocks', 'Coupons', 'VIP perks'],
  },
  {
    id: 'giveaways', file: 'public/discord/banner-giveaways.jpg',
    where: 'the Discord giveaways channel',
    accent: '#34d399', accent2: '#22d3ee', emblem: 'gift',
    chip: 'FREE STUFF', title: 'GIVEAWAYS',
    sub: 'Free drops for verified members',
    pills: ['Open to verified', 'VIP bonus entries', 'Real prizes'],
  },
  {
    id: 'support', file: 'public/discord/banner-support.jpg',
    where: 'the Discord support channel',
    accent: '#818cf8', accent2: '#38bdf8', emblem: 'ticket',
    chip: 'A REAL PERSON', title: 'SUPPORT',
    sub: 'Open a ticket — a person reads it, not a bot',
    pills: ['Orders', 'Payments', 'Refunds', 'Partnerships'],
  },
  {
    id: 'vouches', file: 'public/discord/banner-vouches.jpg',
    where: 'the Discord vouches channel',
    accent: '#34d399', accent2: '#a855f7', emblem: 'parcel',
    chip: 'PROOF', title: 'VOUCHES',
    sub: 'Every vouch here is tied to a real order number',
    pills: ['Proof of delivery', 'Posted by buyers', 'Money back if we cannot deliver'],
  },

  /* ── The eleven channels that had nothing ────────────────────────────────
   *
   * Counted on the built server: thirteen panels carried a banner and a colour
   * and eleven carried neither — so half the channels a member scrolls past
   * were a full-bleed branded header and half were a bare grey embed with no
   * colour bar at all. Nothing was broken; it read as unfinished, which on a
   * shop that has never taken an order is the same thing.
   *
   * Same system, same emblem set, same honesty rule this file was written for:
   * no "instant", no 24/7, no claim the shop cannot keep. Where a channel has
   * nothing true and interesting to promise, the subtitle says what the channel
   * IS rather than inventing a benefit.
   */
  {
    id: 'start-here', file: 'public/discord/banner-start-here.jpg',
    where: 'the Discord start-here channel',
    accent: '#a855f7', accent2: '#38bdf8', emblem: 'bolt',
    chip: 'NEW HERE?', title: 'START HERE',
    sub: 'What this shop is, and how an order actually works',
    pills: ['No account needed', 'Pay by reference', 'Track any time'],
  },
  {
    id: 'how-to-buy', file: 'public/discord/banner-how-to-buy.jpg',
    where: 'the Discord how-to-buy channel',
    accent: '#38bdf8', accent2: '#a855f7', emblem: 'cart',
    chip: 'FOUR STEPS', title: 'HOW TO BUY',
    sub: 'Order, pay with your order number, get your code',
    pills: ['Pick a pack', 'Pay by reference', 'We confirm', 'Code by email'],
  },
  {
    id: 'announcements', file: 'public/discord/banner-announcements.jpg',
    where: 'the Discord announcements channel',
    accent: '#6366f1', accent2: '#ec4899', emblem: 'bolt',
    chip: 'FROM THE OWNER', title: 'ANNOUNCEMENTS',
    sub: 'New products, restocks and anything that changes',
    pills: ['New products', 'Restocks', 'Downtime'],
  },
  {
    id: 'proof', file: 'public/discord/banner-proof.jpg',
    where: 'the Discord proof-of-delivery channel',
    accent: '#34d399', accent2: '#38bdf8', emblem: 'parcel',
    chip: 'RECEIPTS', title: 'PROOF OF DELIVERY',
    sub: 'Real orders, posted the moment they are delivered',
    pills: ['Order numbers', 'Timestamps', 'Posted automatically'],
  },
  {
    id: 'links', file: 'public/discord/banner-links.jpg',
    where: 'the Discord links channel',
    accent: '#818cf8', accent2: '#22d3ee', emblem: 'badge',
    chip: 'OFFICIAL ONLY', title: 'OUR LINKS',
    sub: 'Every address that is really ours — anything else is not',
    pills: ['The shop', 'This server', 'Support'],
  },
  {
    id: 'report-a-scam', file: 'public/discord/banner-report-a-scam.jpg',
    where: 'the Discord report-a-scam channel',
    accent: '#f87171', accent2: '#f59e0b', emblem: 'shield',
    chip: 'STAY SAFE', title: 'REPORT A SCAM',
    sub: 'Staff never DM you first. Report anyone who does',
    pills: ['Screenshot it', 'Do not pay', 'Tell us here'],
  },
  {
    id: 'partners', file: 'public/discord/banner-partners.jpg',
    where: 'the Discord partners channel',
    accent: '#a855f7', accent2: '#f59e0b', emblem: 'tag',
    chip: 'WORK WITH US', title: 'PARTNERS',
    sub: 'Creators and servers we actually work with',
    pills: ['Affiliate links', 'Server partners', 'Open a ticket'],
  },
  {
    id: 'roles', file: 'public/discord/banner-roles.jpg',
    where: 'the Discord roles channel',
    accent: '#22d3ee', accent2: '#6366f1', emblem: 'badge',
    chip: 'PICK YOURS', title: 'ROLES',
    sub: 'Choose what you are pinged about — and what you are not',
    pills: ['Your games', 'Drops & restocks', 'Deals'],
  },
  {
    id: 'suggestions', file: 'public/discord/banner-suggestions.jpg',
    where: 'the Discord suggestions channel',
    accent: '#34d399', accent2: '#6366f1', emblem: 'gift',
    chip: 'TELL US', title: 'SUGGESTIONS',
    sub: 'Missing a game? Ask for it here',
    pills: ['Request a product', 'Vote with a reaction', 'We read all of it'],
  },
];

/** The link-preview card is its own shape, so it is its own spec. */
export const OG = {
  id: 'og', file: 'public/og.jpg', size: '1200x630',
  where: 'the link preview on every share, and the fallback share card for any product',
  accent: '#a855f7', accent2: '#6366f1',
  title: 'Game top-ups & gift cards',
  sub: 'Robux, V-Bucks, Valorant, gift cards and more — paid with a reference, delivered to your email.',
  facts: ['Money back if we cannot deliver', 'No account needed', 'Real support on Discord'],
};
