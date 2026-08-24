const mongoose = require('mongoose');

const { Schema } = mongoose;

const VISIT_CLASS_TYPES = ['regular', 'trial'];
const VISIT_STATUSES = ['scheduled', 'attended', 'missed', 'cancelled'];
const VISIT_MARKED_VIA = ['coach', 'admin'];

// The attendance ledger — replaces GroupClassSession.students[].isPresent as
// the source of truth (docs/plans/premium-registration-and-attendance-plan.md
// §1). One Visit per (studentId, groupClassSessionId) among non-cancelled
// records; uniqueness is enforced in visit.service.js's upsert logic, not a
// DB index — a real unique index would reject the legitimate
// cancelled -> re-scheduled transition upsertScheduledVisits performs (see
// that function's second bulkWrite op), same as CKQ's own Visit model.
const visitSchema = new Schema(
  {
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    groupClassSessionId: {
      type: Schema.Types.ObjectId,
      ref: 'GroupClassSession',
      required: true,
    },
    // Denormalized (matches CKQ) — every roster/history query needs "this
    // student's visits for this schedule" without a session lookup first.
    groupClassScheduleId: {
      type: Schema.Types.ObjectId,
      ref: 'GroupClassSchedule',
      required: true,
    },
    classType: {
      type: String,
      enum: VISIT_CLASS_TYPES,
      required: true,
    },
    status: {
      type: String,
      enum: VISIT_STATUSES,
      default: 'scheduled',
    },
    markedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    markedVia: {
      type: String,
      enum: VISIT_MARKED_VIA,
      default: null,
    },
    // Set only by addStudentToSession (Phase 3) — distinguishes a walk-in
    // from a real roster student for removeStudentFromSession's guard.
    isMakeupClass: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

visitSchema.index({ studentId: 1, groupClassSessionId: 1 });
visitSchema.index({ groupClassSessionId: 1, status: 1 });
visitSchema.index({ studentId: 1, groupClassScheduleId: 1 });

const Visit = mongoose.model('Visit', visitSchema);

module.exports = Visit;
module.exports.VISIT_CLASS_TYPES = VISIT_CLASS_TYPES;
module.exports.VISIT_STATUSES = VISIT_STATUSES;
module.exports.VISIT_MARKED_VIA = VISIT_MARKED_VIA;
