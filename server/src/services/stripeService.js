/**
 * Stripe payments via hosted Checkout — we never touch card data.
 *
 * Flow: createCheckoutSession() builds a Session from the order's total and
 * returns a redirect URL. Stripe redirects the buyer to success/cancel URLs and,
 * authoritatively, sends webhooks (routes/payments.js).
 *
 * `checkout.session.completed` is NOT on its own a statement that the money
 * arrived: for every delayed-notification method it comes back with
 * `payment_status: 'unpaid'` and settles later on
 * `checkout.session.async_payment_succeeded`. The webhook reads that field
 * rather than the event name, because a digital shop that marks an order paid on
 * the event name gives the product away on a promise.
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
    /* The SDK's defaults are an 80-second timeout and two retries — four
       minutes for a call inside a function Vercel ends at 30 s. Stripe answers
       in well under a second when it is up; when it is not, a quick error the
       checkout can show beats a request the platform kills mid-sentence. */
    client = new Stripe(config.payments.stripe.secretKey, { timeout: 8_000, maxNetworkRetries: 1 });
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

  const params = {
    mode: 'payment',
    payment_method_types: config.payments.stripe.methods,
    /* Ask the bank for 3-D Secure on every card: a digital code cannot be
       taken back, and an authenticated payment moves a fraud chargeback's
       liability to the card issuer. */
    payment_method_options: { card: { request_three_d_secure: 'any' } },
    /* A session lives 30 minutes (Stripe's minimum), so an old tab cannot pay
       an order a second time long after a new session was made for it. */
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
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
    /* The order id on the PAYMENT INTENT as well as on the session.
       A refund or a dispute is raised against the payment, and the event Stripe
       sends then carries the intent's metadata and not the session's — so
       without this the only way back to the order is a database lookup that
       depends on the intent having been recorded first. Both, because a webhook
       that can identify its own order from the payload is the one that still
       works when something else did not run. */
    payment_intent_data: {
      metadata: { orderId: order.id, orderNumber: order.number },
      description: `ForgeMarket ${order.number}`,
    },
    /* The buyer is Dutch and the shop is in Dutch. Stripe otherwise picks from
       the browser, which is right often enough to hide the times it is not. */
    locale: 'nl',
    success_url: `${config.appUrl}/checkout/success?order=${order.id}&n=${encodeURIComponent(order.number)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.appUrl}/cart?canceled=1`,
  };
  let session;
  try {
    session = await s.checkout.sessions.create(params);
  } catch (e) {
    /* A method that is not switched on in the Stripe dashboard (iDEAL before
       it is approved) refuses the whole session. Card still works: sell with
       card rather than not at all, and say so loudly. */
    if (!/payment_method_types|payment method type/i.test(e.message)) throw e;
    console.error('[stripe] payment methods refused, falling back to card only:', e.message);
    session = await s.checkout.sessions.create({ ...params, payment_method_types: ['card'] });
  }
  return { id: session.id, url: session.url, paymentIntentId: session.payment_intent || null };
}

/**
 * What Stripe's own fraud engine (Radar) and the card say about a payment:
 * the risk level and the card's country. Null when it cannot be read — a
 * check that cannot run must not stop a sale.
 */
export async function paymentRisk(paymentIntentId) {
  const s = await stripe();
  if (!s || !/^pi_/.test(String(paymentIntentId || ''))) return null;
  try {
    /* Three seconds at most. This runs inside the payment webhook, before the
       order is marked paid: with Stripe's API slow the webhook ran 75 s in the
       simulation and was killed, leaving a PAID order pending. A risk check that
       cannot answer in time does not stop the sale — the same as when it errors. */
    const pi = await Promise.race([
      s.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] }, { timeout: 3_000 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Radar lookup timed out')), 3_000).unref?.()),
    ]);
    const ch = pi.latest_charge || {};
    return {
      level: ch.outcome?.risk_level || null,             // normal | elevated | highest | not_assessed
      score: ch.outcome?.risk_score ?? null,
      cardCountry: ch.payment_method_details?.card?.country || null,
    };
  } catch { return null; }
}

/** A Checkout session that is still open, by id — or null. */
export async function openSession(id) {
  const s = await stripe();
  if (!s || !/^cs_/.test(String(id || ''))) return null;
  const session = await s.checkout.sessions.retrieve(id).catch(() => null);
  return session?.status === 'open' ? { id: session.id, url: session.url } : null;
}

