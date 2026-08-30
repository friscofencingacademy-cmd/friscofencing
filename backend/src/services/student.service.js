const User = require('../models/user.model');
const Subscription = require('../models/subscription.model');
const TrialClass = require('../models/trialClass.model');
const { withAge } = require('../utils/age');
const { todayDateOnly } = require('../utils/billingDates');

function badRequestError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

// A parent adding their own child, or an admin/superadmin adding a child on
// behalf of a specific parent. Security-critical: when the requester is a
// parent, parentId is ALWAYS forced to the requester's own id, regardless of
// anything passed in `data.parentId` — a malicious parent must not be able
// to attach a child to a different parent's account by tampering with the
// request body.
async function create(data, requestingUser) {
  let parentId;

  if (requestingUser.role === 'parent') {
    parentId = requestingUser._id;
  } else {
    if (!data.parentId) {
      throw badRequestError('parentId is required');
    }

    const parent = await User.findById(data.parentId);

    if (!parent || parent.role !== 'parent') {
      throw badRequestError('parentId must refer to an existing user with role "parent"');
    }

    parentId = data.parentId;
  }

  // dateOfBirth is accepted and stored when present, but NOT hard-required
  // here — this service is shared with admin's own student-creation dialog,
  // which may not always have a birthdate in hand (docs/plans/trial-
  // registration-required-fields-plan.md §1.3). The real requirement lives
  // at trial-booking time instead (trialClass.service.js).
  const student = await User.create({
    role: 'student',
    firstName: data.firstName,
    lastName: data.lastName,
    skillLevel: data.skillLevel,
    dateOfBirth: data.dateOfBirth,
    parentId,
  });

  return withAge(student);
}

// Batched — exactly two queries for the whole household, never a per-student
// loop. Moves the enrollment-status decision server-side (docs/plans/
// frontend-polish-plan.md PR 3, source-of-truth audit finding B1): the
// dashboard/child-detail pages used to scan `subscriptions`/`trialClasses`
// themselves to decide Enrolled/Trial/Not-enrolled, which silently hid a
// real bug — TrialClass has no status field (one trial ever per student,
// unique-indexed on studentId, see trialClass.service.js's own pre-check),
// so a trial from months ago still read as "scheduled" forever. Only the
// backend can tell upcoming from past, using the same tz-aware "today"
// every other date-sensitive calculation in this codebase uses.
async function attachEnrollment(students) {
  const studentIds = students.map((student) => student._id);

  const [activeSubscriptions, trialClasses] = await Promise.all([
    Subscription.find({ studentId: { $in: studentIds }, status: 'active' }).populate(
      'scheduleId',
      'dayOfWeek startTime endTime'
    ),
    TrialClass.find({ studentId: { $in: studentIds } }).populate('sessionId', 'date'),
  ]);

  // Keyed on the RAW result (existence), not the populated one — canBookTrial
  // mirrors the one-trial-ever rule trialClass.service.js's create() already
  // enforces (a pre-check plus TrialClass's own unique index on studentId),
  // which cares only whether a row exists, never whether its session is
  // still resolvable. Filtering out an orphaned-session trial here before
  // this lookup would make canBookTrial wrongly `true` for a student who
  // already has a (now-unrenderable) trial record — offering a "Book a
  // Trial" CTA the real POST would immediately 409 on. Same reasoning for
  // an active subscription: it still blocks a trial whether or not its
  // schedule reference is still resolvable.
  const activeSubscriptionByStudentId = new Map(
    activeSubscriptions.map((sub) => [String(sub.studentId), sub])
  );
  const trialByStudentId = new Map(trialClasses.map((trial) => [String(trial.studentId), trial]));

  const today = todayDateOnly();

  return students.map((student) => {
    const studentId = String(student._id);
    const activeSubscription = activeSubscriptionByStudentId.get(studentId);

    if (activeSubscription) {
      // A deleted schedule degrades the DISPLAY (no day/time to show)
      // rather than crashing or dropping the enrolled status itself — same
      // orphaned-reference pattern groupClassSchedule.service.js's
      // listPublic() uses (docs/plans/orphaned-coach-reference-fix-plan.md).
      const scheduleDoc = activeSubscription.scheduleId;
      return {
        ...student,
        enrollment: {
          status: 'enrolled',
          canBookTrial: false,
          schedule: scheduleDoc
            ? { dayOfWeek: scheduleDoc.dayOfWeek, startTime: scheduleDoc.startTime, endTime: scheduleDoc.endTime }
            : null,
        },
      };
    }

    const trial = trialByStudentId.get(studentId);

    if (trial) {
      const sessionDoc = trial.sessionId;
      // GroupClassSession.date is a date-only UTC-midnight sentinel — the
      // exact shape todayDateOnly() itself produces (see billingDates.js's
      // docblock) — so a plain >= comparison is the correct, tz-safe check
      // here, never real-instant math on it. A deleted session can't be
      // dated at all — default to "completed" rather than risk a stale
      // "scheduled" line (the exact bug this PR fixes) for an
      // unrenderable trial.
      const status = sessionDoc && sessionDoc.date >= today ? 'trial_scheduled' : 'trial_completed';
      return {
        ...student,
        enrollment: { status, canBookTrial: false, schedule: null },
      };
    }

    return {
      ...student,
      enrollment: { status: 'not_enrolled', canBookTrial: true, schedule: null },
    };
  });
}

async function listMine(parentId) {
  const students = await User.find({ role: 'student', parentId });
  return attachEnrollment(students.map(withAge));
}

module.exports = { create, listMine };
