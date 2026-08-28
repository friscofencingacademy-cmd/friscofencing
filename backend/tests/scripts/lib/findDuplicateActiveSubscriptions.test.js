const mongoose = require('mongoose');

const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');
const Subscription = require('../../../src/models/subscription.model');

const { findDuplicateActiveSubscriptions } = require('../../../scripts/lib/findDuplicateActiveSubscriptions');

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
  // Force Mongoose to build the schema's indexes — the collection doesn't
  // exist yet on a fresh mongodb-memory-server instance, and .indexes()
  // errors on a nonexistent collection.
  await Subscription.init();

  // This diagnostic exists specifically to run against a LEGACY database —
  // one that predates docs/decisions/005-one-active-subscription-per-
  // student.md's tightened Guard A index — so its whole point is to find
  // duplicate active subscriptions that the index would now forbid.
  // Dropping the index here (once, before any test in this file) recreates
  // that legacy pre-migration condition so the fixtures below can actually
  // seed what this script is meant to detect; every other suite in this
  // repo keeps the real index intact.
  const indexes = await Subscription.collection.indexes();
  const guardA = indexes.find((index) => Object.keys(index.key).join(',') === 'studentId');

  if (guardA) {
    await Subscription.collection.dropIndex(guardA.name);
  }
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

afterEach(async () => {
  await clearTestDB();
});

function makeActiveSubscriptionDoc(overrides = {}) {
  return {
    studentId: new mongoose.Types.ObjectId(),
    scheduleId: new mongoose.Types.ObjectId(),
    parentId: new mongoose.Types.ObjectId(),
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodStart: new Date('2026-09-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
    nextBillingDate: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('scripts/lib/findDuplicateActiveSubscriptions', () => {
  it('reports nothing on a database with no duplicates', async () => {
    await Subscription.create(makeActiveSubscriptionDoc());
    await Subscription.create(makeActiveSubscriptionDoc());

    const { scannedCount, duplicates } = await findDuplicateActiveSubscriptions();

    expect(scannedCount).toBe(2);
    expect(duplicates).toHaveLength(0);
  });

  it('flags a student with 2+ active subscriptions across different schedules', async () => {
    const studentId = new mongoose.Types.ObjectId();
    const scheduleA = new mongoose.Types.ObjectId();
    const scheduleB = new mongoose.Types.ObjectId();

    const subA = await Subscription.create(makeActiveSubscriptionDoc({ studentId, scheduleId: scheduleA }));
    const subB = await Subscription.create(makeActiveSubscriptionDoc({ studentId, scheduleId: scheduleB }));
    // A clean, unrelated student — must not appear in the report.
    await Subscription.create(makeActiveSubscriptionDoc());

    const { scannedCount, duplicates } = await findDuplicateActiveSubscriptions();

    expect(scannedCount).toBe(3);
    expect(duplicates).toHaveLength(1);
    expect(String(duplicates[0].studentId)).toBe(String(studentId));
    expect(duplicates[0].count).toBe(2);
    expect(duplicates[0].subscriptionIds.map(String).sort()).toEqual(
      [String(subA._id), String(subB._id)].sort()
    );
  });

  it('never flags a student whose second subscription is cancelled — only ACTIVE ones count', async () => {
    const studentId = new mongoose.Types.ObjectId();

    await Subscription.create(makeActiveSubscriptionDoc({ studentId }));
    await Subscription.create(makeActiveSubscriptionDoc({ studentId, status: 'cancelled' }));

    const { duplicates } = await findDuplicateActiveSubscriptions();

    expect(duplicates).toHaveLength(0);
  });
});
