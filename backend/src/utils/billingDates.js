// Shared date helpers for the billing domain. Extracted from
// registration.service.js on its second use (renewal.service.js, Phase 9) —
// both the first-charge flow and every subsequent renewal need identical
// period-boundary math, so this is real duplication being consolidated, not
// premature abstraction.
//
// Two distinct kinds of Date values flow through this file — knowing which
// one a given helper is fed is what docs/plans/timezone-consistency-plan.md
// D9 is about, and is load-bearing for not reintroducing the bug it fixes:
//  - "Date-only" sentinels: a UTC-midnight Date representing a pure calendar
//    day, no real timezone meaning (e.g. new Date('2026-03-08'), matching
//    GroupClassSession.date's own storage convention). Every currentPeriod-
//    Start/End/anchorDate in this codebase is this shape.
//  - Real instants: an actual point in time that genuinely happened at a
//    specific moment in a specific timezone (e.g. todayAtMidnight()'s own
//    output below — the true Central-midnight instant).
// addOneMonth/addMonths/daysInMonth/endOfMonth below operate ONLY on the
// first kind today (verified by tracing every real call site) — they use
// plain calendar-component arithmetic, which has ZERO DST exposure (UTC has
// no DST) and must NOT be "fixed" into tz-reinterpretation (moment(date)
// .tz(tz)... on a date-only sentinel silently shifts it onto the wrong
// calendar day — see the plan's D9 for the worked example). todayAtMidnight
// and addOneDay operate on/produce the second kind, and use real IANA
// timezone math accordingly.

const moment = require('moment-timezone');
const { DEFAULT_TIMEZONE } = require('../config/timezone');

// Same calendar month a month later, e.g. Jan 31 -> Mar 3 in a non-leap-year
// (JS Date's own setMonth rollover behavior) — acceptable for MVP; no custom
// day-clamping logic. Deliberately NOT tz-aware — see this file's docblock;
// every real caller passes a date-only sentinel, and calendar-component math
// on such a value has no DST exposure to begin with.
function addOneMonth(date) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + 1);
  return result;
}

// Start of "today" as a real instant, resolved in `tz` (default Central) —
// e.g. 2026-03-09T05:00:00.000Z, NOT a UTC-midnight sentinel. Use this
// anywhere "today" gates a real-time decision (a renewal/retry due-check
// against another real instant). For "today, as a date-only value" (an
// anchorDate/currentPeriodStart default), use todayDateOnly() instead — the
// two are NOT interchangeable, see this file's docblock and
// docs/plans/timezone-consistency-plan.md D10.
//
// `tz` defaults to DEFAULT_TIMEZONE (Frisco is single-location today) but
// every call site can pass a location's own timezone once more than one
// exists, with zero signature change needed then.
function todayAtMidnight(tz = DEFAULT_TIMEZONE) {
  return moment().tz(tz).startOf('day').toDate();
}

// "Today", as a date-only UTC-midnight sentinel in `tz` (default Central) —
// the same shape resolveStartDate() already produces by parsing a client
// "YYYY-MM-DD" string (new Date(dateStr)). Use this as the fallback for a
// field that represents a calendar day, not a real instant (e.g.
// registration.service.js's anchorDate when no explicit startDate was
// chosen) — never todayAtMidnight(), whose real-instant shape would make
// that field inconsistently shaped depending on which branch ran (D10).
function todayDateOnly(tz = DEFAULT_TIMEZONE) {
  return new Date(moment().tz(tz).format('YYYY-MM-DD'));
}

// One calendar day later, as a real instant — the retry/dunning schedule's
// step size (docs/plans/registration-ledger-plan.md D6: Day 0 -> 1 -> 2 ->
// 3). Genuinely DST-safe: moment's .add(), kept inside the tz-anchored
// chain, preserves wall-clock time-of-day across a DST transition, unlike
// raw setDate() (see this file's docblock and plan D9). Only ever fed a
// real instant (e.g. todayAtMidnight()'s output) — never a date-only
// sentinel, which addOneMonth/addMonths already handle correctly on their
// own terms.
function addOneDay(date, tz = DEFAULT_TIMEZONE) {
  return moment(date).tz(tz).add(1, 'day').toDate();
}

// Same rollover semantics as addOneMonth (deliberately not tz-aware, same
// reason — see this file's docblock), generalized to N months — used by
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

module.exports = {
  addOneMonth,
  addOneDay,
  addMonths,
  daysInMonth,
  endOfMonth,
  todayAtMidnight,
  todayDateOnly,
};
