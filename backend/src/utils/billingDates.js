// Shared date helpers for the billing domain. Extracted from
// registration.service.js on its second use (renewal.service.js, Phase 9) —
// both the first-charge flow and every subsequent renewal need identical
// period-boundary math, so this is real duplication being consolidated, not
// premature abstraction.

// Same calendar month a month later, e.g. Jan 31 -> Mar 3 in a non-leap-year
// (JS Date's own setMonth rollover behavior) — acceptable for MVP; no custom
// day-clamping logic.
function addOneMonth(date) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + 1);
  return result;
}

function todayAtMidnight() {
  const result = new Date();
  result.setHours(0, 0, 0, 0);
  return result;
}

// Same rollover semantics as addOneMonth, generalized to N months — used by
// registrationFee.service.js's returning-student grace-period deadline.
function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

// Number of calendar days in `date`'s month (28-31) — day 0 of next month is
// the last day of this one, a standard JS Date idiom.
function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

// The last calendar date of `date`'s month, end-of-day — used by
// proration.service.js as a prorated first period's currentPeriodEnd.
function endOfMonth(date) {
  const result = new Date(date.getFullYear(), date.getMonth(), daysInMonth(date));
  result.setHours(23, 59, 59, 999);
  return result;
}

module.exports = { addOneMonth, addMonths, daysInMonth, endOfMonth, todayAtMidnight };
