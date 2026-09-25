import {
  addCalendarDays,
  calendarDayOrdinal,
  formatDateOnly,
  formatInstant,
  lastDayOfMonth,
  type CalendarDay,
} from './formatDate';
import type { CalendarEvent, CalendarEventKind, CalendarEventType } from './types';

// The calendar view's date logic, in one place (docs/plans/calendar-view-
// plan.md §2.2). Everything here works on calendar-day STRINGS
// ('YYYY-MM-DD') and CalendarDay tuples — never on real instants, and never
// with browser-local Date getters. An event is placed by the `day` string the
// backend computed; its `startsAt` is only ever formatted, in Central time.

export interface CalendarMonth {
  year: number;
  month: number; // 1-indexed
}

export type CalendarViewMode = 'month' | 'agenda';

// The calendar's view state — lives in the URL (C11).
export interface CalendarViewState {
  month: CalendarMonth;
  coachId: string | null;
  type: CalendarEventType;
  // null = not chosen: the component picks month or agenda by screen width.
  view: CalendarViewMode | null;
}

export interface CalendarGridDay {
  day: string; // 'YYYY-MM-DD'
  dayOfMonth: number;
  inMonth: boolean;
}

export const GRID_DAYS = 42; // 6 weeks — the backend's own per-request maximum.

const MONTH_PARAM = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY_STRING = /^(\d{4})-(\d{2})-(\d{2})$/;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const EVENT_TYPES: CalendarEventType[] = ['all', 'group', 'private'];
const VIEW_MODES: CalendarViewMode[] = ['month', 'agenda'];

// ── Day strings ───────────────────────────────────────────────────────────

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function dayString(day: CalendarDay): string {
  return `${day.year}-${pad(day.month)}-${pad(day.day)}`;
}

