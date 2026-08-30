const { dateFull, dateOnlyFull, timeOfDay, dayOfWeekLabel, monthLabel } = require('../../src/email/dates');

// docs/plans/utc-date-standard-plan.md — this suite exists to prove the
// two-shape contract this file's docblock now states: dateFull/monthLabel*
// vs dateOnlyFull render the SAME kind of value differently on purpose.
// (*monthLabel's own real caller always feeds it a sentinel — see below.)

describe('email/dates', () => {
  describe('dateFull — real instants, Central-anchored', () => {
    it('renders a real instant in Central time', () => {
      expect(dateFull('2026-08-25T21:00:00.000Z')).toBe('Tuesday, Aug 25, 2026'); // 4pm CDT
    });

    it('shifts to the previous Central calendar day near a UTC midnight rollover', () => {
      // 2026-08-25T04:00:00Z is Aug 24, 11pm Central (CDT, UTC-5) — this is
      // CORRECT behavior for a real instant (e.g. a charge timestamp truly
      // occurred at that Central moment), unlike dateOnlyFull below.
      expect(dateFull('2026-08-25T04:00:00.000Z')).toBe('Monday, Aug 24, 2026');
    });
  });

  describe('dateOnlyFull — calendar-day sentinels, UTC-anchored', () => {
    it('renders a clean UTC-midnight sentinel', () => {
      expect(dateOnlyFull('2026-08-31T00:00:00.000Z')).toBe('Monday, Aug 31, 2026');
    });

    // The regression this function exists to fix (docs/plans/utc-date-
    // standard-plan.md bug 2): a Monday trial's confirmation email stated
    // "Sunday" because the OLD code rendered this exact sentinel shape via
    // dateFull (Central), which shifts it back a calendar day.
    it('renders the same calendar day for every currently-in-the-wild sentinel shape — never a browser/server-timezone shift', () => {
      const cleanSentinel = '2026-08-31T00:00:00.000Z';
      const centralMidnightInstant = '2026-08-31T05:00:00.000Z';
      const easternMidnightInstant = '2026-08-31T04:00:00.000Z';

      expect(dateOnlyFull(cleanSentinel)).toBe('Monday, Aug 31, 2026');
      expect(dateOnlyFull(centralMidnightInstant)).toBe('Monday, Aug 31, 2026');
      expect(dateOnlyFull(easternMidnightInstant)).toBe('Monday, Aug 31, 2026');

      // Contrast: dateFull (Central) gets bugs 2/3 wrong for these same
      // contaminated-but-still-in-the-wild values.
      expect(dateFull(easternMidnightInstant)).toBe('Sunday, Aug 30, 2026');
    });
  });

  describe('monthLabel — fed a calendar-day sentinel (its one real caller), UTC-anchored', () => {
    it('renders the correct month for a clean period-start sentinel on the 1st', () => {
      expect(monthLabel('2026-09-01T00:00:00.000Z')).toBe('September 2026');
    });

    // The regression: a period-start sentinel on the 1st, rendered via the
    // OLD Central-anchored monthLabel, rolled back to "August" — the wrong
    // month on a renewal receipt.
    it('does not roll back a period-start sentinel on the 1st to the previous month', () => {
      expect(monthLabel('2026-09-01T00:00:00.000Z')).not.toBe('August 2026');
    });

    it('renders correctly even for a not-yet-migrated contaminated sentinel', () => {
      expect(monthLabel('2026-09-01T05:00:00.000Z')).toBe('September 2026');
    });
  });

  describe('timeOfDay', () => {
    it('formats a plain HH:mm wall-clock string with no timezone conversion', () => {
      expect(timeOfDay('16:00')).toBe('4:00 PM');
      expect(timeOfDay('09:30')).toBe('9:30 AM');
    });
  });

  describe('dayOfWeekLabel', () => {
    it('maps Date.getDay() convention to a weekday name', () => {
      expect(dayOfWeekLabel(0)).toBe('Sunday');
      expect(dayOfWeekLabel(1)).toBe('Monday');
      expect(dayOfWeekLabel(6)).toBe('Saturday');
    });

    it('falls back to Unknown for an out-of-range value', () => {
      expect(dayOfWeekLabel(9)).toBe('Unknown');
    });
  });
});
