const GroupClassSession = require('../models/groupClassSession.model');
const GroupClassSchedule = require('../models/groupClassSchedule.model');

const SESSION_COUNT = 8;
const DAYS_PER_WEEK = 7;

function notFoundError(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function forbiddenError(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}

function badRequestError(message) {
  const error = new Error(message);
  error.status = 400;
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

const DEFAULT_UPCOMING_WINDOW_DAYS = 30;

// Trial booking no longer makes the parent pick a schedule first — this
// lists every upcoming session across ALL of a class's schedules (e.g. a
// class that runs Mon and Wed both), so a session itself is the only thing
// picked. `date` range is today-inclusive (see nextOccurrenceOnOrAfter's
// same "on or after" convention) through `+days`, computed here — never on
// the frontend — matching this codebase's "no client-side availability
// math" rule. Only the display-relevant schedule fields are populated:
// never the roster (`students`) or `coachId` — a parent browsing trial
// dates must never see another family's child names.
async function listUpcomingByClass(classId, days = DEFAULT_UPCOMING_WINDOW_DAYS) {
  const scheduleIds = await GroupClassSchedule.find({ classId }).distinct('_id');

  const rangeStart = new Date();
  rangeStart.setHours(0, 0, 0, 0);

  const rangeEnd = new Date(rangeStart);
  rangeEnd.setDate(rangeEnd.getDate() + days);

  return GroupClassSession.find({
    scheduleId: { $in: scheduleIds },
    date: { $gte: rangeStart, $lte: rangeEnd },
  })
    .sort({ date: 1, scheduleId: 1 })
    .populate('scheduleId', 'dayOfWeek startTime endTime');
}

async function getById(id) {
  const session = await GroupClassSession.findById(id).populate(
    'students.studentId',
    'firstName lastName'
  );

  if (!session) {
    throw notFoundError('Group class session not found');
  }

  return session;
}

// Coach-marks-their-own-session-attendance mutation. Admins/superadmins may
// mark any session; a coach may only mark a session belonging to a schedule
// they are assigned to. This can only flip `isPresent` on students already
// on the session's roster snapshot — it can never add/remove roster entries.
async function markAttendance(sessionId, studentUpdates, requestingUser) {
  const session = await GroupClassSession.findById(sessionId);

  if (!session) {
    throw notFoundError('Group class session not found');
  }

  const schedule = await GroupClassSchedule.findById(session.scheduleId);

  if (!schedule) {
    throw notFoundError('Group class schedule not found');
  }

  const isAdmin = requestingUser.role === 'admin' || requestingUser.role === 'superadmin';
  const isAssignedCoach =
    requestingUser.role === 'coach' && String(schedule.coachId) === String(requestingUser._id);

  if (!isAdmin && !isAssignedCoach) {
    throw forbiddenError('You are not the assigned coach for this session');
  }

  const updates = studentUpdates || [];
  const rosterIds = new Set(session.students.map((entry) => String(entry.studentId)));

  updates.forEach((update) => {
    if (!rosterIds.has(String(update.studentId))) {
      throw badRequestError(
        "Unknown studentId: cannot attendance-mark a student not on this session's roster"
      );
    }
  });

  updates.forEach((update) => {
    const entry = session.students.find(
      (s) => String(s.studentId) === String(update.studentId)
    );

    if (entry) {
      entry.isPresent = update.isPresent;
    }
  });

  await session.save();

  return getById(sessionId);
}

module.exports = {
  generateInitialSessions,
  listBySchedule,
  listUpcomingByClass,
  getById,
  markAttendance,
};
