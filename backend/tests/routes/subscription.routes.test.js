process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

const request = require('supertest');
const mongoose = require('mongoose');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const Subscription = require('../../src/models/subscription.model');
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

// scheduleId/studentId are never dereferenced by subscription.service.js's
// cancel() — it only ever reads/writes the Subscription doc itself — so a
// bare, unrelated ObjectId is enough here; no real schedule/student needed.
function buildSubscription(overrides = {}) {
  const currentPeriodStart = new Date('2026-01-01T00:00:00.000Z');
  const currentPeriodEnd = new Date('2026-02-01T00:00:00.000Z');

  return Subscription.create({
    studentId: new mongoose.Types.ObjectId(),
    scheduleId: new mongoose.Types.ObjectId(),
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodStart,
    currentPeriodEnd,
    nextBillingDate: currentPeriodEnd,
    ...overrides,
  });
}

describe('Subscription routes', () => {
  describe('POST /api/v1/subscriptions/:id/cancel', () => {
    it('lets a parent cancel their own subscription: cancelAtPeriodEnd -> true, status stays active', async () => {
      const parent = await seedUser({ role: 'parent', email: 'sub-parent1@example.com' });
      const parentAgent = await loginAgent('sub-parent1@example.com');

      const subscription = await buildSubscription({ parentId: parent._id });

      const res = await parentAgent.post(`/api/v1/subscriptions/${subscription._id}/cancel`);

      expect(res.status).toBe(200);
      expect(res.body.subscription.cancelAtPeriodEnd).toBe(true);
      expect(res.body.subscription.status).toBe('active');

      const inDb = await Subscription.findById(subscription._id);
      expect(inDb.cancelAtPeriodEnd).toBe(true);
      expect(inDb.status).toBe('active');
    });

    it('returns 403 when a parent tries to cancel a subscription belonging to a different parent', async () => {
      const owner = await seedUser({ role: 'parent', email: 'sub-owner2@example.com' });
      await seedUser({ role: 'parent', email: 'sub-other2@example.com' });
      const otherParentAgent = await loginAgent('sub-other2@example.com');

      const subscription = await buildSubscription({ parentId: owner._id });

      const res = await otherParentAgent.post(`/api/v1/subscriptions/${subscription._id}/cancel`);

      expect(res.status).toBe(403);

      const inDb = await Subscription.findById(subscription._id);
      expect(inDb.cancelAtPeriodEnd).toBe(false);
    });

    it('returns 409 when cancelling a subscription that is already status "cancelled"', async () => {
      const parent = await seedUser({ role: 'parent', email: 'sub-parent3@example.com' });
      const parentAgent = await loginAgent('sub-parent3@example.com');

      const subscription = await buildSubscription({
        parentId: parent._id,
        status: 'cancelled',
      });

      const res = await parentAgent.post(`/api/v1/subscriptions/${subscription._id}/cancel`);

      expect(res.status).toBe(409);
    });

    it('is idempotent (200, no error) when cancelling a subscription that already has cancelAtPeriodEnd true', async () => {
      const parent = await seedUser({ role: 'parent', email: 'sub-parent4@example.com' });
      const parentAgent = await loginAgent('sub-parent4@example.com');

      const subscription = await buildSubscription({
        parentId: parent._id,
        cancelAtPeriodEnd: true,
      });

      const res = await parentAgent.post(`/api/v1/subscriptions/${subscription._id}/cancel`);

      expect(res.status).toBe(200);
      expect(res.body.subscription.cancelAtPeriodEnd).toBe(true);
      expect(res.body.subscription.status).toBe('active');
    });

    it("lets an admin cancel any parent's subscription", async () => {
      const parent = await seedUser({ role: 'parent', email: 'sub-parent5@example.com' });
      await seedUser({ role: 'admin', email: 'sub-admin5@example.com' });
      const adminAgent = await loginAgent('sub-admin5@example.com');

      const subscription = await buildSubscription({ parentId: parent._id });

      const res = await adminAgent.post(`/api/v1/subscriptions/${subscription._id}/cancel`);

      expect(res.status).toBe(200);
      expect(res.body.subscription.cancelAtPeriodEnd).toBe(true);

      const inDb = await Subscription.findById(subscription._id);
      expect(inDb.cancelAtPeriodEnd).toBe(true);
    });

    it('returns 404 when the subscription does not exist', async () => {
      await seedUser({ role: 'parent', email: 'sub-parent6@example.com' });
      const parentAgent = await loginAgent('sub-parent6@example.com');

      const res = await parentAgent.post(
        `/api/v1/subscriptions/${new mongoose.Types.ObjectId()}/cancel`
      );

      expect(res.status).toBe(404);
    });

    it('returns 403 when a non-parent, non-admin role attempts to cancel', async () => {
      const parent = await seedUser({ role: 'parent', email: 'sub-parent7@example.com' });
      await seedUser({ role: 'coach', email: 'sub-coach7@example.com' });
      const coachAgent = await loginAgent('sub-coach7@example.com');

      const subscription = await buildSubscription({ parentId: parent._id });

      const res = await coachAgent.post(`/api/v1/subscriptions/${subscription._id}/cancel`);

      expect(res.status).toBe(403);
    });
  });
});
