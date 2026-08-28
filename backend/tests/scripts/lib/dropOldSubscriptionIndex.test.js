const { connectTestDB, disconnectTestDB } = require('../../testUtils/db');
const Subscription = require('../../../src/models/subscription.model');

const { dropOldSubscriptionIndex, OLD_INDEX_NAME } = require('../../../scripts/lib/dropOldSubscriptionIndex');

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
  // Force Mongoose to build the schema's real (new, {studentId} alone)
  // indexes before this file manipulates indexes directly.
  await Subscription.init();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

describe('scripts/lib/dropOldSubscriptionIndex', () => {
  it('reports the old index as absent (and does not error) on a database that only ever had the new Guard A index', async () => {
    const result = await dropOldSubscriptionIndex({ apply: false });

    expect(result).toEqual({ existed: false, dropped: false });
  });

  it('dry-run reports the old index as present without dropping it', async () => {
    await Subscription.collection.createIndex(
      { studentId: 1, scheduleId: 1 },
      { unique: true, partialFilterExpression: { status: 'active' }, name: OLD_INDEX_NAME }
    );

    try {
      const result = await dropOldSubscriptionIndex({ apply: false });

      expect(result).toEqual({ existed: true, dropped: false });

      const indexes = await Subscription.collection.indexes();
      expect(indexes.some((index) => index.name === OLD_INDEX_NAME)).toBe(true);
    } finally {
      // Clean up regardless of assertion outcome, so later tests in this
      // file (and any other suite reusing this same connection) see the
      // real schema-declared indexes only.
      const stillThere = await Subscription.collection.indexes();
      if (stillThere.some((index) => index.name === OLD_INDEX_NAME)) {
        await Subscription.collection.dropIndex(OLD_INDEX_NAME);
      }
    }
  });

  it('--live drops the old index when present', async () => {
    await Subscription.collection.createIndex(
      { studentId: 1, scheduleId: 1 },
      { unique: true, partialFilterExpression: { status: 'active' }, name: OLD_INDEX_NAME }
    );

    const result = await dropOldSubscriptionIndex({ apply: true });

    expect(result).toEqual({ existed: true, dropped: true });

    const indexes = await Subscription.collection.indexes();
    expect(indexes.some((index) => index.name === OLD_INDEX_NAME)).toBe(false);
  });

  it('--live is a no-op (not an error) when the old index is already absent', async () => {
    const result = await dropOldSubscriptionIndex({ apply: true });

    expect(result).toEqual({ existed: false, dropped: false });
  });
});
