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

module.exports = { addOneMonth, todayAtMidnight };
