const mongoose = require('mongoose');

const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');
const GroupClassSession = require('../../../src/models/groupClassSession.model');
const GroupClassSchedule = require('../../../src/models/groupClassSchedule.model');
const GroupClass = require('../../../src/models/groupClass.model');
const Level = require('../../../src/models/level.model');
const Location = require('../../../src/models/location.model');
const User = require('../../../src/models/user.model');
const Subscription = require('../../../src/models/subscription.model');
const { SubscriptionCycleRegistration } = require('../../../src/models/registration.model');
const Service = require('../../../src/models/service.model');
const { seedServices } = require('../../../scripts/lib/seedServices');

const { normalizeDateSentinels, normalizeSentinelValue } = require('../../../scripts/lib/normalizeDateSentinels');

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

async function seedScheduleFor(suffix) {
  const level = await Level.create({ name: `Level ${suffix}`, order: 1 });
  const location = await Location.create({ name: `HQ ${suffix}`, address: '1 Main St' });
  const groupClass = await GroupClass.create({ name: `Class ${suffix}`, levelId: level._id, locationId: location._id, capacity: 10 });
  const coach = await User.create({ role: 'coach', firstName: 'C', lastName: suffix, email: `coach-${suffix}@example.com`, passwordHash: 'x' });

  return GroupClassSchedule.create({
    classId: groupClass._id,
    coachId: coach._id,
    dayOfWeek: 1,
    startTime: '16:00',
    endTime: '17:00',
    students: [],
  });
}

async function seedSubscriptionAndFamily(suffix) {
  const parent = await User.create({ role: 'parent', firstName: 'P', lastName: suffix, email: `parent-${suffix}@example.com`, passwordHash: 'x' });
  const student = await User.create({ role: 'student', firstName: 'S', lastName: suffix, parentId: parent._id });
  return { parent, student };
}

