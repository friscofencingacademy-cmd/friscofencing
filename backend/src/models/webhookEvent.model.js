const mongoose = require('mongoose');

const { Schema } = mongoose;

// A record of a processed Stripe webhook event, keyed by Stripe's own event
// id. This is the dedup mechanism: Stripe redelivers events (at-least-once
// delivery), so `stripeEventId` is unique and every delivery is checked
// against it before any processing happens. This is intentionally NOT a
// general-purpose event log or reconciliation ledger — full reconciliation
// logic is out of scope for this phase (future concern) — it only exists to
// make redelivery of `payment_intent.succeeded` /
// `payment_intent.payment_failed` events a safe no-op.
const webhookEventSchema = new Schema(
  {
    stripeEventId: {
      type: String,
      required: true,
      unique: true,
    },
    type: {
      type: String,
      required: true,
    },
    paymentIntentId: {
      type: String,
    },
    status: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

const WebhookEvent = mongoose.model('WebhookEvent', webhookEventSchema);

module.exports = WebhookEvent;
