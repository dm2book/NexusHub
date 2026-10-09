/**
 * Which bundle discount a cart qualifies for.
 *
 * This rule existed twice: the checkout computed it, the cart did not. So a
 * buyer who tapped "Add bundle" saw the bundle's price on the card (€14.38),
 * a higher one in the cart (€15.98), and the correct one again at checkout.
 * The server was charging the right amount the whole time — the cart was simply
 * lying about the price, which is the moment a buyer decides the shop is broken.
 *
 * One implementation now, used by both, and it mirrors the server's
 * bestBundleDiscount(): the single best-value bundle whose products are all
 * present, never several stacked. The arithmetic itself, setDiscount(), is
 * imported by the server, so the two cannot come apart.
 */

/**
 * What one bundle takes off, in minor units — for COMPLETE sets only.
 *
 * A bundle of A + B at 10% is a price for the pair. It used to take 10% off
 * every unit of A and of B in the cart, so ten A's and one B got 10% off eleven
 * cards while only one pair was there. Now it counts as many sets as the
 * scarcest member allows, and discounts each set the way the bundle card
 * prices one: rounded per set, so two sets save exactly twice what the card
 * says. A product listed twice in a bundle needs two units per set.
 *
 * @param productIds  the bundle's products
 * @param percent     its discount
 * @param qtyOf       (id) → how many of that product the cart holds
 * @param priceOf     (id) → that product's unit price
 */
export function setDiscount(productIds = [], percent = 0, qtyOf = () => 0, priceOf = () => 0) {
  if (!(percent > 0) || productIds.length < 2) return 0;
  const need = new Map();
  for (const id of productIds) need.set(id, (need.get(id) || 0) + 1);
  let sets = Infinity;
  let setPrice = 0;
  for (const [id, perSet] of need) {
    sets = Math.min(sets, Math.floor((Number(qtyOf(id)) || 0) / perSet));
    setPrice += (Number(priceOf(id)) || 0) * perSet;
  }
  if (!(sets > 0)) return 0;
  return Math.round(setPrice * percent / 100) * sets;
}

/**
 * @param items    cart lines: { id, price, qty }
 * @param bundles  from /api/bundles
 * @returns { name, percent, discount } | null   discount in minor units
 */
export function matchBundle(items = [], bundles = []) {
  if (!items.length || !bundles.length) return null;
  const qtyOf = (id) => items.filter((i) => i.id === id).reduce((n, i) => n + (i.qty ?? 1), 0);
  const priceOf = (id) => items.find((i) => i.id === id)?.price || 0;

  return bundles
    .filter((b) => b.products?.length >= 2)
    .map((b) => ({
      name: b.name,
      percent: b.discountPercent,
      // Only the bundled products are discounted — not the rest of the cart.
      discount: setDiscount(b.products.map((p) => p.id), b.discountPercent, qtyOf, priceOf),
    }))
    .filter((b) => b.discount > 0)
    .sort((a, b) => b.discount - a.discount)[0] || null;
}
