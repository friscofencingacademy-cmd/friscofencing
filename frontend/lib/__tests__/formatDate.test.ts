import {
  formatDateOnly,
  formatInstant,
  todayInAcademyTZ,
  sentinelCalendarDay,
  calendarDayOrdinal,
  addCalendarDays,
  lastDayOfMonth,
  nextCalendarMonth,
  ACADEMY_TIMEZONE,
} from '../formatDate';

describe('formatDateOnly', () => {
  it('renders a clean UTC-midnight sentinel', () => {
    expect(formatDateOnly('2026-09-01T00:00:00.000Z')).toBe('Sep 1, 2026');
  });

  it('supports extra options (e.g. weekday) while still forcing UTC', () => {
    expect(formatDateOnly('2026-08-31T00:00:00.000Z', { weekday: 'short' })).toBe('Mon, Aug 31, 2026');
  });

  // The regression this module exists to fix (docs/plans/utc-date-standard-
  // plan.md bug 1): every shape currently in the wild for
  // GroupClassSession.date — a clean 00:00Z sentinel (post-migration), a
  // Central-midnight 05:00Z instant (the pre-migration generator), and an
  // Eastern-midnight 04:00Z instant (the owner's original dev-machine data)
  // — all fall on the SAME UTC calendar day, so formatDateOnly renders the
  // same intended day for every one of them, regardless of which shape is
  // still sitting in the database when this ships.
  describe('timezone-shift regression (bug fix)', () => {
    it('renders the same calendar day for every currently-in-the-wild sentinel shape', () => {
      const cleanSentinel = '2026-09-01T00:00:00.000Z'; // post-migration UTC midnight
      const centralMidnightInstant = '2026-09-01T05:00:00.000Z'; // pre-migration generator
      const easternMidnightInstant = '2026-09-01T04:00:00.000Z'; // original owner dev-machine data

      expect(formatDateOnly(cleanSentinel)).toBe('Sep 1, 2026');
      expect(formatDateOnly(centralMidnightInstant)).toBe('Sep 1, 2026');
      expect(formatDateOnly(easternMidnightInstant)).toBe('Sep 1, 2026');
    });

    it('never shifts a Monday sentinel to "Sunday" the way bare toLocaleDateString did', () => {
      // A Beginner (Below 10) Monday session, stored Eastern-midnight —
      // exactly the staging data that produced the originally-reported bug.
      const mondaySessionEasternMidnight = '2026-08-31T04:00:00.000Z';
      expect(formatDateOnly(mondaySessionEasternMidnight, { weekday: 'short' })).toBe('Mon, Aug 31, 2026');
    });
  });
});

describe('formatInstant', () => {
  it('renders a real instant in the academy timezone (Central), not UTC', () => {
    // 16:45 UTC in August (CDT, UTC-5) is 11:45 AM Central.
    expect(formatInstant('2026-08-25T16:45:00.000Z', { hour: 'numeric', minute: '2-digit' })).toBe(
      'Aug 25, 2026, 11:45 AM'
    );
  });

  it('supports extra options while still forcing the academy timezone', () => {
    expect(formatInstant('2026-08-25T16:45:00.000Z', { weekday: 'short' })).toBe('Tue, Aug 25, 2026');
  });

  it('reflects the CST/CDT offset shift across the DST boundary', () => {
    // The US fall-back transition happens at 2:00 AM CDT on 2026-11-01,
    // i.e. exactly 07:00:00 UTC (CDT is UTC-5) — the moment clocks fall
    // back to 1:00 AM CST (UTC-6). One hour on each side of that instant,
    // still the same UTC/Central calendar day, to avoid asserting exactly
    // at the ambiguous boundary itself.
    expect(formatInstant('2026-11-01T05:00:00.000Z', { hour: 'numeric', minute: '2-digit' })).toBe(
      'Nov 1, 2026, 12:00 AM' // still CDT (UTC-5)
    );
    expect(formatInstant('2026-11-01T09:00:00.000Z', { hour: 'numeric', minute: '2-digit' })).toBe(
      'Nov 1, 2026, 3:00 AM' // now CST (UTC-6)
    );
  });
});

describe('sentinelCalendarDay', () => {
  it('extracts a clean sentinel\'s UTC calendar day', () => {
    expect(sentinelCalendarDay('2026-09-01T00:00:00.000Z')).toEqual({ year: 2026, month: 9, day: 1 });
  });

  // sentinelCalendarDay deliberately trusts a sentinel's own UTC calendar
  // day as the intended one — correct for every shape the migration script
  // (docs/plans/utc-date-standard-plan.md §4.4) accepts (any UTC hour <= 12,
  // its own abort threshold), which covers every real shape in the wild.
  it("reads a not-yet-migrated Eastern-midnight instant's UTC day unchanged", () => {
    expect(sentinelCalendarDay('2026-08-31T04:00:00.000Z')).toEqual({ year: 2026, month: 8, day: 31 });
  });
});

