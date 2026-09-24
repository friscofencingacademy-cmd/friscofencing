const Visit = require('../models/visit.model');
const { getServiceByCode } = require('./serviceCatalog.service');

// The only writer of the Visit attendance ledger (docs/decisions/010-
// universal-visit-ledger.md). Group-class functions mirror
// chesskqwebsite/backend/backend-2.0/src/services/visit.service.js
// function-for-function (docs/plans/premium-registration-and-attendance-
// plan.md §3.1); the private-lesson functions below are the same idioms keyed
// on privateClassSessionId.
//
// Every insert stamps `serviceId`, resolved here by Service code — callers
// never pass one, so a Visit can never name the wrong service. The upserts
// below bypass Mongoose validation (bulkWrite / findOneAndUpdate), which is
// exactly why they must set every required field explicitly in $setOnInsert.

const GROUP_SERVICE_CODE = 'group-classes';
const PRIVATE_SERVICE_CODE = 'private-lessons';

async function serviceIdFor(code) {
  const service = await getServiceByCode(code);
  return service._id;
}

// ── Group classes ─────────────────────────────────────────────────────────

// Upsert scheduled Visits for a student across one or more sessions.
// `sessions`: [{ sessionId, scheduleId }]. Idempotent:
//  - creates status:'scheduled' where no Visit exists yet for that
//    (studentId, sessionId) pair
//  - reactivates a cancelled Visit back to 'scheduled'
//  - leaves an already-scheduled/attended/missed Visit untouched
async function upsertScheduledVisits(studentId, sessions, classType = 'regular') {
  if (!sessions || sessions.length === 0) return null;

  const serviceId = await serviceIdFor(GROUP_SERVICE_CODE);

  const insertOps = sessions.map(({ sessionId, scheduleId }) => ({
    updateOne: {
      filter: { studentId, groupClassSessionId: sessionId },
      update: {
        $setOnInsert: {
          studentId,
          serviceId,
          groupClassSessionId: sessionId,
          groupClassScheduleId: scheduleId,
          privateClassSessionId: null,
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
// walk-in case, via addStudentToSession), updates it otherwise (a normal
// roster student's first mark, or a re-toggle).
async function markAttendance(studentId, sessionId, scheduleId, classType, status, markedBy = null, markedVia = null) {
  const serviceId = await serviceIdFor(GROUP_SERVICE_CODE);

  return Visit.findOneAndUpdate(
    { studentId, groupClassSessionId: sessionId },
    {
      $set: { status, classType, markedBy, markedVia },
      $setOnInsert: {
        studentId,
        serviceId,
        groupClassSessionId: sessionId,
        groupClassScheduleId: scheduleId,
        privateClassSessionId: null,
      },
    },
    { upsert: true, new: true }
  );
}

// Stamped as a separate, targeted update (not a markAttendance parameter) —
// addStudentToSession calls this immediately after markAttendance,
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

// Every Visit of any service, newest first.
async function getVisitsByStudent(studentId) {
  return Visit.find({ studentId }).sort({ createdAt: -1 }).lean();
}

// ── Private lessons ───────────────────────────────────────────────────────
// A private session has exactly one student, so its Visit is keyed on the
// session alone for reads/cancels; the student is still part of every upsert
// filter so a Visit can never be attached to the wrong child.

// Idempotent, same contract as upsertScheduledVisits: creates a scheduled
// Visit, reactivates a cancelled one, leaves a marked one untouched.
async function createScheduledPrivateVisit(studentId, sessionId) {
  const serviceId = await serviceIdFor(PRIVATE_SERVICE_CODE);

  return Visit.bulkWrite(
    [
      {
        updateOne: {
          filter: { studentId, privateClassSessionId: sessionId },
          update: {
            $setOnInsert: {
              studentId,
              serviceId,
              groupClassSessionId: null,
              groupClassScheduleId: null,
              privateClassSessionId: sessionId,
              classType: 'private',
              status: 'scheduled',
            },
          },
          upsert: true,
        },
      },
      {
        updateOne: {
          filter: { studentId, privateClassSessionId: sessionId, status: 'cancelled' },
          update: { $set: { status: 'scheduled' } },
        },
      },
    ],
    { ordered: true }
  );
}

async function findActivePrivateVisit(studentId, sessionId) {
  return Visit.findOne({ studentId, privateClassSessionId: sessionId, status: { $ne: 'cancelled' } });
}

// Upsert — the scheduled Visit a confirmed booking creates is normally there
// already; the upsert is the safety net if that write ever failed.
async function markPrivateAttendance(studentId, sessionId, status, markedBy = null, markedVia = null) {
  const serviceId = await serviceIdFor(PRIVATE_SERVICE_CODE);

  return Visit.findOneAndUpdate(
    { studentId, privateClassSessionId: sessionId },
    {
      $set: { status, markedBy, markedVia },
      $setOnInsert: {
        studentId,
        serviceId,
        groupClassSessionId: null,
        groupClassScheduleId: null,
        privateClassSessionId: sessionId,
        classType: 'private',
      },
    },
    { upsert: true, new: true }
  );
}

async function cancelPrivateVisit(sessionId) {
  return Visit.updateMany(
    { privateClassSessionId: sessionId, status: { $ne: 'cancelled' } },
    { $set: { status: 'cancelled' } }
  );
}

// sessionId -> Visit status for a batch of private sessions (one query) —
// how every private-session listing reads attendance. A session with no
// Visit reads as 'scheduled'.
async function getPrivateVisitStatusBySession(sessionIds) {
  if (!sessionIds || sessionIds.length === 0) return new Map();

  const visits = await Visit.find(
    { privateClassSessionId: { $in: sessionIds } },
    'privateClassSessionId status'
  ).lean();

  return new Map(visits.map((visit) => [String(visit.privateClassSessionId), visit.status]));
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
  createScheduledPrivateVisit,
  findActivePrivateVisit,
  markPrivateAttendance,
  cancelPrivateVisit,
  getPrivateVisitStatusBySession,
};
