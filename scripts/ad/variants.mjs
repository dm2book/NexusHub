/**
 * Eight ways to cut the same real purchase.
 *
 * One recording per product, eight edits — not eight purchases. The footage is
 * the same honest walk through the shop; what changes is which beats the edit
 * spends its twenty seconds on, what the captions say, and where the hook lands.
 *
 * Every variant declares what it NEEDS to be true. A variant that claims a
 * delivery needs a completed order; one that quotes a customer needs a
 * published review; one that says "almost gone" needs the stock number to
 * actually say so. When the requirement is not met the variant is skipped with
 * a reason, because the alternative is an advert that lies about a shop whose
 * whole pitch is that it does not.
 *
 * Captions are written as templates with {tokens}. A token with no real value
 * drops the whole line rather than rendering a gap or a guess.
 */

/** Tokens available to every caption, resolved from real data only. */
export function tokensFor({ product, order, review, stock, mystery }) {
  /* Formatted the way the storefront formats it — the caption sits beside a
     page showing that exact number, and "€ 9,99" next to "€9.99" reads as a
     different price. This is the same locale the site's money() uses. */
  const money = (c, cur = 'EUR') => new Intl.NumberFormat('en-IE',
    { style: 'currency', currency: cur }).format((c || 0) / 100);
  return {
    name: product?.name || null,
    price: product?.price ? money(product.price, product.currency) : null,
    // Only what the shop itself promises for THIS product. `instant` is true
    // only when it auto-delivers and a code is on the shelf right now.
    delivery: product?.instant === true ? 'Sent the moment your payment clears'
      : product?.instant === false ? 'Bought in for you, delivered by hand' : null,
    deliveryShort: product?.instant === true ? 'Instant' : product?.instant === false ? 'By hand' : null,
    orderNumber: order?.number || null,
    // 1–6 only: the server hides anything higher, so a bigger number here would
    // be one this shop never publishes.
    stockLeft: Number.isFinite(stock) && stock > 0 && stock <= 6 ? String(stock) : null,
    reviewBody: review?.body ? `“${String(review.body).slice(0, 90)}”` : null,
    reviewAuthor: review?.author || null,
    reviewStars: review?.stars ? '★'.repeat(Math.round(review.stars)) : null,
    prize: mystery?.label || null,
    prizeValue: mystery?.credit ? money(mystery.credit) : null,
    /* What this pack costs per 1,000 units, from the shop's own two numbers.
       It is how this market compares before it buys, and it is the only
       comparison this shop is entitled to make: market_observations is empty,
       so nothing here may be measured against a competitor. Null for anything
       that is not a countable pack — a €25 card is priced in euros, and "3
       Months" is not three of something. */
    perThousand: (() => {
      const n = String(product?.name || '');
      if (!product?.price || /€/.test(n)) return null;
      const m = /^([\d.,]+)\s+\S/.exec(n);
      const units = m ? Number(m[1].replace(/[.,]/g, '')) : 0;
      if (!units || units < 100) return null;
      return money(Math.round((product.price / units) * 1000), product.currency);
    })(),
  };
}

/** Fill a caption template, or return null when any token has no real value. */
export function fill(template, tokens) {
  if (!template) return null;
  let out = template;
  for (const m of template.matchAll(/\{(\w+)\}/g)) {
    const v = tokens[m[1]];
    if (v === null || v === undefined || v === '') return null;   // no guessing
    out = out.replaceAll(m[0], v);
  }
  return out;
}

/**
 * Scene grammar shared by most variants.
 *
 * `at` is the beat the scene starts on and `to` where it ends; `weight` is its
 * share of the running time; `speed` is the fastest it may be played. compose.mjs
 * resolves these against the beats the recorder actually marked.
 */
const S = {
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
  /* The money moving. The grammar went straight from checkout to confirmed, so
     the one beat between placing an order and it existing — the payment — was
     never a scene anything could be pinned to. */
  pay: { from: 'order-placed', to: 'confirmed', speed: 1.8, weight: 1.1, zoom: 'punch', label: 'payment' },
};

/**
 * The first two seconds decide whether the rest is watched, so every variant
 * opens on a different promise — and each promise is one this shop can keep.
 */
