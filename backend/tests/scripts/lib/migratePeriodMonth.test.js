const mongoose = require('mongoose');

const { SubscriptionCycleRegistration } = require('../../../src/models/registration.model');
const { migratePeriodMonth, OLD_INDEX_NAME, NEW_INDEX_NAME } = require('../../../scripts/lib/migratePeriodMonth');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

// Each test starts from the REAL pre-migration index shape — the OLD
// (subscriptionId, periodStart) unique index, no (subscriptionId,
// periodMonth) index yet — rather than whatever Mongoose's autoIndex would
// otherwise build straight from the current schema (which already declares
// the NEW index only, since that's the shipped schema). Without this, a
// raw two-row insert missing periodMonth would collide against the NEW
// index before migratePeriodMonth ever runs, testing the wrong thing.
beforeEach(async () => {
  // The very first test in this file runs before the `registrations`
  // collection exists at all (no document has ever been inserted yet) —
  // .indexes() throws "ns does not exist" in that case, same as "no
  // indexes to worry about yet".
  let indexes = [];

  try {
    indexes = await SubscriptionCycleRegistration.collection.indexes();
  } catch (error) {
    if (!/ns does not exist/.test(error.message)) {
      throw error;
    }
  }

  if (indexes.some((index) => index.name === NEW_INDEX_NAME)) {
    await SubscriptionCycleRegistration.collection.dropIndex(NEW_INDEX_NAME);
  }

  if (!indexes.some((index) => index.name === OLD_INDEX_NAME)) {
    await SubscriptionCycleRegistration.collection.createIndex(
      { subscriptionId: 1, periodStart: 1 },
      {
        name: OLD_INDEX_NAME,
        unique: true,
        partialFilterExpression: {
          status: { $in: ['pending', 'completed'] },
          subscriptionId: { $exists: true },
        },
      }
    );
  }
});

afterEach(async () => {
  await clearTestDB();
});

function baseRow(overrides = {}) {
  return {
    serviceId: new mongoose.Types.ObjectId(),
    studentId: new mongoose.Types.ObjectId(),
    parentId: new mongoose.Types.ObjectId(),
    subscriptionId: new mongoose.Types.ObjectId(),
    scheduleId: new mongoose.Types.ObjectId(),
    eventType: 'renewal',
    status: 'completed',
    amount: 100,
    breakdown: { monthlyFee: 100 },
    periodStart: new Date('2026-02-01T00:00:00.000Z'),
    periodEnd: new Date('2026-03-01T00:00:00.000Z'),
    ...overrides,
  };
}

// Bypasses the schema's own pre-validate hook (insertMany with
// `validateBeforeSave: false` in Mongoose still runs hooks by default, so
// go straight to the driver) — simulates a row written before periodMonth
// existed, which is exactly what this migration exists to backfill.
async function insertRowWithoutPeriodMonth(overrides = {}) {
  const doc = {
    _id: new mongoose.Types.ObjectId(),
    billingShape: 'subscription_cycle',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...baseRow(overrides),
  };

  delete doc.periodMonth;
  await mongoose.connection.collection('registrations').insertOne(doc);

  return doc;
}

describe('migratePeriodMonth', () => {
  it('dry run: reports the would-be changes and writes nothing', async () => {
    await insertRowWithoutPeriodMonth({ periodStart: new Date('2026-02-05T00:00:00.000Z') });

    const report = await migratePeriodMonth({ apply: false });

    expect(report.aborted).toBe(false);
    expect(report.scannedCount).toBe(1);
    expect(report.changeCount).toBe(1);
    expect(report.changes[0].oldPeriodMonth).toBeNull();
    expect(report.changes[0].newPeriodMonth).toBe('2026-02');
    expect(report.indexSwapped).toBe(false);

    // Nothing written — the row in the DB still has no periodMonth.
    const raw = await mongoose.connection.collection('registrations').findOne({});
    expect(raw.periodMonth).toBeUndefined();
  });

  it('live run: backfills periodMonth on every row and swaps the index', async () => {
    await insertRowWithoutPeriodMonth({ periodStart: new Date('2026-02-05T00:00:00.000Z') });
    await insertRowWithoutPeriodMonth({
      subscriptionId: new mongoose.Types.ObjectId(),
      periodStart: new Date('2026-03-10T00:00:00.000Z'),
    });

    const report = await migratePeriodMonth({ apply: true });

    expect(report.aborted).toBe(false);
    expect(report.changeCount).toBe(2);
    expect(report.indexSwapped).toBe(true);

    const rows = await SubscriptionCycleRegistration.find({}).sort({ periodStart: 1 });
    expect(rows[0].periodMonth).toBe('2026-02');
    expect(rows[1].periodMonth).toBe('2026-03');

    const indexes = await SubscriptionCycleRegistration.collection.indexes();
    expect(indexes.some((index) => index.name === NEW_INDEX_NAME)).toBe(true);
    expect(indexes.some((index) => index.name === OLD_INDEX_NAME)).toBe(false);
  });

  it('is safe to re-run after a live run — no further changes, still reports success', async () => {
    await insertRowWithoutPeriodMonth({ periodStart: new Date('2026-02-05T00:00:00.000Z') });

    await migratePeriodMonth({ apply: true });
    const secondReport = await migratePeriodMonth({ apply: true });

    expect(secondReport.aborted).toBe(false);
    expect(secondReport.changeCount).toBe(0);
  });

  it(
    'aborts with NO writes and the OLD index left in place when two pending/completed rows for the ' +
      'same subscription would land in the same periodMonth bucket',
    async () => {
      const subscriptionId = new mongoose.Types.ObjectId();

      await insertRowWithoutPeriodMonth({
        subscriptionId,
        status: 'completed',
        periodStart: new Date('2026-02-01T00:00:00.000Z'),
      });
      // Simulates data that predates Guard B's own re-key protection — two
      // rows for the same subscription, same month, different days.
      await insertRowWithoutPeriodMonth({
        subscriptionId,
        status: 'pending',
        periodStart: new Date('2026-02-15T00:00:00.000Z'),
      });

      const report = await migratePeriodMonth({ apply: true });

      expect(report.aborted).toBe(true);
      expect(report.collisions).toHaveLength(1);
      expect(report.collisions[0].periodMonth).toBe('2026-02');
      expect(report.indexSwapped).toBe(false);

      // Nothing written — both rows still lack periodMonth.
      const rawRows = await mongoose.connection.collection('registrations').find({}).toArray();
      expect(rawRows.every((row) => row.periodMonth === undefined)).toBe(true);
    }
  );

  it('a "failed" row never collides with a pending/completed row for the same month', async () => {
    const subscriptionId = new mongoose.Types.ObjectId();

    await insertRowWithoutPeriodMonth({
      subscriptionId,
      status: 'failed',
      periodStart: new Date('2026-02-01T00:00:00.000Z'),
    });
    await insertRowWithoutPeriodMonth({
      subscriptionId,
      status: 'completed',
      periodStart: new Date('2026-02-20T00:00:00.000Z'),
    });

    const report = await migratePeriodMonth({ apply: true });

    expect(report.aborted).toBe(false);
    expect(report.indexSwapped).toBe(true);
  });
});
