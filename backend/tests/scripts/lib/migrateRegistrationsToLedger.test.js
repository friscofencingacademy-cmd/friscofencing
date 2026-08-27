const mongoose = require('mongoose');

const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');
const User = require('../../../src/models/user.model');
const Registration = require('../../../src/models/registration.model');
const Subscription = require('../../../src/models/subscription.model');

const { migrateRegistrationsToLedger } = require('../../../scripts/lib/migrateRegistrationsToLedger');

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

// The new registration.model.js schema requires fields (subscriptionId,
// eventType, amount, breakdown.monthlyFee, periodStart, periodEnd) the old
// 3-field shape never had — Registration.create() would reject it, so a
// legacy fixture has to go in via the raw collection, bypassing Mongoose
// validation entirely, exactly the way real old data sits in the database
// this script is meant to run against.
async function insertLegacyRegistration({ studentId, scheduleId, status = 'active', createdAt }) {
  const { insertedId } = await Registration.collection.insertOne({
    studentId,
    scheduleId,
    status,
    createdAt,
    updatedAt: createdAt,
  });

  return insertedId;
}

async function makeParentAndStudent() {
  const parent = await User.create({
    role: 'parent',
    firstName: 'Parent',
    lastName: 'Legacy',
    email: `parent-legacy-${new mongoose.Types.ObjectId()}@example.com`,
    passwordHash: 'irrelevant-hash',
  });
  const student = await User.create({
    role: 'student',
    firstName: 'Kid',
    lastName: 'Legacy',
    parentId: parent._id,
  });

  return { parent, student };
}

