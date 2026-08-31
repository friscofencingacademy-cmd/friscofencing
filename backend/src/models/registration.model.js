const mongoose = require('mongoose');

const { Schema } = mongoose;
const { BILLING_SHAPES } = require('./service.model');

const REGISTRATION_STATUSES = ['pending', 'completed', 'failed'];
const REGISTRATION_EVENT_TYPES = ['initial', 'renewal', 'legacy'];

// ─── The unified payment ledger ────────────────────────────────────────────
// docs/plans/service-registry-unified-ledger-plan.md. ONE collection for
// every charge in the business, factored on two independent dimensions:
//
//   - `serviceId` (below) — the BUSINESS dimension: which offering the money
//     belongs to (group classes, private lessons, camps, meets, ...).
//     Reporting/revenue-by-service/future QBO mapping all key off this.
//   - `billingShape` (the Mongoose discriminator key) — the STRUCTURAL
//     dimension: which fields and dedup index apply. There are only three,
//     ever: `subscription_cycle`, `per_session`, `one_time_event`. Adding a
//     new SERVICE (meets, once camps exists) is a Service seed-data row,
//     never a new discriminator — only a genuinely new billing shape needs
//     schema work.
//
// This deliberately does NOT copy CKQ's own Registration discriminator
// design, which uses the service's display-name string itself as the
// discriminator key (`'Group Class'`, `'Private Class'`) — that conflates
// the two dimensions, so CKQ grows a new near-duplicate sub-schema for
// every new service even when its billing shape already exists. Here, camps
// and meets both use the SAME `one_time_event` shape with zero schema
// changes — only a `Service` row each.
//
// Mutation contract, on every row regardless of shape (enforced by code
// discipline, not schema machinery): immutable after insert except the
// `pending -> completed|failed` transition and retry's own updates to
// `attempt` / `stripePaymentIntentId` / `failureMessage` / `paidAt` /
// `status`. Nothing ever rewrites `amount` or any shape-specific id
// reference after insert.
const registrationSchema = new Schema(
  {
    serviceId: {
      type: Schema.Types.ObjectId,
      ref: 'Service',
      required: true,
      index: true,
    },
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: REGISTRATION_STATUSES,
      required: true,
    },
    // Dollars — what was actually charged (or attempted).
    amount: {
      type: Number,
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
    // bumped by a successful or failed retry. A row is never duplicated for
    // a retry; the SAME row is updated in place.
    attempt: {
      type: Number,
      default: 1,
    },
    paidAt: {
      type: Date,
      default: null,
    },
    // Set only by a one-time migration script that reconstructed this row
    // from another collection's own last-known snapshot, not captured live
    // at charge time — best-effort, not charge-time truth. Never set by any
    // normal charge path. (scripts/lib/migrateRegistrationsToLedger.js and
    // scripts/lib/migrateToUnifiedLedger.js both use this flag.)
    backfilled: {
      type: Boolean,
      default: false,
    },
    // How this charge was collected (docs/plans/payment-airtight-plan.md
    // D5) — 'card' covers every existing row (the schema default; a row
    // created before this field existed reads back as `undefined`, which
    // every consumer treats the same as 'card' — never re-check `=== 'card'`
    // directly, always branch on `=== 'manual'` so old rows degrade
    // correctly with no migration needed for this field). 'manual' is set
    // ONLY by renewal.service.js's recordManualPayment — never by any real
    // Stripe charge path.
    chargeMethod: {
      type: String,
      enum: ['card', 'manual'],
      default: 'card',
    },
    // Required, non-empty, ONLY when chargeMethod is 'manual' (validated
    // below) — the admin's own note on why/how this was collected outside
    // Stripe (e.g. "paid by check #1042"). Null for every card charge.
    manualNote: {
      type: String,
      default: null,
    },
    // The superadmin who triggered this charge, for audit — set on a
    // manual recording AND on an admin-triggered card charge (the Charge
    // dialog, either period option); left null for the unscheduled cron's
    // own renewOne/retryOne calls and for a parent's own initial
    // registration, none of which have an acting admin. Set once at row
    // creation, never touched by the pending->completed|failed transition.
    recordedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
    discriminatorKey: 'billingShape',
  }
);

registrationSchema.path('manualNote').validate(function manualNoteRequiredForManualCharge(value) {
  if (this.chargeMethod !== 'manual') {
    return true;
  }

  return typeof value === 'string' && value.trim().length > 0;
}, 'manualNote is required and must be non-empty when chargeMethod is "manual"');

const Registration = mongoose.model('Registration', registrationSchema);

