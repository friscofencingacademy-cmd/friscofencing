const GroupClass = require('../../models/groupClass.model');
const GroupClassSchedule = require('../../models/groupClassSchedule.model');
const { daysInMonth, firstOfNextMonth } = require('../../utils/billingDates');

// Every distinct weekday (0=Sun..6=Sat) at least one schedule at `levelId`
// meets on — a level can have several schedules on different days (a
// premium student can attend any of them), deduplicated into a Set rather
// than just the student's own chosen "home" schedule's single day.
async function resolveLevelWeekdays(levelId) {
  const groupClasses = await GroupClass.find({ levelId }, '_id');
  const classIds = groupClasses.map((groupClass) => groupClass._id);

  if (classIds.length === 0) {
    return new Set();
  }

  const schedules = await GroupClassSchedule.find({ classId: { $in: classIds } }, 'dayOfWeek');

  return new Set(schedules.map((schedule) => schedule.dayOfWeek));
}

// Counts calendar days in `year`-`month` (JS Date convention: month 0-11)
// from `fromDay` through `toDay` (inclusive) whose weekday is in `weekdays`.
function countClassDays(weekdays, year, month, fromDay, toDay) {
  let count = 0;

  for (let day = fromDay; day <= toDay; day += 1) {
    if (weekdays.has(new Date(year, month, day).getDay())) {
      count += 1;
    }
  }

  return count;
}

// Single source of truth for prorating a first charge (docs/plans/prorated-
// first-month-billing-plan.md, docs/decisions/007-calendar-month-billing.md)
// — called identically by registration.service.js's create() and
// previewChargeAmount(), and nowhere else. No caching, re-derived live from
// the current schedule roster every call, matching calculateChargeAmount's
// "never cached" principle. The frontend never reimplements any of this
// math — it only ever displays what this function returned.
//
// `periodEnd` is always the calendar-month boundary (firstOfNextMonth of
// registrationDate) — every subscription's period ends on the 1st (ADR
// 007), whether this particular registration was proratable or not. This
// function is the single source of that boundary too, not just the amount:
// registration.service.js uses this returned periodEnd directly rather than
// computing its own, so the two can never structurally disagree.
//
// @param {string} levelId
// @param {number} monthlyFee      - the RAW list price, before proration
// @param {Date}   registrationDate
// @returns {Promise<{
//   prorated: boolean,
//   totalClassDays: number,
//   remainingClassDays: number,
//   dailyRate: number,
//   proratedAmount: number,
//   periodEnd: Date,
// }>}
async function computeProration({ levelId, monthlyFee, registrationDate }) {
  const weekdays = await resolveLevelWeekdays(levelId);

  if (weekdays.size === 0) {
    // No schedules configured for this level at all — can't meaningfully
    // prorate; fall back to the full fee rather than dividing by zero or
    // blocking registration over a data gap. The period boundary is still
    // the calendar month (ADR 007) even in this fallback.
    return {
      prorated: false,
      totalClassDays: 0,
      remainingClassDays: 0,
      dailyRate: 0,
      proratedAmount: monthlyFee,
      periodEnd: firstOfNextMonth(registrationDate),
    };
  }

  const year = registrationDate.getFullYear();
  const month = registrationDate.getMonth();
  const lastDay = daysInMonth(registrationDate);

  const totalClassDays = countClassDays(weekdays, year, month, 1, lastDay);
  const remainingClassDays = countClassDays(weekdays, year, month, registrationDate.getDate(), lastDay);

  // Every weekday occurs at least 4 times in any calendar month, so
  // totalClassDays is guaranteed > 0 here (weekdays is non-empty) — no
  // divide-by-zero guard needed beyond the empty-set case handled above.
  const dailyRate = monthlyFee / totalClassDays;
  // Rounded once, at the final dollar amount — not by first rounding
  // dailyRate and multiplying, which would compound rounding error.
  const proratedAmount = Number((dailyRate * remainingClassDays).toFixed(2));

  return {
    prorated: true,
    totalClassDays,
    remainingClassDays,
    dailyRate: Number(dailyRate.toFixed(2)), // rounded for display only
    proratedAmount,
    periodEnd: firstOfNextMonth(registrationDate),
  };
}

module.exports = { computeProration };