export const VARIANTS = [
  {
    id: 'A',
    slug: 'price-hook',
    name: 'Price hook',
    target: 16,
    // Leads on the number, then proves it by buying at that number.
    scenes: [S.toProduct, S.product, S.buy, S.checkout, S.confirmed, S.delivered],
    hook: '{name} for {price}',
    captions: [
      { at: 'the product', text: '{price}. That is the price you pay.', style: 'big' },
      { at: 'buy', text: 'No account needed to order', style: 'small' },
      { at: 'confirmed', text: 'Ordered', style: 'small' },
      { at: 'delivered', text: '{delivery}', style: 'small' },
    ],
    cta: 'forgemarket.nl',
    needs: ['price'],
  },
  {
    id: 'B',
    slug: 'speed-hook',
    name: 'Speed / delivery hook',
    target: 18,
    scenes: [S.product, S.buy, S.checkout, S.confirmed, S.delivered, S.email, S.code],
    hook: '{deliveryShort}. Watch.',
    captions: [
      { at: 'buy', text: 'Ordering…', style: 'small' },
      { at: 'confirmed', text: 'Paid', style: 'small' },
      { at: 'the email', text: 'And it is in the inbox', style: 'big' },
      { at: 'the code', text: '{delivery}', style: 'small' },
    ],
    cta: 'forgemarket.nl',
    // The claim IS the delivery, so it has to have happened.
    needs: ['delivery', 'order'],
  },
  {
    id: 'C',
    slug: 'showcase',
    name: 'Product showcase',
    target: 15,
    /* The showcase ends on the product being bought, not just admired. Four
       scenes of catalogue and product page came in at 13.5 seconds — under the
       floor — and padding the end card to cover it would have been brand time
       standing in for content. This is a second more of the real thing. */
    scenes: [S.open, S.browse, S.toProduct, S.product, S.buy, S.confirmed],
    hook: '{name}',
    captions: [
      { at: 'browse', text: 'Top-ups, gift cards, subscriptions', style: 'small' },
      { at: 'the product', text: '{price}', style: 'big' },
      { at: 'the product', text: '{delivery}', style: 'small', late: true },
    ],
    cta: 'forgemarket.nl',
    needs: ['price'],
  },
  {
    id: 'D',
    slug: 'problem-solution',
    name: 'Problem → solution',
    target: 18,
    scenes: [S.open, S.toProduct, S.product, S.buy, S.checkout, S.confirmed, S.delivered],
    hook: 'Topping up should not be this hard',
    captions: [
      { at: 'open', text: 'No account. No waiting for a reply.', style: 'small' },
      { at: 'the product', text: '{price}', style: 'big' },
      /* This said "Pay with iDEAL". Whether iDEAL is offered depends on what
         the owner has enabled at Mollie — availableMethods() intersects the
         shop's list with what the account really returns — and with no provider
         configured the shop pays by transfer. An advert is the last place to
         name a method the checkout might not show. */
      { at: 'checkout', text: 'You transfer the exact amount shown', style: 'small' },
      { at: 'delivered', text: '{delivery}', style: 'small' },
    ],
    cta: 'forgemarket.nl',
    needs: ['price'],
  },
  {
    id: 'E',
    slug: 'purchase-demo',
    name: 'Website purchase demo',
    target: 22,
    // The full walk — this is the one that shows the whole thing end to end.
    scenes: [S.open, S.browse, S.toProduct, S.product, S.buy, S.checkout,
      S.confirmed, S.delivered, S.goods, S.email, S.code],
    hook: 'Buying on ForgeMarket, start to finish',
    captions: [
      { at: 'browse', text: 'Pick your game', style: 'small' },
      { at: 'the product', text: '{name} · {price}', style: 'big' },
      { at: 'checkout', text: 'Checkout', style: 'small' },
      { at: 'confirmed', text: 'Order {orderNumber}', style: 'small' },
      { at: 'the email', text: 'Delivered', style: 'big' },
    ],
    cta: 'forgemarket.nl',
    needs: ['order'],
  },
  {
    id: 'F',
    slug: 'customer-proof',
    name: 'Customer proof',
    target: 18,
    scenes: [S.toProduct, S.product, S.confirmed, S.delivered, S.email],
    // The quote occupies the space the price badge wants; one message per shot.
    priceCard: false,
    hook: '{reviewStars} from a real order',
    captions: [
      { at: 'the product', text: '{reviewBody}', style: 'quote' },
      { at: 'confirmed', text: '— {reviewAuthor}', style: 'small' },
      { at: 'delivered', text: 'Reviews are tied to real orders', style: 'small' },
      { at: 'the email', text: 'Every one of them', style: 'small' },
    ],
    cta: 'forgemarket.nl',
    // A published, verified review or nothing — this shop does not write its own.
    needs: ['review'],
  },
  {
    id: 'G',
    slug: 'low-stock',
    name: 'Restock / limited availability',
    target: 15,
    scenes: [S.browse, S.toProduct, S.product, S.buy, S.confirmed],
    hook: 'Only {stockLeft} left',
    captions: [
      { at: 'the product', text: '{name} · {price}', style: 'big' },
      { at: 'the product', text: '{stockLeft} in stock right now', style: 'small', late: true },
      { at: 'buy', text: '{delivery}', style: 'small' },
    ],
    cta: 'forgemarket.nl',
    /* The number has to be real and low. The storefront only ever publishes a
       count of six or fewer, so anything else here would be a scarcity claim
       the shop itself refuses to make. */
    needs: ['stockLeft'],
  },
  {
    id: 'H',
    slug: 'mystery-reveal',
    name: 'Mystery box reveal',
    target: 18,
    scenes: [S.toProduct, S.product, S.buy, S.checkout, S.confirmed, S.delivered, S.email],
    hook: 'Opening a {price} mystery box',
    captions: [
      { at: 'the product', text: 'Every box wins something', style: 'small' },
      { at: 'checkout', text: 'Opening…', style: 'small' },
      { at: 'confirmed', text: '{prize}', style: 'big' },
      { at: 'delivered', text: 'Paid out as store credit', style: 'small' },
    ],
    cta: 'forgemarket.nl',
    // A real box, really opened, with the prize it really rolled.
    needs: ['mystery', 'order'],
  },
  {
    id: 'W',
    slug: 'workflow',
    name: 'The workflow',
    target: 20,
    /* Product → Checkout → Payment → Email delivery → Success, and nothing
       else. No shop front, no browsing: this cut starts on the thing being
       bought and spends every second it has on the five steps between wanting
       it and having it.
       Weights are the argument. The product and the email arrival carry the
       most because they are the two frames that decide anything — one is what
       you get, the other is proof you got it — and the three steps between them
       are the mechanics, which have to be legible but not lingered on. */
    /* Its own pacing, not the shared defaults.
       On the shared speeds this cut opened on a 4.2-second product shot and did
       not reach its first flash until then — a "fast" advert whose first four
       seconds hold still. Each scene here carries the ramp it needs to compress
       into the share the weights give it: the mechanics run at 2.4–3.4× and land
       at roughly two seconds each, and the email is the only scene played at
       real time, because the arrival is the payoff and speeding it up throws
       away the thing the other fifteen seconds were spent earning. */
    scenes: [
      { ...S.product, speed: 1.9, weight: 1.0 },
      { ...S.buy, speed: 2.4, weight: 0.5 },
      { ...S.checkout, speed: 3.4, weight: 0.85 },
      { ...S.pay, speed: 2.6, weight: 0.95 },
      { ...S.confirmed, speed: 3.2, weight: 0.7 },
      { ...S.email, speed: 1.0, weight: 2.3 },
      { ...S.code, speed: 1.35, weight: 1.2 },
    ],
    hook: '{name}. Ordered and delivered.',
    captions: [
      { at: 'the product', text: '{price}', style: 'big' },
      { at: 'buy', text: 'Add to cart', style: 'small' },
      { at: 'checkout', text: 'Checkout — no account needed', style: 'small' },
      { at: 'payment', text: 'You transfer the exact amount shown', style: 'small' },
      { at: 'confirmed', text: 'Order {orderNumber}', style: 'small' },
      /* The one caption in the whole toolkit that slides instead of fading.
         compose.mjs walks it in from off-frame and lifts the recording under it
         for two tenths at the same moment — the arrival IS the beat, and the
         notify sound is already timed to land on it. */
      { at: 'the email', text: 'Your order from ForgeMarket', sub: 'to your inbox', style: 'notify' },
      { at: 'the code', text: '{delivery}', style: 'small' },
    ],
    cta: 'forgemarket.nl',
    /* It claims a delivery, so a delivery has to have happened. Without a
       completed order this variant does not get made — which is the whole
       point of it existing in this file rather than in a brief. */
    needs: ['price', 'order', 'delivery'],
  },
];

export const variantById = (id) =>
  VARIANTS.find((v) => v.id.toUpperCase() === String(id).toUpperCase()
    || v.slug === String(id).toLowerCase()) || null;

/**
 * Can this variant honestly be made from what we recorded?
 *
 * Returns null when it can, or the reason it cannot — which the caller prints
 * and moves on, rather than filling the gap with something invented.
 */
export function blockedReason(variant, { tokens, order, review, mystery }) {
  for (const need of variant.needs || []) {
    if (need === 'order') {
      if (order?.status !== 'completed') {
        return 'the recording has no completed order, and this variant claims a delivery';
      }
    } else if (need === 'review') {
      if (!review?.body) return 'no published verified review to quote';
    } else if (need === 'mystery') {
      if (!mystery?.label) return 'no mystery box prize was actually rolled';
    } else if (!tokens[need]) {
      return `no real value for {${need}}`;
    }
  }
  // A hook that cannot be filled is a variant with no first two seconds.
  if (!fill(variant.hook, tokens)) return 'the hook needs a value this product does not have';
  return null;
}
