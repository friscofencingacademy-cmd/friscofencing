const mongoose = require('mongoose');

const { Schema } = mongoose;
const { PROVIDER_NAMES } = require('../payments/contract');

// One saved card per parent for MVP, not multiple — the unique index on
// parentId is the race-safety backstop behind the service-layer
// find-or-create logic in paymentMethod.service.js, same two-layer pattern
// as Price.levelId / TrialClass.studentId.
const paymentMethodSchema = new Schema(
  {
    parentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    // The payment provider this card is saved with, and that provider's own
    // saved-card id. A card on a provider that is no longer active is treated
    // as "no card on file" (paymentMethod.service.js getMine), never deleted —
    // cards never move between providers (docs/plans/payment-provider-port-plan.md D7).
    provider: {
      type: String,
      enum: PROVIDER_NAMES,
      required: true,
    },
    providerPaymentMethodId: {
      type: String,
      required: true,
    },
    cardBrand: {
      type: String,
      required: true,
    },
    cardLast4: {
      type: String,
      required: true,
    },
    cardExpMonth: {
      type: Number,
      required: true,
    },
    cardExpYear: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const PaymentMethod = mongoose.model('PaymentMethod', paymentMethodSchema);

module.exports = PaymentMethod;