describe('scripts/lib/normalizeDateSentinels — normalizeSentinelValue', () => {
  it('keeps an already-clean UTC-midnight sentinel', () => {
    expect(normalizeSentinelValue(new Date('2026-08-31T00:00:00.000Z'))).toEqual({ action: 'keep' });
  });

  it('truncates an Eastern-midnight contaminated instant', () => {
    const result = normalizeSentinelValue(new Date('2026-08-31T04:00:00.000Z'));
    expect(result.action).toBe('truncate');
    expect(result.newValue.toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });

  it('truncates a Central-midnight contaminated instant', () => {
    const result = normalizeSentinelValue(new Date('2026-08-31T05:00:00.000Z'));
    expect(result.action).toBe('truncate');
    expect(result.newValue.toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });

  it('aborts on a value at/past UTC noon — possible east-of-UTC creation', () => {
    const result = normalizeSentinelValue(new Date('2026-08-31T12:00:00.000Z'));
    expect(result.action).toBe('abort');
  });

  it('skips a non-Date/invalid value', () => {
    expect(normalizeSentinelValue('not a date').action).toBe('skip');
    expect(normalizeSentinelValue(new Date('invalid')).action).toBe('skip');
  });
});

describe('scripts/lib/normalizeDateSentinels — normalizeDateSentinels (real Mongo)', () => {
  it('dry-run reports a contaminated GroupClassSession.date as needing normalization, without writing anything', async () => {
    const schedule = await seedScheduleFor('a');
    const session = await GroupClassSession.create({ scheduleId: schedule._id, date: new Date('2026-08-31T04:00:00.000Z') });

    const report = await normalizeDateSentinels({ apply: false });

    expect(report.applied).toBe(false);
    expect(report.aborted).toBe(false);
    expect(report.changes).toHaveLength(1);
    expect(report.changes[0]).toEqual(
      expect.objectContaining({
        docId: session._id,
        field: 'date',
        newValue: new Date('2026-08-31T00:00:00.000Z'),
      })
    );

    const unchanged = await GroupClassSession.findById(session._id);
    expect(unchanged.date.toISOString()).toBe('2026-08-31T04:00:00.000Z');
  });

  it('--live truncates a contaminated GroupClassSession.date to true UTC midnight', async () => {
    const schedule = await seedScheduleFor('b');
    const session = await GroupClassSession.create({ scheduleId: schedule._id, date: new Date('2026-08-31T05:00:00.000Z') });

    const report = await normalizeDateSentinels({ apply: true });

    expect(report.applied).toBe(true);
    expect(report.changes).toHaveLength(1);

    const updated = await GroupClassSession.findById(session._id);
    expect(updated.date.toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });

  it('leaves an already-clean sentinel untouched and reports zero changes', async () => {
    const schedule = await seedScheduleFor('c');
    await GroupClassSession.create({ scheduleId: schedule._id, date: new Date('2026-08-31T00:00:00.000Z') });

    const report = await normalizeDateSentinels({ apply: true });

    expect(report.changes).toHaveLength(0);
  });

  it('is idempotent — a second run over already-normalized data reports zero changes', async () => {
    const schedule = await seedScheduleFor('d');
    await GroupClassSession.create({ scheduleId: schedule._id, date: new Date('2026-08-31T04:00:00.000Z') });

    await normalizeDateSentinels({ apply: true });
    const secondRun = await normalizeDateSentinels({ apply: true });

    expect(secondRun.changes).toHaveLength(0);
  });

  it('normalizes all three Subscription period fields', async () => {
    const schedule = await seedScheduleFor('e');
    const { parent, student } = await seedSubscriptionAndFamily('e');

    const subscription = await Subscription.create({
      studentId: student._id,
      scheduleId: schedule._id,
      parentId: parent._id,
      status: 'active',
      currentPeriodStart: new Date('2026-08-01T04:00:00.000Z'),
      currentPeriodEnd: new Date('2026-09-01T04:00:00.000Z'),
      nextBillingDate: new Date('2026-09-01T04:00:00.000Z'),
    });

    const report = await normalizeDateSentinels({ apply: true });

    expect(report.changes.length).toBe(3);

    const updated = await Subscription.findById(subscription._id);
    expect(updated.currentPeriodStart.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(updated.currentPeriodEnd.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(updated.nextBillingDate.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('normalizes SubscriptionCycleRegistration periodStart/periodEnd', async () => {
    await seedServices();
    const groupClassesService = await Service.findOne({ code: 'group-classes' });
    const schedule = await seedScheduleFor('f');
    const { parent, student } = await seedSubscriptionAndFamily('f');

    const row = await SubscriptionCycleRegistration.create({
      serviceId: groupClassesService._id,
      subscriptionId: new mongoose.Types.ObjectId(),
      scheduleId: schedule._id,
      studentId: student._id,
      parentId: parent._id,
      eventType: 'renewal',
      status: 'completed',
      amount: 150,
      breakdown: { monthlyFee: 150 },
      periodStart: new Date('2026-08-01T04:00:00.000Z'),
      periodEnd: new Date('2026-09-01T04:00:00.000Z'),
    });

    const report = await normalizeDateSentinels({ apply: true });

    expect(report.changes.length).toBe(2);

    const updated = await SubscriptionCycleRegistration.findById(row._id);
    expect(updated.periodStart.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(updated.periodEnd.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('aborts the ENTIRE run — writes nothing anywhere — when any field fails the safety check', async () => {
    const schedule = await seedScheduleFor('g');
    // A clean, otherwise-normal session that WOULD be left untouched...
    const cleanSession = await GroupClassSession.create({ scheduleId: schedule._id, date: new Date('2026-08-31T00:00:00.000Z') });

    const { parent, student } = await seedSubscriptionAndFamily('g');
    // ...but a Subscription field with an impossible UTC-noon-or-later value
    // forces the whole run to abort before anything is written, anywhere.
    const subscription = await Subscription.create({
      studentId: student._id,
      scheduleId: schedule._id,
      parentId: parent._id,
      status: 'active',
      currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
      nextBillingDate: new Date('2026-09-01T14:00:00.000Z'),
    });

    const report = await normalizeDateSentinels({ apply: true });

    expect(report.aborted).toBe(true);
    expect(report.applied).toBe(false);
    expect(report.changes).toHaveLength(0);

    const unchangedSession = await GroupClassSession.findById(cleanSession._id);
    expect(unchangedSession.date.toISOString()).toBe('2026-08-31T00:00:00.000Z');

    const unchangedSubscription = await Subscription.findById(subscription._id);
    expect(unchangedSubscription.nextBillingDate.toISOString()).toBe('2026-09-01T14:00:00.000Z');
  });

  it('skips (never writes) a normalization that would collide with another row on the same unique key after truncation', async () => {
    const schedule = await seedScheduleFor('h');
    // Two sessions on the SAME schedule, contaminated with two different
    // instant shapes that both truncate to the SAME calendar day — writing
    // both would collide on the {scheduleId, date} unique index.
    const sessionA = await GroupClassSession.create({ scheduleId: schedule._id, date: new Date('2026-08-31T04:00:00.000Z') });
    const sessionB = await GroupClassSession.create({ scheduleId: schedule._id, date: new Date('2026-08-31T05:00:00.000Z') });

    const report = await normalizeDateSentinels({ apply: true });

    expect(report.changes).toHaveLength(0);
    expect(report.skippedCollisions.length).toBe(2);

    const unchangedA = await GroupClassSession.findById(sessionA._id);
    const unchangedB = await GroupClassSession.findById(sessionB._id);
    expect(unchangedA.date.toISOString()).toBe('2026-08-31T04:00:00.000Z');
    expect(unchangedB.date.toISOString()).toBe('2026-08-31T05:00:00.000Z');
  });

  it('does not treat a collision against an untouched already-clean row as safe to write', async () => {
    const schedule = await seedScheduleFor('i');
    // An already-clean session at the target day...
    await GroupClassSession.create({ scheduleId: schedule._id, date: new Date('2026-08-31T00:00:00.000Z') });
    // ...and a contaminated one on the SAME schedule that would truncate
    // onto the exact same day — writing it would collide with the clean one.
    const contaminated = await GroupClassSession.create({ scheduleId: schedule._id, date: new Date('2026-08-31T04:00:00.000Z') });

    const report = await normalizeDateSentinels({ apply: true });

    expect(report.changes).toHaveLength(0);
    expect(report.skippedCollisions).toHaveLength(1);

    const unchanged = await GroupClassSession.findById(contaminated._id);
    expect(unchanged.date.toISOString()).toBe('2026-08-31T04:00:00.000Z');
  });
});
