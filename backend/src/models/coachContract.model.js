const mongoose = require('mongoose');

const { Schema } = mongoose;

// The default private-lesson length (owner decision 2026-09-25: most
// fencing private lessons are 30 minutes). The one home of this default on
// the backend — privateClassSchedule.model.js reuses it. A coach's slot
// length is their contract's sessionDurationMinutes unless the publisher
// types another.
const DEFAULT_LESSON_MINUTES = 30;

// The rate contract behind a coach's private-lesson slots — one VERSION of
// it. Editing a contract never changes a version in place: it ends the
// current version (effectiveTo, endReason 'revised') and starts a new one
// (docs/plans/coach-pack-pricing-plan.md §8). One active version per coach,
// enforced in coachContract.service.js, not here.
const coachContractSchema = new Schema(
  {
    // Always the 'private-lessons' Service today — CoachContract has no
    // other consumer yet. Set internally by coachContract.service.js's
    // create(), never accepted from a client request; the day a second
    // coach-facing service exists, the create() API can start accepting it
    // (docs/plans/service-registry-unified-ledger-plan.md D5.5/D7).
    serviceId: {
      type: Schema.Types.ObjectId,
      ref: 'Service',
      required: true,
    },
    coachId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // $/HOUR billed to the parent.
    studentBillingRate: {
      type: Number,
      required: true,
      min: 0,
    },
    // $/hour paid to the coach — stored for audit/future payroll only, no
    // payout UI in this plan (D11).
    coachCompensationRate: {
      type: Number,
      required: true,
      min: 0,
    },
    sessionDurationMinutes: {
      type: Number,
      default: DEFAULT_LESSON_MINUTES,
      min: 15,
    },
    effectiveFrom: {
      type: Date,
      default: Date.now,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // When this version stopped being current, and why: 'revised' (replaced
    // by an edit — a newer version starts at the same instant) or
    // 'deactivated'. Both unset while the version is current, and on
    // versions that ended before these fields existed.
    effectiveTo: {
      type: Date,
    },
    endReason: {
      type: String,
      enum: ['revised', 'deactivated'],
    },
    notes: {
      type: String,
    },
    // This coach's private-lesson packs (docs/plans/coach-pack-pricing-
    // plan.md): a fixed total `price` for `quantity` lessons of exactly
    // `sessionDurationMinutes`. A single session at the hourly rate is always
    // offered and is never a row here. Each pack's Mongoose `_id` is the
    // `packId` a parent's purchase request carries. Validated ONLY by
    // utils/privateClassPricing.js's validatePacks (the price band, D8) —
    // called by coachContract.service.js on every write. A version's packs
    // never change; editing them makes a new version, whose packs are new
    // subdocuments with new ids (plan §8 V5).
    privateLessonPacks: {
      type: [
        {
          sessionDurationMinutes: { type: Number, required: true, min: 15 },
          quantity: { type: Number, required: true, min: 2 },
          price: { type: Number, required: true, min: 0.01 },
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

coachContractSchema.index({ coachId: 1, isActive: 1 });

module.exports = mongoose.model('CoachContract', coachContractSchema);
module.exports.DEFAULT_LESSON_MINUTES = DEFAULT_LESSON_MINUTES;
