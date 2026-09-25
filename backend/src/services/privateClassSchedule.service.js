const PrivateClassSchedule = require('../models/privateClassSchedule.model');
const PrivateClassSession = require('../models/privateClassSession.model');
const { SLOT_HOLDING_STATUSES } = require('../models/privateClassSession.model');
const coachContractService = require('./coachContract.service');
const holidayService = require('./holiday.service');
const { purchaseOptionsFor } = require('../utils/privateClassPricing');
const {
  dateOnlyUTC,
  addDaysToDateOnly,
  nextDateOnlyOnOrAfter,
  sentinelDayString,
  combineDayAndTimeInTZ,
} = require('../utils/dateShapes');
const { todayDateOnly } = require('../utils/billingDates');
const { badRequestError, forbiddenError, notFoundError, conflictError } = require('../utils/errors');
const { hasAdminRole } = require('../utils/roles');
const { dayOfWeekLabel } = require('../email/dates');

// Availability rules for private lessons (docs/decisions/011-private-per-
// session-booking.md). A rule is "weekday + start time + length, bookable
// between two calendar days." Bookable dates are computed from the rules on
// read — nothing is generated ahead of time. The one rule deciding whether a
// (schedule, day) pair is bookable is resolveBookableInstant below; both the
// date picker (listAvailableDates) and every booking write path use it, so
// they can never disagree.

// How far ahead the date picker looks by default, and at most.
const DEFAULT_AVAILABLE_DAYS = 56;
const MAX_AVAILABLE_DAYS = 120;

// A published range may not exceed a year — a typo guard (e.g. 2062 for
// 2026) that would otherwise publish decades of bookable dates.
const MAX_RANGE_DAYS = 366;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAY_STRING = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// ── Parsing helpers ───────────────────────────────────────────────────────

// Strict 'YYYY-MM-DD' -> calendar-day sentinel (dateShapes.js). Rejects
// anything else, including impossible dates like 2026-02-30.
function parseDay(value, label) {
  if (typeof value !== 'string' || !DAY_STRING.test(value)) {
    throw badRequestError(`${label} must be a date in YYYY-MM-DD format`);
  }

  const sentinel = dateOnlyUTC(value);

  if (Number.isNaN(sentinel.getTime()) || sentinelDayString(sentinel) !== value) {
    throw badRequestError(`${label} is not a real calendar date`);
  }

  return sentinel;
}

function parseTime(value, label) {
  if (typeof value !== 'string' || !HHMM.test(value)) {
    throw badRequestError(`${label} must be a time in HH:mm (24-hour) format`);
  }

  return timeToMinutes(value);
}

