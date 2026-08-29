const { calculateAge } = require('../../src/utils/age');

// Frozen clock throughout, per docs/TESTING_STRATEGY.md's date rules — never
// the real wall clock against a today-computing subject.
describe('calculateAge', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns null when there is no dateOfBirth', () => {
    expect(calculateAge(null)).toBeNull();
    expect(calculateAge(undefined)).toBeNull();
  });

  it("returns the whole-years age when today is on or after this year's birthday", () => {
    jest.useFakeTimers({ now: new Date('2026-08-29T18:00:00.000Z') }); // noon Central

    expect(calculateAge(new Date('2018-08-29'))).toBe(8); // birthday is today
    expect(calculateAge(new Date('2018-01-01'))).toBe(8); // birthday already passed this year
  });

  it("has not yet added the year when today is before this year's birthday", () => {
    jest.useFakeTimers({ now: new Date('2026-08-29T18:00:00.000Z') }); // noon Central

    expect(calculateAge(new Date('2018-08-30'))).toBe(7); // birthday is tomorrow
    expect(calculateAge(new Date('2018-12-31'))).toBe(7); // birthday is later this year
  });
});
