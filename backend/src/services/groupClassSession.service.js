const GroupClassSession = require('../models/groupClassSession.model');

const SESSION_COUNT = 8;
const DAYS_PER_WEEK = 7;

function notFoundError(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

// Returns the next date on/after `fromDate` that falls on `dayOfWeek`
// (0=Sunday...6=Saturday, Date.getDay() convention). If `fromDate` itself
// already falls on `dayOfWeek`, it is returned (diff 0) — "on or after".
function nextOccurrenceOnOrAfter(fromDate, dayOfWeek) {
  const result = new Date(fromDate);
  result.setHours(0, 0, 0, 0);

  const diff = (dayOfWeek - result.getDay() + 7) % 7;
  result.setDate(result.getDate() + diff);

  return result;
}

// Pure-ish: the only non-deterministic input is `new Date()` at call time,
// which is fine for real runtime code (not under test as a pure function —
// the route test instead asserts the resulting dates' day-of-week and
// 7-day spacing, not exact instants).
function generateInitialSessions(schedule) {
  const firstDate = nextOccurrenceOnOrAfter(new Date(), schedule.dayOfWeek);

  // Snapshot the schedule's roster as of session-generation time. Attendance
  // marking (mutating isPresent) is Phase 5 — here it's always seeded false.
  const studentsSnapshot = (schedule.students || []).map((studentId) => ({
    studentId,
    isPresent: false,
  }));

  const sessions = [];

  for (let i = 0; i < SESSION_COUNT; i += 1) {
    const date = new Date(firstDate);
    date.setDate(date.getDate() + i * DAYS_PER_WEEK);

    sessions.push({
      scheduleId: schedule._id,
      date,
      students: studentsSnapshot.map((entry) => ({ ...entry })),
    });
  }

  return sessions;
}

async function listBySchedule(scheduleId) {
  return GroupClassSession.find({ scheduleId }).sort({ date: 1 });
}

async function getById(id) {
  const session = await GroupClassSession.findById(id);

  if (!session) {
    throw notFoundError('Group class session not found');
  }

  return session;
}

module.exports = { generateInitialSessions, listBySchedule, getById };
