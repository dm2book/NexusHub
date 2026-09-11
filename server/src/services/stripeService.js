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
import { config } from '../config/env.js';

/**
 * The SDK is loaded on first use, not on import.
 *
 * `routes/catalog.js` imports this module, so it sits in the module graph of
 * every cold start — and loading the Stripe SDK cost about 150ms of the ~360ms
 * this function spent evaluating JavaScript before it could serve anything.
 * This shop runs on Mollie, which needs no SDK at all (it is plain fetch), so on
 * the normal deployment that 150ms bought nothing whatsoever. Behind a dynamic
 * import it is paid by the first Stripe checkout and by nobody else.
 */
let client = null;
async function stripe() {
  if (!config.payments.stripe.secretKey) return null;
  if (!client) {
    const { default: Stripe } = await import('stripe');
    client = new Stripe(config.payments.stripe.secretKey);
  }
  return client;
}

export const isEnabled = () => !!config.payments.stripe.secretKey;

/** A live key, not a test one. Test keys take fake cards and move no money. */
export const isTestKey = () => /^sk_test_/.test(config.payments.stripe.secretKey || '');

/** Whether the webhook can be verified at all. Without it nothing is ever paid. */
export const hasWebhookSecret = () => !!config.payments.stripe.webhookSecret;

/**
 * Which payment methods a Dutch buyer will actually be offered.
 *
 * Checkout does not hardcode a list — it uses whatever is enabled on the Stripe
 * account, which is the right default (hardcoding `ideal` throws at session
 * creation if the account has not enabled it, taking the checkout down rather
 * than degrading). The cost of that default is that it is SILENT: a Dutch shop
 * whose account has only cards switched on serves cards to a country where
 * iDEAL is most of online payment, and nothing says so.
 *
 * So the launch check asks Stripe instead of assuming. Returns null when the
 * question cannot be answered — an unreachable API is not evidence of anything.
 */
export async function enabledMethods() {
  const s = await stripe();
  if (!s) return null;
  try {
    const list = await s.paymentMethodConfigurations.list({ limit: 10 });
    const active = (list?.data || []).filter((c) => c.active !== false);
    if (!active.length) return null;
    const names = new Set();
    for (const cfg of active) {
      for (const [name, v] of Object.entries(cfg)) {
        if (v && typeof v === 'object' && v.display_preference?.value === 'on') names.add(name);
      }
    }
    return [...names].sort();
  } catch {
    return null;                       // no permission, old API version, offline
  }
}

/** Create a Checkout Session for an order. Returns { id, url }. */
export async function createCheckoutSession(order) {
  const s = await stripe();
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
export async function constructEvent(rawBody, signature) {
  const s = await stripe();
  const secret = config.payments.stripe.webhookSecret;
  if (!s || !secret) throw new Error('Stripe webhook not configured');
  return s.webhooks.constructEvent(rawBody, signature, secret);
}
