const mongoose = require('mongoose');

const { Schema } = mongoose;

const PRIVATE_CLASS_CHARGE_STATUSES = ['pending', 'completed', 'failed'];

// The per-session money ledger — Frisco has none of this today; every
// private-lesson charge is a Stripe PaymentIntent triggered by marking a
// session attended (privateClassSession.service.js's chargeSession).
const privateClassChargeSchema = new Schema(
  {
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: 'PrivateClassSession',
      required: true,
    },
    enrollmentId: {
      type: Schema.Types.ObjectId,
      ref: 'PrivateClassEnrollment',
      required: true,
    },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Dollars — what was actually charged (or attempted).
    amount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: PRIVATE_CLASS_CHARGE_STATUSES,
      required: true,
    },
    stripePaymentIntentId: {
      type: String,
      default: null,
    },
    attempt: {
      type: Number,
      default: 1,
    },
    failureMessage: {
      type: String,
      default: null,
    },
    paidAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// CKQ's Layer-1 dedup: a session may have at most one non-failed charge at
// a time, so a double-save of the same attendance can never double-charge.
// 'failed' is deliberately excluded — a failed charge must not block retry.
privateClassChargeSchema.index(
  { sessionId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['pending', 'completed'] } },
  }
);

const PrivateClassCharge = mongoose.model('PrivateClassCharge', privateClassChargeSchema);

module.exports = PrivateClassCharge;
module.exports.PRIVATE_CLASS_CHARGE_STATUSES = PRIVATE_CLASS_CHARGE_STATUSES;
