const User = require('../../../src/models/user.model');
const { hashPassword, comparePassword } = require('../../../src/utils/password');
const {
  setStagingTestPasswords,
  STAGING_TEST_PASSWORD,
} = require('../../../scripts/lib/setStagingTestPasswords');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');

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

describe('setStagingTestPasswords', () => {
  it('sets every login-capable role (parent/coach/admin/superadmin) to the same known password', async () => {
    const parent = await User.create({ role: 'parent', firstName: 'Pat', lastName: 'Rivera', email: 'parent@example.com' });
    const coach = await User.create({
      role: 'coach',
      firstName: 'Dana',
      lastName: 'Coach',
      email: 'coach@example.com',
      passwordHash: await hashPassword('ChangeMe-Original!'),
    });
    const admin = await User.create({ role: 'admin', firstName: 'A', lastName: 'B', email: 'admin@example.com' });
    const superadmin = await User.create({
      role: 'superadmin',
      firstName: 'Super',
      lastName: 'Admin',
      email: 'superadmin@example.com',
      passwordHash: await hashPassword('some-other-password'),
    });

    const result = await setStagingTestPasswords();

    expect(result.usersUpdated).toBe(4);
    expect(result.password).toBe(STAGING_TEST_PASSWORD);
    expect(STAGING_TEST_PASSWORD).toBe('Test@123');

    for (const user of [parent, coach, admin, superadmin]) {
      // eslint-disable-next-line no-await-in-loop -- test assertions, small fixed set
      const updated = await User.findById(user._id);
      // eslint-disable-next-line no-await-in-loop
      expect(await comparePassword('Test@123', updated.passwordHash)).toBe(true);
    }
  });

  it('never touches a student — students have no login-capable role', async () => {
    const parent = await User.create({ role: 'parent', firstName: 'Pat', lastName: 'Rivera', email: 'parent2@example.com' });
    const student = await User.create({ role: 'student', firstName: 'Kid', lastName: 'Rivera', parentId: parent._id });

    await setStagingTestPasswords();

    const updatedStudent = await User.findById(student._id);
    expect(updatedStudent.passwordHash).toBeUndefined();
  });

  it('overwrites even a parent with no pre-existing password at all — the exact migrated-parent case', async () => {
    // Mirrors runLegacyImport.js's own findOrCreateParent: no passwordHash
    // at all until this step runs.
    const migratedParent = await User.create({
      role: 'parent',
      firstName: 'Migrated',
      lastName: 'Family',
      legacyPin: '1234',
    });

    await setStagingTestPasswords();

    const updated = await User.findById(migratedParent._id);
    expect(await comparePassword('Test@123', updated.passwordHash)).toBe(true);
  });
});
