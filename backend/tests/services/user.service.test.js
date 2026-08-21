const mongoose = require('mongoose');

const User = require('../../src/models/user.model');
const userService = require('../../src/services/user.service');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');

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

async function createParent(overrides = {}) {
  return User.create({
    role: 'parent',
    firstName: 'Pat',
    lastName: 'Parent',
    email: `parent-${new mongoose.Types.ObjectId()}@example.com`,
    passwordHash: 'irrelevant-hash',
    ...overrides,
  });
}

describe('user.service', () => {
  describe('create', () => {
    it('ignores a submitted password for a student and never sets a passwordHash', async () => {
      const parent = await createParent();

      const student = await userService.create(
        { role: 'student', firstName: 'Kid', lastName: 'One', parentId: parent._id.toString(), password: 'ignored-password' },
        'admin'
      );

      const persisted = await User.findById(student._id);
      expect(persisted.passwordHash).toBeUndefined();
    });

    it('returns safe JSON with no passwordHash for a login-capable role', async () => {
      const user = await userService.create(
        { role: 'coach', firstName: 'Cody', lastName: 'Coach', email: 'cody@example.com', password: 'password123' },
        'admin'
      );

      expect(user.passwordHash).toBeUndefined();
    });

    it('rejects an invalid role with 400', async () => {
      await expect(
        userService.create({ role: 'wizard', firstName: 'A', lastName: 'B' }, 'superadmin')
      ).rejects.toMatchObject({ status: 400 });
    });

    it('returns 404 when a student parentId does not exist at all', async () => {
      await expect(
        userService.create(
          { role: 'student', firstName: 'Kid', lastName: 'One', parentId: new mongoose.Types.ObjectId().toString() },
          'admin'
        )
      ).rejects.toMatchObject({ status: 404 });
    });

    it('lets a superadmin requester create a superadmin', async () => {
      const user = await userService.create(
        { role: 'superadmin', firstName: 'Sue', lastName: 'Super', email: 'sue@example.com', password: 'password123' },
        'superadmin'
      );

      expect(user.role).toBe('superadmin');
    });
  });

  describe('update', () => {
    it('drops role, password, and parentId from the payload even for a login-capable role', async () => {
      const parent = await createParent({ email: 'parent-update@example.com' });

      await userService.update(
        parent._id,
        { firstName: 'Changed', lastName: 'Parent', email: 'parent-update-new@example.com', role: 'superadmin', password: 'new-password', parentId: new mongoose.Types.ObjectId().toString() },
        'admin'
      );

      const persisted = await User.findById(parent._id);
      expect(persisted.role).toBe('parent');
      expect(persisted.passwordHash).toBe('irrelevant-hash');
      expect(persisted.email).toBe('parent-update-new@example.com');
    });

    it('does not change email for a student even if one is submitted', async () => {
      const parent = await createParent({ email: 'parent-for-student-update@example.com' });
      const student = await User.create({ role: 'student', firstName: 'Kid', lastName: 'One', parentId: parent._id });

      await userService.update(student._id, { firstName: 'Kiddo', lastName: 'One', email: 'sneaky@example.com' }, 'admin');

      const persisted = await User.findById(student._id);
      expect(persisted.firstName).toBe('Kiddo');
      expect(persisted.email).toBeUndefined();
    });

    it('returns 404 for a nonexistent user', async () => {
      await expect(
        userService.update(new mongoose.Types.ObjectId(), { firstName: 'A', lastName: 'B' }, 'admin')
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('remove', () => {
    it('includes the exact blocking count in the 409 message for a parent with two children', async () => {
      const parent = await createParent({ email: 'parent-two-kids@example.com' });
      await User.create({ role: 'student', firstName: 'Kid', lastName: 'One', parentId: parent._id });
      await User.create({ role: 'student', firstName: 'Kid', lastName: 'Two', parentId: parent._id });

      await expect(
        userService.remove(parent._id, 'admin', new mongoose.Types.ObjectId())
      ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('2 child account(s)') });
    });

    it('does not apply any entity guard when deleting an admin or superadmin', async () => {
      const admin = await User.create({ role: 'admin', firstName: 'A', lastName: 'B', email: 'plain-admin@example.com' });

      await userService.remove(admin._id, 'admin', new mongoose.Types.ObjectId());

      expect(await User.findById(admin._id)).toBeNull();
    });

    it('blocks self-delete even when the id and requesterId are passed as different types (string vs ObjectId)', async () => {
      const admin = await User.create({ role: 'admin', firstName: 'A', lastName: 'B', email: 'self-delete@example.com' });

      await expect(
        userService.remove(admin._id.toString(), 'admin', admin._id)
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('list', () => {
    it('passes an explicit single-role filter through unchanged for a non-superadmin', async () => {
      await User.create({ role: 'coach', firstName: 'Cody', lastName: 'Coach', email: 'coach-list@example.com' });
      await User.create({ role: 'parent', firstName: 'Pat', lastName: 'Parent', email: 'parent-list@example.com' });

      const results = await userService.list({ role: 'coach' }, 'admin');

      expect(results).toHaveLength(1);
      expect(results[0].role).toBe('coach');
    });
  });
});
