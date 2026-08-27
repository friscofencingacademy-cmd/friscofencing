const mongoose = require('mongoose');

const { Schema } = mongoose;

const REGISTRATION_EVENT_TYPES = ['initial', 'renewal', 'legacy'];
const REGISTRATION_STATUSES = ['pending', 'completed', 'failed'];

// The payment ledger — one immutable row per charge cycle (attempted or
// succeeded), never an enrollment record. `Subscription` is the enrollment
// fact (who is registered, what happens next); this is the money fact (what
// was charged, when, and via which Stripe PaymentIntent). Ported from CKQ's
// `Registration` model + this repo's own `PrivateClassCharge` precedent —
// see docs/plans/registration-ledger-plan.md.
//
// Mutation contract (enforced by code discipline, not schema machinery — see
// the plan's D1): a row is immutable after insert except the
// pending -> completed|failed transition and retry's own updates to
// `attempt` / `stripePaymentIntentId` / `failureMessage` / `paidAt` /
// `status`. Nothing ever rewrites `amount`, `breakdown`, `periodStart/End`,
// or the id references — a later schedule change must not rewrite history
// (see subscription.service.js's changeSchedule, which deliberately no
// longer touches this collection).
const registrationSchema = new Schema(
  {
    subscriptionId: {
      type: Schema.Types.ObjectId,
      ref: 'Subscription',
      required: true,
    },
    // Snapshots at charge time, not live refs to "the current" anything —
    // a later schedule change on the Subscription must not rewrite what
    // schedule this charge was actually for.
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

    eventType: {
      type: String,
      enum: REGISTRATION_EVENT_TYPES,
      required: true,
    },
    status: {
      type: String,
      enum: REGISTRATION_STATUSES,
      required: true,
    },

    // Dollars — what was actually charged (or attempted). For 'initial' rows
    // this INCLUDES the registration fee: registration.service.js's create()
    // charges both in a single PaymentIntent, so this is what that one
    // PaymentIntent was actually for.
    amount: {
      type: Number,
      required: true,
    },

    breakdown: {
      monthlyFee: { type: Number, required: true },
      prorated: { type: Boolean, default: false },
      proratedAmount: { type: Number, default: null },
      siblingDiscountApplied: { type: Boolean, default: false },
      siblingDiscountAmount: { type: Number, default: 0 },
      // 0 for every renewal row — a renewal never re-charges the one-time
      // fee. Only an 'initial' row can carry a non-zero value here.
      registrationFeeCharged: { type: Number, default: 0 },
    },

    // The billing period this charge pays for.
    periodStart: {
      type: Date,
      required: true,
    },
    periodEnd: {
      type: Date,
      required: true,
    },

    stripePaymentIntentId: {
      type: String,
      default: null,
    },
    failureMessage: {
      type: String,
      default: null,
    },
    // Which attempt this row currently reflects — 1 for the original charge,
    // bumped by a successful or failed retry (renewal.service.js's
    // retryOne). A row is never duplicated for a retry; the SAME row is
    // updated in place so "the ledger entry for period X" stays singular.
    attempt: {
      type: Number,
      default: 1,
    },
    paidAt: {
      type: Date,
      default: null,
    },

    // Set only by the one-time migration script
    // (scripts/lib/migrateRegistrationsToLedger.js) that rewrote this
    // repo's original 3-field enrollment-stub Registration docs into ledger
    // rows. `true` means `amount`/`breakdown` were reconstructed from a
    // Subscription's own last-known snapshot fields, not captured live at
    // charge time — best-effort, not charge-time truth. Never set by any
    // normal charge path.
    backfilled: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Retry's "most recent failed row for this subscription" lookup
// (renewal.service.js's retryOne) — a plain query index, not a uniqueness
// guard.
registrationSchema.index({ subscriptionId: 1, createdAt: -1 });

// Guard B — durable renewal dedup (CKQ's fourth double-charge protection
// layer, docs/plans/registration-ledger-plan.md D2). At most one
// pending-or-completed row per subscription+period; 'failed' is deliberately
// excluded so a failed charge never blocks its own retry. This is what
// outlives Stripe's ~24h idempotency-key window — same shape and rationale
// as privateClassCharge.model.js's own index.
registrationSchema.index(
  { subscriptionId: 1, periodStart: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['pending', 'completed'] } },
  }
);

const Registration = mongoose.model('Registration', registrationSchema);

module.exports = Registration;
module.exports.REGISTRATION_EVENT_TYPES = REGISTRATION_EVENT_TYPES;
module.exports.REGISTRATION_STATUSES = REGISTRATION_STATUSES;
