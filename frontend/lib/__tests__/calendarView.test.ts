import {
  GRID_DAYS,
  addMonths,
  bookingHref,
  calendarQueryString,
  canGoNext,
  canGoPrevious,
  eventDescription,
  eventKindLabel,
  eventTime,
  eventTimeRange,
  formatDayHeading,
  formatMonthTitle,
  groupByDay,
  isInMonth,
  monthGrid,
  monthRange,
  parseCalendarQuery,
  type CalendarViewState,
} from '../calendarView';
import type { CalendarDay } from '../formatDate';
import type { CalendarEvent } from '../types';

// Pure functions on calendar-day strings (docs/plans/calendar-view-plan.md
// §2.2). "Today" is always passed in — nothing here reads the clock.
const TODAY: CalendarDay = { year: 2026, month: 10, day: 5 };
const COACH_ID = '64b0000000000000000000c1';

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'private-open:rule-1:2026-10-06',
    kind: 'private-open',
    day: '2026-10-06',
    startsAt: '2026-10-06T21:30:00.000Z',
    endsAt: '2026-10-06T22:00:00.000Z',
    title: 'Private lesson — 30 min',
    coach: { id: COACH_ID, name: 'Dana Cole' },
    locationName: null,
    levelName: null,
    durationMinutes: 30,
    scheduleId: 'rule-1',
    sessionId: null,
    price: 32.5,
    mine: false,
    students: [],
    isHoliday: false,
    holidayName: null,
    ...overrides,
  };
}

function days(grid: ReturnType<typeof monthGrid>) {
  return grid.map((cell) => cell.day);
}

describe('calendarView — month grid', () => {
  it.each([
    ['a month starting on a Sunday (Nov 2026)', { year: 2026, month: 11 }, '2026-11-01', '2026-12-12'],
    ['a month starting on a Saturday (Aug 2026)', { year: 2026, month: 8 }, '2026-07-26', '2026-09-05'],
    ['February 2027', { year: 2027, month: 2 }, '2027-01-31', '2027-03-13'],
    ['October 2026 (the daylight-saving month)', { year: 2026, month: 10 }, '2026-09-27', '2026-11-07'],
  ])('draws %s as 42 consecutive days from the Sunday on or before the 1st', (_label, month, first, last) => {
    const grid = monthGrid(month);

    expect(grid).toHaveLength(GRID_DAYS);
    expect(grid[0].day).toBe(first);
    expect(grid[grid.length - 1].day).toBe(last);
    // Every step is exactly one calendar day — no gap or repeat at month ends
    // or at the Nov 1 clock change.
    expect(new Set(days(grid)).size).toBe(GRID_DAYS);
  });

  it('marks which days belong to the month', () => {
    const grid = monthGrid({ year: 2026, month: 10 });

    expect(grid.filter((cell) => cell.inMonth)).toHaveLength(31);
    expect(grid[0]).toEqual({ day: '2026-09-27', dayOfMonth: 27, inMonth: false });
    expect(grid.find((cell) => cell.day === '2026-10-01')).toEqual({ day: '2026-10-01', dayOfMonth: 1, inMonth: true });
    expect(days(grid).filter((day) => day === '2026-11-01')).toHaveLength(1);
  });

  it('requests exactly the grid — never more than the backend’s 42-day limit', () => {
    [{ year: 2026, month: 10 }, { year: 2027, month: 2 }, { year: 2026, month: 8 }].forEach((month) => {
      const { from, to } = monthRange(month);
      const grid = monthGrid(month);
      expect(from).toBe(grid[0].day);
      expect(to).toBe(grid[GRID_DAYS - 1].day);
    });
  });

  it('adds months across a year boundary', () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths({ year: 2026, month: 10 }, 14)).toEqual({ year: 2027, month: 12 });
  });

  it('knows whether a day string is in a month', () => {
    expect(isInMonth('2026-10-31', { year: 2026, month: 10 })).toBe(true);
    expect(isInMonth('2026-11-01', { year: 2026, month: 10 })).toBe(false);
  });

  it('formats a month title and a day heading from calendar days, not instants', () => {
    expect(formatMonthTitle({ year: 2026, month: 10 })).toBe('October 2026');
    expect(formatDayHeading('2026-10-06')).toBe('Tuesday, October 6');
  });
});

describe('calendarView — navigation limits', () => {
  it('allows "next" only while the next month starts on or before the horizon', () => {
    const horizon = '2026-12-06';
    expect(canGoNext({ year: 2026, month: 10 }, horizon)).toBe(true);
    expect(canGoNext({ year: 2026, month: 11 }, horizon)).toBe(true);
    expect(canGoNext({ year: 2026, month: 12 }, horizon)).toBe(false);
    expect(canGoNext({ year: 2026, month: 12 }, null)).toBe(true);
  });

  it('allows "previous" only back to the current month — unless there is no horizon (admin)', () => {
    expect(canGoPrevious({ year: 2026, month: 10 }, TODAY, '2026-12-06')).toBe(false);
    expect(canGoPrevious({ year: 2026, month: 11 }, TODAY, '2026-12-06')).toBe(true);
    expect(canGoPrevious({ year: 2026, month: 10 }, TODAY, null)).toBe(true);
  });
});