function formatTime(totalMinutes) {
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const minutes = String(totalMinutes % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function timeToMinutes(hhmm) {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
}

// ── Publishing ────────────────────────────────────────────────────────────

// Every (weekday, start time) a window produces: slots start at
// windowStart and step by the slot length while a whole slot still fits
// before windowEnd. "17:00–20:00, 30 min" -> 17:00, 17:30, ... 19:30.
function buildCandidates(daysOfWeek, windowStartMinutes, windowEndMinutes, slotDurationMinutes) {
  const startTimes = [];

  for (let start = windowStartMinutes; start + slotDurationMinutes <= windowEndMinutes; start += slotDurationMinutes) {
    startTimes.push(start);
  }

  return daysOfWeek.flatMap((dayOfWeek) =>
    startTimes.map((startMinutes) => ({ dayOfWeek, startMinutes, startTime: formatTime(startMinutes) }))
  );
}

function windowsIntersect(aStart, aDuration, bStart, bDuration) {
  return aStart < bStart + bDuration && bStart < aStart + aDuration;
}

// Publishes a coach's availability in one request: every weekday in
// `daysOfWeek` x every slot the time window produces, bookable from
// `startDate` to `endDate` (inclusive). All-or-nothing — if any new slot's
// time overlaps one of the coach's existing active rules on the same weekday
// with an intersecting date range, nothing is created and the 409 names
// every conflict. The coach must have an active contract; the slot length
// defaults to the contract's session length.
async function createBulk({
  coachId,
  daysOfWeek,
  windowStart,
  windowEnd,
  slotDurationMinutes,
  startDate,
  endDate,
}) {
  const contract = await coachContractService.getActiveForCoach(coachId);

  if (!contract) {
    throw badRequestError('This coach is not currently accepting private students (no active contract)');
  }

  if (
    !Array.isArray(daysOfWeek) ||
    daysOfWeek.length === 0 ||
    !daysOfWeek.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  ) {
    throw badRequestError('daysOfWeek must be a non-empty list of weekdays (0 = Sunday … 6 = Saturday)');
  }

  const startSentinel = parseDay(startDate, 'startDate');
  const endSentinel = parseDay(endDate, 'endDate');

  if (endSentinel < startSentinel) {
    throw badRequestError('endDate must be on or after startDate');
  }

  if ((endSentinel - startSentinel) / MS_PER_DAY >= MAX_RANGE_DAYS) {
    throw badRequestError(`A published range can be at most ${MAX_RANGE_DAYS} days`);
  }

  if (endSentinel < todayDateOnly()) {
    throw badRequestError('endDate is in the past');
  }

  const duration = slotDurationMinutes === undefined ? contract.sessionDurationMinutes : slotDurationMinutes;

  if (!Number.isInteger(duration) || duration < 15) {
    throw badRequestError('slotDurationMinutes must be a whole number of at least 15');
  }

  const windowStartMinutes = parseTime(windowStart, 'windowStart');
  const windowEndMinutes = parseTime(windowEnd, 'windowEnd');

  if (windowEndMinutes <= windowStartMinutes) {
    throw badRequestError('windowEnd must be after windowStart');
  }

  const uniqueDays = [...new Set(daysOfWeek)].sort((a, b) => a - b);
  const candidates = buildCandidates(uniqueDays, windowStartMinutes, windowEndMinutes, duration);

  if (candidates.length === 0) {
    throw badRequestError(`The window is shorter than one ${duration}-minute slot`);
  }

  const existing = await PrivateClassSchedule.find({
    coachId,
    isActive: true,
    dayOfWeek: { $in: uniqueDays },
    startDate: { $lte: endSentinel },
    endDate: { $gte: startSentinel },
  }).lean();

  const conflicts = candidates.filter((candidate) =>
    existing.some(
      (rule) =>
        rule.dayOfWeek === candidate.dayOfWeek &&
        windowsIntersect(candidate.startMinutes, duration, timeToMinutes(rule.startTime), rule.durationMinutes)
    )
  );

  if (conflicts.length > 0) {
    const labels = conflicts.map((conflict) => `${dayOfWeekLabel(conflict.dayOfWeek)} ${conflict.startTime}`);
    throw conflictError(`These slots overlap availability already published for this coach: ${labels.join(', ')}`);
  }

  return PrivateClassSchedule.insertMany(
    candidates.map((candidate) => ({
      coachId,
      dayOfWeek: candidate.dayOfWeek,
      startTime: candidate.startTime,
      durationMinutes: duration,
      startDate: startSentinel,
      endDate: endSentinel,
    }))
  );
}

// ── Listing ───────────────────────────────────────────────────────────────

// Adds `bookedCount` (upcoming slot-holding bookings) to each rule — what
// the coach/admin lists show, and why a rule can or cannot be deleted.
async function withBookedCounts(schedules) {
  if (schedules.length === 0) return [];

  const counts = await PrivateClassSession.aggregate([
    {
      $match: {
        scheduleId: { $in: schedules.map((schedule) => schedule._id) },
        status: { $in: SLOT_HOLDING_STATUSES },
        startDate: { $gt: new Date() },
      },
    },
    { $group: { _id: '$scheduleId', count: { $sum: 1 } } },
  ]);
  const countById = new Map(counts.map((row) => [String(row._id), row.count]));

  return schedules.map((schedule) => {
    const plain = schedule.toObject ? schedule.toObject() : schedule;
    return { ...plain, bookedCount: countById.get(String(plain._id)) || 0 };
  });
}

// Active rules that are not over yet (endDate on or after today).
function currentRulesFilter(extra = {}) {
  return { isActive: true, endDate: { $gte: todayDateOnly() }, ...extra };
}

// The lesson lengths a coach currently publishes (sorted, distinct) — the
// contract editor's price preview shows each one (coach-pack-pricing-plan
// §8 V6).
async function currentLengthsForCoach(coachId) {
  const lengths = await PrivateClassSchedule.distinct('durationMinutes', currentRulesFilter({ coachId }));
  return lengths.sort((a, b) => a - b);
}

async function listMine(coachId) {
  const schedules = await PrivateClassSchedule.find(currentRulesFilter({ coachId })).sort({
    dayOfWeek: 1,
    startTime: 1,
    startDate: 1,
  });

  return withBookedCounts(schedules);
}

async function listAll({ coachId } = {}) {
  const schedules = await PrivateClassSchedule.find(currentRulesFilter(coachId ? { coachId } : {}))
    .populate('coachId', 'firstName lastName email')
    .sort({ dayOfWeek: 1, startTime: 1, startDate: 1 });

  return withBookedCounts(schedules);
}

// ── Removing ──────────────────────────────────────────────────────────────

// Admin/superadmin may remove any rule; a coach only their own. A rule with
// an upcoming booking cannot be removed (cancel the booking first). A rule
// with only past or cancelled bookings is retired (isActive: false) so every
// historical booking keeps a valid scheduleId; a rule nobody ever booked is
// deleted outright.
async function remove(id, requestingUser) {
  const schedule = await PrivateClassSchedule.findById(id);

  if (!schedule) {
    throw notFoundError('Private class schedule not found');
  }

  const isAdmin = hasAdminRole(requestingUser);
  const isOwningCoach =
    requestingUser.role === 'coach' && String(schedule.coachId) === String(requestingUser._id);

  if (!isAdmin && !isOwningCoach) {
    throw forbiddenError('This slot does not belong to you');
  }

  const upcoming = await PrivateClassSession.exists({
    scheduleId: schedule._id,
    status: { $in: SLOT_HOLDING_STATUSES },
    startDate: { $gt: new Date() },
  });

  if (upcoming) {
    throw conflictError('This slot has upcoming bookings — cancel them before removing it');
  }

  const hasHistory = await PrivateClassSession.exists({ scheduleId: schedule._id });

  if (hasHistory) {
    schedule.isActive = false;
    await schedule.save();
    return { schedule, outcome: 'retired' };
  }

  await PrivateClassSchedule.deleteOne({ _id: schedule._id });
  return { schedule, outcome: 'deleted' };
}

// ── Bookable dates ────────────────────────────────────────────────────────

// THE rule for "can this schedule be booked on this day": the rule is
// active, the day is inside its range, falls on its weekday, is not an
// academy holiday, and the lesson has not started yet. Returns the lesson's
// real start/end instants. Throws 400 naming the reason otherwise. Does not
// check whether someone else already holds the slot — the booking insert's
// unique index is the only authority on that.
async function resolveBookableInstant(schedule, day, now = new Date()) {
  if (!schedule.isActive) {
    throw badRequestError('This slot is no longer offered');
  }

  const daySentinel = parseDay(day, 'day');

  if (daySentinel < schedule.startDate || daySentinel > schedule.endDate) {
    throw badRequestError('That date is outside the dates this slot is offered');
  }

  if (daySentinel.getUTCDay() !== schedule.dayOfWeek) {
    throw badRequestError(`This slot is only offered on ${dayOfWeekLabel(schedule.dayOfWeek)}s`);
  }

  const holidays = await holidayService.getHolidaysInRange(daySentinel, daySentinel);
  const holiday = holidayService.findHolidayForDate(daySentinel, holidays);

  if (holiday) {
    throw badRequestError(`That date is an academy holiday (${holiday.name})`);
  }

  const startDate = combineDayAndTimeInTZ(day, schedule.startTime);

  if (!(startDate > now)) {
    throw badRequestError('That lesson time has already passed');
  }

  return { startDate, endDate: new Date(startDate.getTime() + schedule.durationMinutes * 60000) };
}

// Every bookable, still-open date of one rule within the next `days` days:
// the rule's weekdays inside its range, minus holidays, minus lesson times
// already started, minus dates someone already holds. Public — returns only
// dates, never who booked them.
async function listAvailableDates(scheduleId, { days } = {}) {
  const schedule = await PrivateClassSchedule.findById(scheduleId);

  if (!schedule || !schedule.isActive) {
    throw notFoundError('Private class schedule not found');
  }

  let windowDays = DEFAULT_AVAILABLE_DAYS;

  if (days !== undefined) {
    const parsed = Number(days);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_AVAILABLE_DAYS) {
      throw badRequestError(`days must be a whole number between 1 and ${MAX_AVAILABLE_DAYS}`);
    }
    windowDays = parsed;
  }

  const now = new Date();
  const today = todayDateOnly();
  const rangeStart = schedule.startDate > today ? schedule.startDate : today;
  const horizon = addDaysToDateOnly(today, windowDays);
  const rangeEnd = schedule.endDate < horizon ? schedule.endDate : horizon;

  if (rangeEnd < rangeStart) {
    return [];
  }

  const holidays = await holidayService.getHolidaysInRange(rangeStart, rangeEnd);
  const candidates = [];

  for (
    let day = nextDateOnlyOnOrAfter(rangeStart, schedule.dayOfWeek);
    day <= rangeEnd;
    day = addDaysToDateOnly(day, 7)
  ) {
    if (!holidayService.findHolidayForDate(day, holidays)) {
      const dayString = sentinelDayString(day);
      const startDate = combineDayAndTimeInTZ(dayString, schedule.startTime);

      if (startDate > now) {
        candidates.push({
          day: dayString,
          startDate,
          endDate: new Date(startDate.getTime() + schedule.durationMinutes * 60000),
        });
      }
    }
  }

  if (candidates.length === 0) {
    return [];
  }

  const held = await PrivateClassSession.find(
    {
      scheduleId: schedule._id,
      status: { $in: SLOT_HOLDING_STATUSES },
      startDate: { $in: candidates.map((candidate) => candidate.startDate) },
    },
    'startDate'
  ).lean();
  const heldTimes = new Set(held.map((session) => session.startDate.getTime()));

  return candidates.filter((candidate) => !heldTimes.has(candidate.startDate.getTime()));
}

// ── Public listing ────────────────────────────────────────────────────────

// Unauthenticated public listing — coaches with an active contract AND at
// least one current rule. No student/parent data: only coach name + rule,
// price, and date-range facts. Each slot carries `options` — that coach's
// purchase options for that slot's length, straight from purchaseOptionsFor:
// the SAME shape the purchase quote returns (docs/plans/coach-pack-pricing-
// plan.md D14 d), so the frontend types a purchase option once.
async function listPublic() {
  const allSchedules = await PrivateClassSchedule.find(currentRulesFilter()).populate(
    'coachId',
    'firstName lastName'
  );

  // Excludes rules whose coach was deleted without a delete-guard blocking
  // it (orphaned-coach-reference-fix-plan D1).
  const schedules = allSchedules.filter((schedule) => schedule.coachId);

  const coachIds = [...new Set(schedules.map((schedule) => String(schedule.coachId._id)))];
  const contracts = await Promise.all(coachIds.map((coachId) => coachContractService.getActiveForCoach(coachId)));
  const contractByCoachId = new Map(
    coachIds.map((coachId, index) => [coachId, contracts[index]]).filter(([, contract]) => contract)
  );

  const grouped = new Map();

  schedules
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime))
    .forEach((schedule) => {
      const coachId = String(schedule.coachId._id);
      const contract = contractByCoachId.get(coachId);

      // No active contract means the rule has no valid price to show.
      if (!contract) {
        return;
      }

      const options = purchaseOptionsFor(contract, schedule.durationMinutes);

      if (!grouped.has(coachId)) {
        grouped.set(coachId, {
          coachId,
          coachName: `${schedule.coachId.firstName} ${schedule.coachId.lastName}`,
          slots: [],
        });
      }

      grouped.get(coachId).slots.push({
        scheduleId: schedule._id,
        dayOfWeek: schedule.dayOfWeek,
        dayName: dayOfWeekLabel(schedule.dayOfWeek),
        // Raw "HH:mm" — format with lib/formatTime.ts on the frontend.
        startTime: schedule.startTime,
        durationMinutes: schedule.durationMinutes,
        // Calendar-day sentinels — format with formatDateOnly.
        startDate: schedule.startDate,
        endDate: schedule.endDate,
        // The single session's price — options[0], never recomputed.
        sessionPrice: options[0].unitPrice,
        hourlyRate: contract.studentBillingRate,
        options,
      });
    });

  return { coaches: [...grouped.values()] };
}

module.exports = {
  createBulk,
  listMine,
  listAll,
  remove,
  resolveBookableInstant,
  listAvailableDates,
  listPublic,
  currentLengthsForCoach,
};
