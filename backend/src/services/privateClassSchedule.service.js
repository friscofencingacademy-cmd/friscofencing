const PrivateClassSchedule = require('../models/privateClassSchedule.model');
const PrivateClassEnrollment = require('../models/privateClassEnrollment.model');
const coachContractService = require('./coachContract.service');
const { computeSessionPrice } = require('../utils/privateClassPricing');
const { nextOccurrenceStrictlyAfter } = require('../utils/scheduleOccurrence');

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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

// Publishes a new available slot for a coach. The coach must have an
// active contract (D11/§5.3) — a coach with no active contract publishes
// nothing.
async function create({ coachId, dayOfWeek, startTime, durationMinutes }) {
  const activeContract = await coachContractService.getActiveForCoach(coachId);

  if (!activeContract) {
    throw badRequestError(
      'This coach is not currently accepting private students (no active contract)'
    );
  }

  const duplicate = await PrivateClassSchedule.findOne({ coachId, dayOfWeek, startTime });

  if (duplicate) {
    throw conflictError('A slot already exists for this coach at this day and time');
  }

  return PrivateClassSchedule.create({
    coachId,
    dayOfWeek,
    startTime,
    durationMinutes: durationMinutes || activeContract.sessionDurationMinutes,
  });
}

async function listMine(coachId) {
  return PrivateClassSchedule.find({ coachId })
    .populate('studentId', 'firstName lastName')
    .populate('enrollmentId')
    .sort({ dayOfWeek: 1, startTime: 1 });
}

async function listAll({ coachId, available } = {}) {
  const filter = {};

  if (coachId) {
    filter.coachId = coachId;
  }

  if (available === true || available === 'true') {
    filter.studentId = null;
  }

  return PrivateClassSchedule.find(filter)
    .populate('coachId', 'firstName lastName email')
    .populate('studentId', 'firstName lastName')
    .sort({ dayOfWeek: 1, startTime: 1 });
}

// Admin/superadmin may delete any slot; a coach only their own. Only a
// free slot (no enrolled student) may be deleted.
//
// The guard checks REALITY (is there a live, active enrollment claiming
// this slot?) rather than trusting the denormalized studentId/enrollmentId
// fields alone (docs/plans/booking-and-private-class-fixes-plan.md §4) —
// cancel(), in privateClassEnrollment.service.js, frees a slot by matching
// `enrollmentId`, so any slot whose `studentId` is set but whose
// `enrollmentId` doesn't point at a still-active enrollment (a stale claim
// — e.g. from data that predates a fix, or any future partial write) used
// to 409 forever with no way to ever delete it. A stale claim now
// self-heals — since the whole document is deleted right below, "freeing"
// a stale claim here just means not blocking the delete on it.
async function remove(id, requestingUser) {
  const schedule = await PrivateClassSchedule.findById(id);

  if (!schedule) {
    throw notFoundError('Private class schedule not found');
  }

  const isAdmin = requestingUser.role === 'admin' || requestingUser.role === 'superadmin';
  const isOwningCoach =
    requestingUser.role === 'coach' && String(schedule.coachId) === String(requestingUser._id);

  if (!isAdmin && !isOwningCoach) {
    throw forbiddenError('This slot does not belong to you');
  }

  if (schedule.studentId || schedule.enrollmentId) {
    const enrollment = schedule.enrollmentId
      ? await PrivateClassEnrollment.findById(schedule.enrollmentId)
      : null;

    if (enrollment && enrollment.status === 'active') {
      throw conflictError('Slot has an enrolled student');
    }

    // Stale claim (enrollment cancelled, deleted outright, or
    // enrollmentId was never set while studentId was) — fall through to
    // the delete below instead of 409ing on data that no longer reflects
    // an active enrollment.
  }

  await PrivateClassSchedule.findByIdAndDelete(id);

  return schedule;
}

// Unauthenticated public availability — coaches with an active contract
// AND >=1 available slot. No student/parent data leaks: only coach name +
// slot/price/date facts.
async function listPublic() {
  const allSchedules = await PrivateClassSchedule.find({ studentId: null, isActive: true }).populate(
    'coachId',
    'firstName lastName'
  );

  // Excludes slots whose coach was deleted without a delete-guard blocking
  // it (orphaned-coach-reference-fix-plan D1) — mirrors
  // groupClassSchedule.service.js's own listPublic() precedent.
  const schedules = allSchedules.filter((schedule) => schedule.coachId);

  const coachIds = [...new Set(schedules.map((schedule) => String(schedule.coachId._id)))];
  const contracts = await Promise.all(
    coachIds.map((coachId) => coachContractService.getActiveForCoach(coachId))
  );
  const contractByCoachId = new Map(
    coachIds.map((coachId, index) => [coachId, contracts[index]]).filter(([, contract]) => contract)
  );

  const grouped = new Map();
  const today = new Date();

  schedules.forEach((schedule) => {
    const coachId = String(schedule.coachId._id);
    const contract = contractByCoachId.get(coachId);

    // Excludes contract-less coaches — no active contract means the
    // published slot has no valid price to show.
    if (!contract) {
      return;
    }

    const sessionPrice = computeSessionPrice(contract.studentBillingRate, schedule.durationMinutes);
    const firstSessionDate = nextOccurrenceStrictlyAfter(today, schedule.dayOfWeek);

    const slot = {
      scheduleId: schedule._id,
      dayOfWeek: schedule.dayOfWeek,
      dayName: DAY_LABELS[schedule.dayOfWeek],
      // Raw "HH:mm" — same convention as every other schedule endpoint in
      // this codebase (groupClassSchedule.service.js's listPublic() etc.).
      // A redundant `displayTime: schedule.startTime` alias used to sit
      // here too — its name implied "already formatted," which led both
      // frontend consumers (app/private-classes, app/parent/register-
      // private) to render it raw instead of through lib/formatTime.ts,
      // shipping 24-hour times to parents. Removed rather than fixed in
      // place: a second field that's byte-identical to startTime is the
      // trap that caused this, not just the missing format call.
      startTime: schedule.startTime,
      durationMinutes: schedule.durationMinutes,
      sessionPrice,
      hourlyRate: contract.studentBillingRate,
      firstSessionDate,
    };

    if (!grouped.has(coachId)) {
      grouped.set(coachId, {
        coachId,
        coachName: `${schedule.coachId.firstName} ${schedule.coachId.lastName}`,
        slots: [],
      });
    }

    grouped.get(coachId).slots.push(slot);
  });

  return [...grouped.values()];
}

module.exports = { create, listMine, listAll, remove, listPublic };
