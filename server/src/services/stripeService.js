/**
 * Stripe payments via hosted Checkout — we never touch card data.
 *
 * Flow: createCheckoutSession() builds a Session from the order's line items and
 * returns a redirect URL. Stripe redirects the buyer to success/cancel URLs and,
 * authoritatively, fires a `checkout.session.completed` webhook which we verify
 * and use to mark the order paid (see routes/payments.js).
 *
 * Activated by setting STRIPE_SECRET_KEY; otherwise isEnabled() is false and the
 * storefront falls back to demo or pending payments.
 */
import Stripe from 'stripe';
import { config } from '../config/env.js';

let client = null;
function stripe() {
  if (!config.payments.stripe.secretKey) return null;
  if (!client) client = new Stripe(config.payments.stripe.secretKey);
  return client;
}

export const isEnabled = () => !!config.payments.stripe.secretKey;

/** Create a Checkout Session for an order. Returns { id, url }. */
export async function createCheckoutSession(order) {
  const s = stripe();
  if (!s) throw new Error('Stripe is not configured');

  const session = await s.checkout.sessions.create({
    mode: 'payment',
    // Reuse the customer email so receipts and dashboards line up.
    customer_email: order.email,
    client_reference_id: order.id,
    metadata: { orderId: order.id, orderNumber: order.number },
    // ONE line for order.total, not a line per item at list price.
    //
    // Building the lines from unit_price re-derives the SUBTOTAL and silently
    // drops every coupon, Forge+ discount, bundle and — worst — the store credit
    // that createOrder has already debited, so the buyer would be charged twice
    // for that part. The server owns the total; Stripe should only collect it.
    line_items: [{
      quantity: 1,
      price_data: {
        currency: (order.currency || 'eur').toLowerCase(),
        unit_amount: order.total, // already minor units, discounts applied
        product_data: {
          name: order.items.length === 1
            ? order.items[0].name
            : `ForgeMarket order ${order.number}`,
          description: order.items.length === 1 && order.items[0].quantity > 1
            ? `${order.items[0].quantity} ×`
            : order.items.map((it) => `${it.quantity} × ${it.name}`).join(', ').slice(0, 500) || undefined,
        },
      },
    }],
    success_url: `${config.appUrl}/checkout/success?order=${order.id}&n=${encodeURIComponent(order.number)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.appUrl}/cart?canceled=1`,
  });
  return { id: session.id, url: session.url };
}

/** Verify a webhook payload (raw Buffer) and return the Stripe event. */
export function constructEvent(rawBody, signature) {
  const s = stripe();
  const secret = config.payments.stripe.webhookSecret;
  if (!s || !secret) throw new Error('Stripe webhook not configured');
  return s.webhooks.constructEvent(rawBody, signature, secret);
}
