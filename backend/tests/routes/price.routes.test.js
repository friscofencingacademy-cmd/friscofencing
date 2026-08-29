process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

const request = require('supertest');
const mongoose = require('mongoose');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const Level = require('../../src/models/level.model');
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

describe('Price routes', () => {
  it('creates, lists, updates, and deletes a price (admin happy path)', async () => {
    await seedUser();
    const agent = await loginAgent('test-admin@example.com');

    const level = await Level.create({ name: 'Beginner', order: 1 });

    const createRes = await agent.post('/api/v1/prices').send({
      levelId: level._id.toString(),
      monthlyFee: 150,
    });

    expect(createRes.status).toBe(201);
    expect(createRes.body.price.monthlyFee).toBe(150);

    const priceId = createRes.body.price._id;

    const listRes = await agent.get('/api/v1/prices');
    expect(listRes.status).toBe(200);
    expect(listRes.body.prices).toHaveLength(1);

    const updateRes = await agent
      .put(`/api/v1/prices/${priceId}`)
      .send({ monthlyFee: 175 });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.price.monthlyFee).toBe(175);

    const deleteRes = await agent.delete(`/api/v1/prices/${priceId}`);
    expect(deleteRes.status).toBe(200);

    const listAfterDeleteRes = await agent.get('/api/v1/prices');
    expect(listAfterDeleteRes.body.prices).toHaveLength(0);
  });

  it('returns 403 when a non-admin tries to create a price', async () => {
    await seedUser({ role: 'parent', email: 'test-parent@example.com' });
    const agent = await loginAgent('test-parent@example.com');

    const level = await Level.create({ name: 'Beginner', order: 1 });

    const res = await agent.post('/api/v1/prices').send({
      levelId: level._id.toString(),
      monthlyFee: 150,
    });

    expect(res.status).toBe(403);
  });

  it('returns 404 when levelId does not exist', async () => {
    await seedUser();
    const agent = await loginAgent('test-admin@example.com');

    const bogusLevelId = new mongoose.Types.ObjectId().toString();

    const res = await agent.post('/api/v1/prices').send({
      levelId: bogusLevelId,
      monthlyFee: 150,
    });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/Level not found/);
  });

  it('returns 409 when creating a second price for a level that already has one', async () => {
    await seedUser();
    const agent = await loginAgent('test-admin@example.com');

    const level = await Level.create({ name: 'Beginner', order: 1 });

    const firstRes = await agent.post('/api/v1/prices').send({
      levelId: level._id.toString(),
      monthlyFee: 150,
    });
    expect(firstRes.status).toBe(201);

    const secondRes = await agent.post('/api/v1/prices').send({
      levelId: level._id.toString(),
      monthlyFee: 200,
    });

    expect(secondRes.status).toBe(409);
    expect(secondRes.body.message).toMatch(/A price already exists for this level/);
  });

  it('returns 409 when updating a price to a levelId another price already claims', async () => {
    await seedUser();
    const agent = await loginAgent('test-admin@example.com');

    const beginner = await Level.create({ name: 'Beginner', order: 1 });
    const advanced = await Level.create({ name: 'Advanced', order: 2 });

    await agent.post('/api/v1/prices').send({
      levelId: beginner._id.toString(),
      monthlyFee: 150,
    });

    const advancedPriceRes = await agent.post('/api/v1/prices').send({
      levelId: advanced._id.toString(),
      monthlyFee: 200,
    });

    const advancedPriceId = advancedPriceRes.body.price._id;

    const updateRes = await agent
      .put(`/api/v1/prices/${advancedPriceId}`)
      .send({ levelId: beginner._id.toString() });

    expect(updateRes.status).toBe(409);
    expect(updateRes.body.message).toMatch(/A price already exists for this level/);
  });

  it('allows updating a price without changing levelId (no false 409 against itself)', async () => {
    await seedUser();
    const agent = await loginAgent('test-admin@example.com');

    const level = await Level.create({ name: 'Beginner', order: 1 });

    const createRes = await agent.post('/api/v1/prices').send({
      levelId: level._id.toString(),
      monthlyFee: 150,
    });

    const priceId = createRes.body.price._id;

    const updateRes = await agent
      .put(`/api/v1/prices/${priceId}`)
      .send({ levelId: level._id.toString(), monthlyFee: 160 });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.price.monthlyFee).toBe(160);
  });

  // Per-level registration fee (docs/plans/per-level-registration-fee-plan.md)
  describe('registrationFee override', () => {
    it('creates and returns a price with a registrationFee override', async () => {
      await seedUser();
      const agent = await loginAgent('test-admin@example.com');

      const level = await Level.create({ name: 'Beginner', order: 1 });

      const createRes = await agent.post('/api/v1/prices').send({
        levelId: level._id.toString(),
        monthlyFee: 150,
        registrationFee: 100,
      });

      expect(createRes.status).toBe(201);
      expect(createRes.body.price.registrationFee).toBe(100);
    });

    it('defaults registrationFee to null when not provided (inherits the academy-wide fee)', async () => {
      await seedUser();
      const agent = await loginAgent('test-admin@example.com');

      const level = await Level.create({ name: 'Beginner', order: 1 });

      const createRes = await agent.post('/api/v1/prices').send({
        levelId: level._id.toString(),
        monthlyFee: 150,
      });

      expect(createRes.status).toBe(201);
      expect(createRes.body.price.registrationFee).toBeNull();
    });

    it('clears a previously-set registrationFee override back to null', async () => {
      await seedUser();
      const agent = await loginAgent('test-admin@example.com');

      const level = await Level.create({ name: 'Beginner', order: 1 });

      const createRes = await agent.post('/api/v1/prices').send({
        levelId: level._id.toString(),
        monthlyFee: 150,
        registrationFee: 100,
      });
      const priceId = createRes.body.price._id;

      const updateRes = await agent
        .put(`/api/v1/prices/${priceId}`)
        .send({ registrationFee: null });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.price.registrationFee).toBeNull();
    });

    it('accepts an explicit registrationFee of 0 (this level charges no fee)', async () => {
      await seedUser();
      const agent = await loginAgent('test-admin@example.com');

      const level = await Level.create({ name: 'Beginner', order: 1 });

      const createRes = await agent.post('/api/v1/prices').send({
        levelId: level._id.toString(),
        monthlyFee: 150,
        registrationFee: 0,
      });

      expect(createRes.status).toBe(201);
      expect(createRes.body.price.registrationFee).toBe(0);
    });

    it('rejects a negative registrationFee via the real Mongoose min:0 validator', async () => {
      await seedUser();
      const agent = await loginAgent('test-admin@example.com');

      const level = await Level.create({ name: 'Beginner', order: 1 });

      const res = await agent.post('/api/v1/prices').send({
        levelId: level._id.toString(),
        monthlyFee: 150,
        registrationFee: -5,
      });

      // price.controller.js has no special-case for a Mongoose
      // ValidationError (no .status set on it), so it falls through the
      // generic `error.status || 500` handler — a real, if imperfect,
      // existing behavior of this controller, not something this PR
      // introduces. The point of this test is that the negative value is
      // actually rejected, not accepted and silently stored.
      expect(res.status).toBe(500);
    });
  });
});
