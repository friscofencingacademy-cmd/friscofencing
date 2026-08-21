const PrivateClassSchedule = require('../models/privateClassSchedule.model');
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

  if (schedule.studentId) {
    throw conflictError('Slot has an enrolled student');
  }

  await PrivateClassSchedule.findByIdAndDelete(id);

  return schedule;
}

// Unauthenticated public availability — coaches with an active contract
// AND >=1 available slot. No student/parent data leaks: only coach name +
// slot/price/date facts.
async function listPublic() {
  const schedules = await PrivateClassSchedule.find({ studentId: null, isActive: true }).populate(
    'coachId',
    'firstName lastName'
  );

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
      startTime: schedule.startTime,
      displayTime: schedule.startTime,
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
