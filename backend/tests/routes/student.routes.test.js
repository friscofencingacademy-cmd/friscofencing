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

    // docs/plans/trial-registration-required-fields-plan.md §1.3/§1.5. No
    // frozen clock here — jest.useFakeTimers() reliably hangs this suite's
    // real supertest+MongoDB stack (confirmed while building this test, not
    // assumed; same class of issue TESTING_STRATEGY.md's E2E date rules
    // already warn about for a different layer). Instead: a birthdate built
    // from LOCAL calendar components (never toISOString(), which can shift
    // the calendar day across a UTC/local boundary) and pushed 30 days
    // further into the past than "today minus 8 years" — far enough that
    // this year's birthday has unambiguously already passed regardless of
    // exactly which timezone the test happens to run in, so the expected
    // age is deterministic without needing to freeze anything.
    it('stores dateOfBirth and returns a computed age when provided', async () => {
      await seedUser({ role: 'parent', email: 'parent-dob@example.com' });
      const parentAgent = await loginAgent('parent-dob@example.com');

      const birthday = new Date();
      birthday.setDate(birthday.getDate() - 30);
      birthday.setFullYear(birthday.getFullYear() - 8);
      const dateOfBirth = `${birthday.getFullYear()}-${String(birthday.getMonth() + 1).padStart(2, '0')}-${String(birthday.getDate()).padStart(2, '0')}`;

      const res = await parentAgent.post('/api/v1/students').send({
        firstName: 'Kid',
        lastName: 'WithBirthday',
        skillLevel: 'beginner',
        dateOfBirth,
      });

      expect(res.status).toBe(201);
      expect(res.body.student.age).toBe(8);

      const created = await User.findById(res.body.student._id);
      expect(created.dateOfBirth.toISOString().slice(0, 10)).toBe(dateOfBirth);
    });

    // Not hard-required at this shared service layer (admin's own dialog may
    // not always have a birthdate in hand) — creation still succeeds, and
    // age is null rather than 0 or a guess.
    it('still succeeds without dateOfBirth — age comes back null, not 0 or a guess', async () => {
      await seedUser({ role: 'parent', email: 'parent-no-dob@example.com' });
      const parentAgent = await loginAgent('parent-no-dob@example.com');

      const res = await parentAgent.post('/api/v1/students').send({
        firstName: 'Kid',
        lastName: 'NoBirthday',
        skillLevel: 'beginner',
      });

      expect(res.status).toBe(201);
      expect(res.body.student.age).toBeNull();
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

    it("includes each child's computed age alongside their stored dateOfBirth", async () => {
      const parent = await seedUser({ role: 'parent', email: 'parent5@example.com' });

      // Same "30 days + 8 years further into the past" technique as the
      // create test above — this year's birthday has unambiguously already
      // passed, so age is deterministic without freezing the clock (see
      // that test's comment for why fake timers aren't used here).
      const birthday = new Date();
      birthday.setDate(birthday.getDate() - 30);
      birthday.setFullYear(birthday.getFullYear() - 8);

      await User.create({
        role: 'student',
        firstName: 'Birthday',
        lastName: 'Kid',
        parentId: parent._id,
        dateOfBirth: birthday,
      });

      const parentAgent = await loginAgent('parent5@example.com');

      const res = await parentAgent.get('/api/v1/students/mine');

      expect(res.status).toBe(200);
      expect(res.body.students[0].age).toBe(8);
    });

    // Shape-only assertion — the enrollment status/canBookTrial DECISION
    // logic (including its Central-tz "today" boundary) is covered by
    // tests/services/student.service.test.js's own suite. Fake timers are
    // deliberately NOT used in this file (see this describe block's
    // comment above the dateOfBirth tests) — a plain not_enrolled fixture
    // needs no clock at all, so this test doesn't need one either.
    it("includes an enrollment object on every child, per docs/plans/frontend-polish-plan.md PR 3 (source-of-truth audit finding B1)", async () => {
      const parent = await seedUser({ role: 'parent', email: 'parent6@example.com' });
      await User.create({ role: 'student', firstName: 'NoEnrollment', lastName: 'Kid', parentId: parent._id });

      const parentAgent = await loginAgent('parent6@example.com');

      const res = await parentAgent.get('/api/v1/students/mine');

      expect(res.status).toBe(200);
      expect(res.body.students[0].enrollment).toEqual({
        status: 'not_enrolled',
        canBookTrial: true,
        schedule: null,
      });
    });
  });
});
