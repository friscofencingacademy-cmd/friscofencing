const mongoose = require('mongoose');

const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');
const GroupClassSession = require('../../../src/models/groupClassSession.model');
const GroupClassSchedule = require('../../../src/models/groupClassSchedule.model');
const { sessionInstantsFor } = require('../../../src/services/groupClassSession.service');

const { backfillSessionInstants } = require('../../../scripts/lib/backfillSessionInstants');

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

function seedSchedule(overrides = {}) {
  return GroupClassSchedule.create({
    classId: new mongoose.Types.ObjectId(),
    coachId: new mongoose.Types.ObjectId(),
    dayOfWeek: 2,
    startTime: '16:00',
    endTime: '17:00',
    students: [],
    ...overrides,
  });
}

// A pre-migration row: `date` only, no startsAt/endsAt. Inserted through the
// raw collection because the current model (correctly) refuses to create
// such a document.
async function insertLegacySession(schedule, date) {
  const { insertedId } = await GroupClassSession.collection.insertOne({
    scheduleId: schedule._id,
    date,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return insertedId;
}

async function rawSession(id) {
  return GroupClassSession.collection.findOne({ _id: id });
}

describe('scripts/lib/backfillSessionInstants', () => {
  it('dry-run reports what it would write and writes nothing', async () => {
    const schedule = await seedSchedule();
    const id = await insertLegacySession(schedule, new Date('2026-08-25T00:00:00.000Z'));

    const report = await backfillSessionInstants({ apply: false });

    expect(report.aborted).toBe(false);
    expect(report.scannedCount).toBe(1);
    expect(report.changes).toHaveLength(1);
    expect(report.changes[0].startsAt.toISOString()).toBe('2026-08-25T21:00:00.000Z');

    const untouched = await rawSession(id);
    expect(untouched.startsAt).toBeUndefined();
    expect(untouched.endsAt).toBeUndefined();
  });

  it('--live fills startsAt/endsAt with exactly what the production generator composes — CDT and CST rows', async () => {
    const schedule = await seedSchedule();
    const summer = await insertLegacySession(schedule, new Date('2026-07-21T00:00:00.000Z'));
    const winter = await insertLegacySession(schedule, new Date('2026-01-20T00:00:00.000Z'));

    const report = await backfillSessionInstants({ apply: true });

    expect(report.changes).toHaveLength(2);

    const summerDoc = await rawSession(summer);
    expect(summerDoc.startsAt.toISOString()).toBe('2026-07-21T21:00:00.000Z');
    expect(summerDoc.endsAt.toISOString()).toBe('2026-07-21T22:00:00.000Z');

    const winterDoc = await rawSession(winter);
    expect(winterDoc.startsAt.toISOString()).toBe('2026-01-20T22:00:00.000Z');
    expect(winterDoc.endsAt.toISOString()).toBe('2026-01-20T23:00:00.000Z');

    const expected = sessionInstantsFor(new Date('2026-07-21T00:00:00.000Z'), schedule);
    expect(summerDoc.startsAt.getTime()).toBe(expected.startsAt.getTime());
  });

  it('uses each row\'s OWN schedule times', async () => {
    const morning = await seedSchedule({ startTime: '09:00', endTime: '10:00' });
    const evening = await seedSchedule({ startTime: '18:30', endTime: '19:30' });
    const morningId = await insertLegacySession(morning, new Date('2026-08-25T00:00:00.000Z'));
    const eveningId = await insertLegacySession(evening, new Date('2026-08-25T00:00:00.000Z'));

    await backfillSessionInstants({ apply: true });

    expect((await rawSession(morningId)).startsAt.toISOString()).toBe('2026-08-25T14:00:00.000Z');
    expect((await rawSession(eveningId)).startsAt.toISOString()).toBe('2026-08-25T23:30:00.000Z');
  });

  it('leaves a row that already has both fields untouched (idempotent)', async () => {
    const schedule = await seedSchedule();
    const preserved = {
      startsAt: new Date('2030-01-01T10:00:00.000Z'),
      endsAt: new Date('2030-01-01T11:00:00.000Z'),
    };
    const { insertedId } = await GroupClassSession.collection.insertOne({
      scheduleId: schedule._id,
      date: new Date('2026-08-25T00:00:00.000Z'),
      ...preserved,
    });

    const report = await backfillSessionInstants({ apply: true });

    expect(report.scannedCount).toBe(0);
    expect(report.changes).toHaveLength(0);
    const doc = await rawSession(insertedId);
    expect(doc.startsAt.toISOString()).toBe(preserved.startsAt.toISOString());
  });

  it('a second --live run over already-backfilled data changes nothing', async () => {
    const schedule = await seedSchedule();
    await insertLegacySession(schedule, new Date('2026-08-25T00:00:00.000Z'));

    await backfillSessionInstants({ apply: true });
    const second = await backfillSessionInstants({ apply: true });

    expect(second.changes).toHaveLength(0);
  });

  it('aborts the WHOLE run with nothing written when a session\'s schedule no longer exists', async () => {
    const schedule = await seedSchedule();
    const goodId = await insertLegacySession(schedule, new Date('2026-08-25T00:00:00.000Z'));
    const orphanedSchedule = await seedSchedule();
    await insertLegacySession(orphanedSchedule, new Date('2026-08-25T00:00:00.000Z'));
    await GroupClassSchedule.deleteOne({ _id: orphanedSchedule._id });

    const report = await backfillSessionInstants({ apply: true });

    expect(report.aborted).toBe(true);
    expect(report.abortReason.reason).toMatch(/no longer exists/);
    expect(report.changes).toHaveLength(0);
    expect((await rawSession(goodId)).startsAt).toBeUndefined();
  });

  it('returns an empty report when there is nothing to backfill', async () => {
    const report = await backfillSessionInstants({ apply: true });

    expect(report).toEqual({ scannedCount: 0, changes: [], aborted: false, abortReason: null });
  });
});
