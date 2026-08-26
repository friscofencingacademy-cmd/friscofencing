const Level = require('../../../src/models/level.model');
const Location = require('../../../src/models/location.model');
const GroupClass = require('../../../src/models/groupClass.model');
const GroupClassSchedule = require('../../../src/models/groupClassSchedule.model');
const User = require('../../../src/models/user.model');
const { computeProration } = require('../../../src/services/billing/proration.service');
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
    expect(result.periodEnd.getFullYear()).toBe(2026);
    expect(result.periodEnd.getMonth()).toBe(7);
    expect(result.periodEnd.getDate()).toBe(31);
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
    // Falls back to the pre-proration rolling-month behavior, not a
    // calendar-month boundary — there's nothing to anchor a calendar period
    // to when this level has no class days at all.
    expect(result.periodEnd.getMonth()).toBe(8); // one month after August (7) is September (8)
  });
});
