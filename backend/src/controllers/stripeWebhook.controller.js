const stripe = require('../config/stripe');
const WebhookEvent = require('../models/webhookEvent.model');

const INTERESTING_EVENT_TYPES = ['payment_intent.succeeded', 'payment_intent.payment_failed'];

// Handles incoming Stripe webhook deliveries. Requires the raw (unparsed)
// request body — see app.js, where this route is mounted with its own
// express.raw() middleware ahead of the global express.json() call, so
// Stripe's signature verification always sees the exact bytes Stripe signed.
//
// Deliberately narrow: records only payment_intent.succeeded /
// payment_intent.payment_failed events, deduped by Stripe's event id. Full
// reconciliation against Registration/Subscription state is out of scope
// for this phase — a future concern, not built here.
async function handle(req, res) {
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    return res.status(400).json({ message: `Webhook signature verification failed: ${error.message}` });
  }

  try {
    const existing = await WebhookEvent.findOne({ stripeEventId: event.id });

    if (existing) {
      // Stripe redelivers events; treat redelivery as a safe no-op.
      return res.status(200).json({ received: true });
    }

    if (INTERESTING_EVENT_TYPES.includes(event.type)) {
      await WebhookEvent.create({
        stripeEventId: event.id,
        type: event.type,
        paymentIntentId: event.data.object.id,
        status: event.data.object.status,
      });
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    // Signature verification already succeeded at this point, so a 500 here
    // is safe: Stripe will retry delivery, and the dedup check above makes
    // a successful retry idempotent.
    return res.status(500).json({ message: error.message || 'Failed to process webhook event' });
  }
}

module.exports = { handle };
