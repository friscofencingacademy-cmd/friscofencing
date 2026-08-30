// The frontend's date-shape gate (docs/plans/utc-date-standard-plan.md) —
// mirrors backend/src/utils/dateShapes.js's two-shape contract. Every Date
// value this app ever renders or compares is one of exactly two shapes:
//
//  - Calendar-day sentinel: a UTC-midnight Date representing a pure calendar
//    day with no real timezone meaning (GroupClassSession.date,
//    Subscription/Registration period fields). Render with timeZone: 'UTC'
//    — NEVER browser-local, which silently renders the wrong calendar day
//    for any viewer west of UTC (the exact bug this module exists to fix).
//  - Real instant: an actual point in time (a charge timestamp, a private-
//    class session's startDate). Render in the academy's own timezone —
//    also never browser-local, so every viewer sees the same wall-clock
//    time regardless of their own device.
//
// Every place in this app that renders a session/billing date must go
// through formatDateOnly or formatInstant below — never a bare
// `new Date(iso).toLocaleDateString()`/`toLocaleString()` with no `timeZone`
// option, which is what let a Monday class render as "Sunday" for any
// parent in a browser timezone west of UTC.

export const ACADEMY_TIMEZONE = 'America/Chicago';

const DATE_ONLY_DEFAULTS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
};

const INSTANT_DEFAULTS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
};

/**
 * Renders a calendar-day sentinel (a UTC-midnight Date/ISO string) in a
 * fixed, viewer-independent way. `timeZone` is always forced to 'UTC',
 * regardless of what `options` passes — a sentinel has no real timezone
 * meaning, so there is nothing else it could correctly mean.
 */
export function formatDateOnly(iso: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', {
    ...DATE_ONLY_DEFAULTS,
    ...options,
    timeZone: 'UTC',
  }).format(new Date(iso));
}

/**
 * Renders a real instant in the academy's own timezone (Central) — never
 * browser-local, so every viewer sees the same wall-clock day/time.
 * `timeZone` is always forced to ACADEMY_TIMEZONE, regardless of `options`.
 */
export function formatInstant(iso: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', {
    ...INSTANT_DEFAULTS,
    ...options,
    timeZone: ACADEMY_TIMEZONE,
  }).format(new Date(iso));
}

// ── Calendar-day arithmetic (sentinel-only — never mixed with instant math) ─
//
// The register wizard's start-date window (thisMonthWindowEnd/
// isNextCalendarMonth) used to build real `Date` objects from session-date
// sentinels via `new Date(session.date)` and then call browser-local
// getters (`getFullYear`/`getMonth`/`getDate`) on them — the exact same
// shape-confusion bug as the raw-toLocaleDateString rendering bug above,
// just in the comparison logic instead of display. A UTC-midnight sentinel
// has no local-time meaning; reading it with local getters silently shifts
// it onto the wrong calendar day for any viewer west of UTC.
//
// CalendarDay is the fix: every comparison below happens on plain
// {year, month, day} tuples pulled either from a sentinel's own UTC parts
// (sentinelCalendarDay) or from "today" as it actually reads in the
// academy's timezone (todayInAcademyTZ) — never a shared Date object common
// to both, and never local getters on a sentinel.

export interface CalendarDay {
  year: number;
  month: number; // 1-indexed (January = 1), matching Intl's own convention
  day: number;
}

/** Today's calendar day in the academy's timezone — never a browser-local Date. */
export function todayInAcademyTZ(): CalendarDay {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ACADEMY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const lookup: Record<string, string> = {};
  parts.forEach((part) => {
    lookup[part.type] = part.value;
  });

  return { year: Number(lookup.year), month: Number(lookup.month), day: Number(lookup.day) };
}

/** A calendar-day sentinel's own UTC calendar day — its only meaningful shape. */
export function sentinelCalendarDay(iso: string): CalendarDay {
  const date = new Date(iso);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** A single comparable integer for a CalendarDay — safe for <, <=, >, >=, ===. */
export function calendarDayOrdinal(day: CalendarDay): number {
  return day.year * 10000 + day.month * 100 + day.day;
}

/** `day` plus `count` calendar days — pure UTC calendar arithmetic, zero DST/local exposure. */
export function addCalendarDays(day: CalendarDay, count: number): CalendarDay {
  const date = new Date(Date.UTC(day.year, day.month - 1, day.day));
  date.setUTCDate(date.getUTCDate() + count);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** The last calendar day of `day`'s own month. */
export function lastDayOfMonth(day: CalendarDay): CalendarDay {
  const date = new Date(Date.UTC(day.year, day.month, 0)); // day 0 of next month = last day of this month
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** The {year, month} of the calendar month immediately after `day`'s own. */
export function nextCalendarMonth(day: CalendarDay): { year: number; month: number } {
  const date = new Date(Date.UTC(day.year, day.month, 1)); // month is already 1-indexed, so this is +1
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}
