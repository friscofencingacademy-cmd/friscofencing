process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

const Holiday = require('../../src/models/holiday.model');
const PrivateClassSchedule = require('../../src/models/privateClassSchedule.model');
const PrivateClassSession = require('../../src/models/privateClassSession.model');
const {
  openSlotsForRules,
  PRIVATE_BOOKING_HORIZON_DAYS,
} = require('../../src/services/privateClassSchedule.service');
const { dateOnlyUTC } = require('../../src/utils/dateShapes');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');
const { seedServices } = require('../../scripts/lib/seedServices');
const {
  DEFAULT_RULES,
  freezeDate,
  seedCoachWithRules,
  seedParentWithStudent,
  seedActiveEnrollment,
  seedBooking,
} = require('../testUtils/privateLessons');

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

beforeEach(async () => {
  freezeDate();
  await seedServices();
});

afterEach(async () => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  await clearTestDB();
});

// Frozen now = Mon Oct 5 2026, 9:00 AM Central. DEFAULT_RULES = Tuesdays
// 16:30 and 17:00 (30 min), Oct 1 – Dec 31 2026.
const OCT_5 = dateOnlyUTC('2026-10-05');
const OCT_20 = dateOnlyUTC('2026-10-20');

function daysOf(slots, scheduleId) {
  return slots.filter((slot) => String(slot.scheduleId) === String(scheduleId)).map((slot) => slot.day);
}

async function rulesById(...schedules) {
  return PrivateClassSchedule.find({ _id: { $in: schedules.map((schedule) => schedule._id) } }).sort({ _id: 1 });
}

