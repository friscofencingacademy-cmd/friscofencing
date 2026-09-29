const Level = require('../models/level.model');
const GroupClass = require('../models/groupClass.model');
const GroupClassSchedule = require('../models/groupClassSchedule.model');
const GroupClassSession = require('../models/groupClassSession.model');
const Subscription = require('../models/subscription.model');
const Visit = require('../models/visit.model');
const User = require('../models/user.model');
const groupClassSessionService = require('./groupClassSession.service');
const holidayService = require('./holiday.service');
const settingService = require('./setting.service');
const { todayDateOnly } = require('../utils/billingDates');
const { badRequestError, notFoundError, conflictError } = require('../utils/errors');

// The front-desk sign-in tablet (docs/plans/kiosk-signin-plan.md). The tablet
// is logged in as a `kiosk` account (or an admin) — the route gates it; this
// service only answers "who can sign in" and does the sign-in, which IS the
// attendance mark. Academy-wide: Frisco has one location and the kiosk
// account has none (K3).

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

function isStudent(user) {
  return Boolean(user) && user.role === 'student';
}

// Who the tablet may list (K3): every student with an active Subscription,
// plus anyone holding a non-cancelled Visit for a group session TODAY (a trial
// on their trial day, a coach-added walk-in). Subscription entries win on
// overlap (they carry the level name).
async function getDirectory() {
  const subscriptions = await Subscription.find({ status: 'active' }, 'studentId scheduleId')
    .populate('studentId', 'firstName lastName role')
    .lean();

  const schedules = await GroupClassSchedule.find(
    { _id: { $in: subscriptions.map((subscription) => subscription.scheduleId) } },
    '_id classId'
  ).lean();
  const classes = await GroupClass.find({ _id: { $in: schedules.map((schedule) => schedule.classId) } }, '_id levelId').lean();
  const levels = await Level.find({ _id: { $in: classes.map((groupClass) => groupClass.levelId) } }, 'name').lean();

  const classIdBySchedule = new Map(schedules.map((schedule) => [String(schedule._id), String(schedule.classId)]));
  const levelIdByClass = new Map(classes.map((groupClass) => [String(groupClass._id), String(groupClass.levelId)]));
  const levelNameById = new Map(levels.map((level) => [String(level._id), level.name]));

  const levelNameFor = (scheduleId) => {
    const levelId = levelIdByClass.get(classIdBySchedule.get(String(scheduleId)));
    return levelNameById.get(levelId) ?? null;
  };

  const todaySessions = await GroupClassSession.find({ date: todayDateOnly() }, '_id').lean();
  const visits = await Visit.find(
    { groupClassSessionId: { $in: todaySessions.map((session) => session._id) }, status: { $ne: 'cancelled' } },
    'studentId'
  )
    .populate('studentId', 'firstName lastName role')
    .lean();

  const byStudent = new Map();

  subscriptions.forEach((subscription) => {
    const student = subscription.studentId;
    if (!isStudent(student) || byStudent.has(String(student._id))) return;

    byStudent.set(String(student._id), {
      studentId: String(student._id),
      firstName: student.firstName,
      lastName: student.lastName,
      levelName: levelNameFor(subscription.scheduleId),
    });
  });

  visits.forEach((visit) => {
    const student = visit.studentId;
    if (!isStudent(student) || byStudent.has(String(student._id))) return;

    byStudent.set(String(student._id), {
      studentId: String(student._id),
      firstName: student.firstName,
      lastName: student.lastName,
      levelName: null,
    });
  });

  return [...byStudent.values()].sort(
    (a, b) => a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName)
  );
}

// The tablet's poll payload. `confirmationRequired` rides along so flipping
// the setting reaches the tablet on its next poll (K6).
async function getKioskState() {
  const [students, settings] = await Promise.all([getDirectory(), settingService.getSettings()]);

  return { students, confirmationRequired: settings.kioskConfirmationRequired, serverTime: new Date() };
}

