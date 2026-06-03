/** Stripe webhook — the authoritative source of payment confirmation. */
import { Router } from 'express';
import { constructEvent } from '../services/stripeService.js';
import { getOrder, markPaymentReceived } from '../services/orderService.js';
import { audit } from '../services/auditService.js';

const router = Router();

// NOTE: this route receives a RAW body (configured in app.js) so the Stripe
// signature can be verified. Do not add a JSON parser ahead of it.
router.post('/stripe/webhook', async (req, res) => {
  let event;
  try {
    event = constructEvent(req.body, req.get('stripe-signature'));
  } catch (err) {
    console.error('[stripe] signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const orderId = session.metadata?.orderId || session.client_reference_id;
      const order = orderId ? await getOrder(orderId) : null;
      if (order && order.status === 'pending') {
        await markPaymentReceived(order.id, session.payment_intent || session.id,
          { actorId: 'stripe', reason: 'Stripe payment confirmed' });
        await audit({ actor: { id: 'stripe', email: 'stripe' }, action: 'order.payment_received',
          targetType: 'order', targetId: order.id, metadata: { provider: 'stripe' } });
      }
    }
  } catch (err) {
    console.error('[stripe] handler error:', err.message);
    // 200 anyway so Stripe doesn't retry a non-retryable app error indefinitely.
  }
  res.json({ received: true });
});

export default router;
