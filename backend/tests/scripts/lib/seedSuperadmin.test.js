const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');
const User = require('../../../src/models/user.model');
const { comparePassword } = require('../../../src/utils/password');

const { seedSuperadmin } = require('../../../scripts/lib/seedSuperadmin');

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

const FIELDS = { email: 'Super@Example.com', password: 'super-secret', firstName: 'Super', lastName: 'Admin' };

describe('scripts/lib/seedSuperadmin', () => {
  it('creates a superadmin with a lowercased email and a real password hash', async () => {
    const { superadmin, created } = await seedSuperadmin(FIELDS);

    expect(created).toBe(true);
    expect(superadmin.role).toBe('superadmin');
    expect(superadmin.email).toBe('super@example.com');
    expect(await comparePassword('super-secret', superadmin.passwordHash)).toBe(true);
  });

  it('is idempotent: a second call with the same email finds the existing one instead of duplicating', async () => {
    await seedSuperadmin(FIELDS);
    const { created } = await seedSuperadmin(FIELDS);

    expect(created).toBe(false);
    expect(await User.countDocuments({ role: 'superadmin' })).toBe(1);
  });
});
