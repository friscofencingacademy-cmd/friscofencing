const {
  computeSessionPrice,
  computePackSubtotal,
  computePackTotal,
  computePackQuote,
  normalizePackageOffers,
  resolvePackOptions,
  sessionDurationMinutes,
} = require('../../src/utils/privateClassPricing');

// docs/plans/private-class-per-session-booking-plan.md D13 — the one home of
// every pack rule.
describe('privateClassPricing — packs', () => {
  describe('computePackTotal', () => {
    it('takes the discount off the subtotal once, to the cent', () => {
      expect(computePackTotal(32.5, 10, 10)).toBe(292.5);
      expect(computePackTotal(65, 1, 0)).toBe(65);
      // 3 x 33.33 = 99.99; 15% off = 84.9915 -> 84.99 (never per-session rounding)
      expect(computePackTotal(33.33, 3, 15)).toBe(84.99);
    });

    it.each([
      ['a zero quantity', 32.5, 0, 0, /positive whole number/],
      ['a fractional quantity', 32.5, 1.5, 0, /positive whole number/],
      ['a negative discount', 32.5, 10, -1, /between 0 and 99/],
      ['a 100% discount', 32.5, 10, 100, /between 0 and 99/],
      ['a negative unit price', -1, 10, 0, /valid unit price/],
    ])('throws on %s, never guessing', (_label, unitPrice, quantity, discountPercent, message) => {
      expect(() => computePackTotal(unitPrice, quantity, discountPercent)).toThrow(message);
    });
  });

  describe('computePackQuote', () => {
    it('returns lines that always sum: subtotal - discountAmount = total', () => {
      expect(computePackQuote(32.5, 10, 10)).toEqual({
        unitPrice: 32.5,
        quantity: 10,
        discountPercent: 10,
        subtotal: 325,
        discountAmount: 32.5,
        total: 292.5,
      });

      const quote = computePackQuote(33.33, 3, 15);
      expect(Math.round((quote.subtotal - quote.discountAmount) * 100) / 100).toBe(quote.total);
    });

    it('agrees with computePackSubtotal and computePackTotal', () => {
      const quote = computePackQuote(27.5, 5, 5);
      expect(quote.subtotal).toBe(computePackSubtotal(27.5, 5));
      expect(quote.total).toBe(computePackTotal(27.5, 5, 5));
    });
  });

  describe('normalizePackageOffers / resolvePackOptions', () => {
    it('sorts packs by quantity and keeps only quantity + discountPercent', () => {
      expect(
        normalizePackageOffers([
          { quantity: 20, discountPercent: 15, extra: 'x' },
          { quantity: 10, discountPercent: 10 },
        ])
      ).toEqual([
        { quantity: 10, discountPercent: 10 },
        { quantity: 20, discountPercent: 15 },
      ]);
    });

    it('always offers a single full-price session first', () => {
      expect(resolvePackOptions([{ quantity: 10, discountPercent: 10 }])).toEqual([
        { quantity: 1, discountPercent: 0 },
        { quantity: 10, discountPercent: 10 },
      ]);
      expect(resolvePackOptions()).toEqual([{ quantity: 1, discountPercent: 0 }]);
    });

    it.each([
      ['a duplicate quantity', [{ quantity: 10, discountPercent: 1 }, { quantity: 10, discountPercent: 2 }], /Only one/],
      ['quantity 1', [{ quantity: 1, discountPercent: 0 }], /at least 2/],
      ['a missing entry', [null], /needs a quantity/],
      ['a non-list', 'ten', /must be a list/],
    ])('rejects %s', (_label, packages, message) => {
      expect(() => normalizePackageOffers(packages)).toThrow(message);
    });
  });
});

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
