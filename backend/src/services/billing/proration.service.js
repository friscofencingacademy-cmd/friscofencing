const GroupClass = require('../../models/groupClass.model');
const GroupClassSchedule = require('../../models/groupClassSchedule.model');
const { daysInMonth, firstOfNextMonth, todayDateOnly } = require('../../utils/billingDates');

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

// True when `anchorDate` (a calendar-day sentinel) falls in the same
// calendar month as "today" in Central time — the exact boundary D1 below
// branches on. anchorDate's UTC getters are safe to read directly (it's a
// UTC-midnight sentinel, not a real instant); todayDateOnly() already
// returns that same sentinel shape.
function isCurrentCalendarMonth(anchorDate) {
  const today = todayDateOnly();
  return anchorDate.getUTCFullYear() === today.getUTCFullYear() && anchorDate.getUTCMonth() === today.getUTCMonth();
}

// Single source of truth for a first charge's amount AND billing period
// (docs/plans/payment-airtight-plan.md D1) — called identically by
// registration.service.js's create() and previewChargeAmount(), and nowhere
// else, so the two paths can never structurally disagree. Prompted by a
// real incident: "Enroll for next month" anchored to a real session date
// that wasn't the 1st, so computeProration silently prorated a future
// month's charge too (275 * 16/17 = 258.82 instead of the expected 275).
//
// The rule: proration applies ONLY when `anchorDate` falls in the CURRENT
// calendar month (Central) — delegates to computeProration() unchanged in
// that case. Any FUTURE month is billed the full monthly fee for that
// entire calendar month, never a fraction of it, regardless of which day
// within that month the parent's chosen session falls on — computeProration
// is never even called in that branch. Both branches return the same shape,
// so callers never need to know which one ran.
//
// `periodStart` is the BILLING period's start, which is NOT always
// `anchorDate` — a future-month anchor's period starts on the 1st of that
// month, even though the student's roster join date (handled entirely
// separately, by roster.service.js's addStudentToRoster) stays the actual
// day the parent picked.
//
// The future-month branch deliberately builds BOTH periodStart and
// periodEnd via explicit Date.UTC arithmetic (dateShapes.js's convention),
// never billingDates.js's firstOfNextMonth — that helper reads/writes a
// Date's LOCAL components, which only agrees with a UTC-midnight sentinel's
// real calendar day when the host itself runs in UTC (true in prod/CI, not
// necessarily on a developer's own machine, same assumption every other
// billingDates.js caller already carries). Since anchorDate here can be a
// genuine UTC sentinel from any caller, this branch stays correct
// regardless of the host's local timezone rather than inheriting that
// class of bug.
async function resolveFirstChargePeriod({ levelId, monthlyFee, anchorDate }) {
  if (isCurrentCalendarMonth(anchorDate)) {
    const prorationInfo = await computeProration({ levelId, monthlyFee, registrationDate: anchorDate });
    return { ...prorationInfo, periodStart: anchorDate };
  }

  const periodStart = new Date(Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1));

  return {
    prorated: false,
    totalClassDays: 0,
    remainingClassDays: 0,
    dailyRate: 0,
    proratedAmount: monthlyFee,
    periodEnd,
    periodStart,
  };
}

module.exports = { computeProration, resolveFirstChargePeriod };
