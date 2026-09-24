const mongoose = require('mongoose');

const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');
const Visit = require('../../../src/models/visit.model');
const Service = require('../../../src/models/service.model');
const { seedServices } = require('../../../scripts/lib/seedServices');

const { backfillVisitService } = require('../../../scripts/lib/backfillVisitService');

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
});

const id = () => new mongoose.Types.ObjectId();

// A pre-ADR-010 row: no serviceId. Inserted through the raw collection
// because the current model (correctly) refuses to create one.
async function insertLegacyGroupVisit(overrides = {}) {
  const { insertedId } = await Visit.collection.insertOne({
    studentId: id(),
    groupClassSessionId: id(),
    groupClassScheduleId: id(),
    classType: 'regular',
    status: 'attended',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
  return insertedId;
}

async function rawVisit(visitId) {
  return Visit.collection.findOne({ _id: visitId });
}

describe('backfillVisitService', () => {
  it('dry run reports every visit missing serviceId and writes nothing', async () => {
    const first = await insertLegacyGroupVisit();
    await insertLegacyGroupVisit();

    const report = await backfillVisitService();

    expect(report).toEqual({ scannedCount: 2, updatedCount: 0, aborted: false, abortReason: null });
    expect((await rawVisit(first)).serviceId).toBeUndefined();
  });

  it('apply stamps the group-classes Service id on every legacy visit', async () => {
    const first = await insertLegacyGroupVisit();
    const second = await insertLegacyGroupVisit({ classType: 'trial' });
    const groupService = await Service.findOne({ code: 'group-classes' });

    const report = await backfillVisitService({ apply: true });

    expect(report.updatedCount).toBe(2);
    expect(String((await rawVisit(first)).serviceId)).toBe(String(groupService._id));
    expect(String((await rawVisit(second)).serviceId)).toBe(String(groupService._id));
  });

  it('is idempotent: a second apply scans and updates nothing', async () => {
    await insertLegacyGroupVisit();

    await backfillVisitService({ apply: true });
    const second = await backfillVisitService({ apply: true });

    expect(second).toEqual({ scannedCount: 0, updatedCount: 0, aborted: false, abortReason: null });
  });

  it('never touches a visit that already has a serviceId', async () => {
    const privateService = await Service.findOne({ code: 'private-lessons' });
    const already = await insertLegacyGroupVisit({ serviceId: privateService._id });

    await backfillVisitService({ apply: true });

    expect(String((await rawVisit(already)).serviceId)).toBe(String(privateService._id));
  });

  it('aborts with nothing written when a visit cannot be classified', async () => {
    const legacy = await insertLegacyGroupVisit();
    const orphan = await insertLegacyGroupVisit({ groupClassSessionId: null });

    const report = await backfillVisitService({ apply: true });

    expect(report.aborted).toBe(true);
    expect(String(report.abortReason.docId)).toBe(String(orphan));
    expect((await rawVisit(legacy)).serviceId).toBeUndefined();
  });
});
