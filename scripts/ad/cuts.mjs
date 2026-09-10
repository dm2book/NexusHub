#!/usr/bin/env node
/**
 * Ten adverts out of one purchase, composed rather than written.
 *
 * The brief is ten cuts of the same real recording — three that differ only in
 * pace (8s ultra-fast, 10s balanced, 12s cinematic) and seven that differ in
 * what they lean on (price, speed, product, checkout, the email, "watch me buy
 * this", clean premium). Written out longhand that is ten more variant literals
 * in variants.mjs, each one a place for the flow to drift out of step with the
 * other nine — which is the bug this codebase keeps shipping: the same rule in
 * two files, then in three.
 *
 * So a cut is not written here. It is COMPOSED from two tables:
 *
 *   PACE   how fast the edit moves — running time, end-card hold, how hard the
 *          zooms push, when frames are averaged, which cuts are thrown, how
 *          hard the flash on a cut lands
 *   FOCUS  what it leans on — which beats get the weight, which opening line it
 *          uses, and which beats speak
 *
 * Ten declarations at the bottom are then ten pairs. Change how a payment beat
 * should be cut and all ten change together, because there is one of it.
 *
 * WHAT IS IDENTICAL ACROSS ALL TEN, ON PURPOSE:
 *
 *   the recording       one real purchase, filmed once
 *   the beats           product → buy → checkout → payment → delivered →
 *                       email → code, in that order, every time
 *   the honesty gate    the opening comes out of hooks.mjs and every caption
 *                       goes through fill(), so a line whose token has no real
 *                       value removes itself here exactly as it does everywhere
 *
 * Only montage, hook, timing, zooms, transitions, captions and the closing line
 * differ — which is the whole brief, and also the only part of an advert that
 * may differ when the thing being advertised is a single real purchase.
 */
import { S } from './variants.mjs';
import { hookById } from './hooks.mjs';

/* The flow. One skeleton, seven beats, shared by every cut — cloned from the
   scene grammar rather than restated, so there is one definition of what a
   payment beat is. */
export const SKELETON = [S.pHook, S.pBuy, S.pCheckout, S.pPay, S.pMail, S.pArrive, S.pReveal];

/** Calmer equivalents, for a pace that does not want to be thrown around. */
const CALM = { punch: 'in', in: 'in', drift: 'drift', focus: 'focus' };

/**
 * How fast the edit moves.
 *
 * `ceiling` scales every scene's speed LIMIT rather than its speed. The
 * resolver treats speed as a ceiling and gives a scene the larger of its share
 * and its fastest ramp, so raising the ceiling lets a scene be squeezed and
 * lowering it forces the scene to sit closer to real time. That one number is
 * the difference between ultra-fast and cinematic; everything else is polish.
 */
export const PACES = {
  ultra: {
    name: 'ultra-fast',
    target: 8, card: 0.9, ceiling: 1.55, zoomScale: 3.4, blurAt: 1.3, flash: 0.62,
    /* Every cut thrown but the last. At eight seconds a cut lands about every
       second, and a white flash on each of them is the same punctuation seven
       times — the eye stops reading it after the third. */
    whip: (n) => [...Array(Math.max(0, n - 1)).keys()],
    blurAll: true,
  },
  balanced: {
    name: 'balanced',
    target: 10, card: 1.4, ceiling: 1, zoomScale: 3, blurAt: 1.6, flash: 0.55,
    // Buy, payment and the mail landing — the three moments worth throwing to.
    whip: () => [1, 3, 4],
  },
  cinematic: {
    name: 'cinematic',
    target: 12, card: 2.0, ceiling: 0.7, zoomScale: 1.6, blurAt: 2.4, flash: 0.22,
    /* No throws and a flash at a fifth of the usual weight. A hard white frame
       on every cut is the opposite of cinematic, and at this pace the scenes
       are long enough that a cut does not need announcing. */
    whip: () => [],
    calm: true,
  },
};

/**
 * What the cut leans on.
 *
 * `weight` multiplies a scene's share of the running time — the montage. `hook`
 * names an opening out of hooks.mjs, so the opening line is gated by the same
 * rule as everything else: no real value, no hook, no advert. `say` picks which
 * beats speak.
 */
