const mongoose = require('mongoose');

const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');
const User = require('../../../src/models/user.model');
const Level = require('../../../src/models/level.model');

const { wipeDatabase } = require('../../../scripts/lib/wipeDatabase');

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

describe('scripts/lib/wipeDatabase', () => {
  it('deletes every document across every collection, including a superadmin', async () => {
    await User.create({ role: 'superadmin', firstName: 'Super', lastName: 'Admin', email: 'super@test.local' });
    await User.create({ role: 'parent', firstName: 'Some', lastName: 'Parent', email: 'parent@test.local' });
    await Level.create({ name: 'Test Level', order: 1 });

    expect(await User.countDocuments({})).toBe(2);
    expect(await Level.countDocuments({})).toBe(1);

    await wipeDatabase();

    expect(await User.countDocuments({})).toBe(0);
    expect(await Level.countDocuments({})).toBe(0);
  });

  it('returns a per-collection deleted count', async () => {
    await User.create({ role: 'parent', firstName: 'A', lastName: 'B', email: 'a@test.local' });

    const results = await wipeDatabase();

    expect(results.users).toBe(1);
  });

  it('is a no-op (not an error) on an already-empty database', async () => {
    await expect(wipeDatabase()).resolves.toBeDefined();
    expect(await User.countDocuments({})).toBe(0);
  });

  // docs/plans/booking-and-private-class-fixes-plan.md §3 — the real
  // staging bug: mongoose.connection.collections only contains an entry for
  // a model this PROCESS has require()d, which is not the same set as
  // "every collection actually in the database." Reproduced here by
  // inserting through the raw MongoDB driver into a collection name whose
  // Mongoose model is deliberately never required anywhere in this test
  // file (or its import chain) — 'privateclassschedules' stands in for the
  // real incident's PrivateClassSchedule/PrivateClassSession collections,
  // which refresh-staging-data.js's own require graph never loads.
  describe('unregistered-collection regression (booking-and-private-class-fixes plan §3)', () => {
    it('wipes a collection whose model was never require()d in this process, not just registered-model collections', async () => {
      await User.create({ role: 'parent', firstName: 'Some', lastName: 'Parent', email: 'parent2@test.local' });
      await mongoose.connection.db
        .collection('privateclassschedules')
        .insertOne({ coachId: new mongoose.Types.ObjectId(), dayOfWeek: 2, startTime: '16:00' });

      expect(await mongoose.connection.db.collection('privateclassschedules').countDocuments({})).toBe(1);

      const results = await wipeDatabase();

      expect(await User.countDocuments({})).toBe(0);
      expect(await mongoose.connection.db.collection('privateclassschedules').countDocuments({})).toBe(0);
      expect(results.users).toBe(1);
      expect(results.privateclassschedules).toBe(1);
    });
  });
});
