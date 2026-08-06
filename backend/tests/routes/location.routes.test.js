process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

const request = require('supertest');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const Location = require('../../src/models/location.model');
const Level = require('../../src/models/level.model');
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

describe('Location routes', () => {
  it('creates, lists, updates, and deletes a location (admin happy path)', async () => {
    await seedUser();
    const agent = await loginAgent('test-admin@example.com');

    const createRes = await agent.post('/api/v1/locations').send({
      name: 'Frisco HQ',
      address: '123 Main St',
      timezone: 'America/Chicago',
    });

    expect(createRes.status).toBe(201);
    expect(createRes.body.location.name).toBe('Frisco HQ');

    const locationId = createRes.body.location._id;

    const listRes = await agent.get('/api/v1/locations');
    expect(listRes.status).toBe(200);
    expect(listRes.body.locations).toHaveLength(1);

    const updateRes = await agent
      .put(`/api/v1/locations/${locationId}`)
      .send({ address: '456 Elm St' });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.location.address).toBe('456 Elm St');

    const deleteRes = await agent.delete(`/api/v1/locations/${locationId}`);
    expect(deleteRes.status).toBe(200);

    const listAfterDeleteRes = await agent.get('/api/v1/locations');
    expect(listAfterDeleteRes.body.locations).toHaveLength(0);
  });

  it('returns 403 when a non-admin tries to create a location', async () => {
    await seedUser({ role: 'parent', email: 'test-parent@example.com' });
    const agent = await loginAgent('test-parent@example.com');

    const res = await agent.post('/api/v1/locations').send({
      name: 'Frisco HQ',
      address: '123 Main St',
    });

    expect(res.status).toBe(403);
  });

  it('returns 409 when deleting a location referenced by a GroupClass', async () => {
    await seedUser();
    const agent = await loginAgent('test-admin@example.com');

    const location = await Location.create({ name: 'Frisco HQ', address: '123 Main St' });
    const level = await Level.create({ name: 'Beginner', order: 1 });
    await GroupClass.create({
      name: 'Beginner Foil',
      levelId: level._id,
      locationId: location._id,
      capacity: 10,
    });

    const res = await agent.delete(`/api/v1/locations/${location._id}`);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/1 class\(es\) reference this location/);
  });
});
