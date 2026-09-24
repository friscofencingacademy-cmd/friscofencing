const mongoose = require('mongoose');

const { Schema } = mongoose;

// pending   — slot reserved, purchase charge not yet resolved
// confirmed — booked (paid by a purchase or by a credit)
// cancelled — a confirmed booking cancelled before it started; credit returned
// released  — never confirmed (payment failed, or an abandoned pending hold);
//             the slot was given back
const PRIVATE_CLASS_SESSION_STATUSES = ['pending', 'confirmed', 'cancelled', 'released'];
const PRIVATE_CLASS_SESSION_RELEASE_REASONS = ['payment_failed', 'abandoned'];

// Statuses that hold a slot — the partial unique index below and every
// availability query use exactly this list.
const SLOT_HOLDING_STATUSES = ['pending', 'confirmed'];

// In Frisco a private session IS A BOOKING (docs/decisions/011-private-per-
// session-booking.md): one student, one date of one PrivateClassSchedule
// rule. It is created only when a parent books — nothing is generated ahead
// of time. Inserting it is the atomic slot claim (the partial unique index
// below), which is why it names the student: the winning document must say
// who won.
//
// Attendance is NOT stored here — it is the session's Visit (ADR 010).
// Money is NOT stored here — it is the Registration ledger.
const privateClassSessionSchema = new Schema(
  {
    scheduleId: {
      type: Schema.Types.ObjectId,
      ref: 'PrivateClassSchedule',
      required: true,
    },
    // The purchase whose credit this booking uses.
    enrollmentId: {
      type: Schema.Types.ObjectId,
      ref: 'PrivateClassEnrollment',
      required: true,
    },
    // Denormalized from the schedule/enrollment at booking time.
    coachId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
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
    // Real instants (ADR 009) — built only via dateShapes.js's
    // combineDayAndTimeInTZ from the booked day + the schedule's startTime.
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: PRIVATE_CLASS_SESSION_STATUSES,
      required: true,
      default: 'pending',
    },
    releaseReason: {
      type: String,
      enum: [...PRIVATE_CLASS_SESSION_RELEASE_REASONS, null],
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancelledBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// The atomic slot claim: at most one slot-holding booking per schedule per
// start instant. Partial, so a cancelled/released booking frees the slot
// without deleting its history.
privateClassSessionSchema.index(
  { scheduleId: 1, startDate: 1 },
  { unique: true, partialFilterExpression: { status: { $in: SLOT_HOLDING_STATUSES } } }
);
privateClassSessionSchema.index({ coachId: 1, startDate: 1 });
privateClassSessionSchema.index({ enrollmentId: 1 });
privateClassSessionSchema.index({ parentId: 1, startDate: 1 });

const PrivateClassSession = mongoose.model('PrivateClassSession', privateClassSessionSchema);

module.exports = PrivateClassSession;
module.exports.PRIVATE_CLASS_SESSION_STATUSES = PRIVATE_CLASS_SESSION_STATUSES;
module.exports.PRIVATE_CLASS_SESSION_RELEASE_REASONS = PRIVATE_CLASS_SESSION_RELEASE_REASONS;
module.exports.SLOT_HOLDING_STATUSES = SLOT_HOLDING_STATUSES;
