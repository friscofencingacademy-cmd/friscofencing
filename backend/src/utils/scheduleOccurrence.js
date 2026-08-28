const moment = require('moment-timezone');
const { DEFAULT_TIMEZONE } = require('../config/timezone');

// Shared "next occurrence of a weekday" date math for the private-class
// flow (public availability preview + session generation both need the
// exact same rule: the first occurrence of `dayOfWeek` STRICTLY AFTER
// today — never today itself, unlike GroupClassSession's generator, which
// uses on-or-after).
//
// `fromDate` is always a real instant here (every current caller passes
// `new Date()`) — genuine IANA timezone math via moment-timezone, resolved
// in `tz` (default Central; a future per-location call site can pass
// `location.timezone` with no signature change needed —
// docs/plans/timezone-consistency-plan.md D4). Do not feed this a date-only
// sentinel (see billingDates.js's docblock for that distinction) — it
// isn't one of this function's current or intended callers.

function nextOccurrenceStrictlyAfter(fromDate, dayOfWeek, tz = DEFAULT_TIMEZONE) {
  const start = moment(fromDate).tz(tz).startOf('day');

  // moment's isoWeekday() is 1=Monday..7=Sunday; this codebase's dayOfWeek
  // convention (matching JS Date.getDay()) is 0=Sunday..6=Saturday — the
  // %7 below converts moment's own .day() (0=Sunday..6=Saturday, same
  // convention as this file's callers) so no isoWeekday translation is
  // needed.
  let diff = (dayOfWeek - start.day() + 7) % 7;

  if (diff === 0) {
    // "Strictly after" — if today already falls on dayOfWeek, the next
    // occurrence is 7 days out, not today.
    diff = 7;
  }

  return start.add(diff, 'days').toDate();
}

module.exports = { nextOccurrenceStrictlyAfter };
