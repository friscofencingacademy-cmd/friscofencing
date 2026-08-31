const Level = require('../../../src/models/level.model');
const Location = require('../../../src/models/location.model');
const GroupClass = require('../../../src/models/groupClass.model');
const GroupClassSchedule = require('../../../src/models/groupClassSchedule.model');
const User = require('../../../src/models/user.model');
const { computeProration, resolveFirstChargePeriod } = require('../../../src/services/billing/proration.service');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

afterEach(async () => {
  await clearTestDB();
});

async function seedLevelWithSchedules(dayOfWeeks, { name = 'Level', order = 1 } = {}) {
  const level = await Level.create({ name, order });
  const location = await Location.create({ name: `${name} HQ`, address: '1 Main St' });
  const groupClass = await GroupClass.create({
    name: `${name} Class`,
    levelId: level._id,
    locationId: location._id,
    capacity: 10,
  });
  const coach = await User.create({
    role: 'coach',
    firstName: 'Coach',
    lastName: name,
    email: `coach-${name}-${Date.now()}-${Math.random()}@example.com`,
  });

  for (const dayOfWeek of dayOfWeeks) {
    // eslint-disable-next-line no-await-in-loop -- test setup, negligible fan-out
    await GroupClassSchedule.create({
      classId: groupClass._id,
      coachId: coach._id,
      dayOfWeek,
      startTime: '16:00',
      endTime: '17:00',
      students: [],
    });
  }

  return level;
}

describe('computeProration', () => {
  it('prorates correctly for a single-weekday level, registering mid-month (August 2026, Wednesdays only)', async () => {
    const level = await seedLevelWithSchedules([3], { name: 'SingleWeekday' }); // Wednesday

    // Aug 2026 has 4 Wednesdays (5, 12, 19, 26). Registering ON Aug 12
    // (itself a Wednesday) leaves 3 remaining (12, 19, 26) — inclusive.
    const result = await computeProration({
      levelId: level._id,
      monthlyFee: 300,
      registrationDate: new Date(2026, 7, 12),
    });

    expect(result.prorated).toBe(true);
    expect(result.totalClassDays).toBe(4);
    expect(result.remainingClassDays).toBe(3);
    expect(result.dailyRate).toBe(75); // 300 / 4
    expect(result.proratedAmount).toBe(225); // 75 * 3
    // The calendar-month boundary (docs/decisions/007-calendar-month-
    // billing.md) — the 1st of the FOLLOWING month, not the last day of
    // this one.
    expect(result.periodEnd.getFullYear()).toBe(2026);
    expect(result.periodEnd.getMonth()).toBe(8); // September
    expect(result.periodEnd.getDate()).toBe(1);
  });

  it('charges the full fee (remaining == total) when registering before the first class day of the month', async () => {
    const level = await seedLevelWithSchedules([3], { name: 'RegisterEarly' }); // Wednesday

    // Aug 1, 2026 is a Saturday — before that month's first Wednesday (Aug
    // 5) — so all 4 Wednesdays are still ahead.
    const result = await computeProration({
      levelId: level._id,
      monthlyFee: 300,
      registrationDate: new Date(2026, 7, 1),
    });

    expect(result.totalClassDays).toBe(4);
    expect(result.remainingClassDays).toBe(4);
    expect(result.proratedAmount).toBe(300);
  });

  it('charges $0 when registering on the last day of the month, after that weekday has already passed', async () => {
    const level = await seedLevelWithSchedules([3], { name: 'RegisterLastDay' }); // Wednesday

    // Aug 31, 2026 is a Monday — after the month's last Wednesday (Aug 26).
    const result = await computeProration({
      levelId: level._id,
      monthlyFee: 300,
      registrationDate: new Date(2026, 7, 31),
    });

    expect(result.remainingClassDays).toBe(0);
    expect(result.proratedAmount).toBe(0);
  });

  it('dedupes weekdays across MULTIPLE schedules at the same level (a premium student can attend any of them)', async () => {
    // Two separate schedules, Tuesday and Thursday, plus a third on
    // Saturday — 13 total matching days in August 2026, not double-counted.
    const level = await seedLevelWithSchedules([2, 4, 6], { name: 'MultiSchedule' });

    const result = await computeProration({
      levelId: level._id,
      monthlyFee: 100,
      registrationDate: new Date(2026, 7, 1),
    });

    expect(result.totalClassDays).toBe(13);
  });

  it('rounds the prorated amount to cents rather than a raw repeating fraction', async () => {
    const level = await seedLevelWithSchedules([2, 4, 6], { name: 'Rounding' }); // 13 total in Aug 2026

    const result = await computeProration({
      levelId: level._id,
      monthlyFee: 100,
      registrationDate: new Date(2026, 7, 1), // all 13 remaining
    });

    // 100 / 13 = 7.6923... — dailyRate rounded for display, proratedAmount
    // rounded once at the final dollar figure (never compounded through a
    // pre-rounded dailyRate).
    expect(result.dailyRate).toBe(7.69);
    expect(result.proratedAmount).toBe(100); // exactly the full fee since all 13 days remain
    expect(Number.isInteger(result.proratedAmount * 100)).toBe(true); // a clean cent value
  });

  it('correctly counts a 28-day February (non-leap year)', async () => {
    const level = await seedLevelWithSchedules([1], { name: 'FebLevel' }); // Monday

    const result = await computeProration({
      levelId: level._id,
      monthlyFee: 200,
      registrationDate: new Date(2026, 1, 1), // Feb 1, 2026
    });

    expect(result.totalClassDays).toBe(4);
  });

  it('falls back to the full, unprorated fee for a level with zero configured schedules', async () => {
    const level = await Level.create({ name: 'NoSchedules', order: 99 });

    const result = await computeProration({
      levelId: level._id,
      monthlyFee: 150,
      registrationDate: new Date(2026, 7, 15),
    });

    expect(result).toEqual({
      prorated: false,
      totalClassDays: 0,
      remainingClassDays: 0,
      dailyRate: 0,
      proratedAmount: 150,
      periodEnd: result.periodEnd, // asserted separately below
    });
    // Even this fallback (no schedules configured at all — can't compute a
    // real proration) still anchors to the calendar-month boundary (ADR
    // 007) — there's no such thing as a non-calendar period any more, only
    // "prorated" vs. "not prorated."
    expect(result.periodEnd.getMonth()).toBe(8); // September
    expect(result.periodEnd.getDate()).toBe(1);
  });
});

