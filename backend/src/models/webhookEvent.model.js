const mongoose = require('mongoose');

const { Schema } = mongoose;
const { PROVIDER_NAMES } = require('../payments/contract');

// A record of a processed payment-provider webhook event, keyed by the
// provider and the provider's own event id. This is the dedup mechanism:
// providers redeliver events (at-least-once delivery), so
// (provider, providerEventId) is unique and every delivery is checked
// against it before any processing happens. This is intentionally NOT a
// general-purpose event log or reconciliation ledger — full reconciliation
// logic is out of scope (future concern) — it only exists to make
// redelivery of a payment succeeded / failed event a safe no-op
// (webhooks.controller.js, docs/decisions/013-payment-provider-port.md).
const webhookEventSchema = new Schema(
  {
    provider: {
      type: String,
      enum: PROVIDER_NAMES,
      required: true,
    },
    providerEventId: {
      type: String,
      required: true,
    },
    // The provider's own raw event type (e.g. `payment_intent.succeeded`,
    // `payment.updated`), kept verbatim for audit — never the normalized one.
    type: {
      type: String,
      required: true,
    },
    providerPaymentId: {
      type: String,
    },
    // The payment's raw provider status at delivery time, for audit.
    status: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Event ids are only unique within one provider.
webhookEventSchema.index({ provider: 1, providerEventId: 1 }, { unique: true });

const WebhookEvent = mongoose.model('WebhookEvent', webhookEventSchema);

module.exports = WebhookEvent;
