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
 * present, never several stacked.
 */

/**
 * @param items    cart lines: { id, price, qty }
 * @param bundles  from /api/bundles
 * @returns { name, percent, discount } | null   discount in minor units
 */
export function matchBundle(items = [], bundles = []) {
  if (!items.length || !bundles.length) return null;
  const inCart = new Set(items.map((i) => i.id));
  const totalFor = (id) => items
    .filter((i) => i.id === id)
    .reduce((sum, i) => sum + i.price * (i.qty || 1), 0);

  return bundles
    .filter((b) => b.products?.length >= 2 && b.products.every((p) => inCart.has(p.id)))
    .map((b) => ({
      name: b.name,
      percent: b.discountPercent,
      // Only the bundled products are discounted — not the rest of the cart.
      discount: Math.round(b.products.reduce((s, p) => s + totalFor(p.id), 0) * b.discountPercent / 100),
    }))
    .filter((b) => b.discount > 0)
    .sort((a, b) => b.discount - a.discount)[0] || null;
}
