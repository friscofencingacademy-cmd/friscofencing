const mongoose = require('mongoose');

const { Schema } = mongoose;

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
    stripePaymentMethodId: {
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