// Which of today's sessions the student signs in to (K4). The tablet never
// chooses:
//   1. today's sessions, none on an academy holiday
//   2. eligible: the student has a Visit for it, their own subscription is on
//      its schedule, or the walk-in rule allows it
//   3. still open: not hasSessionEnded
//   4. own-Visit session first, then the start nearest to now
// Eligibility is checked before the end cut-off so the two "nothing to sign
// in to" cases get different messages.
async function resolveTodaySession(student, now = new Date()) {
  const today = todayDateOnly();
  const noClassToday = conflictError(`${student.firstName} has no class today`);

  const holidays = await holidayService.getHolidaysInRange(today, today);

  if (holidayService.findHolidayForDate(today, holidays)) {
    throw noClassToday;
  }

  const sessions = await GroupClassSession.find({ date: today }).lean();

  if (sessions.length === 0) {
    throw noClassToday;
  }

  const schedules = await GroupClassSchedule.find(
    { _id: { $in: sessions.map((session) => session.scheduleId) } },
    '_id classId coachId startTime endTime'
  ).lean();
  const scheduleById = new Map(schedules.map((schedule) => [String(schedule._id), schedule]));

  const ownVisits = await Visit.find(
    {
      studentId: student._id,
      groupClassSessionId: { $in: sessions.map((session) => session._id) },
      status: { $ne: 'cancelled' },
    },
    'groupClassSessionId'
  ).lean();
  const sessionsWithOwnVisit = new Set(ownVisits.map((visit) => String(visit.groupClassSessionId)));

  const subscription = await Subscription.findOne({ studentId: student._id, status: 'active' }, 'scheduleId').lean();

  const eligible = [];

  for (const session of sessions) {
    const schedule = scheduleById.get(String(session.scheduleId));
    if (!schedule) continue;

    const hasOwnVisit = sessionsWithOwnVisit.has(String(session._id));
    const onOwnSchedule = Boolean(subscription) && String(subscription.scheduleId) === String(session.scheduleId);

    let isEligible = hasOwnVisit || onOwnSchedule;

    if (!isEligible) {
      // eslint-disable-next-line no-await-in-loop -- a handful of sessions a
      // day; the walk-in rule's one home is worth the queries.
      const walkIns = await groupClassSessionService.listWalkInEligibleStudents(session, schedule);
      isEligible = walkIns.some((walkIn) => String(walkIn._id) === String(student._id));
    }

    if (isEligible) {
      eligible.push({ session, schedule, hasOwnVisit });
    }
  }

  if (eligible.length === 0) {
    throw noClassToday;
  }

  const open = eligible.filter(({ session }) => !groupClassSessionService.hasSessionEnded(session, now));

  if (open.length === 0) {
    throw conflictError(`${student.firstName}'s class today has already ended`);
  }

  open.sort((a, b) => {
    if (a.hasOwnVisit !== b.hasOwnVisit) return a.hasOwnVisit ? -1 : 1;
    return Math.abs(a.session.startsAt - now) - Math.abs(b.session.startsAt - now);
  });

  return open[0];
}

// The whole kiosk interaction: resolve today's session, mark attended, as
// `user` (the account logged in on the tablet). The mark is never swallowed
// — a failed write must surface on the tablet, not a false "signed in".
async function signIn(user, { studentId }, now = new Date()) {
  if (typeof studentId !== 'string' || !OBJECT_ID_PATTERN.test(studentId)) {
    throw badRequestError('Invalid student id');
  }

  const student = await User.findOne({ _id: studentId, role: 'student' }, 'firstName lastName').lean();

  if (!student) {
    throw notFoundError('Student not found');
  }

  const { session, schedule } = await resolveTodaySession(student, now);
  const { alreadySignedIn } = await groupClassSessionService.markKioskAttendance(student._id, session._id, user._id);

  const [groupClass, coach] = await Promise.all([
    GroupClass.findById(schedule.classId, 'name').lean(),
    User.findById(schedule.coachId, 'firstName lastName').lean(),
  ]);

  return {
    student: { _id: student._id, firstName: student.firstName, lastName: student.lastName },
    session: {
      _id: session._id,
      className: groupClass ? groupClass.name : null,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      coachName: coach ? `${coach.firstName} ${coach.lastName}` : null,
    },
    alreadySignedIn,
  };
}

module.exports = { getDirectory, getKioskState, resolveTodaySession, signIn };
