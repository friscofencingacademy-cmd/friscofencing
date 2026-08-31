process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

const request = require('supertest');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const Holiday = require('../../src/models/holiday.model');
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

describe('Holiday routes', () => {
  describe('role gate — every route', () => {
    it('returns 401 for every route with no auth at all', async () => {
      const holiday = await Holiday.create({
        name: 'Winter Break',
        startDate: new Date('2026-12-24'),
        endDate: new Date('2026-12-26'),
      });

      expect((await request(app).get('/api/v1/holidays')).status).toBe(401);
      expect((await request(app).get(`/api/v1/holidays/${holiday._id}`)).status).toBe(401);
      expect(
        (await request(app).post('/api/v1/holidays').send({ name: 'X', startDate: '2026-01-01', endDate: '2026-01-01' }))
          .status
      ).toBe(401);
      expect((await request(app).put(`/api/v1/holidays/${holiday._id}`).send({ name: 'Y' })).status).toBe(401);
      expect((await request(app).delete(`/api/v1/holidays/${holiday._id}`)).status).toBe(401);
    });

    it.each(['parent', 'coach', 'student'])('returns 403 for every route as a %s', async (role) => {
      await seedUser({ role, email: `holiday-${role}@example.com` });
      const agent = await loginAgent(`holiday-${role}@example.com`);

      const holiday = await Holiday.create({
        name: 'Winter Break',
        startDate: new Date('2026-12-24'),
        endDate: new Date('2026-12-26'),
      });

      expect((await agent.get('/api/v1/holidays')).status).toBe(403);
      expect((await agent.get(`/api/v1/holidays/${holiday._id}`)).status).toBe(403);
      expect(
        (await agent.post('/api/v1/holidays').send({ name: 'X', startDate: '2026-01-01', endDate: '2026-01-01' })).status
      ).toBe(403);
      expect((await agent.put(`/api/v1/holidays/${holiday._id}`).send({ name: 'Y' })).status).toBe(403);
      expect((await agent.delete(`/api/v1/holidays/${holiday._id}`)).status).toBe(403);
    });

    it.each(['admin', 'superadmin'])('allows full CRUD as a(n) %s', async (role) => {
      await seedUser({ role, email: `holiday-allowed-${role}@example.com` });
      const agent = await loginAgent(`holiday-allowed-${role}@example.com`);

      const createRes = await agent
        .post('/api/v1/holidays')
        .send({ name: 'Winter Break', startDate: '2026-12-24', endDate: '2026-12-26' });
      expect(createRes.status).toBe(201);

      const listRes = await agent.get('/api/v1/holidays');
      expect(listRes.status).toBe(200);
      expect(listRes.body.holidays).toHaveLength(1);

      const id = createRes.body.holiday._id;

      const getRes = await agent.get(`/api/v1/holidays/${id}`);
      expect(getRes.status).toBe(200);

      const updateRes = await agent.put(`/api/v1/holidays/${id}`).send({ name: 'Winter Holidays' });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.holiday.name).toBe('Winter Holidays');

      const deleteRes = await agent.delete(`/api/v1/holidays/${id}`);
      expect(deleteRes.status).toBe(200);

      expect(await Holiday.findById(id)).toBeNull();
    });
  });

  describe('validation errors surface through the route', () => {
    it('returns 409 for a duplicate name', async () => {
      await seedUser({ role: 'admin', email: 'holiday-dup@example.com' });
      const agent = await loginAgent('holiday-dup@example.com');

      await agent.post('/api/v1/holidays').send({ name: 'Winter Break', startDate: '2026-12-24', endDate: '2026-12-26' });
      const res = await agent
        .post('/api/v1/holidays')
        .send({ name: 'Winter Break', startDate: '2027-12-24', endDate: '2027-12-26' });

      expect(res.status).toBe(409);
    });

    it('returns 400 for an invalid date range', async () => {
      await seedUser({ role: 'admin', email: 'holiday-badrange@example.com' });
      const agent = await loginAgent('holiday-badrange@example.com');

      const res = await agent
        .post('/api/v1/holidays')
        .send({ name: 'Backwards', startDate: '2026-12-26', endDate: '2026-12-24' });

      expect(res.status).toBe(400);
    });
  });
});
