const mongoose = require('mongoose');

const { Schema } = mongoose;

const SUBSCRIPTION_STATUSES = ['active', 'cancelled'];

// Recurring billing state, owned entirely in-house (see
// docs/decisions/001-in-house-subscription-billing.md) — Stripe is only used
// to charge a saved card, never its native Subscriptions object.
//
// Deliberately NOT unique on (studentId, scheduleId): a student can
// legitimately re-register for the same schedule after a past cancellation,
// which needs a second doc. "No currently active enrollment" is enforced in
// registration.service.js, not the schema.
const subscriptionSchema = new Schema(
  {
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    scheduleId: {
      type: Schema.Types.ObjectId,
      ref: 'GroupClassSchedule',
      required: true,
    },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: SUBSCRIPTION_STATUSES,
      default: 'active',
    },
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },
    currentPeriodStart: {
      type: Date,
      required: true,
    },
    currentPeriodEnd: {
      type: Date,
      required: true,
    },
    nextBillingDate: {
      type: Date,
      required: true,
    },
    // Record of what happened at the most recent charge — for
    // display/record-keeping only. NOT the source of truth for future
    // discount decisions: calculateChargeAmount.service.js always re-derives
    // the sibling discount live from current Subscription/Price state, never
    // reads these back.
    lastChargeAmount: {
      type: Number,
      default: null,
    },
    lastSiblingDiscountApplied: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const Subscription = mongoose.model('Subscription', subscriptionSchema);

module.exports = Subscription;
module.exports.SUBSCRIPTION_STATUSES = SUBSCRIPTION_STATUSES;
