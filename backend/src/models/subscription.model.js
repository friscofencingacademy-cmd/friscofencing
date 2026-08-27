const mongoose = require('mongoose');

const { Schema } = mongoose;

const SUBSCRIPTION_STATUSES = ['active', 'cancelled'];

// Recurring billing state, owned entirely in-house (see
// docs/decisions/001-in-house-subscription-billing.md) — Stripe is only used
// to charge a saved card, never its native Subscriptions object.
//
// NOT unique on plain (studentId, scheduleId): a student can legitimately
// re-register for the same schedule after a past cancellation, which needs a
// second doc. What IS enforced at the DB level (Guard A, below) is that at
// most one of those docs is ever ACTIVE at a time — the partial index scopes
// out cancelled docs entirely, so this comment's original intent still
// holds; only the previously-TOCTOU-racy "no currently active enrollment"
// check in registration.service.js gained a real backstop.
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
    // One flat monthly fee for the whole level, attend any of its scheduled
    // sessions — the real Frisco billing model (docs/plans/premium-
    // registration-and-attendance-plan.md §0/§3.6). Set at creation from
    // the ENABLE_SCHEDULE_BASED_REGISTRATION flag (registration.service.js's
    // create()); `scheduleId` above is still required either way — for a
    // premium subscription it's the student's chosen "home" slot (the
    // billing anchor + what changeSchedule would move, if it weren't
    // blocked for premium — see subscription.service.js), not a
    // restriction on which sessions they can attend.
    isPremium: {
      type: Boolean,
      default: false,
    },
    // One-time registration fee actually charged at THIS subscription's
    // creation (registrationFee.service.js), captured once and never
    // touched again — including by a later admin change to the Setting's
    // fee amount, or by renewals (which never re-charge it). 0 for any
    // subscription created before this field existed, or when no fee was
    // configured at the time — never null, so display code never needs a
    // null-check alongside lastChargeAmount's genuine null-for-"never
    // charged yet" meaning.
    registrationFeeCharged: {
      type: Number,
      default: 0,
    },
    // Permanent audit record of whether THIS subscription's first charge
    // was prorated (docs/plans/prorated-first-month-billing-plan.md) —
    // captured once at creation, never recomputed or touched again,
    // including by renewals (a prorated first period is always followed by
    // full-price, full-month renewals). false for any subscription created
    // before this field existed or while prorationEnabled was off.
    firstChargeProrated: {
      type: Boolean,
      default: false,
    },
    // Retry/dunning state (docs/plans/registration-ledger-plan.md D6) — 0
    // means "not currently in retry," matching phase 1 (runRenewals)'s
    // candidate filter. Bumped by renewal.service.js's retryOne on each
    // failed retry attempt; reset to 0 (with nextRetryAt cleared) on any
    // successful charge, whether that charge came from the normal renewal
    // path or from a retry.
    retryCount: {
      type: Number,
      default: 0,
    },
    // When the next retry attempt is due. null while retryCount is 0. Uses
    // $unset (never a plain `undefined` write, which Mongoose silently
    // strips) when clearing this field — see renewal.service.js's
    // cancel-after-exhaustion handling for why that distinction is
    // load-bearing.
    nextRetryAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Guard A — closes the concurrent-registration race
// (docs/plans/registration-ledger-plan.md D2). At most one ACTIVE
// subscription per student+schedule, enforced by MongoDB itself, not just
// the check-then-create in registration.service.js's create() (a real TOCTOU
// race under two near-simultaneous requests). Cancelled docs are excluded on
// purpose — re-registration after a past cancellation still needs a second
// doc, per this schema's own comment above.
subscriptionSchema.index(
  { studentId: 1, scheduleId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
  }
);

const Subscription = mongoose.model('Subscription', subscriptionSchema);

module.exports = Subscription;
module.exports.SUBSCRIPTION_STATUSES = SUBSCRIPTION_STATUSES;
