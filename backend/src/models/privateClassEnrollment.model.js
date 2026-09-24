const mongoose = require('mongoose');

const { Schema } = mongoose;

// pending -> active on a successful purchase charge; pending -> failed when
// the charge is declined or the purchase is abandoned. Only `active`
// enrollments hold usable credits.
const PRIVATE_CLASS_ENROLLMENT_STATUSES = ['pending', 'active', 'failed'];

// ONE PURCHASE of private-lesson credits (docs/plans/private-class-per-
// session-booking-plan.md D4): "10 sessions with Coach X, 30 minutes each, at
// this pinned rate." Created pending-first, before any Stripe call, exactly
// like a group Subscription (ADR 008).
//
// This is the operational credit balance, not the money record: what was
// charged lives only on its Registration ledger row (one row per enrollment),
// which is the source of truth in any disagreement
// (scripts/check-private-credit-ledger.js reconciles the two).
//
// agreedHourlyRate, sessionDurationMinutes, quantity and discountPercent are
// PINNED at purchase and immutable afterward — one purchase, one price.
// sessionsUsed is the only field that moves after activation, and only
// through privateClassSession.service.js's atomic guarded $inc. Remaining
// credits are always derived (quantity - sessionsUsed), never stored.
const privateClassEnrollmentSchema = new Schema(
  {
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
    coachId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Audit trail: which contract set the pinned rate below.
    coachContractId: {
      type: Schema.Types.ObjectId,
      ref: 'CoachContract',
      required: true,
    },
    agreedHourlyRate: {
      type: Number,
      required: true,
      min: 0,
    },
    // A credit books only a slot of exactly this length.
    sessionDurationMinutes: {
      type: Number,
      required: true,
      min: 15,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    discountPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 0,
    },
    sessionsUsed: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    status: {
      type: String,
      enum: PRIVATE_CLASS_ENROLLMENT_STATUSES,
      default: 'pending',
    },
  },
  {
    timestamps: true,
  }
);

privateClassEnrollmentSchema.path('sessionsUsed').validate(function withinQuantity(value) {
  return this.quantity === undefined || value <= this.quantity;
}, 'sessionsUsed cannot exceed quantity');

// Credit lookup: a student's usable enrollments with a coach, oldest first.
privateClassEnrollmentSchema.index({ studentId: 1, coachId: 1, status: 1, createdAt: 1 });
privateClassEnrollmentSchema.index({ parentId: 1, createdAt: -1 });

const PrivateClassEnrollment = mongoose.model('PrivateClassEnrollment', privateClassEnrollmentSchema);

module.exports = PrivateClassEnrollment;
module.exports.PRIVATE_CLASS_ENROLLMENT_STATUSES = PRIVATE_CLASS_ENROLLMENT_STATUSES;
