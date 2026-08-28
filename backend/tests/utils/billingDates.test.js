const {
  todayAtMidnight,
  todayDateOnly,
  addOneDay,
  addOneMonth,
  addMonths,
  daysInMonth,
  endOfMonth,
} = require('../../src/utils/billingDates');

// docs/plans/timezone-consistency-plan.md D3/D9/D10 — this suite exists to
// PROVE the timezone fix, not just exercise the code path: every "real
// instant" assertion below is contrasted against what the old, raw-Date
// (server-local, UTC in prod) implementation would have produced.

describe('billingDates', () => {
  describe('todayAtMidnight', () => {
    it('resolves the correct Central calendar day for an instant inside the UTC/Central gap window', () => {
      // 2026-01-16T04:30:00.000Z is 2026-01-15 10:30pm Central (CST,
      // UTC-6) — still Jan 15 in Central, but already Jan 16 in UTC. This
      // is exactly the daily gap window this plan closes (verified under
      // TZ=UTC, matching the production/test runner default).
      jest.useFakeTimers({ now: new Date('2026-01-16T04:30:00.000Z') });

      try {
        const result = todayAtMidnight();

        // Prove the contrast: raw new Date().setHours(0,0,0,0) at this same
        // frozen instant returns UTC's Jan 16 — the wrong calendar day.
        const rawWrongResult = new Date();
        rawWrongResult.setHours(0, 0, 0, 0);

        expect(result.toISOString()).toBe('2026-01-15T06:00:00.000Z'); // Central midnight of Jan 15 — correct
        expect(rawWrongResult.toISOString()).toBe('2026-01-16T00:00:00.000Z'); // UTC midnight of Jan 16 — the old, wrong result
        expect(result.getTime()).not.toBe(rawWrongResult.getTime());
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('todayDateOnly', () => {
    it('returns a UTC-midnight sentinel for the correct Central calendar day', () => {
      jest.useFakeTimers({ now: new Date('2026-01-16T04:30:00.000Z') }); // Jan 15, 10:30pm Central

      try {
        const result = todayDateOnly();
        expect(result.toISOString()).toBe('2026-01-15T00:00:00.000Z');
      } finally {
        jest.useRealTimers();
      }
    });

    it('matches the same shape resolveStartDate() produces from a client date string', () => {
      const sentinelFromClientString = new Date('2026-01-15');
      jest.useFakeTimers({ now: new Date('2026-01-15T18:00:00.000Z') }); // noon Central

      try {
        expect(todayDateOnly().toISOString()).toBe(sentinelFromClientString.toISOString());
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('addOneDay — real-instant, DST-safe', () => {
    it('preserves Central midnight across the March 8->9, 2026 spring-forward transition', () => {
      const centralMidnightMar8 = new Date('2026-03-08T06:00:00.000Z'); // CST, UTC-6
      const result = addOneDay(centralMidnightMar8);

      expect(result.toISOString()).toBe('2026-03-09T05:00:00.000Z'); // CDT, UTC-5 — correct

      // Prove the contrast: the old raw setDate() implementation.
      const rawWrongResult = new Date(centralMidnightMar8);
      rawWrongResult.setDate(rawWrongResult.getDate() + 1);
      expect(rawWrongResult.toISOString()).toBe('2026-03-09T06:00:00.000Z'); // 1hr late, wrong
      expect(result.getTime()).not.toBe(rawWrongResult.getTime());
    });

    it('preserves Central midnight across the November 1->2, 2026 fall-back transition', () => {
      const centralMidnightNov1 = new Date('2026-11-01T05:00:00.000Z'); // CDT, UTC-5
      const result = addOneDay(centralMidnightNov1);

      expect(result.toISOString()).toBe('2026-11-02T06:00:00.000Z'); // CST, UTC-6 — correct

      const rawWrongResult = new Date(centralMidnightNov1);
      rawWrongResult.setDate(rawWrongResult.getDate() + 1);
      expect(rawWrongResult.toISOString()).toBe('2026-11-02T05:00:00.000Z'); // 1hr early, wrong
      expect(result.getTime()).not.toBe(rawWrongResult.getTime());
    });
  });

  describe('addOneMonth / addMonths — date-only sentinels, deliberately NOT tz-aware', () => {
    // Regression lock (D9's correction): these must stay plain
    // calendar-component math. Wrapping them in moment(date).tz(tz).add()
    // would shift a date-only sentinel onto the WRONG calendar day.
    it('addOneMonth on a sentinel across the spring-forward boundary returns the calendar-correct date, not a tz-reinterpreted one', () => {
      const sentinel = new Date('2026-03-08'); // means "March 8", no real tz meaning
      const result = addOneMonth(sentinel);

      expect(result.toISOString()).toBe('2026-04-08T00:00:00.000Z');
      // The tz-reinterpreted (wrong) answer would have been April 7.
      expect(result.getUTCDate()).toBe(8);
    });

    it('addMonths on a sentinel across the fall-back boundary returns the calendar-correct date', () => {
      const sentinel = new Date('2026-10-01');
      const result = addMonths(sentinel, 1);

      expect(result.toISOString()).toBe('2026-11-01T00:00:00.000Z');
      expect(result.getUTCDate()).toBe(1);
    });
  });

  describe('daysInMonth / endOfMonth — unchanged, sentinel-consistent', () => {
    it('daysInMonth counts correctly for a sentinel-shaped date', () => {
      expect(daysInMonth(new Date('2026-02-01'))).toBe(28); // 2026 is not a leap year
      expect(daysInMonth(new Date('2026-04-01'))).toBe(30);
    });

    it('endOfMonth returns the last calendar day of a sentinel-shaped date, end of day', () => {
      const result = endOfMonth(new Date('2026-02-01'));
      expect(result.getUTCDate()).toBe(28);
      expect(result.getUTCHours()).toBe(23);
    });
  });
});
