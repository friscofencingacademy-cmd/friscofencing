const {
  PACK_PRICE_FLOOR_RATIO,
  computeSessionPrice,
  quotePurchase,
  packPriceBand,
  describePack,
  validatePacks,
  purchaseOptionsFor,
  purchaseBreakdown,
  sessionDurationMinutes,
} = require('../../src/utils/privateClassPricing');

// docs/plans/coach-pack-pricing-plan.md — the one home of every pack rule.
// $65/hr x 30 min = $32.50 a session, so a 10-pack's subtotal is $325.00.
const RATE = 65;
const TEN_BY_THIRTY = { sessionDurationMinutes: 30, quantity: 10 };

describe('privateClassPricing — packs', () => {
  it('defines the floor as one named constant', () => {
    expect(PACK_PRICE_FLOOR_RATIO).toBe(0.5);
  });

  describe('quotePurchase — the only savings formula', () => {
    it('derives savings as subtotal - total', () => {
      expect(quotePurchase(32.5, { quantity: 10, price: 300 })).toEqual({
        quantity: 10,
        unitPrice: 32.5,
        subtotal: 325,
        savings: 25,
        total: 300,
      });
    });

    it('shows no savings for a single session', () => {
      expect(quotePurchase(32.5, { quantity: 1, price: 32.5 })).toEqual({
        quantity: 1,
        unitPrice: 32.5,
        subtotal: 32.5,
        savings: 0,
        total: 32.5,
      });
    });

    it('works in whole cents, never a floating-point hair off', () => {
      // 3 x 33.33 = 99.99 exactly, not 99.99000000000001
      expect(quotePurchase(33.33, { quantity: 3, price: 90 }).subtotal).toBe(99.99);
      expect(quotePurchase(33.33, { quantity: 3, price: 90 }).savings).toBe(9.99);
    });

    it.each([
      ['a zero quantity', 32.5, { quantity: 0, price: 1 }, /positive whole number/],
      ['a fractional quantity', 32.5, { quantity: 1.5, price: 1 }, /positive whole number/],
      ['a negative unit price', -1, { quantity: 2, price: 1 }, /valid unit price/],
      ['a missing price', 32.5, { quantity: 2 }, /valid price/],
    ])('throws on %s, never guessing', (_label, unitPrice, terms, message) => {
      expect(() => quotePurchase(unitPrice, terms)).toThrow(message);
    });
  });

  describe('packPriceBand', () => {
    it('is [half the subtotal, one cent under it]', () => {
      expect(packPriceBand(RATE, TEN_BY_THIRTY)).toEqual({ unitPrice: 32.5, subtotal: 325, min: 162.5, max: 324.99 });
    });

    it('rounds the floor UP to a whole cent when half is a half-cent', () => {
      // $65/hr x 45 min = $48.75; 3 of them = $146.25; half = $73.125 -> $73.13
      expect(packPriceBand(RATE, { sessionDurationMinutes: 45, quantity: 3 })).toEqual({
        unitPrice: 48.75,
        subtotal: 146.25,
        min: 73.13,
        max: 146.24,
      });
    });
  });

  describe('describePack — the one pack check', () => {
    it('previews a valid pack: per-lesson price, savings, percent, range', () => {
      expect(describePack(RATE, { ...TEN_BY_THIRTY, price: 300 })).toEqual({
        sessionDurationMinutes: 30,
        quantity: 10,
        price: 300,
        perLessonPrice: 30,
        subtotal: 325,
        savings: 25,
        // 25 / 325 = 7.7% -> 8
        savingsPercent: 8,
        allowedRange: { min: 162.5, max: 324.99 },
        error: null,
      });
    });

    const RANGE = 'between $162.50 and $324.99';

    it.each([
      ['the band ceiling (no savings)', 325, `10 × 30 min: price must be ${RANGE}`],
      ['above the subtotal', 400, `10 × 30 min: price must be ${RANGE}`],
      ['one cent under the floor', 162.49, `10 × 30 min: price must be ${RANGE}`],
      ['a fraction of a cent', 300.005, `10 × 30 min: price must be a dollar amount in whole cents, ${RANGE}`],
      ['a non-number', 'abc', `10 × 30 min: price must be a dollar amount in whole cents, ${RANGE}`],
    ])('refuses %s with a message naming the pack and range', (_label, price, message) => {
      expect(describePack(RATE, { ...TEN_BY_THIRTY, price }).error).toBe(message);
    });

    it.each([
      ['exactly one cent under the subtotal', 324.99],
      ['exactly the floor', 162.5],
    ])('accepts %s', (_label, price) => {
      expect(describePack(RATE, { ...TEN_BY_THIRTY, price }).error).toBeNull();
    });

    it('checks the half-cent floor against the same rounded number the message shows', () => {
      const pack = { sessionDurationMinutes: 45, quantity: 3 };
      expect(describePack(RATE, { ...pack, price: 73.12 }).error).toBe(
        '3 × 45 min: price must be between $73.13 and $146.24'
      );
      expect(describePack(RATE, { ...pack, price: 73.13 }).error).toBeNull();
    });

    it.each([
      ['a quantity of 1', { sessionDurationMinutes: 30, quantity: 1, price: 30 }, /at least 2 sessions/],
      ['a fractional quantity', { sessionDurationMinutes: 30, quantity: 2.5, price: 30 }, /at least 2 sessions/],
      ['a lesson under 15 minutes', { sessionDurationMinutes: 10, quantity: 5, price: 30 }, /at least 15 minutes/],
      ['a missing pack', null, /at least 15 minutes/],
    ])('returns an error (never throws) for %s', (_label, pack, message) => {
      const described = describePack(RATE, pack);
      expect(described.error).toMatch(message);
      expect(described.allowedRange).toBeNull();
    });

    it('refuses every pack at a $0 rate rather than offering a free or negative band', () => {
      expect(describePack(0, { ...TEN_BY_THIRTY, price: 10 }).error).toMatch(/positive session price/);
    });
  });

  describe('validatePacks', () => {
    it('throws exactly the message describePack returns — one check, not two', () => {
      const pack = { ...TEN_BY_THIRTY, price: 325 };
      expect(() => validatePacks([pack], RATE)).toThrow(describePack(RATE, pack).error);
    });

    it('rejects two packs with the same length and quantity', () => {
      expect(() =>
        validatePacks(
          [
            { ...TEN_BY_THIRTY, price: 300 },
            { ...TEN_BY_THIRTY, price: 290 },
          ],
          RATE
        )
      ).toThrow('Only one pack may offer 10 × 30 min');
    });

    it('allows the same quantity at two different lengths', () => {
      expect(
        validatePacks(
          [
            { sessionDurationMinutes: 60, quantity: 10, price: 600 },
            { ...TEN_BY_THIRTY, price: 300 },
          ],
          RATE
        )
      ).toHaveLength(2);
    });

    it('returns the list normalized and sorted by length, then quantity, keeping any _id', () => {
      expect(
        validatePacks(
          [
            { sessionDurationMinutes: 60, quantity: 5, price: 300, extra: 'dropped' },
            { _id: 'keep-me', sessionDurationMinutes: 30, quantity: 10, price: 300 },
            { sessionDurationMinutes: 30, quantity: 5, price: 155 },
          ],
          RATE
        )
      ).toEqual([
        { sessionDurationMinutes: 30, quantity: 5, price: 155 },
        { _id: 'keep-me', sessionDurationMinutes: 30, quantity: 10, price: 300 },
        { sessionDurationMinutes: 60, quantity: 5, price: 300 },
      ]);
    });

    it('accepts an empty list and rejects a non-list', () => {
      expect(validatePacks([], RATE)).toEqual([]);
      expect(() => validatePacks('ten', RATE)).toThrow('privateLessonPacks must be a list');
    });
  });

  describe('purchaseOptionsFor — the one shape of a purchase option', () => {
    const contract = {
      studentBillingRate: RATE,
      privateLessonPacks: [
        { _id: 'pack-20', sessionDurationMinutes: 30, quantity: 20, price: 580 },
        { _id: 'pack-60', sessionDurationMinutes: 60, quantity: 10, price: 600 },
        { _id: 'pack-10', sessionDurationMinutes: 30, quantity: 10, price: 300 },
      ],
    };

    it("offers the single session first, then only that length's packs by quantity", () => {
      expect(purchaseOptionsFor(contract, 30)).toEqual([
        { packId: null, quantity: 1, unitPrice: 32.5, subtotal: 32.5, savings: 0, total: 32.5 },
        { packId: 'pack-10', quantity: 10, unitPrice: 32.5, subtotal: 325, savings: 25, total: 300 },
        { packId: 'pack-20', quantity: 20, unitPrice: 32.5, subtotal: 650, savings: 70, total: 580 },
      ]);
    });

    it('offers only the single session when the coach has no packs', () => {
      expect(purchaseOptionsFor({ studentBillingRate: RATE }, 30)).toEqual([
        { packId: null, quantity: 1, unitPrice: 32.5, subtotal: 32.5, savings: 0, total: 32.5 },
      ]);
    });
  });

  describe('purchaseBreakdown', () => {
    it("builds a ledger row's lines with the charged amount as the total", () => {
      const row = { quantity: 10, unitPrice: 32.5, amount: 300 };
      expect(purchaseBreakdown(row)).toEqual(quotePurchase(32.5, { quantity: 10, price: 300 }));
      expect(purchaseBreakdown(row).total).toBe(300);
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
