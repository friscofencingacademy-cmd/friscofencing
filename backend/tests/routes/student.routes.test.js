process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

const request = require('supertest');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const { hashPassword } = require('../../src/utils/password');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');

const TEST_PASSWORD = 'correct-password';

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

async function seedUser(overrides = {}) {
  const passwordHash = await hashPassword(TEST_PASSWORD);

  return User.create({
    firstName: 'Test',
    lastName: 'User',
    passwordHash,
    ...overrides,
  });
}

async function loginAgent(email) {
  const agent = request.agent(app);

  await agent.post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD });

  return agent;
}

describe('Student routes', () => {
  describe('POST /api/v1/students', () => {
    it('forces parentId to the requesting parent, even if a different parentId is passed in the body', async () => {
      const parent = await seedUser({ role: 'parent', email: 'parent@example.com' });
      const otherParent = await seedUser({ role: 'parent', email: 'other-parent@example.com' });
      const parentAgent = await loginAgent('parent@example.com');

      const res = await parentAgent.post('/api/v1/students').send({
        firstName: 'Kid',
        lastName: 'One',
        skillLevel: 'beginner',
        parentId: otherParent._id.toString(),
      });

      expect(res.status).toBe(201);

      // Assert the actual persisted parentId in the DB, not just the
      // response body — this is the security-relevant assertion.
      const created = await User.findById(res.body.student._id);
      expect(String(created.parentId)).toBe(String(parent._id));
      expect(String(created.parentId)).not.toBe(String(otherParent._id));
    });

    it('lets an admin create a child with an explicit valid parentId', async () => {
      await seedUser({ role: 'admin', email: 'admin@example.com' });
      const parent = await seedUser({ role: 'parent', email: 'parent2@example.com' });
      const adminAgent = await loginAgent('admin@example.com');

      const res = await adminAgent.post('/api/v1/students').send({
        firstName: 'Kid',
        lastName: 'Two',
        skillLevel: 'intermediate',
        parentId: parent._id.toString(),
      });

      expect(res.status).toBe(201);
      expect(res.body.student.parentId).toBe(parent._id.toString());
    });

    it('returns 400 when an admin passes a parentId that is not a parent-role user', async () => {
      await seedUser({ role: 'admin', email: 'admin2@example.com' });
      const coach = await seedUser({ role: 'coach', email: 'coach@example.com' });
      const adminAgent = await loginAgent('admin2@example.com');

      const res = await adminAgent.post('/api/v1/students').send({
        firstName: 'Kid',
        lastName: 'Three',
        skillLevel: 'beginner',
        parentId: coach._id.toString(),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/students/mine', () => {
    it("returns only the requesting parent's own children, not another parent's", async () => {
      const parent = await seedUser({ role: 'parent', email: 'parent3@example.com' });
      const otherParent = await seedUser({ role: 'parent', email: 'parent4@example.com' });

      await User.create({ role: 'student', firstName: 'Mine', lastName: 'Kid', parentId: parent._id });
      await User.create({
        role: 'student',
        firstName: 'Theirs',
        lastName: 'Kid',
        parentId: otherParent._id,
      });

      const parentAgent = await loginAgent('parent3@example.com');

      const res = await parentAgent.get('/api/v1/students/mine');

      expect(res.status).toBe(200);
      expect(res.body.students).toHaveLength(1);
      expect(res.body.students[0].firstName).toBe('Mine');
    });
  });
});
