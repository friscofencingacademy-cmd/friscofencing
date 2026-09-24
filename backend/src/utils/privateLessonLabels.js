// The one wording for a private-lesson purchase, shared by the parent's
// payment history (registration.service.js's describeHistoryRow) and the PDF
// invoice (invoice.service.js's buildPerSessionData), so the two can never
// describe the same charge differently. Pure — callers resolve the coach
// themselves and pass null when it no longer exists.
//
//   "Private lessons with Dana Cole — 30 min × 10"
//   "Private lesson with Dana Cole — 30 min"        (a single session)
//   "Private lessons — 30 min × 10"                  (coach no longer exists)
function privateLessonPurchaseLabel({ coach, durationMinutes, quantity }) {
  const noun = quantity === 1 ? 'Private lesson' : 'Private lessons';
  const withCoach = coach ? ` with ${[coach.firstName, coach.lastName].filter(Boolean).join(' ')}` : '';
  const length = Number.isFinite(durationMinutes) ? ` — ${durationMinutes} min` : '';
  const count = quantity > 1 ? ` × ${quantity}` : '';

  return `${noun}${withCoach}${length}${count}`;
}

module.exports = { privateLessonPurchaseLabel };
