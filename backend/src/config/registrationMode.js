// The premium-vs-schedule-based flag (docs/plans/premium-registration-and-
// attendance-plan.md §0/§4) — unset or 'false' (the live default) means
// premium: one flat fee, attend any scheduled session of the level. Read at
// call time, never captured at module load, matching mail.service.js's own
// isEmailBlocked() convention — this codebase's established pattern for an
// env-var-driven behavioral gate.
//
// A neutral config/ module (matching this directory's config/billing.js and
// config/timezone.js precedent) rather than living in registration.service.js
// alone — groupClassSchedule.service.js's public listing needs the same
// read and would otherwise have to import it back from registration.service.js,
// which already imports FROM groupClassSchedule.service.js (computeAvailability),
// creating a cycle.
function isPremiumRegistrationEnabled() {
  return process.env.ENABLE_SCHEDULE_BASED_REGISTRATION !== 'true';
}

module.exports = { isPremiumRegistrationEnabled };