export function parseDayString(value: string): CalendarDay {
  const match = DAY_STRING.exec(value);
  if (!match) {
    throw new Error(`Not a calendar day: ${value}`);
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** 0 = Sunday … 6 = Saturday — pure UTC calendar arithmetic, no local time. */
function weekdayOf(day: CalendarDay): number {
  return new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
}

// ── Months ────────────────────────────────────────────────────────────────

export function monthKey(month: CalendarMonth): string {
  return `${month.year}-${pad(month.month)}`;
}

export function monthOf(day: CalendarDay): CalendarMonth {
  return { year: day.year, month: day.month };
}

export function addMonths(month: CalendarMonth, count: number): CalendarMonth {
  const index = month.year * 12 + (month.month - 1) + count;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function firstDayOf(month: CalendarMonth): CalendarDay {
  return { year: month.year, month: month.month, day: 1 };
}

/** "October 2026". */
export function formatMonthTitle(month: CalendarMonth): string {
  return formatDateOnly(`${monthKey(month)}-01T00:00:00.000Z`, { month: 'long', day: undefined, year: 'numeric' });
}

/** The 6×7 days a month grid draws: Sunday on/before the 1st, 42 days on. */
export function monthGrid(month: CalendarMonth): CalendarGridDay[] {
  const first = firstDayOf(month);
  const start = addCalendarDays(first, -weekdayOf(first));

  return Array.from({ length: GRID_DAYS }, (_unused, index) => {
    const day = addCalendarDays(start, index);
    return { day: dayString(day), dayOfMonth: day.day, inMonth: day.month === month.month };
  });
}

/** The range to request for a month: the grid's first and last day (42 days). */
export function monthRange(month: CalendarMonth): { from: string; to: string } {
  const grid = monthGrid(month);
  return { from: grid[0].day, to: grid[grid.length - 1].day };
}

/** Is `day` ('YYYY-MM-DD') inside `month`? */
export function isInMonth(day: string, month: CalendarMonth): boolean {
  return day.startsWith(`${monthKey(month)}-`);
}

// ── Navigation limits ─────────────────────────────────────────────────────

/** "Next" is allowed while the next month starts on or before the horizon. */
export function canGoNext(month: CalendarMonth, horizonTo: string | null): boolean {
  if (horizonTo === null) return true;
  return calendarDayOrdinal(firstDayOf(addMonths(month, 1))) <= calendarDayOrdinal(parseDayString(horizonTo));
}

/**
 * "Previous" is allowed while the previous month still has days from today
 * on — except with no horizon (admin), who may look back freely.
 */
export function canGoPrevious(month: CalendarMonth, today: CalendarDay, horizonTo: string | null): boolean {
  if (horizonTo === null) return true;
  return calendarDayOrdinal(lastDayOfMonth(firstDayOf(addMonths(month, -1)))) >= calendarDayOrdinal(today);
}

// ── URL state (C11) ───────────────────────────────────────────────────────

interface SearchParamsLike {
  get(name: string): string | null;
}

/** Reads the view state from the URL; any invalid value falls back to its default. */
export function parseCalendarQuery(params: SearchParamsLike, today: CalendarDay): CalendarViewState {
  const monthMatch = MONTH_PARAM.exec(params.get('month') ?? '');
  const coach = params.get('coach');
  const type = params.get('type') as CalendarEventType | null;
  const view = params.get('view') as CalendarViewMode | null;

  return {
    month: monthMatch ? { year: Number(monthMatch[1]), month: Number(monthMatch[2]) } : monthOf(today),
    coachId: coach && OBJECT_ID.test(coach) ? coach : null,
    type: type && EVENT_TYPES.includes(type) ? type : 'all',
    view: view && VIEW_MODES.includes(view) ? view : null,
  };
}

/** The URL query for a view state — defaults left out, month always kept. */
export function calendarQueryString(state: CalendarViewState): string {
  const params = new URLSearchParams();
  params.set('month', monthKey(state.month));
  if (state.coachId) params.set('coach', state.coachId);
  if (state.type !== 'all') params.set('type', state.type);
  if (state.view) params.set('view', state.view);
  return `?${params.toString()}`;
}

// ── Where a click goes (C8) ───────────────────────────────────────────────

/**
 * An event's link into the booking flows that already exist — never a new
 * booking path. An open private slot opens the booking wizard with its date
 * picked; a class opens book-trial. Anyone but a logged-in parent logs in
 * first, carrying `next` back. Booked lessons and holidays link nowhere here.
 */
export function bookingHref(event: CalendarEvent, isLoggedInParent: boolean): string | null {
  let target: string | null = null;

  if (event.kind === 'private-open' && event.scheduleId) {
    target = `/parent/register-private?slot=${event.scheduleId}&day=${event.day}`;
  } else if (event.kind === 'group' && !event.mine) {
    target = '/parent/book-trial';
  }

  if (target === null) return null;
  return isLoggedInParent ? target : `/login?next=${encodeURIComponent(target)}`;
}

// ── Events ────────────────────────────────────────────────────────────────

/** Events grouped by the server's `day` string, server order kept. */
export function groupByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const byDay = new Map<string, CalendarEvent[]>();
  events.forEach((event) => {
    const list = byDay.get(event.day);
    if (list) {
      list.push(event);
    } else {
      byDay.set(event.day, [event]);
    }
  });
  return byDay;
}

/** "Tuesday, October 6" — a calendar day's heading. */
export function formatDayHeading(day: string): string {
  return formatDateOnly(`${day}T00:00:00.000Z`, { weekday: 'long', month: 'long', day: 'numeric', year: undefined });
}

// The text label every event carries, so color is never the only signal.
const KIND_LABELS: Record<CalendarEventKind, string> = {
  group: 'Class',
  'private-open': 'Open slot',
  'private-booked': 'Booked',
  holiday: 'Holiday',
};

export function eventKindLabel(event: Pick<CalendarEvent, 'kind' | 'mine'>): string {
  if (event.mine && event.kind === 'group') return 'Your class';
  if (event.mine && event.kind === 'private-booked') return 'Your lesson';
  return KIND_LABELS[event.kind];
}

/** "4:30 PM" in Central time, or "All day" for a holiday. */
export function eventTime(event: Pick<CalendarEvent, 'startsAt'>): string {
  if (!event.startsAt) return 'All day';
  return formatInstant(event.startsAt, { hour: 'numeric', minute: '2-digit', month: undefined, day: undefined, year: undefined });
}

/** "4:30 PM – 5:00 PM", or "All day". */
export function eventTimeRange(event: Pick<CalendarEvent, 'startsAt' | 'endsAt'>): string {
  if (!event.startsAt || !event.endsAt) return 'All day';
  return `${eventTime(event)} – ${eventTime({ startsAt: event.endsAt })}`;
}

/**
 * The one full description of an event — a linked chip's accessible name.
 * Same order as the chip's visible text (kind, time, title), then the details
 * the chip has no room for: "Open slot, 4:30 PM, Private lesson — 30 min,
 * Dana Cole".
 */
export function eventDescription(event: CalendarEvent): string {
  const parts = [eventKindLabel(event), eventTime(event), event.title];
  if (event.coach) parts.push(event.coach.name);
  if (event.students.length > 0) parts.push(`for ${event.students.map((student) => student.name).join(' and ')}`);
  if (event.isHoliday && event.kind === 'group' && event.holidayName) parts.push(`holiday: ${event.holidayName}`);
  return parts.join(', ');
}
