process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

const request = require('supertest');
const mongoose = require('mongoose');

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
    role: 'admin',
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

describe('User routes', () => {
  describe('POST /api/v1/users (create)', () => {
    it('lets a superadmin create every role, including another superadmin', async () => {
      await seedUser({ role: 'superadmin', email: 'super@example.com' });
      const agent = await loginAgent('super@example.com');

      const parentRes = await agent.post('/api/v1/users').send({
        role: 'parent',
        firstName: 'Pat',
        lastName: 'Parent',
        email: 'pat-parent@example.com',
        password: 'password123',
      });
      expect(parentRes.status).toBe(201);
      const parentId = parentRes.body.user._id;

      const studentRes = await agent.post('/api/v1/users').send({
        role: 'student',
        firstName: 'Sam',
        lastName: 'Student',
        parentId,
      });
      expect(studentRes.status).toBe(201);

      const coachRes = await agent.post('/api/v1/users').send({
        role: 'coach',
        firstName: 'Cody',
        lastName: 'Coach',
        email: 'cody-coach@example.com',
        password: 'password123',
      });
      expect(coachRes.status).toBe(201);

      const adminRes = await agent.post('/api/v1/users').send({
        role: 'admin',
        firstName: 'Amy',
        lastName: 'Admin',
        email: 'amy-admin@example.com',
        password: 'password123',
      });
      expect(adminRes.status).toBe(201);

      const superadminRes = await agent.post('/api/v1/users').send({
        role: 'superadmin',
        firstName: 'Sue',
        lastName: 'Super',
        email: 'sue-super@example.com',
        password: 'password123',
      });
      expect(superadminRes.status).toBe(201);
    });

    it('returns 403 when an admin tries to create a superadmin', async () => {
      await seedUser({ email: 'admin@example.com' });
      const agent = await loginAgent('admin@example.com');

      const res = await agent.post('/api/v1/users').send({
        role: 'superadmin',
        firstName: 'Sue',
        lastName: 'Super',
        email: 'sue-super2@example.com',
        password: 'password123',
      });

      expect(res.status).toBe(403);
    });

    it('returns 400 when creating a student without a parentId', async () => {
      await seedUser({ email: 'admin2@example.com' });
      const agent = await loginAgent('admin2@example.com');

      const res = await agent.post('/api/v1/users').send({
        role: 'student',
        firstName: 'Sam',
        lastName: 'Student',
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when a student parentId points at a non-parent user', async () => {
      await seedUser({ email: 'admin3@example.com' });
      const coach = await seedUser({ role: 'coach', email: 'coach@example.com' });
      const agent = await loginAgent('admin3@example.com');

      const res = await agent.post('/api/v1/users').send({
        role: 'student',
        firstName: 'Sam',
        lastName: 'Student',
        parentId: coach._id.toString(),
      });

      expect(res.status).toBe(400);
    });

    it('returns 409 for a duplicate email', async () => {
      await seedUser({ email: 'admin4@example.com' });
      const agent = await loginAgent('admin4@example.com');

      await agent.post('/api/v1/users').send({
        role: 'parent',
        firstName: 'Pat',
        lastName: 'Parent',
        email: 'dupe@example.com',
        password: 'password123',
      });

      const res = await agent.post('/api/v1/users').send({
        role: 'coach',
        firstName: 'Cody',
        lastName: 'Coach',
        email: 'dupe@example.com',
        password: 'password123',
      });

      expect(res.status).toBe(409);
    });

    it('returns 400 when the password is under 8 characters', async () => {
      await seedUser({ email: 'admin5@example.com' });
      const agent = await loginAgent('admin5@example.com');

      const res = await agent.post('/api/v1/users').send({
        role: 'parent',
        firstName: 'Pat',
        lastName: 'Parent',
        email: 'shortpw@example.com',
        password: 'short',
      });

      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/v1/users/:id (update)', () => {
    it('updates profile fields and silently ignores role/password in the payload', async () => {
      await seedUser({ email: 'admin6@example.com' });
      const target = await seedUser({ role: 'coach', email: 'coach2@example.com' });
      const agent = await loginAgent('admin6@example.com');

      const res = await agent.put(`/api/v1/users/${target._id}`).send({
        firstName: 'Changed',
        lastName: 'Name',
        email: 'coach2-new@example.com',
        role: 'superadmin',
        password: 'shouldnotstick',
      });

      expect(res.status).toBe(200);
      expect(res.body.user.firstName).toBe('Changed');
      expect(res.body.user.email).toBe('coach2-new@example.com');

      const persisted = await User.findById(target._id);
      expect(persisted.role).toBe('coach');
      const matchesOldPassword = await require('../../src/utils/password').comparePassword(
        TEST_PASSWORD,
        persisted.passwordHash
      );
      expect(matchesOldPassword).toBe(true);
    });

    it('returns 403 when an admin edits a superadmin', async () => {
      await seedUser({ email: 'admin7@example.com' });
      const target = await seedUser({ role: 'superadmin', email: 'super7@example.com' });
      const agent = await loginAgent('admin7@example.com');

      const res = await agent
        .put(`/api/v1/users/${target._id}`)
        .send({ firstName: 'Hacked', lastName: 'Name' });

      expect(res.status).toBe(403);
    });

    it('returns 409 when the changed email collides with another user', async () => {
      await seedUser({ email: 'admin8@example.com' });
      await seedUser({ role: 'parent', email: 'taken@example.com' });
      const target = await seedUser({ role: 'coach', email: 'coach8@example.com' });
      const agent = await loginAgent('admin8@example.com');

      const res = await agent
        .put(`/api/v1/users/${target._id}`)
        .send({ firstName: 'Coach', lastName: 'Eight', email: 'taken@example.com' });

      expect(res.status).toBe(409);
    });
  });

  describe('PUT /api/v1/users/:id/password (updatePassword)', () => {
    it('changes the password so the new one logs in and the old one no longer does', async () => {
      await seedUser({ email: 'admin9@example.com' });
      const target = await seedUser({ role: 'parent', email: 'parent9@example.com' });
      const agent = await loginAgent('admin9@example.com');

      const res = await agent
        .put(`/api/v1/users/${target._id}/password`)
        .send({ password: 'brandnewpassword' });

      expect(res.status).toBe(200);

      const oldLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'parent9@example.com', password: TEST_PASSWORD });
      expect(oldLogin.status).toBe(401);

      const newLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'parent9@example.com', password: 'brandnewpassword' });
      expect(newLogin.status).toBe(200);
    });

    it('returns 400 for a password under 8 characters', async () => {
      await seedUser({ email: 'admin10@example.com' });
      const target = await seedUser({ role: 'parent', email: 'parent10@example.com' });
      const agent = await loginAgent('admin10@example.com');

      const res = await agent.put(`/api/v1/users/${target._id}/password`).send({ password: 'short' });

      expect(res.status).toBe(400);
    });

    it('returns 403 when an admin resets a superadmin password', async () => {
      await seedUser({ email: 'admin11@example.com' });
      const target = await seedUser({ role: 'superadmin', email: 'super11@example.com' });
      const agent = await loginAgent('admin11@example.com');

      const res = await agent
        .put(`/api/v1/users/${target._id}/password`)
        .send({ password: 'brandnewpassword' });

      expect(res.status).toBe(403);
    });

    it('returns 400 when resetting a student password (students have no login)', async () => {
      const admin = await seedUser({ email: 'admin12@example.com' });
      const parent = await seedUser({ role: 'parent', email: 'parent12@example.com' });
      const student = await User.create({ role: 'student', firstName: 'Kid', lastName: 'One', parentId: parent._id });
      const agent = await loginAgent('admin12@example.com');

      const res = await agent
        .put(`/api/v1/users/${student._id}/password`)
        .send({ password: 'brandnewpassword' });

      expect(res.status).toBe(400);
      // Sanity: admin account used above is untouched.
      expect(admin.role).toBe('admin');
    });
  });

  describe('DELETE /api/v1/users/:id (remove)', () => {
    it('deletes a childless parent, a coach with no schedules, and an admin (happy path)', async () => {
      await seedUser({ email: 'admin13@example.com' });
      const parent = await seedUser({ role: 'parent', email: 'parent13@example.com' });
      const coach = await seedUser({ role: 'coach', email: 'coach13@example.com' });
      const otherAdmin = await seedUser({ email: 'admin13b@example.com' });
      const agent = await loginAgent('admin13@example.com');

      expect((await agent.delete(`/api/v1/users/${parent._id}`)).status).toBe(200);
      expect((await agent.delete(`/api/v1/users/${coach._id}`)).status).toBe(200);
      expect((await agent.delete(`/api/v1/users/${otherAdmin._id}`)).status).toBe(200);
    });

    it('returns 400 when a user tries to delete their own account', async () => {
      const admin = await seedUser({ email: 'admin14@example.com' });
      const agent = await loginAgent('admin14@example.com');

      const res = await agent.delete(`/api/v1/users/${admin._id}`);

      expect(res.status).toBe(400);
    });

    it('returns 409 when deleting a parent with children', async () => {
      await seedUser({ email: 'admin15@example.com' });
      const parent = await seedUser({ role: 'parent', email: 'parent15@example.com' });
      await User.create({ role: 'student', firstName: 'Kid', lastName: 'One', parentId: parent._id });
      const agent = await loginAgent('admin15@example.com');

      const res = await agent.delete(`/api/v1/users/${parent._id}`);

      expect(res.status).toBe(409);
    });

    // Registration is a payment ledger now, not an enrollment record
    // (docs/plans/registration-ledger-plan.md D7) — deletion is guarded by
    // Subscription alone (see the next test). A student referenced only by
    // an orphaned ledger row, with no Subscription at all, is no longer
    // blocked — service-level coverage of this exact case (with an
    // assertion on the ledger row shape) lives in user.service.test.js.
    it('does NOT return 409 when deleting a student whose only reference is a Registration ledger row with no Subscription', async () => {
      const { SubscriptionCycleRegistration } = require('../../src/models/registration.model');
      const Service = require('../../src/models/service.model');
      const { seedServices } = require('../../scripts/lib/seedServices');
      await seedServices();
      const groupClassesService = await Service.findOne({ code: 'group-classes' });

      await seedUser({ email: 'admin16@example.com' });
      const parent = await seedUser({ role: 'parent', email: 'parent16@example.com' });
      const student = await User.create({ role: 'student', firstName: 'Kid', lastName: 'One', parentId: parent._id });
      await SubscriptionCycleRegistration.create({
        serviceId: groupClassesService._id,
        subscriptionId: new mongoose.Types.ObjectId(),
        studentId: student._id,
        scheduleId: new mongoose.Types.ObjectId(),
        parentId: parent._id,
        eventType: 'initial',
        status: 'completed',
        amount: 150,
        breakdown: { monthlyFee: 150 },
        periodStart: new Date('2026-01-01T00:00:00.000Z'),
        periodEnd: new Date('2026-02-01T00:00:00.000Z'),
      });
      const agent = await loginAgent('admin16@example.com');

      const res = await agent.delete(`/api/v1/users/${student._id}`);

      expect(res.status).toBe(200);
    });

    it('returns 409 when deleting a student referenced by a Subscription', async () => {
      const Subscription = require('../../src/models/subscription.model');
      await seedUser({ email: 'admin17@example.com' });
      const parent = await seedUser({ role: 'parent', email: 'parent17@example.com' });
      const student = await User.create({ role: 'student', firstName: 'Kid', lastName: 'One', parentId: parent._id });
      await Subscription.create({
        studentId: student._id,
        scheduleId: new mongoose.Types.ObjectId(),
        parentId: parent._id,
        currentPeriodStart: new Date('2020-01-01'),
        currentPeriodEnd: new Date('2020-02-01'),
        nextBillingDate: new Date('2020-02-01'),
      });
      const agent = await loginAgent('admin17@example.com');

      const res = await agent.delete(`/api/v1/users/${student._id}`);

      expect(res.status).toBe(409);
    });

    it('returns 409 when deleting a student referenced by a TrialClass', async () => {
      const TrialClass = require('../../src/models/trialClass.model');
      await seedUser({ email: 'admin18@example.com' });
      const parent = await seedUser({ role: 'parent', email: 'parent18@example.com' });
      const student = await User.create({ role: 'student', firstName: 'Kid', lastName: 'One', parentId: parent._id });
      await TrialClass.create({ studentId: student._id, sessionId: new mongoose.Types.ObjectId() });
      const agent = await loginAgent('admin18@example.com');

      const res = await agent.delete(`/api/v1/users/${student._id}`);

      expect(res.status).toBe(409);
    });

    it('returns 409 when deleting a coach referenced by a GroupClassSchedule', async () => {
      const GroupClassSchedule = require('../../src/models/groupClassSchedule.model');
      await seedUser({ email: 'admin19@example.com' });
      const coach = await seedUser({ role: 'coach', email: 'coach19@example.com' });
      await GroupClassSchedule.create({
        classId: new mongoose.Types.ObjectId(),
        coachId: coach._id,
        dayOfWeek: 1,
        startTime: '16:00',
        endTime: '17:00',
      });
      const agent = await loginAgent('admin19@example.com');

      const res = await agent.delete(`/api/v1/users/${coach._id}`);

      expect(res.status).toBe(409);
    });

    it('returns 403 when an admin deletes a superadmin', async () => {
      await seedUser({ email: 'admin20@example.com' });
      const target = await seedUser({ role: 'superadmin', email: 'super20@example.com' });
      const agent = await loginAgent('admin20@example.com');

      const res = await agent.delete(`/api/v1/users/${target._id}`);

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/users (list)', () => {
    it('returns 403 when an admin filters by ?role=superadmin', async () => {
      await seedUser({ email: 'admin21@example.com' });
      const agent = await loginAgent('admin21@example.com');

      const res = await agent.get('/api/v1/users').query({ role: 'superadmin' });

      expect(res.status).toBe(403);
    });

    it("never includes a superadmin row in an admin's unfiltered list", async () => {
      await seedUser({ email: 'admin22@example.com' });
      await seedUser({ role: 'superadmin', email: 'super22@example.com' });
      const agent = await loginAgent('admin22@example.com');

      const res = await agent.get('/api/v1/users');

      expect(res.status).toBe(200);
      expect(res.body.users.some((u) => u.role === 'superadmin')).toBe(false);
    });

    it("includes a superadmin row in a superadmin's unfiltered list", async () => {
      await seedUser({ role: 'superadmin', email: 'super23@example.com' });
      const agent = await loginAgent('super23@example.com');

      const res = await agent.get('/api/v1/users');

      expect(res.status).toBe(200);
      expect(res.body.users.some((u) => u.role === 'superadmin')).toBe(true);
    });
  });
});
