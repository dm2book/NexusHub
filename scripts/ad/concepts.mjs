/**
 * Twenty-five short-form concepts for TikTok and YouTube Shorts.
 *
 * ── WHY THIS FILE EXISTS RATHER THAN A DOCUMENT ───────────────────────────
 * variants.mjs already knows how to cut a real purchase eight ways and, more
 * importantly, how to REFUSE: a variant declares what has to be true before it
 * may be made, and a caption token with no real value drops its whole line. A
 * concept written in a slide deck inherits none of that. Written here, every
 * one of the twenty-five is checked by the same machinery and skips itself when
 * the shop cannot back it.
 *
 * ── WHAT THE EXISTING ADVERTS GOT WRONG ───────────────────────────────────
 * The video toolkit is honest by construction. The nine STATIC creatives are
 * not, and they are the most distributed advertising this shop has — og.png is
 * the card on every shared link, and the Discord banners head every drop:
 *
 *   og.png                "Digital goods, delivered instantly" · "Instant
 *                         delivery" · "4.9/5" · "24/7 support"
 *   banner-welcome.png    "INSTANT DELIVERY" · "delivered in seconds"
 *   banner-support.png    "24/7" · "we reply fast, 24/7"
 *   banner-vouches.png    "★★★★★" · "Real buyers, real proof of delivery"
 *
 * Every one of those strings is on honest-copy.test.mjs's banned list, and the
 * shop has 0 orders and 0 reviews. They survive because the test reads .jsx and
 * .html and cannot read a PNG. So the rule for everything below: the words that
 * go on screen live in this file, in text, where the test can see them.
 *
 * ── THE RULES EVERY CONCEPT HERE OBEYS ────────────────────────────────────
 *   · Never "instant" unless {deliveryShort} resolves to it for that product.
 *   · Never a rating, a review or a customer count — there are none.
 *   · Never "cheapest" or "lowest price": market_observations is empty, so the
 *     shop has not observed a competitor price and cannot compare itself.
 *   · Never "official", "partner" or "authorised" about Roblox, EA, Epic, Sony
 *     or Microsoft. This shop is none of those things.
 *   · No manufactured urgency. A large part of this audience is under 18 and a
 *     countdown that is not counting anything is a dark pattern either way.
 *   · Per-unit claims come from {perThousand}, computed from the shop's own two
 *     prices, and never from a comparison with anyone else.
 *
 * ── SHAPE ─────────────────────────────────────────────────────────────────
 * Each concept carries the five things a short needs, kept apart on purpose:
 *
 *   hook       the first two seconds, the biggest thing on screen
 *   scenes     the script — which beats of the real recording it spends time on
 *   captions   the timed lines burnt into the video
 *   onScreen   what is on screen the whole time (price chip, handle, disclosure)
 *   cta        the last card
 *   post       the caption typed into TikTok / Shorts, and its tags
 *
 * `sku` is the product the recording must be of. `needs` is inherited from
 * variants.mjs and enforced by blockedReason().
 */

/* Scene grammar, re-used verbatim from variants.mjs so a concept and a variant
   are the same kind of thing to compose.mjs. */
export const S = {
  open: { from: 'open', to: 'shop', speed: 3.4, weight: 0.7, zoom: 'in', label: 'open' },
  browse: { from: 'shop', to: 'select', speed: 3.2, weight: 1.1, zoom: 'drift', label: 'browse' },
  toProduct: { from: 'select', to: 'product', speed: 1.6, weight: 0.7, zoom: 'punch', label: 'open product' },
  product: { from: 'product', to: 'buy', speed: 1.2, weight: 2.0, zoom: 'in', label: 'the product', price: true },
  buy: { from: 'buy', to: 'checkout', speed: 2.0, weight: 0.7, zoom: 'punch', label: 'buy' },
  checkout: { from: 'checkout', to: 'order-placed', speed: 2.8, weight: 1.0, zoom: 'in', label: 'checkout' },
  confirmed: { from: 'confirmed', to: 'delivery', speed: 1.4, weight: 1.2, zoom: 'punch', label: 'confirmed' },
  delivered: { from: 'delivery', to: 'delivered-detail', speed: 1.2, weight: 1.4, zoom: 'in', label: 'delivered' },
  goods: { from: 'delivered-detail', to: 'email-open', speed: 1.4, weight: 0.9, zoom: 'in', label: 'the goods' },
  email: { from: 'email-open', to: 'email-detail', speed: 1.2, weight: 1.8, zoom: 'punch', label: 'the email', notify: true },
  code: { from: 'email-detail', to: 'end', speed: 1.2, weight: 1.4, zoom: 'in', label: 'the code' },
};

