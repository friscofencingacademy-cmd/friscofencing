process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

const request = require('supertest');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const Setting = require('../../src/models/setting.model');
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

describe('Setting routes', () => {
  describe('GET /api/v1/settings', () => {
    it('returns the defaults when no Setting doc has ever been saved', async () => {
      await seedUser({ role: 'superadmin', email: 'setting-super1@example.com' });
      const superAgent = await loginAgent('setting-super1@example.com');

      const res = await superAgent.get('/api/v1/settings');

      expect(res.status).toBe(200);
      expect(res.body.settings).toEqual({
        registrationFee: 0,
        returningStudentGracePeriodMonths: 0,
      });
    });

    it('returns the saved values once a Setting doc exists', async () => {
      await Setting.create({ registrationFee: 25, returningStudentGracePeriodMonths: 6 });
      await seedUser({ role: 'superadmin', email: 'setting-super2@example.com' });
      const superAgent = await loginAgent('setting-super2@example.com');

      const res = await superAgent.get('/api/v1/settings');

      expect(res.status).toBe(200);
      expect(res.body.settings).toEqual({
        registrationFee: 25,
        returningStudentGracePeriodMonths: 6,
      });
    });

    it('returns 403 for a non-superadmin (admin, coach, parent)', async () => {
      await seedUser({ role: 'admin', email: 'setting-admin@example.com' });
      await seedUser({ role: 'coach', email: 'setting-coach@example.com' });
      await seedUser({ role: 'parent', email: 'setting-parent@example.com' });

      for (const email of ['setting-admin@example.com', 'setting-coach@example.com', 'setting-parent@example.com']) {
        const agent = await loginAgent(email);
        const res = await agent.get('/api/v1/settings');
        expect(res.status).toBe(403);
      }
    });
  });

  describe('PATCH /api/v1/settings', () => {
    it('upserts on the first save (no prior Setting doc)', async () => {
      await seedUser({ role: 'superadmin', email: 'setting-super3@example.com' });
      const superAgent = await loginAgent('setting-super3@example.com');

      const res = await superAgent
        .patch('/api/v1/settings')
        .send({ registrationFee: 25, returningStudentGracePeriodMonths: 6 });

      expect(res.status).toBe(200);
      expect(res.body.settings).toEqual({
        registrationFee: 25,
        returningStudentGracePeriodMonths: 6,
      });
      expect(await Setting.countDocuments()).toBe(1);
    });

    it('a partial update touches only the field sent, never resetting the others', async () => {
      await Setting.create({ registrationFee: 25, returningStudentGracePeriodMonths: 6 });
      await seedUser({ role: 'superadmin', email: 'setting-super4@example.com' });
      const superAgent = await loginAgent('setting-super4@example.com');

      const res = await superAgent.patch('/api/v1/settings').send({ registrationFee: 40 });

      expect(res.status).toBe(200);
      expect(res.body.settings).toEqual({
        registrationFee: 40,
        returningStudentGracePeriodMonths: 6,
      });
    });

    it('returns 400 for a negative registrationFee, without writing anything', async () => {
      await seedUser({ role: 'superadmin', email: 'setting-super5@example.com' });
      const superAgent = await loginAgent('setting-super5@example.com');

      const res = await superAgent.patch('/api/v1/settings').send({ registrationFee: -5 });

      expect(res.status).toBe(400);
      expect(await Setting.countDocuments()).toBe(0);
    });

    it('returns 400 for a negative returningStudentGracePeriodMonths', async () => {
      await seedUser({ role: 'superadmin', email: 'setting-super6@example.com' });
      const superAgent = await loginAgent('setting-super6@example.com');

      const res = await superAgent.patch('/api/v1/settings').send({ returningStudentGracePeriodMonths: -1 });

      expect(res.status).toBe(400);
    });

    it('returns 403 for a non-superadmin', async () => {
      await seedUser({ role: 'admin', email: 'setting-admin2@example.com' });
      const agent = await loginAgent('setting-admin2@example.com');

      const res = await agent.patch('/api/v1/settings').send({ registrationFee: 25 });

      expect(res.status).toBe(403);
      expect(await Setting.countDocuments()).toBe(0);
    });
  });
});
