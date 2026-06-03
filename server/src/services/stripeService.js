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
    line_items: order.items.map((it) => ({
      quantity: it.quantity,
      price_data: {
        currency: (order.currency || 'eur').toLowerCase(),
        unit_amount: it.unit_price, // already minor units
        product_data: { name: it.name },
      },
    })),
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
