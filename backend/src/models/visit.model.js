const mongoose = require('mongoose');

const { Schema } = mongoose;

// 'private' is the only classType a private-lesson Visit may carry, and the
// only one a group Visit may never carry — enforced by the validator below.
const VISIT_CLASS_TYPES = ['regular', 'trial', 'private'];
const VISIT_STATUSES = ['scheduled', 'attended', 'missed', 'cancelled'];
const VISIT_MARKED_VIA = ['coach', 'admin'];

// The academy's attendance ledger — ONE row per student per session, for
// every service (docs/decisions/010-universal-visit-ledger.md). It is the
// single source of truth for "did this student attend": group classes
// (replacing GroupClassSession.students[].isPresent, docs/plans/premium-
// registration-and-attendance-plan.md §1) and private lessons (replacing
// PrivateClassSession.attendance, docs/plans/private-class-per-session-
// booking-plan.md D7) alike. Money never lives here — that is the
// Registration ledger.
//
// Shape follows CKQ's own universal Visit (serviceId + one session ref per
// service), kept as flat fields so no group field was ever renamed. Exactly
// one session ref is set per row (validator below); `serviceId` names the
// business service the visit belongs to, the same dimension every
// Registration row carries. visit.service.js is the only writer and resolves
// serviceId by Service code — never a caller-supplied id.
//
// Uniqueness per (studentId, session) among non-cancelled rows is enforced in
// visit.service.js's upsert logic, not a DB index — a real unique index would
// reject the legitimate cancelled -> re-scheduled transition
// upsertScheduledVisits performs, same as CKQ's own Visit model.
const visitSchema = new Schema(
  {
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    serviceId: {
      type: Schema.Types.ObjectId,
      ref: 'Service',
      required: true,
    },
    // Group-class visit refs — set together, or both null on a private visit.
    groupClassSessionId: {
      type: Schema.Types.ObjectId,
      ref: 'GroupClassSession',
      default: null,
    },
    // Denormalized (matches CKQ) — every roster/history query needs "this
    // student's visits for this schedule" without a session lookup first.
    groupClassScheduleId: {
      type: Schema.Types.ObjectId,
      ref: 'GroupClassSchedule',
      default: null,
    },
    // Private-lesson visit ref. The session itself names its schedule, so no
    // denormalized schedule ref is needed here.
    privateClassSessionId: {
      type: Schema.Types.ObjectId,
      ref: 'PrivateClassSession',
      default: null,
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
    // Set only by addStudentToSession (group walk-ins) — distinguishes a
    // walk-in from a real roster student for removeStudentFromSession's guard.
    isMakeupClass: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Exactly one session ref, and a classType consistent with it. Runs on
// create/save; visit.service.js's upserts set the same fields via
// $setOnInsert, which is why its functions are the only sanctioned writers.
visitSchema.pre('validate', function assertOneSessionRef(next) {
  const isGroup = Boolean(this.groupClassSessionId);
  const isPrivate = Boolean(this.privateClassSessionId);

  if (isGroup === isPrivate) {
    return next(new Error('A Visit must reference exactly one of groupClassSessionId or privateClassSessionId'));
  }

  if (isGroup && !this.groupClassScheduleId) {
    return next(new Error('A group-class Visit requires groupClassScheduleId'));
  }

  if (isGroup && this.classType === 'private') {
    return next(new Error("A group-class Visit cannot have classType 'private'"));
  }

  if (isPrivate && this.classType !== 'private') {
    return next(new Error("A private-lesson Visit must have classType 'private'"));
  }

  if (isPrivate && this.groupClassScheduleId) {
    return next(new Error('A private-lesson Visit cannot reference a group-class schedule'));
  }

  return next();
});

visitSchema.index({ studentId: 1, groupClassSessionId: 1 });
visitSchema.index({ groupClassSessionId: 1, status: 1 });
visitSchema.index({ studentId: 1, groupClassScheduleId: 1 });
visitSchema.index({ privateClassSessionId: 1, status: 1 });
// Student visit history by service (CKQ's own index).
visitSchema.index({ studentId: 1, serviceId: 1 });

const Visit = mongoose.model('Visit', visitSchema);

module.exports = Visit;
module.exports.VISIT_CLASS_TYPES = VISIT_CLASS_TYPES;
module.exports.VISIT_STATUSES = VISIT_STATUSES;
module.exports.VISIT_MARKED_VIA = VISIT_MARKED_VIA;