export const FOCUS = {
  flow: {
    name: 'the whole flow', hook: 'product-price',
    weight: {}, say: ['buy', 'payment', 'email'],
  },
  price: {
    /* No price badge: the hook already IS the price, and the first cut of this
       one put €11.99 in the headline and again on the badge in the same frame.
       The badge belongs to a cut whose opening does not say the number. */
    name: 'the price', hook: 'price',
    weight: { 'the product': 2.0 }, say: ['buy', 'payment'],
    extra: [{ at: 'the product', text: '{name}', style: 'small', late: true }],
  },
  speed: {
    name: 'the delivery', hook: 'speed',
    weight: { payment: 1.5, delivered: 1.9 }, say: ['payment', 'email'],
    // The shop's own promise for THIS product, never a number of our own.
    extra: [{ at: 'delivered', text: '{delivery}', style: 'small' }],
  },
  product: {
    name: 'the product', hook: 'product', priceCard: true,
    weight: { 'the product': 2.4 }, say: ['buy', 'payment', 'email'],
    extra: [{ at: 'the product', text: '{name} — {price}', style: 'small', late: true }],
  },
  checkout: {
    name: 'the checkout', hook: 'no-account',
    weight: { buy: 1.6, checkout: 2.6 }, say: ['payment', 'email'],
    extra: [{ at: 'checkout', text: 'E-mail invullen en betalen', style: 'small' }],
  },
  email: {
    name: 'the delivery mail', hook: 'click-to-code',
    weight: { 'the email': 1.9, 'the code': 1.4 }, say: ['payment', 'email'],
    extra: [{ at: 'delivered', text: 'Naar de inbox', style: 'small' }],
  },
  watch: {
    name: 'watch me buy this', hook: 'watch-me',
    weight: { buy: 1.9, checkout: 1.5 }, say: ['payment', 'email'],
    extra: [{ at: 'buy', text: 'Kopen', style: 'small' }],
  },
  clean: {
    name: 'clean premium', hook: 'product',
    /* Two long shots and almost nothing said. The restraint IS the format, so
       the captions are the thing to cut, not the running time. */
    weight: { 'the product': 1.6, 'the code': 1.7 }, say: ['email'],
  },
};

/* What each beat says, in one place, so ten cuts cannot disagree about the
   same moment. Every line here is something the footage shows: guest checkout
   is on camera, "Betaald" is the state the order reaches, "Geleverd" is the
   word the order page itself uses. */
const LINES = {
  buy: { at: 'buy', text: 'Geen account nodig', style: 'small' },
  checkout: { at: 'checkout', text: 'Afrekenen', style: 'small' },
  payment: { at: 'payment', text: 'Betaald', style: 'small' },
  delivered: { at: 'delivered', text: 'Geleverd', style: 'small' },
  email: { at: 'the email', text: 'Je bestelling van ForgeMarket', sub: 'in je inbox', style: 'notify' },
};

