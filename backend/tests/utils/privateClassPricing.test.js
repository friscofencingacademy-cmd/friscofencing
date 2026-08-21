const {
  computeSessionPrice,
  sessionDurationMinutes,
} = require('../../src/utils/privateClassPricing');

describe('privateClassPricing', () => {
  describe('computeSessionPrice', () => {
    it('computes rate * minutes / 60, rounded to the nearest cent', () => {
      expect(computeSessionPrice(65, 60)).toBe(65);
      expect(computeSessionPrice(50, 30)).toBe(25);
      expect(computeSessionPrice(33.33, 45)).toBe(25); // 33.33 * 45 / 60 = 24.9975 -> rounds to 25.00
    });

    it('rounds a non-terminating result to the nearest cent', () => {
      // 40 * 45 / 60 = 30 exactly; use a rate that produces a repeating
      // decimal instead: 25 * 50 / 60 = 20.8333... -> 20.83
      expect(computeSessionPrice(25, 50)).toBe(20.83);
    });

    it.each([null, undefined, NaN, -1])('throws on an invalid hourlyRate (%p)', (rate) => {
      expect(() => computeSessionPrice(rate, 60)).toThrow(
        'A valid hourly rate is required to compute a session price'
      );
    });

    it('allows a zero hourly rate (a legitimate, if unusual, free-lesson rate)', () => {
      expect(computeSessionPrice(0, 60)).toBe(0);
    });

    it.each([null, undefined, NaN, 0, -30])('throws on an invalid durationMinutes (%p)', (duration) => {
      expect(() => computeSessionPrice(65, duration)).toThrow(
        'A valid positive session duration is required to compute a session price'
      );
    });
  });

  describe('sessionDurationMinutes', () => {
    it('returns the minute difference between two instants', () => {
      const start = new Date('2026-08-26T16:00:00.000Z');
      const end = new Date('2026-08-26T17:00:00.000Z');
      expect(sessionDurationMinutes(start, end)).toBe(60);
    });

    it('accepts ISO date strings', () => {
      expect(
        sessionDurationMinutes('2026-08-26T16:00:00.000Z', '2026-08-26T16:30:00.000Z')
      ).toBe(30);
    });

    it('throws when end is not after start', () => {
      const instant = new Date('2026-08-26T16:00:00.000Z');
      expect(() => sessionDurationMinutes(instant, instant)).toThrow(
        'Session end date must be after the start date'
      );
      expect(() =>
        sessionDurationMinutes('2026-08-26T17:00:00.000Z', '2026-08-26T16:00:00.000Z')
      ).toThrow('Session end date must be after the start date');
    });

    it('throws on an invalid date', () => {
      expect(() => sessionDurationMinutes('not-a-date', new Date())).toThrow(
        'Valid start and end dates are required to compute session duration'
      );
    });
  });
});