// docs/plans/calendar-view-plan.md C2 — THE "is this private slot open?" rule,
// shared by the booking wizard's date picker and the calendar.
describe('privateClassSchedule.service — openSlotsForRules', () => {
  it('uses a 2-month booking horizon of 62 days (owner decision O3)', () => {
    expect(PRIVATE_BOOKING_HORIZON_DAYS).toBe(62);
  });

  it("returns each rule's weekdays in the range as real instants, tagged with their rule", async () => {
    const { schedules } = await seedCoachWithRules({ suffix: 'basic' });
    const rules = await rulesById(...schedules);

    const slots = await openSlotsForRules(rules, OCT_5, OCT_20);

    expect(daysOf(slots, schedules[0]._id)).toEqual(['2026-10-06', '2026-10-13', '2026-10-20']);
    expect(daysOf(slots, schedules[1]._id)).toEqual(['2026-10-06', '2026-10-13', '2026-10-20']);
    const first = slots.find((slot) => String(slot.scheduleId) === String(schedules[0]._id));
    expect(first.startDate.toISOString()).toBe('2026-10-06T21:30:00.000Z');
    expect(first.endDate.toISOString()).toBe('2026-10-06T22:00:00.000Z');
  });

  it("honors each rule's own date range inside the requested range", async () => {
    const { schedules } = await seedCoachWithRules({
      suffix: 'range',
      rules: { ...DEFAULT_RULES, windowEnd: '17:00', startDate: '2026-10-13', endDate: '2026-10-13' },
    });

    const slots = await openSlotsForRules(await rulesById(...schedules), OCT_5, OCT_20);

    expect(slots.map((slot) => slot.day)).toEqual(['2026-10-13']);
  });

  it('removes an academy holiday', async () => {
    const { schedules } = await seedCoachWithRules({ suffix: 'holiday', rules: { ...DEFAULT_RULES, windowEnd: '17:00' } });
    await Holiday.create({ name: 'Fall break', startDate: new Date('2026-10-13'), endDate: new Date('2026-10-13') });

    const slots = await openSlotsForRules(await rulesById(...schedules), OCT_5, OCT_20);

    expect(slots.map((slot) => slot.day)).toEqual(['2026-10-06', '2026-10-20']);
  });

  it('removes a lesson that has already started at `now`', async () => {
    const { schedules } = await seedCoachWithRules({ suffix: 'started', rules: { ...DEFAULT_RULES, windowEnd: '17:00' } });
    const rules = await rulesById(...schedules);

    const before = await openSlotsForRules(rules, OCT_5, OCT_20, new Date('2026-10-06T21:29:00.000Z'));
    const at = await openSlotsForRules(rules, OCT_5, OCT_20, new Date('2026-10-06T21:30:00.000Z'));

    expect(before.map((slot) => slot.day)).toEqual(['2026-10-06', '2026-10-13', '2026-10-20']);
    expect(at.map((slot) => slot.day)).toEqual(['2026-10-13', '2026-10-20']);
  });

  it('removes a held slot (pending or confirmed); cancelled and released bookings free it', async () => {
    const { coach, contract, schedules } = await seedCoachWithRules({ suffix: 'held', rules: { ...DEFAULT_RULES, windowEnd: '17:00' } });
    const { parent, student } = await seedParentWithStudent('held');
    const enrollment = await seedActiveEnrollment({ parent, student, coach, contract });
    const [rule] = schedules;
    await seedBooking({ schedule: rule, day: '2026-10-06', enrollment, status: 'confirmed' });
    await seedBooking({ schedule: rule, day: '2026-10-13', enrollment, status: 'pending' });
    await seedBooking({ schedule: rule, day: '2026-10-20', enrollment, status: 'cancelled' });
    await seedBooking({ schedule: rule, day: '2026-10-27', enrollment, status: 'released' });

    const slots = await openSlotsForRules(await rulesById(rule), OCT_5, dateOnlyUTC('2026-10-27'));

    expect(slots.map((slot) => slot.day)).toEqual(['2026-10-20', '2026-10-27']);
  });

  it("never lets a booking on one coach's rule hide another coach's slot at the same instant", async () => {
    const coachA = await seedCoachWithRules({ suffix: 'same-a', rules: { ...DEFAULT_RULES, windowEnd: '17:00' } });
    const coachB = await seedCoachWithRules({ suffix: 'same-b', rules: { ...DEFAULT_RULES, windowEnd: '17:00' } });
    const { parent, student } = await seedParentWithStudent('same');
    const enrollment = await seedActiveEnrollment({ parent, student, coach: coachA.coach, contract: coachA.contract });
    await seedBooking({ schedule: coachA.schedules[0], day: '2026-10-06', enrollment });

    const slots = await openSlotsForRules(await rulesById(coachA.schedules[0], coachB.schedules[0]), OCT_5, OCT_20);

    // Both rules are Tuesday 16:30. Only coach A's Oct 6 is taken.
    expect(daysOf(slots, coachA.schedules[0]._id)).toEqual(['2026-10-13', '2026-10-20']);
    expect(daysOf(slots, coachB.schedules[0]._id)).toEqual(['2026-10-06', '2026-10-13', '2026-10-20']);
  });

  it('reads held bookings and holidays once for many rules', async () => {
    const coachA = await seedCoachWithRules({ suffix: 'one-a' });
    const coachB = await seedCoachWithRules({ suffix: 'one-b' });
    const rules = await rulesById(...coachA.schedules, ...coachB.schedules);
    const findSpy = jest.spyOn(PrivateClassSession, 'find');
    const holidaySpy = jest.spyOn(Holiday, 'find');

    const slots = await openSlotsForRules(rules, OCT_5, dateOnlyUTC('2026-12-31'));

    expect(rules).toHaveLength(4);
    expect(slots.length).toBeGreaterThan(40);
    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(holidaySpy).toHaveBeenCalledTimes(1);
  });

  it('returns nothing, without querying, for no rules or an inverted range', async () => {
    const { schedules } = await seedCoachWithRules({ suffix: 'empty' });
    const findSpy = jest.spyOn(PrivateClassSession, 'find');

    expect(await openSlotsForRules([], OCT_5, OCT_20)).toEqual([]);
    expect(await openSlotsForRules(await rulesById(...schedules), OCT_20, OCT_5)).toEqual([]);
    expect(findSpy).not.toHaveBeenCalled();
  });

  it('defaults `now` to the real clock (frozen here)', async () => {
    const { schedules } = await seedCoachWithRules({ suffix: 'now', rules: { ...DEFAULT_RULES, windowEnd: '17:00' } });
    freezeDate(new Date('2026-10-06T21:30:00.000Z'));

    const slots = await openSlotsForRules(await rulesById(...schedules), OCT_5, OCT_20);

    expect(slots.map((slot) => slot.day)).toEqual(['2026-10-13', '2026-10-20']);
  });
});