const tokensIn = (s) => [...String(s || '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

/**
 * A pace and a focus, composed into something compose.mjs already understands.
 *
 * The result is variant-shaped on purpose: every knob it sets is one that
 * existed before this file, so nothing downstream had to learn a new word.
 */
export function buildCut({ id, slug, name, pace, focus, close, card, hook }) {
  const P = PACES[pace]; const F = FOCUS[focus];
  if (!P) throw new Error(`no pace "${pace}"`);
  if (!F) throw new Error(`no focus "${focus}"`);
  const opening = hookById(hook || F.hook);
  if (!opening) throw new Error(`no hook "${hook || F.hook}" for cut ${id}`);

  const scenes = SKELETON.map((s) => {
    const lean = F.weight[s.label] ?? 1;
    return {
      ...s,
      weight: +((s.weight || 1) * lean).toFixed(3),
      /* Leaning on a beat buys it slack as well as budget.
         A bigger share alone does nothing to a scene already sitting at its
         speed ceiling — and on real footage most of them are, because the
         ceiling is what stops a six-second wait becoming the whole advert.
         Measured on the real recording: the speed cut and the balanced cut both
         spent 1.6s on the delivery, because doubling the weight of a
         ceiling-pinned scene changes nothing at all. Dividing the ceiling by
         the root of the lean lets that scene run closer to real time, which is
         what "focus on this beat" was supposed to mean. */
      speed: +((s.speed || 1) * P.ceiling / Math.sqrt(lean)).toFixed(2),
      zoom: P.calm ? (CALM[s.zoom] ?? s.zoom) : s.zoom,
      ...(P.blurAll ? { blur: true } : {}),
    };
  });

  const captions = [
    ...F.say.map((k) => LINES[k]).filter(Boolean),
    ...(F.extra || []),
    // The closing line is the cut's own, because it is the one part a brief
    // names per advert rather than per format.
    { at: 'the code', text: close, style: 'big' },
  ];

  /* Derived, never hand-maintained: whatever the opening and the captions
     actually ask for, plus the completed order every one of these walks to.
     A list typed out by hand is a list that goes stale the first time a line
     changes, and the failure is an advert making a claim nothing checked. */
  const needs = [...new Set([
    ...opening.needs,
    ...captions.flatMap((c) => [...tokensIn(c.text), ...tokensIn(c.sub)]),
    'order',
  ])];

  return {
    id, slug, name, lang: 'nl', family: 'cut', pace, focus,
    target: P.target, card: card ?? P.card,
    zoomScale: P.zoomScale, blurAt: P.blurAt, flash: P.flash,
    whipAt: P.whip(scenes.length),
    priceCard: F.priceCard === true,
    scenes,
    hook: opening.text, hookSub: opening.sub, hookId: opening.id,
    captions, cta: 'forgemarket.nl', needs,
  };
}

/**
 * The ten.
 *
 * Three paces of the same flow, then seven leans on it. Readable as a table
 * because that is all a cut is: a pace, a focus, and the line it ends on.
 */
export const CUTS = [
  { id: 'A', slug: 'ultra-fast', name: 'Ultra-fast (8s)', pace: 'ultra', focus: 'flow', close: 'Klaar.' },
  { id: 'B', slug: 'balanced', name: 'Balanced (10s)', pace: 'balanced', focus: 'flow', close: 'Je code. Klaar.' },
  { id: 'C', slug: 'cinematic', name: 'Cinematic (12s)', pace: 'cinematic', focus: 'flow', close: 'Van klik tot code.' },
  { id: 'D', slug: 'price', name: 'Price-focused', pace: 'balanced', focus: 'price', close: '{price}. Meer wordt het niet.' },
  { id: 'E', slug: 'speed', name: 'Speed-focused', pace: 'balanced', focus: 'speed', close: '{deliveryShort}' },
  { id: 'F', slug: 'product', name: 'Product-focused', pace: 'balanced', focus: 'product', close: '{name}' },
  { id: 'G', slug: 'checkout', name: 'Checkout-focused', pace: 'balanced', focus: 'checkout', close: 'Geen account. Gewoon je code.' },
  { id: 'H', slug: 'email', name: 'Email-delivery-focused', pace: 'balanced', focus: 'email', close: 'In je mail. Klaar.' },
  { id: 'I', slug: 'watch-me-buy', name: 'Watch me buy this', pace: 'balanced', focus: 'watch', close: 'Zo koop je het.' },
  /* The closing line is a quiet one and the CALL TO ACTION is the end card,
     which at this pace holds for two seconds — the longest of the ten. Closing
     on the domain would have put it in the caption, in the corner tag and on
     the card within the same second, which is the opposite of premium. */
  { id: 'J', slug: 'clean-premium', name: 'Clean premium', pace: 'cinematic', focus: 'clean', close: 'Geleverd.' },
].map(buildCut);

/* Its own lookup, and deliberately not merged with variantById: A–H and J are
   taken in variants.mjs, and a shop that asks for "A" and silently gets the
   16-second price-hook variant instead of the 8-second cut is exactly the kind
   of quiet wrong answer this toolkit is built to avoid. `--cut=` addresses
   this table; `--variant=` addresses that one. */
export const cutById = (id) =>
  CUTS.find((c) => c.id.toUpperCase() === String(id).toUpperCase()
    || c.slug === String(id).toLowerCase()) || null;