describe('calendarView — URL state', () => {
  function params(query: string) {
    return new URLSearchParams(query);
  }

  it('reads a full query', () => {
    expect(parseCalendarQuery(params(`month=2026-11&coach=${COACH_ID}&type=private&view=agenda`), TODAY)).toEqual({
      month: { year: 2026, month: 11 },
      coachId: COACH_ID,
      type: 'private',
      view: 'agenda',
    });
  });

  it.each([
    ['no query', ''],
    ['an impossible month', 'month=2026-13'],
    ['a malformed month', 'month=Oct'],
    ['a malformed coach id', 'coach=nope'],
    ['an unknown type', 'type=camps'],
    ['an unknown view', 'view=week'],
  ])("falls back to the defaults (today's month, everything) for %s", (_label, query) => {
    const defaults: CalendarViewState = { month: { year: 2026, month: 10 }, coachId: null, type: 'all', view: null };

    expect(parseCalendarQuery(params(query), TODAY)).toEqual(defaults);
  });

  it('writes the month always and leaves other defaults out, round-tripping through the parser', () => {
    const state: CalendarViewState = { month: { year: 2027, month: 1 }, coachId: COACH_ID, type: 'group', view: 'month' };

    expect(calendarQueryString({ ...state, coachId: null, type: 'all', view: null })).toBe('?month=2027-01');
    expect(calendarQueryString(state)).toBe(`?month=2027-01&coach=${COACH_ID}&type=group&view=month`);
    expect(parseCalendarQuery(new URLSearchParams(calendarQueryString(state).slice(1)), TODAY)).toEqual(state);
  });
});

describe('calendarView — events', () => {
  it("groups events by the server's day — an 11:30 PM Central lesson stays on its own day", () => {
    // 11:30 PM CDT on Oct 6 is 04:30 UTC on Oct 7.
    const late = event({ id: 'late', day: '2026-10-06', startsAt: '2026-10-07T04:30:00.000Z', endsAt: '2026-10-07T05:00:00.000Z' });
    const next = event({ id: 'next', day: '2026-10-07', startsAt: '2026-10-07T21:30:00.000Z' });

    const byDay = groupByDay([late, next]);

    expect(byDay.get('2026-10-06')?.map((item) => item.id)).toEqual(['late']);
    expect(byDay.get('2026-10-07')?.map((item) => item.id)).toEqual(['next']);
    expect(eventTime(late)).toBe('11:30 PM');
  });

  it('keeps the server order within a day', () => {
    const byDay = groupByDay([event({ id: 'a' }), event({ id: 'b' }), event({ id: 'c' })]);
    expect(byDay.get('2026-10-06')?.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('labels every kind in words, and marks the family’s own items', () => {
    expect(eventKindLabel(event({ kind: 'group' }))).toBe('Class');
    expect(eventKindLabel(event({ kind: 'private-open' }))).toBe('Open slot');
    expect(eventKindLabel(event({ kind: 'private-booked' }))).toBe('Booked');
    expect(eventKindLabel(event({ kind: 'holiday' }))).toBe('Holiday');
    expect(eventKindLabel(event({ kind: 'group', mine: true }))).toBe('Your class');
    expect(eventKindLabel(event({ kind: 'private-booked', mine: true }))).toBe('Your lesson');
  });

  it('formats times in Central, and a holiday as all day', () => {
    expect(eventTimeRange(event({}))).toBe('4:30 PM – 5:00 PM');
    expect(eventTime(event({ kind: 'holiday', startsAt: null, endsAt: null }))).toBe('All day');
    expect(eventTimeRange(event({ kind: 'holiday', startsAt: null, endsAt: null }))).toBe('All day');
  });

  it('describes an event in the same order as its visible text, then the details', () => {
    expect(eventDescription(event({}))).toBe('Open slot, 4:30 PM, Private lesson — 30 min, Dana Cole');
    expect(
      eventDescription(
        event({ kind: 'group', title: 'Beginner Foil', mine: true, students: [{ id: 's1', name: 'Sam Lee' }] })
      )
    ).toBe('Your class, 4:30 PM, Beginner Foil, Dana Cole, for Sam Lee');
  });
});

describe('calendarView — where a click goes (C8)', () => {
  it('opens the booking wizard with the slot and its day for a parent, via login for anyone else', () => {
    const wizard = '/parent/register-private?slot=rule-1&day=2026-10-06';

    expect(bookingHref(event({}), true)).toBe(wizard);
    expect(bookingHref(event({}), false)).toBe(`/login?next=${encodeURIComponent(wizard)}`);
  });

  it('opens book-trial for a class, and nothing for booked lessons, holidays or the family’s own class', () => {
    expect(bookingHref(event({ kind: 'group' }), true)).toBe('/parent/book-trial');
    expect(bookingHref(event({ kind: 'group' }), false)).toBe(`/login?next=${encodeURIComponent('/parent/book-trial')}`);
    expect(bookingHref(event({ kind: 'private-booked' }), true)).toBeNull();
    expect(bookingHref(event({ kind: 'holiday' }), true)).toBeNull();
    expect(bookingHref(event({ kind: 'group', mine: true }), true)).toBeNull();
  });
});