// ─── Discriminator 1: subscription_cycle (group classes) ──────────────────
const subscriptionCycleSchema = new Schema({
  subscriptionId: {
    type: Schema.Types.ObjectId,
    ref: 'Subscription',
    required: true,
  },
  // Snapshot at charge time, not a live ref to "the current" schedule — a
  // later schedule change on the Subscription must not rewrite what
  // schedule this charge was actually for.
  scheduleId: {
    type: Schema.Types.ObjectId,
    ref: 'GroupClassSchedule',
    required: true,
  },
  eventType: {
    type: String,
    enum: REGISTRATION_EVENT_TYPES,
    required: true,
  },
  // For 'initial' rows this amount INCLUDES the registration fee:
  // registration.service.js's create() charges both in a single
  // PaymentIntent, so the breakdown below is what that one PaymentIntent
  // was actually for.
  breakdown: {
    monthlyFee: { type: Number, required: true },
    prorated: { type: Boolean, default: false },
    proratedAmount: { type: Number, default: null },
    siblingDiscountApplied: { type: Boolean, default: false },
    siblingDiscountAmount: { type: Number, default: 0 },
    // 0 for every renewal row — a renewal never re-charges the one-time fee.
    // Only an 'initial' row can carry a non-zero value here.
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
  // Derived, immutable, 'YYYY-MM' bucket of `periodStart` (docs/plans/
  // payment-airtight-plan.md D7) — Guard B's dedup key below. Computed by
  // this schema's own pre-validate hook from periodStart's UTC calendar
  // parts, NEVER accepted from a caller, so it can never structurally
  // disagree with periodStart. Exists so "one payment per subscription per
  // calendar month, through every pathway" is a DB invariant even now that
  // a payment can be anchored mid-month (the admin Charge dialog's
  // "prorated from today" option, or a manual recording) rather than
  // always exactly on periodStart's own boundary — the OLD unique index on
  // the exact (subscriptionId, periodStart) pair would let two rows for
  // the same month, anchored on different days, both slip through.
  periodMonth: {
    type: String,
    required: true,
  },
});

// The single source of a ledger row's periodMonth bucket — the schema hook
// below AND any read-side code that needs to query by the same key (e.g.
// renewal.service.js's per-month dedup pre-check) must call this exact
// function, never reimplement the 'YYYY-MM' format inline. UTC getters,
// deliberately — periodStart is always a calendar-day sentinel (a
// UTC-midnight Date), and reading it via UTC parts is correct regardless of
// the host's own local timezone (dateShapes.js's convention), unlike a
// LOCAL-getter reading, which only agrees with the sentinel's real calendar
// day when the host itself runs in UTC.
function periodMonthOf(periodStart) {
  const year = periodStart.getUTCFullYear();
  const month = periodStart.getUTCMonth() + 1;

  return `${year}-${String(month).padStart(2, '0')}`;
}

subscriptionCycleSchema.pre('validate', function derivePeriodMonth(next) {
  if (this.periodStart) {
    this.periodMonth = periodMonthOf(this.periodStart);
  }

  next();
});

// Retry's "most recent failed row for this subscription" lookup
// (renewal.service.js's retryOne) — a plain query index, not a uniqueness
// guard.
subscriptionCycleSchema.index({ subscriptionId: 1, createdAt: -1 });

// Guard B — durable renewal dedup (CKQ's fourth double-charge protection
// layer), re-keyed from the exact (subscriptionId, periodStart) pair to
// (subscriptionId, periodMonth) — docs/plans/payment-airtight-plan.md D7 —
// so a duplicate payment for the same calendar month collides regardless of
// which day within that month either row anchors to. 'failed' is
// deliberately excluded so a failed charge never blocks its own retry.
// `subscriptionId: { $exists: true }` scopes this index to rows of THIS
// shape only — a per_session or one_time_event row has no subscriptionId
// at all, so it can never collide here (same $exists-scoping idiom CKQ's
// own group registration index uses).
subscriptionCycleSchema.index(
  { subscriptionId: 1, periodMonth: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ['pending', 'completed'] },
      subscriptionId: { $exists: true },
    },
  }
);

const SubscriptionCycleRegistration = Registration.discriminator(
  'SubscriptionCycleRegistration',
  subscriptionCycleSchema,
  'subscription_cycle'
);

// ─── Discriminator 2: per_session (private lessons) ────────────────────────
// Absorbs the former standalone PrivateClassCharge collection — same fields,
// same guarantee, now living on the unified ledger.
const perSessionSchema = new Schema({
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
});

// A session may have at most one non-failed charge at a time, so a
// double-save of the same attendance can never double-charge. 'failed' is
// excluded on purpose — a failed charge must never block a retry from
// creating a new one. `sessionId: { $exists: true }` scopes this to
// per_session rows only, same idiom as Guard B above.
perSessionSchema.index(
  { sessionId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ['pending', 'completed'] },
      sessionId: { $exists: true },
    },
  }
);

const PerSessionRegistration = Registration.discriminator(
  'PerSessionRegistration',
  perSessionSchema,
  'per_session'
);

// ─── Discriminator 3: one_time_event (camps / meets) ───────────────────────
// Schema-only for now — no consumer writes this shape yet (Service rows for
// 'camps'/'meets' are seeded but isActive: false until those features are
// built). Defined now so the architecture is complete and a future
// camps/meets PR only adds behavior, never reshapes the ledger.
const oneTimeEventSchema = new Schema({
  // Standard Mongoose polymorphic ref — `eventModel` names which collection
  // `eventId` points into. The referenced models (Camp, Meet) not existing
  // yet is fine; refs only resolve at populate time.
  eventId: {
    type: Schema.Types.ObjectId,
    required: true,
    refPath: 'eventModel',
  },
  eventModel: {
    type: String,
    enum: ['Camp', 'Meet'],
    required: true,
  },
});

// One non-failed payment per student per event.
oneTimeEventSchema.index(
  { eventId: 1, studentId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ['pending', 'completed'] },
      eventId: { $exists: true },
    },
  }
);

const OneTimeEventRegistration = Registration.discriminator(
  'OneTimeEventRegistration',
  oneTimeEventSchema,
  'one_time_event'
);

module.exports = Registration;
module.exports.REGISTRATION_STATUSES = REGISTRATION_STATUSES;
module.exports.REGISTRATION_EVENT_TYPES = REGISTRATION_EVENT_TYPES;
module.exports.BILLING_SHAPES = BILLING_SHAPES;
module.exports.SubscriptionCycleRegistration = SubscriptionCycleRegistration;
module.exports.PerSessionRegistration = PerSessionRegistration;
module.exports.OneTimeEventRegistration = OneTimeEventRegistration;
module.exports.periodMonthOf = periodMonthOf;
