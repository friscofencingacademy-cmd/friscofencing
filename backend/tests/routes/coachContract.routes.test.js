process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

const request = require('supertest');
const mongoose = require('mongoose');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const CoachContract = require('../../src/models/coachContract.model');
const { hashPassword } = require('../../src/utils/password');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');
const { seedServices } = require('../../scripts/lib/seedServices');

const TEST_PASSWORD = 'correct-password';

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

beforeEach(async () => {
  // Contract creation resolves the private-lessons Service internally now
  // (docs/plans/service-registry-unified-ledger-plan.md).
  await seedServices();
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

describe('Coach contract routes', () => {
  describe('POST /api/v1/coach-contracts', () => {
    it('lets an admin create a contract for a coach', async () => {
      const coach = await seedUser({ role: 'coach', email: 'cc-coach1@example.com' });
      await seedUser({ role: 'admin', email: 'cc-admin1@example.com' });
      const adminAgent = await loginAgent('cc-admin1@example.com');

      const res = await adminAgent.post('/api/v1/coach-contracts').send({
        coachId: coach._id.toString(),
        studentBillingRate: 65,
        coachCompensationRate: 40,
        sessionDurationMinutes: 60,
      });

      expect(res.status).toBe(201);
      expect(res.body.contract.studentBillingRate).toBe(65);
      expect(res.body.contract.isActive).toBe(true);
    });

    it('deactivates the coach\'s previous active contract when a new one is created', async () => {
      const coach = await seedUser({ role: 'coach', email: 'cc-coach2@example.com' });
      await seedUser({ role: 'admin', email: 'cc-admin2@example.com' });
      const adminAgent = await loginAgent('cc-admin2@example.com');

      const firstRes = await adminAgent.post('/api/v1/coach-contracts').send({
        coachId: coach._id.toString(),
        studentBillingRate: 60,
        coachCompensationRate: 35,
      });
      expect(firstRes.status).toBe(201);

      const secondRes = await adminAgent.post('/api/v1/coach-contracts').send({
        coachId: coach._id.toString(),
        studentBillingRate: 70,
        coachCompensationRate: 40,
      });
      expect(secondRes.status).toBe(201);

      const firstInDb = await CoachContract.findById(firstRes.body.contract._id);
      expect(firstInDb.isActive).toBe(false);

      const secondInDb = await CoachContract.findById(secondRes.body.contract._id);
      expect(secondInDb.isActive).toBe(true);

      const activeContracts = await CoachContract.find({ coachId: coach._id, isActive: true });
      expect(activeContracts).toHaveLength(1);
    });

    it('returns 400 when coachId does not refer to a coach', async () => {
      const notACoach = await seedUser({ role: 'parent', email: 'cc-notcoach@example.com' });
      await seedUser({ role: 'admin', email: 'cc-admin3@example.com' });
      const adminAgent = await loginAgent('cc-admin3@example.com');

      const res = await adminAgent.post('/api/v1/coach-contracts').send({
        coachId: notACoach._id.toString(),
        studentBillingRate: 65,
        coachCompensationRate: 40,
      });

      expect(res.status).toBe(400);
    });

    it('returns 403 for a non-admin role', async () => {
      const coach = await seedUser({ role: 'coach', email: 'cc-coach4@example.com' });
      const coachAgent = await loginAgent('cc-coach4@example.com');

      const res = await coachAgent.post('/api/v1/coach-contracts').send({
        coachId: coach._id.toString(),
        studentBillingRate: 65,
        coachCompensationRate: 40,
      });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/coach-contracts', () => {
    it('lists contracts populated with coach info, filterable by coachId', async () => {
      const coachA = await seedUser({ role: 'coach', email: 'cc-list-a@example.com' });
      const coachB = await seedUser({ role: 'coach', email: 'cc-list-b@example.com' });
      await seedUser({ role: 'admin', email: 'cc-list-admin@example.com' });
      const adminAgent = await loginAgent('cc-list-admin@example.com');

      await adminAgent
        .post('/api/v1/coach-contracts')
        .send({ coachId: coachA._id.toString(), studentBillingRate: 65, coachCompensationRate: 40 });
      await adminAgent
        .post('/api/v1/coach-contracts')
        .send({ coachId: coachB._id.toString(), studentBillingRate: 55, coachCompensationRate: 30 });

      const allRes = await adminAgent.get('/api/v1/coach-contracts');
      expect(allRes.status).toBe(200);
      expect(allRes.body.contracts).toHaveLength(2);
      expect(allRes.body.contracts[0].coachId.email).toBeDefined();

      const filteredRes = await adminAgent.get(`/api/v1/coach-contracts?coachId=${coachA._id}`);
      expect(filteredRes.body.contracts).toHaveLength(1);
      expect(filteredRes.body.contracts[0].studentBillingRate).toBe(65);
    });

    it('returns 403 for a coach', async () => {
      const coach = await seedUser({ role: 'coach', email: 'cc-list-coach@example.com' });
      const coachAgent = await loginAgent('cc-list-coach@example.com');

      const res = await coachAgent.get('/api/v1/coach-contracts');
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/v1/coach-contracts/:id/deactivate', () => {
    it('deactivates an active contract', async () => {
      const coach = await seedUser({ role: 'coach', email: 'cc-deact1@example.com' });
      await seedUser({ role: 'admin', email: 'cc-deact-admin1@example.com' });
      const adminAgent = await loginAgent('cc-deact-admin1@example.com');

      const createRes = await adminAgent
        .post('/api/v1/coach-contracts')
        .send({ coachId: coach._id.toString(), studentBillingRate: 65, coachCompensationRate: 40 });

      const res = await adminAgent.post(`/api/v1/coach-contracts/${createRes.body.contract._id}/deactivate`);

      expect(res.status).toBe(200);
      expect(res.body.contract.isActive).toBe(false);
    });

    it('returns 404 for an unknown contract id', async () => {
      await seedUser({ role: 'admin', email: 'cc-deact-admin2@example.com' });
      const adminAgent = await loginAgent('cc-deact-admin2@example.com');

      const res = await adminAgent.post(
        `/api/v1/coach-contracts/${new mongoose.Types.ObjectId()}/deactivate`
      );

      expect(res.status).toBe(404);
    });
  });
});