describe('resolveFirstChargePeriod', () => {
  // "Today" frozen at Oct 1, 2026, 10am Central — the same FROZEN_NOW shape
  // registration.routes.test.js uses. Real timers stay real for everything
  // but Date.now() (this suite hits mongodb-memory-server, which still
  // needs real setTimeout/setInterval to function).
  beforeEach(() => {
    jest.useFakeTimers({
      now: new Date('2026-10-01T15:00:00.000Z'),
      doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick'],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('delegates to computeProration for a CURRENT-month anchor, with periodStart set to anchorDate itself', async () => {
    const level = await seedLevelWithSchedules([3], { name: 'ResolveCurrentMonth' }); // Wednesday
    const anchorDate = new Date(2026, 9, 21); // a Wednesday in October — the current month

    const expected = await computeProration({ levelId: level._id, monthlyFee: 300, registrationDate: anchorDate });
    const result = await resolveFirstChargePeriod({ levelId: level._id, monthlyFee: 300, anchorDate });

    expect(result).toEqual({ ...expected, periodStart: anchorDate });
    // A real partial month, not a coincidental full one — proves this
    // actually delegated to (and didn't short-circuit around) proration.
    expect(result.remainingClassDays).toBeLessThan(result.totalClassDays);
  });

  it(
    'charges the FULL fee flat for a FUTURE-month anchor — never calls computeProration, regardless of ' +
      'which day within that month is chosen (docs/plans/payment-airtight-plan.md D1)',
    async () => {
      // Deliberately a level with NO schedules at all — this branch must
      // never need to resolve weekdays to answer "full fee, whole month".
      const level = await Level.create({ name: 'ResolveFutureMonth', order: 50 });
      const anchorDate = new Date(2026, 10, 18); // November 18 — a future month

      const result = await resolveFirstChargePeriod({ levelId: level._id, monthlyFee: 300, anchorDate });

      expect(result).toEqual({
        prorated: false,
        totalClassDays: 0,
        remainingClassDays: 0,
        dailyRate: 0,
        proratedAmount: 300,
        periodStart: new Date(Date.UTC(2026, 10, 1)),
        periodEnd: new Date(Date.UTC(2026, 11, 1)),
      });
    }
  );

  it('bills the full fee flat for ANY day of a future month, not just its 1st', async () => {
    const level = await Level.create({ name: 'ResolveFutureMonthAnyDay', order: 51 });

    const midMonth = await resolveFirstChargePeriod({
      levelId: level._id,
      monthlyFee: 300,
      anchorDate: new Date(2026, 10, 18),
    });
    const lastDay = await resolveFirstChargePeriod({
      levelId: level._id,
      monthlyFee: 300,
      anchorDate: new Date(2026, 10, 30),
    });

    // Same period + amount regardless of which November day was picked —
    // the billing period is always the WHOLE calendar month.
    expect(midMonth).toEqual(lastDay);
  });

  it('treats the LAST day of the CURRENT month as still-current (prorated), the exact seam D1 relies on', async () => {
    const level = await seedLevelWithSchedules([3], { name: 'ResolveCurrentMonthSeam' }); // Wednesday
    const anchorDate = new Date(2026, 9, 31); // Oct 31 — still October, the current month

    const result = await resolveFirstChargePeriod({ levelId: level._id, monthlyFee: 300, anchorDate });

    expect(result.prorated).toBe(true);
    expect(result.periodStart.toISOString()).toBe(anchorDate.toISOString());
  });
});
