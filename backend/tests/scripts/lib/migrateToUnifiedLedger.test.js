const mongoose = require('mongoose');

const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');
const Registration = require('../../../src/models/registration.model');
const CoachContract = require('../../../src/models/coachContract.model');
const Service = require('../../../src/models/service.model');
const User = require('../../../src/models/user.model');

const { seedServices } = require('../../../scripts/lib/seedServices');
const { migrateToUnifiedLedger } = require('../../../scripts/lib/migrateToUnifiedLedger');

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

afterEach(async () => {
  await clearTestDB();
  // Restores the driver-prototype spy the abort-path fault-injection test
  // installs — that spy is shared across every Collection instance for the
  // rest of the process, so leaving it in place would corrupt every
  // subsequent test's writes, not just this file's.
  jest.restoreAllMocks();
});

// Inserts a raw old-shape group Registration doc (no billingShape/serviceId
// — exactly what a doc from before this migration looks like) via the raw
// collection, bypassing the current (restructured) schema entirely.
async function insertLegacyGroupRegistration(overrides = {}) {
  const doc = {
    _id: new mongoose.Types.ObjectId(),
    subscriptionId: new mongoose.Types.ObjectId(),
    studentId: new mongoose.Types.ObjectId(),
    scheduleId: new mongoose.Types.ObjectId(),
    parentId: new mongoose.Types.ObjectId(),
    eventType: 'initial',
    status: 'completed',
    amount: 150,
    breakdown: { monthlyFee: 150 },
    periodStart: new Date('2026-01-01T00:00:00.000Z'),
    periodEnd: new Date('2026-02-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
  await mongoose.connection.db.collection('registrations').insertOne(doc);
  return doc;
}

// Inserts a raw old-collection PrivateClassCharge-shaped doc directly into
// `privateclasscharges` — the collection no longer has a registered
// Mongoose model (it was deleted as part of this migration), so this goes
// through the raw driver, exactly as real pre-migration data would sit.
async function insertLegacyPrivateCharge(overrides = {}) {
  const doc = {
    _id: new mongoose.Types.ObjectId(),
    sessionId: new mongoose.Types.ObjectId(),
    enrollmentId: new mongoose.Types.ObjectId(),
    parentId: new mongoose.Types.ObjectId(),
    studentId: new mongoose.Types.ObjectId(),
    amount: 50,
    status: 'completed',
    stripePaymentIntentId: 'pi_test_123',
    attempt: 1,
    failureMessage: null,
    paidAt: new Date('2026-01-15T00:00:00.000Z'),
    createdAt: new Date('2026-01-15T00:00:00.000Z'),
    updatedAt: new Date('2026-01-15T00:00:00.000Z'),
    ...overrides,
  };
  await mongoose.connection.db.collection('privateclasscharges').insertOne(doc);
  return doc;
}

async function insertLegacyCoachContract() {
  const coach = await User.create({ role: 'coach', firstName: 'Coach', lastName: 'Legacy' });
  const doc = {
    _id: new mongoose.Types.ObjectId(),
    coachId: coach._id,
    studentBillingRate: 60,
    coachCompensationRate: 30,
    sessionDurationMinutes: 60,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await mongoose.connection.db.collection('coachcontracts').insertOne(doc);
  return doc;
}

describe('scripts/lib/migrateToUnifiedLedger', () => {
  it('dry run reports what it would do but writes nothing', async () => {
    await insertLegacyGroupRegistration();
    const legacyCharge = await insertLegacyPrivateCharge();
    await insertLegacyCoachContract();

    const report = await migrateToUnifiedLedger({ dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.groupRowsToStamp).toBe(1);
    expect(report.privateChargesFound).toBe(1);
    expect(report.privateChargesCopied).toBe(1);
    expect(report.privateChargesAlreadyPresent).toBe(0);
    expect(report.coachContractsToBackfill).toBe(1);

    // Nothing written: the legacy group row still has no billingShape, the
    // charge was never copied, the old collection still exists.
    const rawGroupDoc = await mongoose.connection.db.collection('registrations').findOne({});
    expect(rawGroupDoc.billingShape).toBeUndefined();
    expect(await Registration.countDocuments({ billingShape: 'per_session' })).toBe(0);
    expect(await mongoose.connection.db.collection('privateclasscharges').findOne({ _id: legacyCharge._id })).not.toBeNull();
  });

  it('live run stamps group rows, copies private charges verbatim (preserving _id/PI id/attempt/paidAt/timestamps), backfills CoachContract, and drops the old collection', async () => {
    const legacyGroupDoc = await insertLegacyGroupRegistration();
    const legacyCharge = await insertLegacyPrivateCharge({ attempt: 2, stripePaymentIntentId: 'pi_test_456' });
    const legacyContract = await insertLegacyCoachContract();

    const report = await migrateToUnifiedLedger({ dryRun: false });

    expect(report.verified).toBe(true);
    expect(report.aborted).toBe(false);

    const stampedGroupDoc = await Registration.findById(legacyGroupDoc._id);
    expect(stampedGroupDoc.billingShape).toBe('subscription_cycle');
    const groupClassesService = await Service.findOne({ code: 'group-classes' });
    expect(String(stampedGroupDoc.serviceId)).toBe(String(groupClassesService._id));

    const copiedCharge = await Registration.findById(legacyCharge._id);
    expect(copiedCharge.billingShape).toBe('per_session');
    expect(copiedCharge.sessionId.toString()).toBe(legacyCharge.sessionId.toString());
    expect(copiedCharge.enrollmentId.toString()).toBe(legacyCharge.enrollmentId.toString());
    expect(copiedCharge.amount).toBe(50);
    expect(copiedCharge.status).toBe('completed');
    expect(copiedCharge.stripePaymentIntentId).toBe('pi_test_456');
    expect(copiedCharge.attempt).toBe(2);
    expect(copiedCharge.paidAt.toISOString()).toBe(legacyCharge.paidAt.toISOString());
    expect(copiedCharge.createdAt.toISOString()).toBe(legacyCharge.createdAt.toISOString());
    const privateLessonsService = await Service.findOne({ code: 'private-lessons' });
    expect(String(copiedCharge.serviceId)).toBe(String(privateLessonsService._id));

    const backfilledContract = await CoachContract.findById(legacyContract._id);
    expect(String(backfilledContract.serviceId)).toBe(String(privateLessonsService._id));

    const chargesCollectionStillExists = await mongoose.connection.db
      .listCollections({ name: 'privateclasscharges' })
      .hasNext();
    expect(chargesCollectionStillExists).toBe(false);
  });

  it('a failed charge status is preserved on copy (not silently upgraded/dropped)', async () => {
    await insertLegacyPrivateCharge({ status: 'failed', failureMessage: 'Card declined', stripePaymentIntentId: null });

    await migrateToUnifiedLedger({ dryRun: false });

    const copied = await Registration.findOne({ billingShape: 'per_session' });
    expect(copied.status).toBe('failed');
    expect(copied.failureMessage).toBe('Card declined');
    expect(copied.stripePaymentIntentId).toBeNull();
  });

  it('is idempotent: a second live run copies nothing new and reports everything already present/stamped', async () => {
    await insertLegacyGroupRegistration();
    await insertLegacyPrivateCharge();
    await insertLegacyCoachContract();

    await migrateToUnifiedLedger({ dryRun: false });

    // Re-seed a fresh legacy charge collection artifact is impossible (the
    // real collection was dropped) — the idempotency claim to prove here is
    // that re-running against the now-fully-migrated state is a safe no-op.
    const secondReport = await migrateToUnifiedLedger({ dryRun: false });

    expect(secondReport.groupRowsToStamp).toBe(0);
    expect(secondReport.privateChargesFound).toBe(0);
    expect(secondReport.coachContractsToBackfill).toBe(0);
    expect(secondReport.verified).toBe(true);
    expect(await Registration.countDocuments()).toBe(2); // the one group row + the one copied charge
  });

  it('handles an environment with zero private charges ever written (collection never materialized) without throwing on drop', async () => {
    await insertLegacyGroupRegistration();
    // No insertLegacyPrivateCharge() call — privateclasscharges never gets
    // created as a real collection in this test's DB.

    const report = await migrateToUnifiedLedger({ dryRun: false });

    expect(report.verified).toBe(true);
    expect(report.privateChargesFound).toBe(0);
  });

  it('aborts and drops nothing when a copy silently fails to land (verification catches what the copy step itself cannot)', async () => {
    const untouchedCharge = await insertLegacyPrivateCharge();
    const droppedCharge = await insertLegacyPrivateCharge({ status: 'completed' });

    // Fault injection: make exactly the SECOND insertOne into `registrations`
    // specifically (the copy write for droppedCharge) a silent no-op,
    // simulating a write that fails to actually land despite the copy loop
    // believing it succeeded — the one class of bug the post-copy
    // verification step exists to catch, which nothing about this script's
    // own control flow can otherwise produce (the copy loop always runs
    // immediately before verification in the same call, so a real "it
    // copied but verification still sees fewer rows" state can only arise
    // from an actual write failure like this one). Spied on the shared
    // driver prototype (not one `db.collection('registrations')` instance)
    // because the native driver returns a fresh instance per `.collection()`
    // call, and scoped by `this.collectionName` so seedServices()'s own
    // Service inserts (which happen first, inside the same migration call)
    // are never touched.
    const rawCollection = mongoose.connection.db.collection('registrations');
    const CollectionProto = Object.getPrototypeOf(rawCollection);
    const realInsertOne = CollectionProto.insertOne;
    let registrationsInsertCount = 0;
    jest.spyOn(CollectionProto, 'insertOne').mockImplementation(function fakeInsertOne(doc, ...rest) {
      if (this.collectionName !== 'registrations') {
        return realInsertOne.call(this, doc, ...rest);
      }
      registrationsInsertCount += 1;
      if (registrationsInsertCount === 2) {
        return Promise.resolve({ acknowledged: true, insertedId: doc._id }); // reports success, writes nothing
      }
      return realInsertOne.call(this, doc, ...rest);
    });

    const report = await migrateToUnifiedLedger({ dryRun: false });

    expect(report.aborted).toBe(true);
    expect(report.abortReason).toMatch(/Verification failed/);
    expect(report.verified).toBe(false);

    // Nothing dropped — the source collection must still exist with both
    // original charges intact.
    const chargesCollectionStillExists = await mongoose.connection.db
      .listCollections({ name: 'privateclasscharges' })
      .hasNext();
    expect(chargesCollectionStillExists).toBe(true);
    expect(await mongoose.connection.db.collection('privateclasscharges').countDocuments()).toBe(2);
    expect(await Registration.findById(untouchedCharge._id)).not.toBeNull();
    expect(await Registration.findById(droppedCharge._id)).toBeNull();
  });
});
