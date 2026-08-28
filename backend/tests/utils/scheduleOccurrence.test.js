const { nextOccurrenceStrictlyAfter } = require('../../src/utils/scheduleOccurrence');

// docs/plans/timezone-consistency-plan.md D4 — proves the fix, not just the
// path: assertions at an instant inside the UTC/Central gap window,
// contrasted against what the old raw-Date implementation would return.

describe('scheduleOccurrence', () => {
  describe('nextOccurrenceStrictlyAfter', () => {
    it('returns the next occurrence, never today, for a same-weekday fromDate', () => {
      const monday = new Date('2026-08-24T18:00:00.000Z'); // a Monday, midday Central
      const result = nextOccurrenceStrictlyAfter(monday, 1); // 1 = Monday

      expect(result.getUTCDate()).toBe(31); // next Monday, not the 24th
    });

    it('resolves the correct Central weekday for a fromDate inside the UTC/Central gap window — a full week apart, not just an hour', () => {
      // 2026-08-25T04:30:00.000Z is 2026-08-24 (Monday) 11:30pm Central
      // (CDT, UTC-5), but already Tuesday the 25th in UTC. Asking for the
      // next TUESDAY specifically hits the sharpest case: the UTC-drifted
      // "today" already IS Tuesday, so the old implementation's own
      // "already on this day -> +7" rule fires a week early — landing on
      // Sept 1 instead of tomorrow, Aug 25. Verified by direct execution,
      // not derived by hand — this class of bug doesn't always show up as
      // a small hour-level drift; here it's a full 7-day miss.
      const gapWindowInstant = new Date('2026-08-25T04:30:00.000Z');

      const result = nextOccurrenceStrictlyAfter(gapWindowInstant, 2); // 2 = Tuesday

      expect(result.toISOString()).toBe('2026-08-25T05:00:00.000Z'); // tomorrow, Central-correct

      // Prove the contrast against the old raw getDay()/setDate() math.
      const rawResult = new Date(gapWindowInstant);
      rawResult.setHours(0, 0, 0, 0);
      let diff = (2 - rawResult.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      rawResult.setDate(rawResult.getDate() + diff);

      expect(rawResult.toISOString()).toBe('2026-09-01T00:00:00.000Z'); // wrong — a full week late
      expect(result.getTime()).not.toBe(rawResult.getTime());
    });

    it('walks 7 days out when fromDate already falls on dayOfWeek (never returns today itself)', () => {
      const wednesday = new Date('2026-08-26T18:00:00.000Z');
      const result = nextOccurrenceStrictlyAfter(wednesday, 3);

      expect(result.getUTCDate()).toBe(2); // Sept 2, not the 26th
      expect(result.getUTCMonth()).toBe(8); // September (0-indexed)
    });
  });
});
