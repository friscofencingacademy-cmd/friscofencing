const GroupClassSession = require('../models/groupClassSession.model');
const GroupClassSchedule = require('../models/groupClassSchedule.model');
const Subscription = require('../models/subscription.model');
const Visit = require('../models/visit.model');
const visitService = require('./visit.service');

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

function conflictError(message) {
  const error = new Error(message);
  error.status = 409;
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
//
// No roster snapshot any more (removed alongside GroupClassSession.students
// — docs/plans/premium-registration-and-attendance-plan.md §1/§3.2): this
// always ran at schedule-CREATION time, when a brand-new schedule has no
// roster yet anyway, so the snapshot was already vestigial in real usage.
// A student's scheduled Visits for these sessions are created separately,
// by roster.service.js's addStudentToRoster, whenever they actually
// register.
function generateInitialSessions(schedule) {
  const firstDate = nextOccurrenceOnOrAfter(new Date(), schedule.dayOfWeek);

  const sessions = [];

  for (let i = 0; i < SESSION_COUNT; i += 1) {
    const date = new Date(firstDate);
    date.setDate(date.getDate() + i * DAYS_PER_WEEK);

    sessions.push({ scheduleId: schedule._id, date });
  }

  return sessions;
}

// Batch-attaches a `students: [{studentId, isPresent}]` array to each
// session, computed live from Visit — preserves the exact external response
// shape every existing caller (admin/coach sessions list pages) already
// depends on, so nothing downstream needed to change when the roster
// snapshot moved out of the schema. `isPresent` maps 1:1 from Visit.status:
// true only for 'attended' — 'scheduled'/'missed' both read as false,
// matching today's exact "unmarked reads as unchecked" default.
async function attachRosterToSessions(sessions) {
  if (sessions.length === 0) return sessions;

  const sessionIds = sessions.map((session) => session._id);
  const visits = await Visit.find(
    { groupClassSessionId: { $in: sessionIds }, status: { $ne: 'cancelled' } },
    'studentId groupClassSessionId status classType'
  ).lean();

  const bySession = new Map();
  visits.forEach((visit) => {
    const key = String(visit.groupClassSessionId);
    if (!bySession.has(key)) bySession.set(key, []);
    bySession.get(key).push({
      studentId: visit.studentId,
      isPresent: visit.status === 'attended',
      classType: visit.classType,
    });
  });

  return sessions.map((session) => {
    const plain = session.toObject ? session.toObject() : session;
    return { ...plain, students: bySession.get(String(session._id)) || [] };
  });
}

async function listBySchedule(scheduleId) {
  const sessions = await GroupClassSession.find({ scheduleId }).sort({ date: 1 });
  return attachRosterToSessions(sessions);
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
  const session = await GroupClassSession.findById(id);

  if (!session) {
    throw notFoundError('Group class session not found');
  }

  const visits = await visitService.getActiveVisitsForSession(id);
  const students = visits.map((visit) => ({
    studentId: visit.studentId,
    isPresent: visit.status === 'attended',
    // Additive beyond the old GroupClassSession.students shape — lets the
    // attendance page offer "Evaluate" only for a trial student who's been
    // marked present (Phase 2's inline evaluation action). Older consumers
    // that don't know this field simply ignore it.
    classType: visit.classType,
  }));

  const plain = session.toObject();
  return { ...plain, students };
}

// Coach-marks-their-own-session-attendance mutation. Admins/superadmins may
// mark any session; a coach may only mark a session belonging to a schedule
// they are assigned to.
//
// A studentId is only markable if it resolves to one of two cases (matches
// CKQ's updateStudentAttendance exactly — verified, not assumed):
//  1. An existing non-cancelled Visit already exists for this student+session
//     (the normal case — pre-scheduled by roster.service.js at registration
//     or trial-booking time).
//  2. No Visit exists yet, but the student has an active Subscription on
//     THIS session's own schedule — a defensive fallback for a session that
//     somehow didn't get its Visit pre-created; the Visit is created here.
// Anyone else (not on this schedule's roster, no Visit) must go through
// addStudentToSession (Phase 3) — this endpoint can never silently add an
// arbitrary walk-in.
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

  // Resolve every update BEFORE writing any of them — same all-or-nothing
  // semantic the old roster-membership pre-check gave: one unknown
  // studentId must fail the whole request, not partially apply.
  const resolved = [];

  for (const update of updates) {
    // eslint-disable-next-line no-await-in-loop -- sequential resolution is
    // required here: each check must fully complete (and any of them can
    // throw) before the next update is considered, so a partial failure
    // never leaves some of this request's writes applied and others not.
    const existingVisit = await visitService.findActiveVisit(update.studentId, sessionId);

    if (existingVisit) {
      resolved.push({ studentId: update.studentId, isPresent: update.isPresent, classType: existingVisit.classType });
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const ownScheduleSubscription = await Subscription.findOne({
      studentId: update.studentId,
      scheduleId: schedule._id,
      status: 'active',
    });

    if (!ownScheduleSubscription) {
      throw badRequestError(
        "Unknown studentId: cannot attendance-mark a student not on this session's roster — use Add Student for a walk-in"
      );
    }

    resolved.push({ studentId: update.studentId, isPresent: update.isPresent, classType: 'regular' });
  }

  const markedVia = requestingUser.role === 'coach' ? 'coach' : 'admin';

  for (const entry of resolved) {
    // eslint-disable-next-line no-await-in-loop -- sequential by design, a
    // handful of students per session, each write already awaits its own
    // DB round trip internally.
    await visitService.markAttendance(
      entry.studentId,
      sessionId,
      schedule._id,
      entry.classType,
      entry.isPresent ? 'attended' : 'missed',
      requestingUser._id,
      markedVia
    );
  }

  return getById(sessionId);
}

async function assertCoachOrAdmin(schedule, requestingUser) {
  const isAdmin = requestingUser.role === 'admin' || requestingUser.role === 'superadmin';
  const isAssignedCoach =
    requestingUser.role === 'coach' && String(schedule.coachId) === String(requestingUser._id);

  if (!isAdmin && !isAssignedCoach) {
    throw forbiddenError('You are not the assigned coach for this session');
  }
}

// The "who can be added to this session as a walk-in" picker (Phase 3).
// NOT gated on Subscription.isPremium — verified directly against CKQ's
// getStudentsByLevel: it returns every student with an active subscription
// ANYWHERE at the level, no premium check at all (docs/plans/premium-
// registration-and-attendance-plan.md §0 decision #7). Excludes anyone
// already having a non-cancelled Visit for this exact session, and anyone
// already on this session's OWN schedule (they're already shown via the
// regular attendance list) — the own-schedule exclusion is a direct
// Subscription check, not just a Visit check, so it holds even if that
// student's Visit for this session was somehow never created.
//
// Gated the same as every mutation below (admin or this session's assigned
// coach) — read-only, but it surfaces other classmates' names, which an
// unrelated coach has no reason to see.
async function getEligibleStudentsForSession(sessionId, requestingUser) {
  const session = await GroupClassSession.findById(sessionId);

  if (!session) {
    throw notFoundError('Group class session not found');
  }

  const schedule = await GroupClassSchedule.findById(session.scheduleId);

  if (!schedule) {
    throw notFoundError('Group class schedule not found');
  }

  await assertCoachOrAdmin(schedule, requestingUser);

  const classSchedules = await GroupClassSchedule.find({ classId: schedule.classId }, '_id');
  const classScheduleIds = classSchedules.map((classSchedule) => classSchedule._id);

  const excludedIds = new Set();

  const existingVisits = await Visit.find(
    { groupClassSessionId: sessionId, status: { $ne: 'cancelled' } },
    'studentId'
  );
  existingVisits.forEach((visit) => excludedIds.add(String(visit.studentId)));

  const ownScheduleSubscriptions = await Subscription.find(
    { scheduleId: schedule._id, status: 'active' },
    'studentId'
  );
  ownScheduleSubscriptions.forEach((subscription) => excludedIds.add(String(subscription.studentId)));

  const activeSubscriptions = await Subscription.find(
    { scheduleId: { $in: classScheduleIds }, status: 'active' },
    'studentId'
  ).populate('studentId', 'firstName lastName');

  const seen = new Set();
  const eligible = [];

  activeSubscriptions.forEach((subscription) => {
    if (!subscription.studentId) return;

    const studentId = String(subscription.studentId._id);

    if (excludedIds.has(studentId) || seen.has(studentId)) return;

    seen.add(studentId);
    eligible.push(subscription.studentId);
  });

  return eligible;
}

// Adds a walk-in from a sibling schedule of the same class — the coach/
// admin action behind the eligible-students picker above. Validates the
// student against that SAME eligibility list (never trusts the caller),
// creates the Visit as 'attended', and stamps isMakeupClass so
// removeStudentFromSession can later distinguish this from a genuine
// roster student.
async function addStudentToSession(sessionId, studentId, requestingUser) {
  const session = await GroupClassSession.findById(sessionId);

  if (!session) {
    throw notFoundError('Group class session not found');
  }

  const schedule = await GroupClassSchedule.findById(session.scheduleId);

  if (!schedule) {
    throw notFoundError('Group class schedule not found');
  }

  await assertCoachOrAdmin(schedule, requestingUser);

  const existingVisit = await visitService.findActiveVisit(studentId, sessionId);

  if (existingVisit) {
    throw conflictError('Student already exists in this session');
  }

  const eligible = await getEligibleStudentsForSession(sessionId, requestingUser);
  const isEligible = eligible.some((student) => String(student._id) === String(studentId));

  if (!isEligible) {
    throw badRequestError('This student is not eligible to be added to this session');
  }

  const markedVia = requestingUser.role === 'coach' ? 'coach' : 'admin';
  await visitService.markAttendance(studentId, sessionId, schedule._id, 'regular', 'attended', requestingUser._id, markedVia);
  await visitService.markAsMakeupClass(studentId, sessionId);

  return getById(sessionId);
}

// Undoes a mistaken "Add Student" pick. Only removable if the Visit is
// tagged isMakeupClass — a genuine roster student (real subscription to
// this schedule) cannot be removed this way, and neither can a trial
// student (Frisco has no trial-cancel endpoint yet — see the plan's Out of
// scope §9 — so this just documents the gap rather than closing it).
async function removeStudentFromSession(sessionId, studentId, requestingUser) {
  const session = await GroupClassSession.findById(sessionId);

  if (!session) {
    throw notFoundError('Group class session not found');
  }

  const schedule = await GroupClassSchedule.findById(session.scheduleId);

  if (!schedule) {
    throw notFoundError('Group class schedule not found');
  }

  await assertCoachOrAdmin(schedule, requestingUser);

  const visit = await visitService.findActiveVisit(studentId, sessionId);

  if (!visit) {
    throw badRequestError('Student is not in this session');
  }

  if (visit.classType === 'trial') {
    throw badRequestError('Use trial cancellation to remove a trial student');
  }

  if (!visit.isMakeupClass) {
    throw badRequestError('Cannot remove a student who is enrolled in this class — use attendance status instead');
  }

  await visitService.cancelVisitsForStudent(studentId, [sessionId]);

  return getById(sessionId);
}

module.exports = {
  generateInitialSessions,
  listBySchedule,
  listUpcomingByClass,
  getById,
  markAttendance,
  getEligibleStudentsForSession,
  addStudentToSession,
  removeStudentFromSession,
};
