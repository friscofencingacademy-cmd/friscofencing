// Pricing math for private-lesson sessions — pure functions only, no DB
// access. Rates are stored HOURLY everywhere upstream (CoachContract.
// studentBillingRate, PrivateClassEnrollment.agreedHourlyRate). The
// per-session dollar amount is never stored anywhere except a
// PerSessionRegistration row's `amount` (the unified ledger's per_session
// discriminator — docs/plans/service-registry-unified-ledger-plan.md; the
// audit trail of what was actually charged) — it is always COMPUTED at the
// point of use from the hourly rate and the session's own duration.
//
// This is the ONLY place this formula lives. Every consumer (session
// charge, the public availability preview, confirmation/receipt emails)
// must import from here rather than re-deriving the math (Hard Rule 7 —
// no pricing math anywhere else, frontend included).
//
// Fails closed — these functions never guess a price. Any invalid input
// throws rather than silently producing a wrong or zero amount.

function computeSessionPrice(hourlyRate, durationMinutes) {
  if (
    hourlyRate === null ||
    hourlyRate === undefined ||
    !Number.isFinite(hourlyRate) ||
    hourlyRate < 0
  ) {
    throw new Error('A valid hourly rate is required to compute a session price');
  }

  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new Error('A valid positive session duration is required to compute a session price');
  }

  return Math.round(((hourlyRate * durationMinutes) / 60) * 100) / 100;
}

// Minute difference between two Date instants — may be fractional.
function sessionDurationMinutes(startDate, endDate) {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error('Valid start and end dates are required to compute session duration');
  }

  const minutes = (end - start) / 60000;

  if (!(minutes > 0)) {
    throw new Error('Session end date must be after the start date');
  }

  return minutes;
}

module.exports = { computeSessionPrice, sessionDurationMinutes };
