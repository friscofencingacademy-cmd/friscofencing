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
});
