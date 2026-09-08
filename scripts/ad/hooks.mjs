/**
 * The first two seconds, generated per product.
 *
 * A hook was one line on the variant, so every advert cut from the same variant
 * opened identically whatever it was selling — and the opening line is the one
 * part of a feed advert that decides whether the rest is watched at all. This is
 * a catalogue of openings instead, and the generator can emit one advert per
 * eligible hook from a single recording.
 *
 * THE RULE, and it is the only one that matters here:
 *
 *   a hook may only state something the recording can prove.
 *
 * Every hook declares the tokens it needs. `fill()` returns null the moment a
 * token has no real value, and a hook whose line or sub-line comes back null is
 * DROPPED — not softened, not filled with a plausible number. Some of them will
 * therefore never be produced for a given product, which is the point: this
 * shop has 0 orders and 0 reviews behind it, and an advert that borrows either
 * is the one thing it cannot afford.
 *
 * `proves` is documentation, not decoration: it says where the claim comes
 * from, so a reviewer can check it without reading the resolver.
 */

/**
 * @typedef {object} Hook
 * @property {string} id      short, stable — it names the output file
 * @property {string} type    which of the seven kinds this is
 * @property {string} text    first line, with {tokens}
 * @property {string} [sub]   second line, with {tokens}
 * @property {string[]} needs tokens that must resolve to something real
 * @property {string} proves  where the claim comes from
 */

/** @type {Hook[]} */
export const HOOKS = [
  // ── 1. Product-first ────────────────────────────────────────────────────
  {
    id: 'product',
    type: 'product-first',
    text: '{name}',
    sub: 'Game-tegoed en giftcards. Code in je mail.',
    needs: ['name'],
    proves: 'the product name is the row the recording bought; the sub-line is what the catalogue is',
  },
  {
    id: 'product-price',
    type: 'product-first',
    text: '{name} — {price}',
    sub: 'Game-tegoed en giftcards. Code in je mail.',
    needs: ['name', 'price'],
    proves: 'name and price are the product row; the camera is pointing at both',
  },

  // ── 2. Price-first ──────────────────────────────────────────────────────
  {
    id: 'price',
    type: 'price-first',
    text: '{price}',
    sub: '{name}. Meer wordt het niet.',
    needs: ['price', 'name'],
    proves: 'products.price, and the same number is charged on camera',
  },
  {
    /* Per-unit is how this market compares before it buys, and it is the only
       comparison this shop is entitled to make: market_observations is empty,
       so no competitor price may appear beside it. Computed from the product's
       own two numbers, and null for anything that is not a countable pack. */
    id: 'per-thousand',
    type: 'price-first',
    text: '{perThousand} per 1.000',
    sub: '{name} — {price}',
    needs: ['perThousand', 'name', 'price'],
    proves: 'price ÷ the unit count in the product name — both from the product row',
  },

  // ── 3. Speed-first ──────────────────────────────────────────────────────
  {
    id: 'speed',
    type: 'speed-first',
    text: '{deliveryShort}',
    sub: '{delivery}',
    needs: ['deliveryShort', 'delivery'],
    proves: 'the shop’s own instant flag: auto-delivery AND a code on the shelf right now',
  },
  {
    id: 'in-stock',
    type: 'speed-first',
    text: 'Op voorraad.',
    sub: '{name} — {delivery}',
    needs: ['name', 'delivery'],
    proves: 'same flag; the product page says the same sentence in the shot behind it',
  },

  // ── 4. Problem → solution ───────────────────────────────────────────────
  {
    id: 'no-account',
    type: 'problem-solution',
    text: 'Geen account nodig.',
    sub: '{name} — {price}, code in je mail.',
    needs: ['name', 'price'],
    proves: 'guest checkout: the recording buys without signing in',
  },
  {
    id: 'money-back',
    type: 'problem-solution',
    text: 'Niet geleverd? Geld terug.',
    sub: '{name} — {price}. Staat op forgemarket.nl/refunds.',
    needs: ['name', 'price'],
    proves: 'the refund policy page, which states it in writing',
  },
  {
    /* Stock is disclosed 1-6 only — above that the server does not publish a
       number, so neither does an advert. */
    id: 'last-few',
    type: 'problem-solution',
    text: 'Nog {stockLeft} op voorraad.',
    sub: '{name} — {price}',
    needs: ['stockLeft', 'name', 'price'],
    proves: 'product_codes with status available, as the product page shows it',
  },

  // ── 5. Testimonial / social proof — real reviews only ───────────────────
  {
    id: 'review-stars',
    type: 'testimonial',
    text: '{reviewStars}',
    sub: '{reviewBody} — {reviewAuthor}',
    needs: ['reviewStars', 'reviewBody', 'reviewAuthor'],
    proves: 'a published review, and the shop only publishes verified ones',
  },
  {
    id: 'review-quote',
    type: 'testimonial',
    text: '{reviewBody}',
    sub: '{reviewAuthor} — geverifieerde koper',
    needs: ['reviewBody', 'reviewAuthor'],
    proves: 'the same review row; the label is the one the storefront uses',
  },

  // ── 6. Watch me buy this ────────────────────────────────────────────────
  {
    /* Literally true of this toolkit: the footage is one real purchase on the
       real site, and the cut is refused when the order did not complete. */
    id: 'watch-me',
    type: 'watch-me-buy',
    text: 'Ik koop dit nu.',
    sub: '{name} — {price}',
    needs: ['name', 'price'],
    proves: 'the recording is a real purchase; blockedReason refuses the cut otherwise',
  },
  {
    id: 'click-to-code',
    type: 'watch-me-buy',
    text: 'Van klik tot code.',
    sub: '{name} — {price}',
    needs: ['name', 'price'],
    proves: 'the cut walks the whole purchase; the code beat is in the footage',
  },

  // ── 7. Countdown / stopwatch ────────────────────────────────────────────
  {
    /* Both need `deliverySeconds`, which is null unless the payment was real
       AND the measured gap is at least a second. A demo purchase is marked paid
       the instant it is placed, so nothing timed against it means anything. */
    id: 'stopwatch',
    type: 'stopwatch',
    text: '{deliverySeconds} seconden.',
    sub: 'Van betaling tot code. Gemeten, niet beloofd.',
    needs: ['deliverySeconds'],
    proves: 'the order’s own payment_received → completed transitions',
  },
  {
    id: 'countdown',
    type: 'stopwatch',
    text: 'Betaald → code in {deliverySeconds}s',
    sub: '{name} — {price}',
    needs: ['deliverySeconds', 'name', 'price'],
    proves: 'the same two transitions, with the product they belong to',
  },
];

export const HOOK_TYPES = [...new Set(HOOKS.map((h) => h.type))];

export const hookById = (id) => HOOKS.find((h) => h.id === String(id).toLowerCase()) || null;

/**
 * The hooks this recording can honestly produce.
 *
 * `fill` is the judge, not this function: a hook is eligible when every line it
 * would render comes back non-null. That keeps one rule in one place — the same
 * one every caption in the toolkit already obeys.
 */
export function eligibleHooks(tokens, fill) {
  return HOOKS.filter((h) => {
    if (h.needs.some((t) => !tokens[t])) return false;
    if (!fill(h.text, tokens)) return false;
    return h.sub ? !!fill(h.sub, tokens) : true;
  });
}

/** Why a hook cannot be made here — for the operator, not the advert. */
export function hookBlockedReason(hook, tokens) {
  const missing = hook.needs.filter((t) => !tokens[t]);
  return missing.length ? `no real value for ${missing.map((m) => `{${m}}`).join(', ')}` : null;
}