/**
 * Give a payment back in Stripe. `cents` omitted refunds the rest of the
 * payment. One refund per order and amount: a double click creates nothing new.
 */
export async function refundPaymentIntent(ref, { cents, orderId } = {}) {
  const s = await stripe();
  if (!s) throw new Error('Stripe is not configured');
  let pi = ref;
  if (/^cs_/.test(String(ref))) pi = (await s.checkout.sessions.retrieve(ref)).payment_intent;
  if (!/^pi_/.test(String(pi || ''))) throw new Error('No Stripe payment to refund on this order');
  return s.refunds.create({ payment_intent: pi, ...(cents ? { amount: cents } : {}) },
    { idempotencyKey: `refund-${orderId || pi}-${cents || 'all'}` });
}

/**
 * The events this shop acts on, in one place.
 *
 * Named here rather than in the setup instruction, because the instruction and
 * the handler drifting apart is silent and expensive: it said
 * `checkout.session.completed` alone, which is the subscription somebody would
 * actually create — and then a refund or a dispute never arrives, and the only
 * symptom is an order that disagrees with the Stripe dashboard weeks later.
 */
export const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'charge.refunded',
  'charge.dispute.created',
];

/**
 * What Stripe says about the account behind the key.
 *
 * A live key is not the same as a live account. Stripe issues keys immediately
 * and enables charges only once the onboarding form is finished, so a shop can
 * be fully "configured" — key set, webhook set, iDEAL on — and have every
 * checkout refused at Stripe's end. And `payouts_enabled` is the quieter one:
 * charges succeed, the money sits in the Stripe balance, and nothing reaches
 * the bank account, which looks like a working shop until somebody checks the
 * bank.
 *
 * Null when the question cannot be asked. An unreachable API, a restricted key
 * without account permission, or an outage is not evidence that anything is
 * wrong.
 */
export async function accountStatus() {
  const s = await stripe();
  if (!s) return null;
  try {
    const a = await s.accounts.retrieve();
    return {
      id: a.id || null,
      country: a.country || null,
      chargesEnabled: a.charges_enabled !== false,
      payoutsEnabled: a.payouts_enabled !== false,
      currentlyDue: a.requirements?.currently_due || [],
      disabledReason: a.requirements?.disabled_reason || null,
    };
  } catch {
    return null;
  }
}

/**
 * Whether Stripe is actually pointed at this shop, and for the right events.
 *
 * The readiness check has always told the owner to create this endpoint; it
 * never checked whether they did, or whether the one they created still points
 * here. Both fail silently in the same direction — the buyer pays, Stripe takes
 * the money, and no order is ever marked paid — and a leftover endpoint from a
 * preview URL looks, in the Stripe dashboard, exactly like a correct one.
 *
 * Events matter individually: without `charge.refunded` a refund issued in
 * Stripe never reaches the order, and without `charge.dispute.created` a
 * chargeback arrives as a surprise on a bank statement.
 */
export function evaluateEndpoints(endpoints = [], appUrl = '') {
  const expected = `${String(appUrl || '').replace(/\/+$/, '')}/api/payments/stripe/webhook`;
  /* A disabled endpoint is listed in the dashboard looking much like a live
     one, and delivers nothing. */
  const live = endpoints.filter((e) => (e.status || 'enabled') !== 'disabled');
  const match = live.find((e) => String(e.url || '').replace(/\/+$/, '') === expected) || null;
  /* Stripe's "all events" wildcard covers everything, so it is not a gap. */
  const missingEvents = match
    ? ((match.events || []).includes('*')
      ? [] : WEBHOOK_EVENTS.filter((x) => !(match.events || []).includes(x)))
    : WEBHOOK_EVENTS.slice();
  return { expected, endpoints, matching: match, missingEvents };
}

export async function webhookStatus(appUrl) {
  const s = await stripe();
  if (!s) return null;
  try {
    const list = await s.webhookEndpoints.list({ limit: 50 });
    return evaluateEndpoints((list?.data || []).map((e) => ({
      url: e.url, status: e.status || 'enabled', events: e.enabled_events || [],
    })), appUrl);
  } catch {
    return null;
  }
}

/** Verify a webhook payload (raw Buffer) and return the Stripe event. */
export async function constructEvent(rawBody, signature) {
  const s = await stripe();
  const secret = config.payments.stripe.webhookSecret;
  if (!s || !secret) throw new Error('Stripe webhook not configured');
  return s.webhooks.constructEvent(rawBody, signature, secret);
}
