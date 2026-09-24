const mongoose = require('mongoose');

const Service = require('../../../src/models/service.model');
const PrivateClassSchedule = require('../../../src/models/privateClassSchedule.model');
const PrivateClassEnrollment = require('../../../src/models/privateClassEnrollment.model');
const PrivateClassSession = require('../../../src/models/privateClassSession.model');
const Registration = require('../../../src/models/registration.model');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');
const { seedServices } = require('../../../scripts/lib/seedServices');

const {
  retireRecurringPrivateClasses,
  SESSION_INDEX_NAME,
} = require('../../../scripts/lib/retireRecurringPrivateClasses');

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

beforeEach(async () => {
  await seedServices();
});

afterEach(async () => {
  await clearTestDB();
  try {
    await PrivateClassSession.collection.dropIndexes();
  } catch (error) {
    // collection may not exist
  }
});

const id = () => new mongoose.Types.ObjectId();

// The recurring model's documents, inserted raw — the current schemas
// (correctly) refuse to create them.
async function seedOldShape({ chargeStatus = 'failed' } = {}) {
  const privateService = await Service.findOne({ code: 'private-lessons' });
  const now = new Date();
  const enrollmentId = id();

  const { insertedId: scheduleId } = await PrivateClassSchedule.collection.insertOne({
    coachId: id(),
    dayOfWeek: 2,
    startTime: '16:00',
    durationMinutes: 60,
    studentId: id(),
    enrollmentId,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await PrivateClassEnrollment.collection.insertOne({
    _id: enrollmentId,
    studentId: id(),
    parentId: id(),
    coachId: id(),
    coachContractId: id(),
    agreedHourlyRate: 60,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  const { insertedId: sessionId } = await PrivateClassSession.collection.insertOne({
    scheduleId,
    enrollmentId,
    coachId: id(),
    studentId: id(),
    parentId: id(),
    startDate: new Date('2026-09-01T21:00:00.000Z'),
    endDate: new Date('2026-09-01T22:00:00.000Z'),
    attendance: 'attended',
    createdAt: now,
    updatedAt: now,
  });
  await Registration.collection.insertOne({
    billingShape: 'per_session',
    serviceId: privateService._id,
    sessionId,
    enrollmentId,
    studentId: id(),
    parentId: id(),
    amount: 60,
    status: chargeStatus,
    attempt: 1,
    createdAt: now,
    updatedAt: now,
  });

  // The recurring model's non-partial unique index, as a pre-cutover
  // database has it (Mongoose autoIndex already built the new partial one in
  // this test DB, so swap it back first).
  await PrivateClassSession.collection.dropIndex(SESSION_INDEX_NAME).catch(() => {});
  await PrivateClassSession.collection.createIndex({ scheduleId: 1, startDate: 1 }, { name: SESSION_INDEX_NAME, unique: true });

  return { scheduleId };
}

describe('scripts/lib/retireRecurringPrivateClasses', () => {
  it('dry run reports every old-shape document and writes nothing', async () => {
    await seedOldShape();

    const report = await retireRecurringPrivateClasses();

    expect(report).toMatchObject({
      claimedSchedules: 1,
      oldEnrollments: 1,
      oldSessions: 1,
      oldFailedLedgerRows: 1,
      oldMoneyLedgerRows: 0,
      indexNeedsReplacing: true,
      aborted: false,
      applied: false,
    });
    expect(report.rangelessScheduleIds).toHaveLength(1);
    expect(await PrivateClassSession.countDocuments({})).toBe(1);
  });

  it.each(['pending', 'completed'])('refuses to write anything when an old charge is %s (money moved)', async (chargeStatus) => {
    await seedOldShape({ chargeStatus });

    const report = await retireRecurringPrivateClasses({ apply: true });

    expect(report.aborted).toBe(true);
    expect(report.applied).toBe(false);
    expect(await PrivateClassEnrollment.countDocuments({})).toBe(1);
    expect(await Registration.countDocuments({})).toBe(1);
  });

  it('applies: frees and ranges the schedules, deletes the old model, and swaps in the partial index', async () => {
    const { scheduleId } = await seedOldShape();

    const report = await retireRecurringPrivateClasses({ apply: true });

    expect(report.applied).toBe(true);
    const schedule = await PrivateClassSchedule.collection.findOne({ _id: scheduleId });
    expect(schedule.studentId).toBeUndefined();
    expect(schedule.enrollmentId).toBeUndefined();
    expect(schedule.startDate).toBeInstanceOf(Date);
    expect(Math.round((schedule.endDate - schedule.startDate) / 86400000)).toBe(89);
    expect(await PrivateClassEnrollment.countDocuments({})).toBe(0);
    expect(await PrivateClassSession.countDocuments({})).toBe(0);
    expect(await Registration.countDocuments({})).toBe(0);

    const index = (await PrivateClassSession.collection.indexes()).find((candidate) => candidate.name === SESSION_INDEX_NAME);
    expect(index.unique).toBe(true);
    expect(index.partialFilterExpression).toEqual({ status: { $in: ['pending', 'confirmed'] } });

    // The migrated schedule is now a valid availability rule.
    await expect(PrivateClassSchedule.findById(scheduleId).then((doc) => doc.validate())).resolves.toBeUndefined();
  });

  it('is idempotent: a second apply finds nothing to change', async () => {
    await seedOldShape();
    await retireRecurringPrivateClasses({ apply: true });

    const second = await retireRecurringPrivateClasses({ apply: true });

    expect(second).toMatchObject({
      claimedSchedules: 0,
      rangelessScheduleIds: [],
      oldEnrollments: 0,
      oldSessions: 0,
      oldFailedLedgerRows: 0,
      indexNeedsReplacing: false,
      applied: true,
    });
  });
});
