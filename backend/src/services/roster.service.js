const GroupClassSession = require('../models/groupClassSession.model');
const visitService = require('./visit.service');

// Shared roster-mutation helpers — the same "add/remove a student from a
// schedule's ongoing roster + every already-generated future session" logic
// that registration.service.js (add, on first registration) and
// renewal.service.js (remove, on cancellation finalize) each need, also
// reused by subscription.service.js's changeSchedule (both directions on
// one call) and backend/scripts/lib/runLegacyImport.js's migration.
// Extracted here on its third use rather than duplicated a third time
// (docs/plans/ckq-parity-plan.md §4.1).
//
// The future-sessions half now goes through Visit instead of mutating each
// session's own roster array (docs/plans/premium-registration-and-attendance
// -plan.md §3.5 — GroupClassSession no longer has a students field at all).
// schedule.students itself is untouched — still the enrollment roster,
// still what capacity checks and "whose home schedule is this" read.
//
// `today` (both functions below) MUST be a calendar-day sentinel — the same
// UTC-midnight shape GroupClassSession.date itself uses (docs/plans/
// utc-date-standard-plan.md) — never a real instant like billingDates.js's
// todayAtMidnight(). It feeds a `date: { $gte: today }` query directly;
// passing an instant silently excludes a session dated exactly today (bug
// 5 in that plan). Every current caller passes todayDateOnly().

async function addStudentToRoster(schedule, studentId, today) {
  const alreadyOnRoster = schedule.students.some((id) => String(id) === String(studentId));

  if (!alreadyOnRoster) {
    schedule.students.push(studentId);
    await schedule.save();
  }

  const futureSessions = await GroupClassSession.find(
    { scheduleId: schedule._id, date: { $gte: today } },
    '_id'
  );

  await visitService.upsertScheduledVisits(
    studentId,
    futureSessions.map((session) => ({ sessionId: session._id, scheduleId: schedule._id })),
    'regular'
  );
}

async function removeStudentFromRoster(schedule, studentId, today) {
  const onSchedule = schedule.students.some((id) => String(id) === String(studentId));

  if (onSchedule) {
    schedule.students = schedule.students.filter((id) => String(id) !== String(studentId));
    await schedule.save();
  }

  const futureSessions = await GroupClassSession.find(
    { scheduleId: schedule._id, date: { $gte: today } },
    '_id'
  );

  await visitService.cancelVisitsForStudent(
    studentId,
    futureSessions.map((session) => session._id)
  );
}

module.exports = { addStudentToRoster, removeStudentFromRoster };
