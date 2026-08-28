'use strict';

/**
 * The ONLY date/time formatters emails may use (docs/plans/ckq-parity-plan.md
 * §3.1). No new dependency of its own — Intl.DateTimeFormat only. Callers
 * pass a real Date/ISO instant to dateFull, and a schedule's own "HH:mm"
 * wall-clock string (never a Date) to timeOfDay.
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

/** e.g. "September 2026" — used for the renewal receipt's monthLabel. */
function monthLabel(date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: TIME_ZONE,
  }).format(new Date(date));
}

/** e.g. "Monday, Aug 25, 2026" */
function dateFull(date) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: TIME_ZONE,
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

module.exports = { dateFull, timeOfDay, dayOfWeekLabel, monthLabel };
