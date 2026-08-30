'use strict';

/**
 * The ONLY date/time formatters emails may use (docs/plans/ckq-parity-plan.md
 * §3.1). No new dependency of its own — Intl.DateTimeFormat only.
 *
 * Two shapes flow through this file (docs/plans/utc-date-standard-plan.md —
 * the same distinction billingDates.js/dateShapes.js draw on the backend,
 * and frontend/lib/formatDate.ts draws on the frontend):
 *  - Real instants (an actual point in time — a charge timestamp, a
 *    private-class session's startDate, Subscription.nextRetryAt): pass to
 *    dateFull, rendered in the academy's own Central timezone.
 *  - Calendar-day sentinels (a UTC-midnight Date with no real timezone
 *    meaning — GroupClassSession.date, Subscription/Registration period
 *    fields): pass to dateOnlyFull, rendered in UTC. Rendering a sentinel
 *    via dateFull (Central) would shift it onto the wrong calendar day
 *    whenever the sentinel's UTC time-of-day isn't exactly midnight, or
 *    even at clean UTC midnight — Central is always behind UTC, so a
 *    UTC-midnight sentinel reads as "yesterday, 6-7pm" once shifted into
 *    Central. This was a real, shipped bug (a trial-confirmation email
 *    stating the wrong day) before this distinction existed here.
 *
 * A schedule's own "HH:mm" wall-clock string (never a Date) goes to
 * timeOfDay.
 */

const { DEFAULT_TIMEZONE } = require('../config/timezone');

// Single source of truth is config/timezone.js (docs/plans/timezone-
// consistency-plan.md D6) — never hardcode a second copy of this string.
const TIME_ZONE = DEFAULT_TIMEZONE;

const DAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** Date.getDay() convention (0=Sunday...6=Saturday) -> "Monday". */
function dayOfWeekLabel(dayOfWeek) {
  return DAY_LABELS[dayOfWeek] ?? 'Unknown';
}

/**
 * e.g. "September 2026" — used for the renewal receipt's monthLabel. Its
 * one real caller (renewal.service.js) always feeds it a calendar-day
 * sentinel (a period's periodStart), never a real instant — so this is
 * UTC-anchored like dateOnlyFull below, not Central-anchored. Rendering a
 * period-start sentinel (e.g. the 1st) in Central would roll it back to the
 * PREVIOUS month whenever Central's offset shifts UTC midnight into the
 * prior calendar day — a real, shipped bug this fixes.
 */
function monthLabel(date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(date));
}

/** e.g. "Monday, Aug 25, 2026" — for REAL INSTANTS only (see this file's
 * docblock). Never feed this a calendar-day sentinel — use dateOnlyFull. */
function dateFull(date) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: TIME_ZONE,
  }).format(new Date(date));
}

/** e.g. "Monday, Aug 25, 2026" — for CALENDAR-DAY SENTINELS only (see this
 * file's docblock). Same format as dateFull, UTC-anchored instead of
 * Central-anchored — renders the sentinel's own intended calendar day
 * regardless of the recipient or the academy's own timezone. */
function dateOnlyFull(date) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(date));
}

/** e.g. "16:00" -> "4:00 PM". Formatted as a plain wall-clock value — no
 * timezone conversion, since "HH:mm" schedule fields are already local. */
function timeOfDay(hhmm) {
  const [hours, minutes] = String(hhmm).split(':').map(Number);
  const asUtc = new Date(Date.UTC(2000, 0, 1, hours, minutes));

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  }).format(asUtc);
}

module.exports = { dateFull, dateOnlyFull, timeOfDay, dayOfWeekLabel, monthLabel };
