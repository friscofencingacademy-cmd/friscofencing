const Visit = require('../models/visit.model');

// Mirrors chesskqwebsite/backend/backend-2.0/src/services/visit.service.js
// function-for-function (verified directly, not assumed — see
// docs/plans/premium-registration-and-attendance-plan.md §3.1), adapted to
// Frisco's flat field names and its required groupClassScheduleId.

// Upsert scheduled Visits for a student across one or more sessions.
// `sessions`: [{ sessionId, scheduleId }]. Idempotent:
//  - creates status:'scheduled' where no Visit exists yet for that
//    (studentId, sessionId) pair
//  - reactivates a cancelled Visit back to 'scheduled'
//  - leaves an already-scheduled/attended/missed Visit untouched
async function upsertScheduledVisits(studentId, sessions, classType = 'regular') {
  if (!sessions || sessions.length === 0) return null;

  const insertOps = sessions.map(({ sessionId, scheduleId }) => ({
    updateOne: {
      filter: { studentId, groupClassSessionId: sessionId },
      update: {
        $setOnInsert: {
          studentId,
          groupClassSessionId: sessionId,
          groupClassScheduleId: scheduleId,
          classType,
          status: 'scheduled',
        },
      },
      upsert: true,
    },
  }));

  const reactivateOps = sessions.map(({ sessionId }) => ({
    updateOne: {
      filter: { studentId, groupClassSessionId: sessionId, status: 'cancelled' },
      update: { $set: { status: 'scheduled', classType } },
    },
  }));

  return Visit.bulkWrite([...insertOps, ...reactivateOps], { ordered: false });
}

// Convenience wrapper — upsert a scheduled Visit for a single session.
async function createScheduledVisit(studentId, sessionId, scheduleId, classType = 'regular') {
  return upsertScheduledVisits(studentId, [{ sessionId, scheduleId }], classType);
}

// Every non-cancelled Visit for a session, student names populated — this
// is what a session's roster display reads instead of the old
// GroupClassSession.students snapshot.
async function getActiveVisitsForSession(sessionId) {
  return Visit.find({ groupClassSessionId: sessionId, status: { $ne: 'cancelled' } })
    .populate('studentId', 'firstName lastName')
    .lean();
}

async function findActiveVisit(studentId, sessionId) {
  return Visit.findOne({ studentId, groupClassSessionId: sessionId, status: { $ne: 'cancelled' } });
}

// Upserts a Visit's attendance status — creates it if none exists yet (the
// walk-in case, via addStudentToSession in Phase 3), updates it otherwise
// (a normal roster student's first mark, or a re-toggle).
async function markAttendance(studentId, sessionId, scheduleId, classType, status, markedBy = null, markedVia = null) {
  return Visit.findOneAndUpdate(
    { studentId, groupClassSessionId: sessionId },
    {
      $set: { status, classType, markedBy, markedVia },
      $setOnInsert: { studentId, groupClassSessionId: sessionId, groupClassScheduleId: scheduleId },
    },
    { upsert: true, new: true }
  );
}

// Stamped as a separate, targeted update (not a markAttendance parameter) —
// Phase 3's addStudentToSession calls this immediately after markAttendance,
// specifically so a LATER markAttendance call (e.g. toggling to 'missed')
// can never accidentally clear it: markAttendance's $set never includes
// this field. Matches CKQ's own visit.service.js comment verbatim.
async function markAsMakeupClass(studentId, sessionId) {
  return Visit.updateOne({ studentId, groupClassSessionId: sessionId }, { $set: { isMakeupClass: true } });
}

async function cancelVisitsForStudent(studentId, sessionIds) {
  if (!sessionIds || sessionIds.length === 0) return null;

  return Visit.updateMany(
    { studentId, groupClassSessionId: { $in: sessionIds } },
    { $set: { status: 'cancelled' } }
  );
}

async function getVisitsByStudent(studentId) {
  return Visit.find({ studentId }).sort({ createdAt: -1 }).lean();
}

module.exports = {
  upsertScheduledVisits,
  createScheduledVisit,
  getActiveVisitsForSession,
  findActiveVisit,
  markAttendance,
  markAsMakeupClass,
  cancelVisitsForStudent,
  getVisitsByStudent,
};
