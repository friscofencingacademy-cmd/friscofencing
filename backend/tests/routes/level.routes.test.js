process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

const request = require('supertest');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const Level = require('../../src/models/level.model');
const Location = require('../../src/models/location.model');
const GroupClass = require('../../src/models/groupClass.model');
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
    lastName: 'Admin',
    email: 'test-admin@example.com',
    passwordHash,
    ...overrides,
  });
}

async function loginAgent(email) {
  const agent = request.agent(app);

  await agent.post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD });

  return agent;
}

describe('Level routes', () => {
  it('creates and lists a level (admin happy path)', async () => {
    await seedUser();
    const agent = await loginAgent('test-admin@example.com');

    const createRes = await agent.post('/api/v1/levels').send({
      name: 'Beginner',
      order: 1,
    });

    expect(createRes.status).toBe(201);
    expect(createRes.body.level.name).toBe('Beginner');

    const listRes = await agent.get('/api/v1/levels');
    expect(listRes.status).toBe(200);
    expect(listRes.body.levels).toHaveLength(1);
  });

  it('returns 403 when a non-admin tries to create a level', async () => {
    await seedUser({ role: 'coach', email: 'test-coach@example.com' });
    const agent = await loginAgent('test-coach@example.com');

    const res = await agent.post('/api/v1/levels').send({ name: 'Beginner', order: 1 });

    expect(res.status).toBe(403);
  });

  it('returns 409 when deleting a level referenced by a GroupClass', async () => {
    await seedUser();
    const agent = await loginAgent('test-admin@example.com');

    const level = await Level.create({ name: 'Beginner', order: 1 });
    const location = await Location.create({ name: 'Frisco HQ', address: '123 Main St' });
    await GroupClass.create({
      name: 'Beginner Foil',
      levelId: level._id,
      locationId: location._id,
      capacity: 10,
    });

    const res = await agent.delete(`/api/v1/levels/${level._id}`);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/1 class\(es\) reference this level/);
  });

  it('returns 409 when deleting a level that has a configured Price', async () => {
    await seedUser();
    const agent = await loginAgent('test-admin@example.com');

    const level = await Level.create({ name: 'Beginner', order: 1 });
    const Price = require('../../src/models/price.model');
    await Price.create({ levelId: level._id, monthlyFee: 150 });

    const res = await agent.delete(`/api/v1/levels/${level._id}`);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/a price is configured for this level/);
  });

  it('deletes a level with no references (happy path)', async () => {
    await seedUser();
    const agent = await loginAgent('test-admin@example.com');

    const level = await Level.create({ name: 'Beginner', order: 1 });

    const res = await agent.delete(`/api/v1/levels/${level._id}`);
    expect(res.status).toBe(200);

    const listRes = await agent.get('/api/v1/levels');
    expect(listRes.body.levels).toHaveLength(0);
  });

  describe('GET /api/v1/levels/public', () => {
    it('requires no auth and returns only levels with a configured Price, ordered by "order"', async () => {
      const Price = require('../../src/models/price.model');

      const advanced = await Level.create({ name: 'Advanced', order: 2 });
      const beginner = await Level.create({ name: 'Beginner', order: 1 });
      // No Price configured for this one — must be excluded, not shown with
      // an invented/missing fee.
      await Level.create({ name: 'Unpriced', order: 3 });

      await Price.create({ levelId: beginner._id, monthlyFee: 120 });
      await Price.create({ levelId: advanced._id, monthlyFee: 180 });

      // No Authorization/cookie at all.
      const res = await request(app).get('/api/v1/levels/public');

      expect(res.status).toBe(200);
      expect(res.body.levels).toEqual([
        { name: 'Beginner', order: 1, monthlyFee: 120 },
        { name: 'Advanced', order: 2, monthlyFee: 180 },
      ]);
    });
  });
});
