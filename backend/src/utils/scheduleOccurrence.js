// Shared "next occurrence of a weekday" date math for the private-class
// flow (public availability preview + session generation both need the
// exact same rule: the first occurrence of `dayOfWeek` STRICTLY AFTER
// today — never today itself, unlike GroupClassSession's generator, which
// uses on-or-after).
//
// Disclosed MVP simplification: like the rest of this codebase's date math
// (billingDates.js's todayAtMidnight, groupClassSession.service.js's
// nextOccurrenceOnOrAfter), this operates on the server process's local
// Date, not a full IANA "America/Chicago" conversion. Test suites run under
// TZ=UTC (docs/TESTING_STRATEGY.md) to keep this deterministic.

function nextOccurrenceStrictlyAfter(fromDate, dayOfWeek) {
  const result = new Date(fromDate);
  result.setHours(0, 0, 0, 0);

  let diff = (dayOfWeek - result.getDay() + 7) % 7;

  if (diff === 0) {
    // "Strictly after" — if today already falls on dayOfWeek, the next
    // occurrence is 7 days out, not today.
    diff = 7;
  }

  result.setDate(result.getDate() + diff);

  return result;
}

module.exports = { nextOccurrenceStrictlyAfter };