describe('calendarDayOrdinal', () => {
  it('orders days within the same month correctly', () => {
    expect(calendarDayOrdinal({ year: 2026, month: 1, day: 5 })).toBeLessThan(
      calendarDayOrdinal({ year: 2026, month: 1, day: 6 })
    );
  });

  it('orders across a month boundary correctly', () => {
    expect(calendarDayOrdinal({ year: 2026, month: 1, day: 31 })).toBeLessThan(
      calendarDayOrdinal({ year: 2026, month: 2, day: 1 })
    );
  });

  it('orders across a year boundary correctly', () => {
    expect(calendarDayOrdinal({ year: 2026, month: 12, day: 31 })).toBeLessThan(
      calendarDayOrdinal({ year: 2027, month: 1, day: 1 })
    );
  });
});

describe('addCalendarDays', () => {
  it('adds days within a month', () => {
    expect(addCalendarDays({ year: 2026, month: 1, day: 10 }, 14)).toEqual({ year: 2026, month: 1, day: 24 });
  });

  it('rolls over a month boundary', () => {
    expect(addCalendarDays({ year: 2026, month: 1, day: 28 }, 14)).toEqual({ year: 2026, month: 2, day: 11 });
  });

  it('rolls over a year boundary', () => {
    expect(addCalendarDays({ year: 2026, month: 12, day: 28 }, 14)).toEqual({ year: 2027, month: 1, day: 11 });
  });

  // "Prove the fix" pattern (docs/TESTING_STRATEGY.md's Timezone section) —
  // pure UTC calendar-component arithmetic (Date.UTC + setUTCDate) never
  // touches wall-clock/local time at all, so it is DST-immune BY
  // CONSTRUCTION: stepping across the US fall-back transition (2026-11-01)
  // produces exactly a 7-day calendar jump, never a 6h-drifted instant the
  // way naive real-instant `+7*24h` stepping would.
  it('steps a clean 7 days across the fall-back DST transition, with zero drift', () => {
    const beforeTransition = { year: 2026, month: 10, day: 25 }; // Sun, one week before fall-back
    const afterTransition = addCalendarDays(beforeTransition, 7);
    expect(afterTransition).toEqual({ year: 2026, month: 11, day: 1 }); // exactly 7 calendar days later
  });
});

describe('lastDayOfMonth', () => {
  it('returns the last day of a 31-day month', () => {
    expect(lastDayOfMonth({ year: 2026, month: 1, day: 5 })).toEqual({ year: 2026, month: 1, day: 31 });
  });

  it('returns the last day of a 30-day month', () => {
    expect(lastDayOfMonth({ year: 2026, month: 4, day: 1 })).toEqual({ year: 2026, month: 4, day: 30 });
  });

  it('returns the last day of February in a leap year', () => {
    expect(lastDayOfMonth({ year: 2028, month: 2, day: 1 })).toEqual({ year: 2028, month: 2, day: 29 });
  });

  it('returns the last day of February in a non-leap year', () => {
    expect(lastDayOfMonth({ year: 2026, month: 2, day: 1 })).toEqual({ year: 2026, month: 2, day: 28 });
  });
});

describe('nextCalendarMonth', () => {
  it('returns the following month within a year', () => {
    expect(nextCalendarMonth({ year: 2026, month: 1, day: 15 })).toEqual({ year: 2026, month: 2 });
  });

  it('wraps December into January of the next year', () => {
    expect(nextCalendarMonth({ year: 2026, month: 12, day: 15 })).toEqual({ year: 2027, month: 1 });
  });
});

describe('todayInAcademyTZ', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  // The exact class of bug this function exists to prevent: reading "today"
  // from raw UTC/local getters on `new Date()` disagrees with the Central
  // calendar day for part of every day. `new Date().getUTCDate()` would
  // wrongly return Aug 31 here.
  it('resolves "today" as the Central calendar day, not the UTC one, near a UTC midnight rollover (CDT)', () => {
    jest.useFakeTimers({ now: new Date('2026-08-31T04:00:00.000Z') }); // 11 PM Aug 30 in Central (CDT, UTC-5)
    expect(todayInAcademyTZ()).toEqual({ year: 2026, month: 8, day: 30 });
  });

  it('resolves "today" correctly in winter (CST, UTC-6)', () => {
    jest.useFakeTimers({ now: new Date('2026-01-01T05:00:00.000Z') }); // 11 PM Dec 31 2025 in Central (CST, UTC-6)
    expect(todayInAcademyTZ()).toEqual({ year: 2025, month: 12, day: 31 });
  });

  it('agrees with the UTC calendar day well inside the Central business day', () => {
    jest.useFakeTimers({ now: new Date('2026-08-15T18:00:00.000Z') }); // 1 PM Central — no rollover ambiguity
    expect(todayInAcademyTZ()).toEqual({ year: 2026, month: 8, day: 15 });
  });
});

describe('ACADEMY_TIMEZONE', () => {
  it('is the academy\'s Central timezone, matching the backend\'s DEFAULT_TIMEZONE', () => {
    expect(ACADEMY_TIMEZONE).toBe('America/Chicago');
  });
});
