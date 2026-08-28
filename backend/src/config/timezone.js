// The one place the literal string 'America/Chicago' is allowed to appear
// in application code — every day-boundary/schedule-occurrence helper, and
// email/dates.js's display formatter, import this instead of hardcoding
// their own copy (docs/plans/timezone-consistency-plan.md D2/D6).
//
// A neutral config/ module rather than adding this to billingDates.js
// (billing-domain-scoped by its own docblock) or email/dates.js
// (presentation-layer) on purpose — matches this directory's existing
// config/billing.js precedent (a single-constant module, not buried in the
// util file that happens to use it first).
//
// Frisco is a single-location business today; this is the fallback every
// day-boundary helper defaults to. It is NOT wired to Location.timezone —
// there is nothing to select between yet (one location). The day a second
// location with a different timezone exists, call sites that should be
// location-aware pass `location.timezone` explicitly; this constant stays
// the default for everything else.
const DEFAULT_TIMEZONE = 'America/Chicago';

module.exports = { DEFAULT_TIMEZONE };