/* Two overlays every concept carries, so neither is a per-concept decision.
   The handle is the CTA a viewer can act on without leaving the app; the
   disclosure is what keeps a paid post inside the platforms' own rules and,
   in the Netherlands, inside the Reclamecode Social Media. */
const BASE_OVERLAY = ['forgemarket.nl', '#ad · paid promotion'];

/** The five brands this set covers, and the ladder each one is cut from. */
export const BRANDS = {
  roblox: { label: 'Roblox', skus: ['ROBUX-1000', 'ROBUX-2000', 'ROBUX-4500', 'ROBUX-10000', 'ROBUX-22500'] },
  eafc: { label: 'FC Points', skus: ['EAFC-1600', 'EAFC-4600', 'EAFC-12000'] },
  vbucks: { label: 'V-Bucks', skus: ['VBUCKS-1000', 'VBUCKS-2800', 'VBUCKS-5000', 'VBUCKS-13500'] },
  psn: { label: 'PlayStation', skus: ['PSN-25'] },
  xbox: { label: 'Xbox', skus: ['XBOX-25', 'GAMEPASS-3M'] },
};

export const CONCEPTS = [
  // ══ ROBLOX ═══════════════════════════════════════════════════════════════
  // The Roblox audience is the youngest and the most scammed. Four of these
  // five lead on safety or on mechanics rather than on price, because the
  // objection here is not "is it cheap" but "is this person going to take my
  // account".
  {
    id: 'R1', brand: 'roblox', sku: 'ROBUX-4500', target: 20,
    name: 'The 5,000 a day cap, explained',
    hook: 'Why nobody can give you 10,000 Robux in one go',
    scenes: [S.toProduct, S.product, S.buy, S.confirmed, S.delivered],
    captions: [
      { at: 'the product', text: 'Roblox pays out max 5,000 R$ per account per day', style: 'big' },
      { at: 'the product', text: 'That is Roblox’s limit, not ours', style: 'small', late: true },
      { at: 'buy', text: 'So a bigger order is split across days', style: 'small' },
      { at: 'delivered', text: '{delivery}', style: 'small' },
    ],
    onScreen: ['{price}', ...BASE_OVERLAY],
    cta: 'The whole rule is on the product page · forgemarket.nl',
    post: {
      text: 'Anyone promising 10,000 Robux in one drop is telling you something Roblox does not allow. The cap is 5,000 per account per day — we split bigger orders across days and say so before you buy.',
      tags: ['#roblox', '#robux', '#robloxtips', '#fyp'],
    },
    needs: ['price', 'delivery'],
  },
  {
    id: 'R2', brand: 'roblox', sku: 'ROBUX-1000', target: 16,
    name: 'We never ask for your password',
    hook: 'If a Robux seller asks for your password, close the tab',
    scenes: [S.toProduct, S.product, S.buy, S.confirmed],
    captions: [
      { at: 'the product', text: 'Username only', style: 'big' },
      { at: 'the product', text: 'Never a password. We never log in as you.', style: 'small', late: true },
      { at: 'buy', text: '2-Step Verification stays ON', style: 'small' },
      { at: 'confirmed', text: '{delivery}', style: 'small' },
    ],
    onScreen: ['{price}', ...BASE_OVERLAY],
    cta: 'forgemarket.nl',
    post: {
      text: 'Rule of thumb for Robux: your username is enough. Anyone who needs your password or wants 2FA turned off is not topping you up, they are taking the account.',
      tags: ['#roblox', '#robux', '#robloxsafety', '#scamawareness'],
    },
    needs: ['price', 'delivery'],
  },
  {
    id: 'R3', brand: 'roblox', sku: 'ROBUX-22500', target: 18,
    name: 'The ladder, per 1,000',
    hook: 'Same Robux. Five prices. Here is the maths.',
    scenes: [S.browse, S.toProduct, S.product, S.buy, S.confirmed],
    captions: [
      { at: 'browse', text: 'Every pack, priced per 1,000', style: 'small' },
      { at: 'the product', text: '{perThousand} per 1,000', style: 'big' },
      /* Was "the biggest pack is always the cheapest per unit". The guard
         caught it and was right twice over: it reads as a comparison, and
         "always" is a promise about every ladder forever — the commercial
         audit found two rungs that were dearer per unit than the pack below
         them. State the fact the shop can keep instead. */
      { at: 'the product', text: 'Every pack shows what it costs per 1,000', style: 'small', late: true },
      { at: 'buy', text: '{price}', style: 'small' },
    ],
    onScreen: ['{perThousand} / 1,000', ...BASE_OVERLAY],
    cta: 'Compare every rung · forgemarket.nl',
    post: {
      text: 'Every Robux pack on the site shows what it costs per 1,000, so you can see the ladder instead of doing the division in your head.',
      tags: ['#roblox', '#robux', '#fyp'],
    },
    needs: ['price', 'perThousand'],
  },
  {
    id: 'R4', brand: 'roblox', sku: 'ROBUX-2000', target: 22,
    name: 'For the person paying',
    hook: 'Your kid asked for Robux. Here is exactly what happens.',
    scenes: [S.open, S.toProduct, S.product, S.buy, S.checkout, S.confirmed, S.delivered],
    captions: [
      { at: 'open', text: 'No account needed to order', style: 'small' },
      { at: 'the product', text: '{price}', style: 'big' },
      { at: 'checkout', text: 'You order first, then transfer the exact amount', style: 'small' },
      { at: 'checkout', text: 'Nothing is charged automatically', style: 'small', late: true },
      { at: 'delivered', text: '{delivery}', style: 'small' },
    ],
    onScreen: ['{price}', ...BASE_OVERLAY],
    cta: 'forgemarket.nl',
    post: {
      text: 'For the parents: no card is stored, nothing is on a subscription, and nothing leaves your account until you transfer it yourself with the order number as reference.',
      tags: ['#roblox', '#robux', '#ouders', '#parenting'],
    },
    needs: ['price', 'delivery'],
  },
  {
    id: 'R5', brand: 'roblox', sku: 'ROBUX-10000', target: 20,
    name: 'Username in, Robux out',
    hook: 'Three steps. That is the whole thing.',
    scenes: [S.toProduct, S.product, S.buy, S.checkout, S.confirmed, S.delivered, S.email],
    captions: [
      { at: 'the product', text: '1 · Turn on 2FA', style: 'small' },
      { at: 'buy', text: '2 · Send your username', style: 'small' },
      { at: 'confirmed', text: '3 · We top it up', style: 'small' },
      { at: 'the email', text: 'Order {orderNumber}', style: 'big' },
    ],
    onScreen: ['{price}', ...BASE_OVERLAY],
    cta: 'forgemarket.nl',
    post: {
      text: '2FA on, username sent, Robux delivered. No password, no logging in as you, no third-party extension touching your account.',
      tags: ['#roblox', '#robux', '#fyp'],
    },
    needs: ['price', 'order'],
  },

  // ══ FC POINTS ════════════════════════════════════════════════════════════
  // The FC audience buys around a moment — a promo, a squad, a weekend — so
  // these lead on being ready rather than on being fast, which is a promise
  // this shop can actually keep.
  {
    id: 'F1', brand: 'eafc', sku: 'EAFC-4600', target: 18,
    name: 'Points before you sit down',
    hook: 'Points in the account before the squad is even picked',
    scenes: [S.toProduct, S.product, S.buy, S.checkout, S.confirmed, S.delivered],
    captions: [
      { at: 'the product', text: '{name}', style: 'big' },
      { at: 'the product', text: '{price}', style: 'small', late: true },
      { at: 'checkout', text: 'Order now, transfer the exact amount', style: 'small' },
      { at: 'delivered', text: '{delivery}', style: 'small' },
    ],
    onScreen: ['{price}', ...BASE_OVERLAY],
    cta: 'forgemarket.nl',
    post: {
      text: 'FC Points ordered ahead of the session instead of mid-menu. We say what the delivery actually is on every product page — no promises about seconds.',
      tags: ['#eafc', '#fcpoints', '#fut', '#fifa'],
    },
    needs: ['price', 'delivery'],
  },
  {
    id: 'F2', brand: 'eafc', sku: 'EAFC-12000', target: 16,
    name: 'Three packs, one number',
    hook: '1,600 · 4,600 · 12,000 — which one is actually worth it?',
    scenes: [S.browse, S.toProduct, S.product, S.buy],
    captions: [
      { at: 'browse', text: 'Three sizes', style: 'small' },
      { at: 'the product', text: '{perThousand} per 1,000', style: 'big' },
      { at: 'the product', text: 'Shown on every pack, so you can compare', style: 'small', late: true },
      { at: 'buy', text: '{price}', style: 'small' },
    ],
    onScreen: ['{perThousand} / 1,000', ...BASE_OVERLAY],
    cta: 'forgemarket.nl',
    post: {
      text: 'The only honest way to compare point packs is per 1,000. Every FC Points pack on the site prints that number next to the price.',
      tags: ['#eafc', '#fcpoints', '#fut'],
    },
    needs: ['price', 'perThousand'],
  },
  {
    id: 'F3', brand: 'eafc', sku: 'EAFC-1600', target: 15,
    name: 'The small pack is a real pack',
    hook: 'You do not need the 12,000 pack',
    scenes: [S.toProduct, S.product, S.buy, S.confirmed],
    captions: [
      { at: 'the product', text: '{name} · {price}', style: 'big' },
      { at: 'the product', text: 'Buy the size you actually want', style: 'small', late: true },
      { at: 'buy', text: 'No minimum, no bundle you did not ask for', style: 'small' },
      { at: 'confirmed', text: '{delivery}', style: 'small' },
    ],
    onScreen: ['{price}', ...BASE_OVERLAY],
    cta: 'forgemarket.nl',
    post: {
      text: 'Smallest FC Points pack, on its own, at the price on the tin. No bundles, no minimum order.',
      tags: ['#eafc', '#fcpoints', '#fut'],
    },
    needs: ['price', 'delivery'],
  },
  {
    id: 'F4', brand: 'eafc', sku: 'EAFC-4600', target: 20,
    name: 'What you hand over: nothing',
    hook: 'What do you need from my EA account? Nothing.',
    scenes: [S.toProduct, S.product, S.buy, S.checkout, S.confirmed, S.delivered, S.email],
    captions: [
      { at: 'the product', text: 'No login. No password. No account link.', style: 'big' },
      { at: 'checkout', text: 'An email address is the whole form', style: 'small' },
      { at: 'the email', text: '{delivery}', style: 'small' },
    ],
    onScreen: ['{price}', ...BASE_OVERLAY],
    cta: 'forgemarket.nl',
    post: {
      text: 'We do not ask to log into your EA account, because we do not need to. The delivery method for every product is written on its own page before you buy.',
      tags: ['#eafc', '#fcpoints', '#fut', '#scamawareness'],
    },
    needs: ['price', 'order'],
  },
  {
    id: 'F5', brand: 'eafc', sku: 'EAFC-12000', target: 22,
    name: 'Start to finish',
    hook: 'Buying FC Points, whole thing, no cuts',
    scenes: [S.open, S.browse, S.toProduct, S.product, S.buy, S.checkout,
      S.confirmed, S.delivered, S.goods, S.email],
    captions: [
      { at: 'browse', text: 'Pick the pack', style: 'small' },
      { at: 'the product', text: '{name} · {price}', style: 'big' },
      { at: 'checkout', text: 'Order {orderNumber}', style: 'small' },
      { at: 'the email', text: 'Delivered', style: 'big' },
    ],
    onScreen: [...BASE_OVERLAY],
    cta: 'forgemarket.nl',
    post: {
      text: 'One real order, start to finish, nothing sped up past what the timestamps say.',
      tags: ['#eafc', '#fcpoints', '#fut'],
    },
    needs: ['order'],
  },

  // ══ V-BUCKS ══════════════════════════════════════════════════════════════
  // V-Bucks has the steepest ladder in the shop — the top rung is roughly half
  // the per-unit price of the bottom one — so three of these five are value
  // cuts. The number does the work; no adjective is needed.
  {
    id: 'V1', brand: 'vbucks', sku: 'VBUCKS-13500', target: 16,
    name: 'The steepest ladder in the shop',
    hook: 'The big V-Bucks pack is half the price per unit',
    scenes: [S.browse, S.toProduct, S.product, S.buy, S.confirmed],
    captions: [
      { at: 'browse', text: 'Four packs', style: 'small' },
      { at: 'the product', text: '{perThousand} per 1,000', style: 'big' },
      { at: 'the product', text: 'Every pack shows its own', style: 'small', late: true },
      { at: 'buy', text: '{price}', style: 'small' },
    ],
    onScreen: ['{perThousand} / 1,000', ...BASE_OVERLAY],
    cta: 'forgemarket.nl',
    post: {
      text: 'V-Bucks priced per 1,000 on every pack. The ladder is steep enough that it is worth a look before you buy the small one.',
      tags: ['#fortnite', '#vbucks', '#fyp'],
    },
    needs: ['price', 'perThousand'],
  },
  {
    id: 'V2', brand: 'vbucks', sku: 'VBUCKS-2800', target: 18,
    name: 'One code, every platform',
    hook: 'One code. Works on whatever you play on.',
    scenes: [S.toProduct, S.product, S.buy, S.confirmed, S.delivered, S.email, S.code],
    captions: [
      { at: 'the product', text: '{price}', style: 'big' },
      { at: 'delivered', text: 'Redeem at fortnite.com/vbuckscard', style: 'small' },
      { at: 'the code', text: 'V-Bucks are shared across every platform on that Epic account', style: 'small' },
    ],
    onScreen: ['{price}', ...BASE_OVERLAY],
    cta: 'forgemarket.nl',
    post: {
      text: 'Redeemed on your Epic account, so it does not matter which platform you play on. The steps are printed in the delivery email.',
      tags: ['#fortnite', '#vbucks', '#epicgames'],
    },
    needs: ['price', 'order'],
  },
  {
    id: 'V3', brand: 'vbucks', sku: 'VBUCKS-5000', target: 15,
    name: 'A present that is not a subscription',
    hook: 'Buying V-Bucks for someone else',
    scenes: [S.toProduct, S.product, S.buy, S.checkout, S.confirmed],
    captions: [
      { at: 'the product', text: '{price}', style: 'big' },
      { at: 'checkout', text: 'A code by email — no account of theirs needed', style: 'small' },
      { at: 'confirmed', text: 'Nothing renews behind anyone’s back', style: 'small' },
    ],
    onScreen: ['{price}', ...BASE_OVERLAY],
    cta: 'forgemarket.nl',
    post: {
      text: 'A code you can forward. No subscription, no card on file, nothing that renews next month.',
      tags: ['#fortnite', '#vbucks', '#cadeau', '#gift'],
    },
    needs: ['price'],
  },
  {
    id: 'V4', brand: 'vbucks', sku: 'VBUCKS-1000', target: 16,
    name: 'Nothing leaves your account first',
    hook: 'You press Buy and nothing is charged. On purpose.',
    scenes: [S.toProduct, S.product, S.buy, S.checkout, S.confirmed],
    captions: [
      { at: 'the product', text: '{price}', style: 'big' },
      { at: 'buy', text: 'You order first', style: 'small' },
      { at: 'checkout', text: 'Then you transfer the exact amount, with your order number', style: 'small' },
      { at: 'confirmed', text: 'Money back in full if we cannot deliver', style: 'small' },
    ],
    onScreen: ['{price}', ...BASE_OVERLAY],
    cta: 'forgemarket.nl',
    post: {
      text: 'No card details are stored on the site. You place the order, then you decide to pay it. If we cannot deliver, you get all of it back.',
      tags: ['#fortnite', '#vbucks', '#fyp'],
    },
    needs: ['price'],
  },
  {
    id: 'V5', brand: 'vbucks', sku: 'VBUCKS-13500', target: 22,
    name: 'Start to finish',
    hook: 'V-Bucks, ordered and delivered, in one take',
    scenes: [S.open, S.browse, S.toProduct, S.product, S.buy, S.checkout,
      S.confirmed, S.delivered, S.goods, S.email, S.code],
    captions: [
      { at: 'the product', text: '{name} · {price}', style: 'big' },
      { at: 'checkout', text: 'Order {orderNumber}', style: 'small' },
      { at: 'the email', text: 'Delivered', style: 'big' },
      { at: 'the code', text: 'Redeem at fortnite.com/vbuckscard', style: 'small' },
    ],
    onScreen: [...BASE_OVERLAY],
    cta: 'forgemarket.nl',
    post: {
      text: 'The whole purchase, uncut. The code in the frame is masked; everything else is the real order.',
      tags: ['#fortnite', '#vbucks', '#fyp'],
    },
    needs: ['order'],
  },

  // ══ PLAYSTATION ══════════════════════════════════════════════════════════
  // There is exactly ONE PSN product in the catalogue: PSN-25. None of these
  // may imply a range, a region or a denomination the shop does not stock.
  {
    id: 'P1', brand: 'psn', sku: 'PSN-25', target: 15,
    name: 'A code, not your account',
    hook: 'We never touch your PlayStation account',
    scenes: [S.toProduct, S.product, S.buy, S.confirmed, S.delivered],
    captions: [
      { at: 'the product', text: '{name} · {price}', style: 'big' },
      { at: 'the product', text: 'A code by email. No login, no account link.', style: 'small', late: true },
      { at: 'delivered', text: '{delivery}', style: 'small' },
    ],
    onScreen: ['{price}', ...BASE_OVERLAY],
    cta: 'forgemarket.nl',
    post: {
      text: 'A PlayStation Store code arrives by email and you redeem it yourself. Nobody needs to sign in as you.',
      tags: ['#playstation', '#psn', '#ps5'],
    },
    needs: ['price', 'delivery'],
  },
  {
    id: 'P2', brand: 'psn', sku: 'PSN-25', target: 18,
    name: 'What a card actually is',
    hook: 'A PSN card is store credit. That is the whole product.',
    scenes: [S.toProduct, S.product, S.buy, S.checkout, S.confirmed],
    captions: [
      { at: 'the product', text: '{price}', style: 'big' },
      { at: 'the product', text: 'Games, DLC, whatever the store sells', style: 'small', late: true },
      { at: 'checkout', text: 'No subscription attached', style: 'small' },
      { at: 'confirmed', text: '{delivery}', style: 'small' },
    ],
    onScreen: ['{price}', ...BASE_OVERLAY],
    cta: 'forgemarket.nl',
    post: {
      text: 'Store credit, redeemed by you, spent on whatever you like. Nothing renews and nothing is on a card.',
      tags: ['#playstation', '#psn', '#ps5', '#gaming'],
    },
    needs: ['price', 'delivery'],
  },
  {
    id: 'P3', brand: 'psn', sku: 'PSN-25', target: 15,
    name: 'The gift that needs no account',
    hook: 'Buying for someone whose account you do not have',
    scenes: [S.toProduct, S.product, S.buy, S.checkout, S.confirmed],
    captions: [
      { at: 'the product', text: '{price}', style: 'big' },
      { at: 'checkout', text: 'Their email, or yours — forward it either way', style: 'small' },
      { at: 'confirmed', text: 'You never need their password', style: 'small' },
    ],
    onScreen: ['{price}', ...BASE_OVERLAY],
    cta: 'forgemarket.nl',
    post: {
      text: 'A code you can forward. You do not need their login and neither do we.',
      tags: ['#playstation', '#psn', '#cadeau', '#gift'],
    },
    needs: ['price'],
  },
  {
    id: 'P4', brand: 'psn', sku: 'PSN-25', target: 18,
    name: 'Who is actually selling this',
    hook: 'Who is behind the shop you are about to pay?',
    scenes: [S.open, S.toProduct, S.product, S.buy, S.confirmed],
    captions: [
      { at: 'open', text: 'One person, in the Netherlands', style: 'big' },
      { at: 'open', text: 'Name and contact on every page', style: 'small', late: true },
      { at: 'the product', text: '{price}', style: 'small' },
      { at: 'buy', text: 'You pay after ordering. Nothing is charged automatically.', style: 'small' },
    ],
    onScreen: ['{price}', ...BASE_OVERLAY],
    cta: 'Read the whole thing · forgemarket.nl',
    post: {
      text: 'The shop says who runs it, where from, and what it is not — including that it is not a registered company yet. That page is linked from every product.',
      tags: ['#playstation', '#psn', '#webshop'],
    },
    needs: ['price'],
  },
  {
    id: 'P5', brand: 'psn', sku: 'PSN-25', target: 20,
    name: 'Start to finish',
    hook: 'PSN card, ordered and in the inbox',
    scenes: [S.toProduct, S.product, S.buy, S.checkout, S.confirmed, S.delivered, S.email, S.code],
    captions: [
      { at: 'the product', text: '{name} · {price}', style: 'big' },
      { at: 'checkout', text: 'Order {orderNumber}', style: 'small' },
      { at: 'the email', text: 'Delivered', style: 'big' },
      { at: 'the code', text: 'Redeem it yourself', style: 'small' },
    ],
    onScreen: [...BASE_OVERLAY],
    cta: 'forgemarket.nl',
    post: {
      text: 'One real order. The code is masked in the frame — everything else is exactly what happened.',
      tags: ['#playstation', '#psn', '#ps5'],
    },
    needs: ['order'],
  },

  // ══ XBOX ═════════════════════════════════════════════════════════════════
  // Xbox has two products: a €25 card and Game Pass Ultimate 3 months. The Game
  // Pass angle is the strongest one in the whole set — it is a code the buyer
  // redeems, so nothing renews, which is the exact opposite of how Game Pass is
  // normally sold. That is the shop's own line, not a comparison with Microsoft.
  {
    id: 'X1', brand: 'xbox', sku: 'GAMEPASS-3M', target: 18,
    name: 'Nothing renews behind your back',
    hook: 'Three months of Game Pass that cannot auto-renew',
    scenes: [S.toProduct, S.product, S.buy, S.checkout, S.confirmed, S.delivered],
    captions: [
      { at: 'the product', text: '{name}', style: 'big' },
      { at: 'the product', text: 'Bought as a code you redeem yourself', style: 'small', late: true },
      { at: 'checkout', text: 'No card on file. Nothing renews.', style: 'small' },
      { at: 'delivered', text: '{delivery}', style: 'small' },
    ],
    onScreen: ['{price}', ...BASE_OVERLAY],
    cta: 'forgemarket.nl',
    post: {
      text: 'A code, not a subscription. It runs out instead of quietly charging you for a fourth month.',
      tags: ['#xbox', '#gamepass', '#xboxgamepass'],
    },
    needs: ['price', 'delivery'],
  },
  {
    id: 'X2', brand: 'xbox', sku: 'XBOX-25', target: 15,
    name: 'Credit, redeemed by you',
    hook: 'An Xbox card is credit you spend, not an account we touch',
    scenes: [S.toProduct, S.product, S.buy, S.confirmed, S.delivered],
    captions: [
      { at: 'the product', text: '{name} · {price}', style: 'big' },
      { at: 'the product', text: 'Games and add-ons across Xbox and PC', style: 'small', late: true },
      { at: 'delivered', text: '{delivery}', style: 'small' },
    ],
    onScreen: ['{price}', ...BASE_OVERLAY],
    cta: 'forgemarket.nl',
    post: {
      text: 'A code by email that you redeem on your own account. We never sign in anywhere.',
      tags: ['#xbox', '#xboxseriesx', '#gaming'],
    },
    needs: ['price', 'delivery'],
  },
  {
    id: 'X3', brand: 'xbox', sku: 'GAMEPASS-3M', target: 16,
    name: 'The subscription you can end by doing nothing',
    hook: 'The only way to cancel it is to not buy another one',
    scenes: [S.toProduct, S.product, S.buy, S.confirmed],
    captions: [
      { at: 'the product', text: '{price} · three months', style: 'big' },
      { at: 'buy', text: 'No card stored on this site', style: 'small' },
      { at: 'confirmed', text: 'It ends by itself', style: 'small' },
    ],
    onScreen: ['{price}', ...BASE_OVERLAY],
    cta: 'forgemarket.nl',
    post: {
      text: 'No cancel button to hunt for, because there is nothing to cancel.',
      tags: ['#xbox', '#gamepass', '#fyp'],
    },
    needs: ['price'],
  },
  {
    id: 'X4', brand: 'xbox', sku: 'XBOX-25', target: 18,
    name: 'What happens if it does not arrive',
    hook: 'What if you pay and nothing shows up?',
    scenes: [S.toProduct, S.product, S.buy, S.checkout, S.confirmed, S.delivered],
    captions: [
      { at: 'the product', text: '{price}', style: 'big' },
      { at: 'checkout', text: 'Money back in full if we cannot deliver', style: 'small' },
      { at: 'confirmed', text: 'And you can still cancel until it is delivered', style: 'small' },
      { at: 'delivered', text: 'A real person answers the email', style: 'small' },
    ],
    onScreen: ['{price}', ...BASE_OVERLAY],
    cta: 'The refund page says it in writing · forgemarket.nl',
    post: {
      text: 'It is on the refund page in writing, not offered as a favour: if the order cannot be delivered you get all of it back, and until it is delivered you can cancel.',
      tags: ['#xbox', '#gaming', '#webshop'],
    },
    needs: ['price', 'delivery'],
  },
  {
    id: 'X5', brand: 'xbox', sku: 'GAMEPASS-3M', target: 22,
    name: 'Start to finish',
    hook: 'Game Pass, ordered and redeemed, no cuts',
    scenes: [S.open, S.browse, S.toProduct, S.product, S.buy, S.checkout,
      S.confirmed, S.delivered, S.goods, S.email, S.code],
    captions: [
      { at: 'browse', text: 'Subscriptions, bought as codes', style: 'small' },
      { at: 'the product', text: '{name} · {price}', style: 'big' },
      { at: 'checkout', text: 'Order {orderNumber}', style: 'small' },
      { at: 'the email', text: 'Delivered', style: 'big' },
    ],
    onScreen: [...BASE_OVERLAY],
    cta: 'forgemarket.nl',
    post: {
      text: 'One real order from the shop front to the code in the inbox.',
      tags: ['#xbox', '#gamepass', '#fyp'],
    },
    needs: ['order'],
  },
];

export const conceptById = (id) =>
  CONCEPTS.find((c) => c.id.toUpperCase() === String(id).toUpperCase()) || null;

export const conceptsForBrand = (brand) =>
  CONCEPTS.filter((c) => c.brand === String(brand).toLowerCase());
