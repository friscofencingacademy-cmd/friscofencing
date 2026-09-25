// The construction/comparison gate for calendar-day sentinels used OUTSIDE
// the billing domain — group-class session dates (docs/plans/utc-date-
// standard-plan.md). Kept out of billingDates.js (billing-domain-scoped by
// its own docblock) on purpose, same precedent as config/timezone.js being
// its own single-constant module rather than folded into the file that
// happens to use it first.
//
// This file's sentinel functions are a strictly explicit superset of
// billingDates.js's addOneMonth/addMonths/daysInMonth/endOfMonth: those rely
// on the server process running in UTC (documented in that file's own
// docblock — local Date getters happen to equal UTC getters only because of
// that assumption) and are deliberately left untouched by this plan. The
// functions below use explicit getUTC*/setUTCDate/Date.UTC calls instead,
// so they are correct regardless of the server's local timezone — the same
// robustness the frontend's parallel module (frontend/lib/formatDate.ts)
// needs for an actual reason (a browser can run in ANY local timezone).
//
// Two shapes, one rule each (mirrors billingDates.js's own docblock):
//  - Calendar-day sentinel: a UTC-midnight Date representing a pure
//    calendar day, no real timezone meaning (GroupClassSession.date). Build
//    ONLY via dateOnlyUTC/addDaysToDateOnly/nextDateOnlyOnOrAfter below;
//    compare ONLY against another sentinel (e.g. todayDateOnly() from
//    billingDates.js) — never against a real instant. sentinelDayString
//    reads one back out as 'YYYY-MM-DD'.
//  - Real instant: combineDayAndTimeInTZ turns a calendar day + wall-clock
//    "HH:mm" into a true UTC instant, resolved via real IANA timezone math
//    (moment-timezone) — used for private-lesson bookings' startDate/endDate
//    and group-class sessions' startsAt/endsAt (docs/plans/session-start-
//    time-cutoff-plan.md).

const moment = require('moment-timezone');
const { DEFAULT_TIMEZONE } = require('../config/timezone');

// Any value with a real Date's own UTC parts (a Date, or anything
// `new Date(value)` can parse) -> the UTC-midnight sentinel of that same
// UTC calendar day. The ONLY way application code may construct or
// normalize a calendar-day sentinel. Idempotent: calling this on an
// already-clean sentinel returns an equal value.
function dateOnlyUTC(value) {
  const date = value instanceof Date ? value : new Date(value);

  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// `sentinel` plus `days` calendar days, staying a sentinel — plain UTC
// calendar-component arithmetic (setUTCDate), zero DST exposure by
// construction (UTC has no DST). `days` may be negative.
function addDaysToDateOnly(sentinel, days) {
  const result = new Date(sentinel);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

// The first sentinel on/after `fromSentinel` whose UTC calendar weekday
// (getUTCDay, 0=Sunday..6=Saturday — this codebase's dayOfWeek convention,
// matching JS Date.getDay()) is `dayOfWeek`. If `fromSentinel` itself
// already falls on `dayOfWeek`, it is returned unchanged — "on or after."
// Used by GroupClassSession's generator and by private-lesson availability
// (privateClassSchedule.service.js's listAvailableDates).
function nextDateOnlyOnOrAfter(fromSentinel, dayOfWeek) {
  const diff = (dayOfWeek - fromSentinel.getUTCDay() + 7) % 7;
  return addDaysToDateOnly(fromSentinel, diff);
}

// The ONLY sanctioned way to read a calendar-day sentinel back out as the
// 'YYYY-MM-DD' day string combineDayAndTimeInTZ accepts — a sentinel's UTC
// calendar parts ARE its meaning. The named, blessed exception to "never
// reinterpret a sentinel via toISOString()".
function sentinelDayString(sentinel) {
  const year = sentinel.getUTCFullYear();
  const month = String(sentinel.getUTCMonth() + 1).padStart(2, '0');
  const day = String(sentinel.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 'YYYY-MM-DD' calendar day + 'HH:mm' wall-clock time, resolved in `tz`
// (default Central) -> a true UTC instant. The ONLY way to build a stored
// real instant from human wall-clock input (private-lesson bookings'
// startDate/endDate and group classes' startsAt/endsAt) — CKQ's
// combineDateTimeInTZ + its convertTZtoUTC, fused into one call. To feed it
// a calendar-day sentinel, convert with sentinelDayString first — never a
// toISOString() reinterpretation.
function combineDayAndTimeInTZ(dayStr, hhmm, tz = DEFAULT_TIMEZONE) {
  return moment.tz(`${dayStr} ${hhmm}`, 'YYYY-MM-DD HH:mm', tz).toDate();
}

// The reverse of combineDayAndTimeInTZ's day half: a real instant -> the
// 'YYYY-MM-DD' calendar day it falls on in `tz` (default Central). The ONLY
// way to put a real instant on a calendar day (docs/plans/calendar-view-
// plan.md C3/C4) — an 11:30 PM Central lesson is that day, even though its
// UTC date is already the next one. Never use toISOString().slice(0, 10) for
// this; that answers "which UTC day", not "which academy day".
function instantDayString(instant, tz = DEFAULT_TIMEZONE) {
  return moment(instant).tz(tz).format('YYYY-MM-DD');
}

module.exports = {
  dateOnlyUTC,
  addDaysToDateOnly,
  nextDateOnlyOnOrAfter,
  sentinelDayString,
  combineDayAndTimeInTZ,
  instantDayString,
};
