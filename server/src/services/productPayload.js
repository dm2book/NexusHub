/**
 * One definition of what a product looks like to the storefront.
 *
 * `/api/products/:id` and the server-rendered `/product/:id` page now hand the
 * browser the same object — the page inlines it so React can draw the product
 * on its first render instead of waiting for a round trip. Two copies of this
 * shape would drift, and the drift would be invisible: the inlined product
 * would render one thing and the revalidating fetch would quietly replace it
 * with another.
 */
import { withCopy } from './productCopy.js';

// Only surface a "left" count for products that actually sell from finite code
// stock (auto delivery). This keeps "almost sold out" honest — manual/made-to-
// order products, and auto products with plenty of stock, show nothing.
const LOW_STOCK = 6;

export const stockLeftFor = (product, count) =>
  (product.deliveryMode === 'auto' && count > 0 && count <= LOW_STOCK) ? count : null;

// True only when a code is sitting in stock right now and the product is set to
// auto-deliver — i.e. the one case where "instant" is a promise we can keep.
// Everything else is fulfilled by hand and must say so.
export const instantFor = (product, count) => product.deliveryMode === 'auto' && count > 0;

/** The exact JSON body of `{ product }` on /api/products/:id. */
export const productPayload = (product, count) => withCopy({
  ...product,
  stockLeft: stockLeftFor(product, count),
  instant: instantFor(product, count),
});
