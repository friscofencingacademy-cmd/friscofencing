const { dateOnlyUTC, addDaysToDateOnly, nextDateOnlyOnOrAfter, combineDayAndTimeInTZ } = require('../../src/utils/dateShapes');

describe('dateShapes', () => {
  describe('dateOnlyUTC', () => {
    it('truncates a contaminated Eastern-midnight instant to UTC midnight of its own UTC day', () => {
      // The owner's original dev-machine data (docs/plans/utc-date-standard-
      // plan.md bug 1) — Monday stored at Eastern midnight.
      const result = dateOnlyUTC(new Date('2026-08-31T04:00:00.000Z'));
      expect(result.toISOString()).toBe('2026-08-31T00:00:00.000Z');
    });

    it('truncates a Central-midnight instant (the interim generator this PR replaces)', () => {
      const result = dateOnlyUTC(new Date('2026-08-31T05:00:00.000Z'));
      expect(result.toISOString()).toBe('2026-08-31T00:00:00.000Z');
    });

    it('is idempotent on an already-clean UTC-midnight sentinel', () => {
      const result = dateOnlyUTC(new Date('2026-08-31T00:00:00.000Z'));
      expect(result.toISOString()).toBe('2026-08-31T00:00:00.000Z');
    });

    it('accepts a value new Date() can parse, not only a Date instance', () => {
      const result = dateOnlyUTC('2026-08-31T04:00:00.000Z');
      expect(result.toISOString()).toBe('2026-08-31T00:00:00.000Z');
    });
  });

  describe('addDaysToDateOnly', () => {
    it('adds days within a month', () => {
      const sentinel = new Date('2026-08-10T00:00:00.000Z');
      const result = addDaysToDateOnly(sentinel, 14);
      expect(result.toISOString()).toBe('2026-08-24T00:00:00.000Z');
    });

    it('rolls over a month boundary', () => {
      const sentinel = new Date('2026-08-25T00:00:00.000Z');
      const result = addDaysToDateOnly(sentinel, 30);
      expect(result.toISOString()).toBe('2026-09-24T00:00:00.000Z');
    });

    it('supports negative offsets', () => {
      const sentinel = new Date('2026-09-01T00:00:00.000Z');
      const result = addDaysToDateOnly(sentinel, -1);
      expect(result.toISOString()).toBe('2026-08-31T00:00:00.000Z');
    });

    // "Prove the fix" pattern (docs/TESTING_STRATEGY.md's Timezone section)
    // — pure UTC calendar-component arithmetic (setUTCDate) never touches
    // wall-clock/local time at all, so this is DST-immune BY CONSTRUCTION.
    // Stepping 8 weekly sentinels across the 2026-11-01 US fall-back
    // transition produces a clean 7-day jump every time, with every result
    // landing on exact UTC midnight — contrasted against what a real-instant
    // "+7 days" step (billingDates.js's addOneDay, deliberately NOT used
    // here) would have produced across the same boundary (a 1-hour drift).
    it('steps 8 weekly sentinels across the fall-back DST transition, all exact UTC midnight, all exactly 7 days apart', () => {
      const first = new Date('2026-10-06T00:00:00.000Z'); // a Tuesday, well before the Nov 1 transition
      const sessions = [];

      for (let i = 0; i < 8; i += 1) {
        sessions.push(addDaysToDateOnly(first, i * 7));
      }

      expect(sessions.map((d) => d.toISOString())).toEqual([
        '2026-10-06T00:00:00.000Z',
        '2026-10-13T00:00:00.000Z',
        '2026-10-20T00:00:00.000Z',
        '2026-10-27T00:00:00.000Z',
        '2026-11-03T00:00:00.000Z', // spans the Nov 1 fall-back — still exact UTC midnight
        '2026-11-10T00:00:00.000Z',
        '2026-11-17T00:00:00.000Z',
        '2026-11-24T00:00:00.000Z',
      ]);

      // Every value is exactly UTC midnight — zero drift, zero DST exposure.
      sessions.forEach((d) => {
        expect(d.getUTCHours()).toBe(0);
        expect(d.getUTCMinutes()).toBe(0);
      });
    });
  });

  describe('nextDateOnlyOnOrAfter', () => {
    it('returns a future date unchanged in weekday when the target day is ahead', () => {
      const monday = new Date('2026-08-31T00:00:00.000Z'); // Monday
      const result = nextDateOnlyOnOrAfter(monday, 3); // next Wednesday
      expect(result.toISOString()).toBe('2026-09-02T00:00:00.000Z');
      expect(result.getUTCDay()).toBe(3);
    });

    it('returns the SAME date when it already falls on the target weekday — "on or after", not "strictly after"', () => {
      const wednesday = new Date('2026-09-02T00:00:00.000Z');
      const result = nextDateOnlyOnOrAfter(wednesday, 3);
      expect(result.toISOString()).toBe('2026-09-02T00:00:00.000Z');
    });

    it('wraps to the following week when the target day already passed this week', () => {
      const friday = new Date('2026-09-04T00:00:00.000Z'); // Friday
      const result = nextDateOnlyOnOrAfter(friday, 1); // Monday, earlier in the week
      expect(result.toISOString()).toBe('2026-09-07T00:00:00.000Z');
      expect(result.getUTCDay()).toBe(1);
    });
  });

  describe('combineDayAndTimeInTZ', () => {
    it('resolves a Central wall-clock time to the correct UTC instant (CDT, summer)', () => {
      const result = combineDayAndTimeInTZ('2026-08-25', '16:45');
      expect(result.toISOString()).toBe('2026-08-25T21:45:00.000Z'); // CDT, UTC-5
    });

    it('resolves a Central wall-clock time to the correct UTC instant (CST, winter)', () => {
      const result = combineDayAndTimeInTZ('2026-01-15', '16:45');
      expect(result.toISOString()).toBe('2026-01-15T22:45:00.000Z'); // CST, UTC-6
    });

    it('accepts an explicit tz override', () => {
      const result = combineDayAndTimeInTZ('2026-08-25', '09:00', 'America/New_York');
      expect(result.toISOString()).toBe('2026-08-25T13:00:00.000Z'); // EDT, UTC-4
    });
  });
});
