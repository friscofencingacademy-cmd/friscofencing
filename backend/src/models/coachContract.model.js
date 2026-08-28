const mongoose = require('mongoose');

const { Schema } = mongoose;

// The rate contract behind a coach's private-lesson slots. Creating a new
// contract for a coach deactivates their previous active one (enforced in
// coachContract.service.js, not here) — one active contract per coach.
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
      default: 60,
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
    notes: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

coachContractSchema.index({ coachId: 1, isActive: 1 });

module.exports = mongoose.model('CoachContract', coachContractSchema);