describe('scripts/lib/migrateRegistrationsToLedger', () => {
  it('dry run reports what it would migrate but writes nothing', async () => {
    const { parent, student } = await makeParentAndStudent();
    const scheduleId = new mongoose.Types.ObjectId();
    const createdAt = new Date('2026-01-01T12:00:00.000Z');

    await Subscription.create({
      studentId: student._id,
      scheduleId,
      parentId: parent._id,
      status: 'active',
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date('2026-05-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-06-01T00:00:00.000Z'),
      nextBillingDate: new Date('2026-06-01T00:00:00.000Z'),
      lastChargeAmount: 150,
      registrationFeeCharged: 25,
      firstChargeProrated: false,
    });
    const legacyId = await insertLegacyRegistration({ studentId: student._id, scheduleId, createdAt });

    const report = await migrateRegistrationsToLedger({ dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.totalLegacyDocs).toBe(1);
    expect(report.migrated).toHaveLength(1);
    expect(report.migrated[0].registrationId).toBe(legacyId.toString());
    expect(report.migrated[0].amount).toBe(175);

    // Zero writes — the doc in the database is byte-identical to what was
    // inserted, still in its old 3-field shape.
    const raw = await Registration.collection.findOne({ _id: legacyId });
    expect(raw.eventType).toBeUndefined();
    expect(raw.status).toBe('active');
  });

  it('live run rewrites a matched doc into a completed, backfilled ledger row using the Subscription snapshot and the doc\'s own createdAt as periodStart', async () => {
    const { parent, student } = await makeParentAndStudent();
    const scheduleId = new mongoose.Types.ObjectId();
    const createdAt = new Date('2026-01-01T12:00:00.000Z');

    const subscription = await Subscription.create({
      studentId: student._id,
      scheduleId,
      parentId: parent._id,
      status: 'active',
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date('2026-05-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-06-01T00:00:00.000Z'),
      nextBillingDate: new Date('2026-06-01T00:00:00.000Z'),
      lastChargeAmount: 150,
      registrationFeeCharged: 25,
      firstChargeProrated: false,
    });
    const legacyId = await insertLegacyRegistration({ studentId: student._id, scheduleId, createdAt });

    const report = await migrateRegistrationsToLedger({ dryRun: false });

    expect(report.migrated).toHaveLength(1);
    expect(report.orphaned).toHaveLength(0);

    const migrated = await Registration.findById(legacyId);
    expect(migrated.subscriptionId.toString()).toBe(subscription._id.toString());
    expect(migrated.parentId.toString()).toBe(parent._id.toString());
    expect(migrated.eventType).toBe('initial');
    expect(migrated.status).toBe('completed');
    expect(migrated.amount).toBe(175); // 150 lastChargeAmount + 25 registrationFeeCharged
    expect(migrated.breakdown.monthlyFee).toBe(150);
    expect(migrated.breakdown.registrationFeeCharged).toBe(25);
    expect(migrated.periodStart.toISOString()).toBe(createdAt.toISOString());
    expect(migrated.backfilled).toBe(true);
  });

  it('marks a prorated subscription\'s backfilled row with periodEnd at calendar month-end instead of +1 month', async () => {
    const { parent, student } = await makeParentAndStudent();
    const scheduleId = new mongoose.Types.ObjectId();
    const createdAt = new Date('2026-03-10T12:00:00.000Z');

    await Subscription.create({
      studentId: student._id,
      scheduleId,
      parentId: parent._id,
      status: 'active',
      cancelAtPeriodEnd: false,
      currentPeriodStart: createdAt,
      currentPeriodEnd: new Date('2026-03-31T23:59:59.999Z'),
      nextBillingDate: new Date('2026-03-31T23:59:59.999Z'),
      lastChargeAmount: 75,
      registrationFeeCharged: 0,
      firstChargeProrated: true,
    });
    const legacyId = await insertLegacyRegistration({ studentId: student._id, scheduleId, createdAt });

    await migrateRegistrationsToLedger({ dryRun: false });

    const migrated = await Registration.findById(legacyId);
    expect(migrated.breakdown.prorated).toBe(true);
    expect(migrated.periodEnd.getFullYear()).toBe(2026);
    expect(migrated.periodEnd.getMonth()).toBe(2); // March, 0-indexed
    expect(migrated.periodEnd.getDate()).toBe(31);
  });

  it('leaves an orphaned doc (no matching Subscription at all) completely untouched and reports it for manual review', async () => {
    const { student } = await makeParentAndStudent();
    const scheduleId = new mongoose.Types.ObjectId();
    const legacyId = await insertLegacyRegistration({
      studentId: student._id,
      scheduleId,
      createdAt: new Date('2026-01-01T12:00:00.000Z'),
    });

    const report = await migrateRegistrationsToLedger({ dryRun: false });

    expect(report.migrated).toHaveLength(0);
    expect(report.orphaned).toHaveLength(1);
    expect(report.orphaned[0].registrationId).toBe(legacyId.toString());

    const raw = await Registration.collection.findOne({ _id: legacyId });
    expect(raw.eventType).toBeUndefined();
    expect(raw.status).toBe('active');
  });

  it('is safe to run twice: a doc already migrated is not picked up again', async () => {
    const { parent, student } = await makeParentAndStudent();
    const scheduleId = new mongoose.Types.ObjectId();

    await Subscription.create({
      studentId: student._id,
      scheduleId,
      parentId: parent._id,
      status: 'active',
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date('2026-05-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-06-01T00:00:00.000Z'),
      nextBillingDate: new Date('2026-06-01T00:00:00.000Z'),
      lastChargeAmount: 150,
    });
    await insertLegacyRegistration({
      studentId: student._id,
      scheduleId,
      createdAt: new Date('2026-01-01T12:00:00.000Z'),
    });

    const firstRun = await migrateRegistrationsToLedger({ dryRun: false });
    expect(firstRun.migrated).toHaveLength(1);

    const secondRun = await migrateRegistrationsToLedger({ dryRun: false });
    expect(secondRun.totalLegacyDocs).toBe(0);
    expect(secondRun.migrated).toHaveLength(0);
  });
});
