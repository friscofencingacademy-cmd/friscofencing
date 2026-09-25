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
  // docs/plans/coach-pack-pricing-plan.md — packs on the contract.
  // $65/hr x 30 min = $32.50; a 10-pack's allowed range is $162.50–$324.99.
  describe('private-lesson packs', () => {
    const TEN_PACK = { sessionDurationMinutes: 30, quantity: 10, price: 300 };
    const OUT_OF_BAND = '10 × 30 min: price must be between $162.50 and $324.99';

    async function setup(suffix, role = 'admin') {
      const coach = await seedUser({ role: 'coach', email: `pk-coach-${suffix}@example.com` });
      await seedUser({ role, email: `pk-${role}-${suffix}@example.com` });
      const agent = await loginAgent(`pk-${role}-${suffix}@example.com`);
      return { coach, agent };
    }

    function createContract(agent, coach, extra = {}) {
      return agent.post('/api/v1/coach-contracts').send({
        coachId: coach._id.toString(),
        studentBillingRate: 65,
        coachCompensationRate: 40,
        ...extra,
      });
    }

    describe('POST /api/v1/coach-contracts with packs', () => {
      it('creates a contract with its packs, each with an id', async () => {
        const { coach, agent } = await setup('create');

        const res = await createContract(agent, coach, { privateLessonPacks: [TEN_PACK] });

        expect(res.status).toBe(201);
        expect(res.body.contract.privateLessonPacks).toHaveLength(1);
        expect(res.body.contract.privateLessonPacks[0]).toMatchObject(TEN_PACK);
        expect(res.body.contract.privateLessonPacks[0]._id).toBeDefined();
      });

      it('refuses a pack outside the price band with a 400 naming it, and writes no contract', async () => {
        const { coach, agent } = await setup('band');

        const res = await createContract(agent, coach, { privateLessonPacks: [{ ...TEN_PACK, price: 325 }] });

        expect(res.status).toBe(400);
        expect(res.body.message).toBe(OUT_OF_BAND);
        expect(await CoachContract.countDocuments({ coachId: coach._id })).toBe(0);
      });

      it("carries the previous contract's packs over when none are sent, as new packs", async () => {
        const { coach, agent } = await setup('carry');
        const first = await createContract(agent, coach, { privateLessonPacks: [TEN_PACK] });

        const second = await createContract(agent, coach, { studentBillingRate: 70 });

        expect(second.status).toBe(201);
        expect(second.body.contract.privateLessonPacks).toHaveLength(1);
        expect(second.body.contract.privateLessonPacks[0]).toMatchObject(TEN_PACK);
        expect(second.body.contract.privateLessonPacks[0]._id).not.toBe(first.body.contract.privateLessonPacks[0]._id);
      });

      it('refuses a rate change that pushes a carried-over pack out of the band, leaving the old contract active', async () => {
        const { coach, agent } = await setup('carry-band');
        const first = await createContract(agent, coach, { privateLessonPacks: [TEN_PACK] });

        // $20/hr x 30 min = $10; 10 of them = $100, so a $300 pack is far above the ceiling.
        const second = await createContract(agent, coach, { studentBillingRate: 20 });

        expect(second.status).toBe(400);
        expect(second.body.message).toBe('10 × 30 min: price must be between $50.00 and $99.99');
        expect((await CoachContract.findById(first.body.contract._id)).isActive).toBe(true);
        expect(await CoachContract.countDocuments({ coachId: coach._id })).toBe(1);
      });

      it('sends an explicit empty list to drop every pack on a new contract', async () => {
        const { coach, agent } = await setup('empty');
        await createContract(agent, coach, { privateLessonPacks: [TEN_PACK] });

        const res = await createContract(agent, coach, { privateLessonPacks: [] });

        expect(res.status).toBe(201);
        expect(res.body.contract.privateLessonPacks).toEqual([]);
      });
    });

    describe('PUT /api/v1/coach-contracts/:id/packs', () => {
      it('replaces the list, keeping the id of a pack sent back unchanged', async () => {
        const { coach, agent } = await setup('put-keep');
        const created = await createContract(agent, coach, { privateLessonPacks: [TEN_PACK] });
        const kept = created.body.contract.privateLessonPacks[0];

        const res = await agent.put(`/api/v1/coach-contracts/${created.body.contract._id}/packs`).send({
          privateLessonPacks: [kept, { sessionDurationMinutes: 30, quantity: 5, price: 155 }],
        });

        expect(res.status).toBe(200);
        expect(res.body.contract.privateLessonPacks).toHaveLength(2);
        const tenPack = res.body.contract.privateLessonPacks.find((pack) => pack.quantity === 10);
        expect(tenPack._id).toBe(kept._id);
      });

      it('mints a new id for a pack sent back with a changed price (plan D7)', async () => {
        const { coach, agent } = await setup('put-edit');
        const created = await createContract(agent, coach, { privateLessonPacks: [TEN_PACK] });
        const original = created.body.contract.privateLessonPacks[0];

        const res = await agent
          .put(`/api/v1/coach-contracts/${created.body.contract._id}/packs`)
          .send({ privateLessonPacks: [{ ...original, price: 310 }] });

        expect(res.status).toBe(200);
        expect(res.body.contract.privateLessonPacks[0].price).toBe(310);
        expect(res.body.contract.privateLessonPacks[0]._id).not.toBe(original._id);
      });

      it('refuses a pack outside the band and leaves the stored packs unchanged', async () => {
        const { coach, agent } = await setup('put-band');
        const created = await createContract(agent, coach, { privateLessonPacks: [TEN_PACK] });

        const res = await agent
          .put(`/api/v1/coach-contracts/${created.body.contract._id}/packs`)
          .send({ privateLessonPacks: [{ ...TEN_PACK, price: 100 }] });

        expect(res.status).toBe(400);
        expect(res.body.message).toBe(OUT_OF_BAND);
        const stored = await CoachContract.findById(created.body.contract._id);
        expect(stored.privateLessonPacks[0].price).toBe(300);
      });

      it('returns 409 on an inactive contract', async () => {
        const { coach, agent } = await setup('put-inactive');
        const created = await createContract(agent, coach);
        await agent.post(`/api/v1/coach-contracts/${created.body.contract._id}/deactivate`);

        const res = await agent
          .put(`/api/v1/coach-contracts/${created.body.contract._id}/packs`)
          .send({ privateLessonPacks: [TEN_PACK] });

        expect(res.status).toBe(409);
      });

      it('returns 404 for an unknown contract', async () => {
        const { agent } = await setup('put-404');

        const res = await agent
          .put(`/api/v1/coach-contracts/${new mongoose.Types.ObjectId()}/packs`)
          .send({ privateLessonPacks: [TEN_PACK] });

        expect(res.status).toBe(404);
      });

      it('lets a plain admin (not only a superadmin) edit packs (plan D13)', async () => {
        const { coach, agent } = await setup('put-admin', 'admin');
        const created = await createContract(agent, coach);

        const res = await agent
          .put(`/api/v1/coach-contracts/${created.body.contract._id}/packs`)
          .send({ privateLessonPacks: [TEN_PACK] });

        expect(res.status).toBe(200);
      });

      it.each(['coach', 'parent'])('returns 403 for a %s', async (role) => {
        const { coach, agent: adminAgent } = await setup(`put-403-${role}`);
        const created = await createContract(adminAgent, coach);
        await seedUser({ role, email: `pk-other-${role}@example.com` });
        const agent = await loginAgent(`pk-other-${role}@example.com`);

        const res = await agent
          .put(`/api/v1/coach-contracts/${created.body.contract._id}/packs`)
          .send({ privateLessonPacks: [TEN_PACK] });

        expect(res.status).toBe(403);
      });
    });

    describe('POST /api/v1/coach-contracts/pack-quotes', () => {
      it('previews each pack from the backend: per-lesson price, savings, percent, range', async () => {
        const { agent } = await setup('quote');

        const res = await agent
          .post('/api/v1/coach-contracts/pack-quotes')
          .send({ studentBillingRate: 65, packs: [TEN_PACK] });

        expect(res.status).toBe(200);
        expect(res.body.quotes).toEqual([
          {
            sessionDurationMinutes: 30,
            quantity: 10,
            price: 300,
            perLessonPrice: 30,
            subtotal: 325,
            savings: 25,
            savingsPercent: 8,
            allowedRange: { min: 162.5, max: 324.99 },
            error: null,
          },
        ]);
      });

      it('returns the exact error text a save would return', async () => {
        const { coach, agent } = await setup('quote-same');
        const created = await createContract(agent, coach);
        const badPack = { ...TEN_PACK, price: 325 };

        const quoteRes = await agent
          .post('/api/v1/coach-contracts/pack-quotes')
          .send({ studentBillingRate: 65, packs: [badPack] });
        const saveRes = await agent
          .put(`/api/v1/coach-contracts/${created.body.contract._id}/packs`)
          .send({ privateLessonPacks: [badPack] });

        expect(saveRes.status).toBe(400);
        expect(quoteRes.body.quotes[0].error).toBe(saveRes.body.message);
      });

      it('writes nothing', async () => {
        const { coach, agent } = await setup('quote-nowrite');
        const created = await createContract(agent, coach);

        await agent.post('/api/v1/coach-contracts/pack-quotes').send({ studentBillingRate: 65, packs: [TEN_PACK] });

        const stored = await CoachContract.findById(created.body.contract._id);
        expect(stored.privateLessonPacks).toHaveLength(0);
        expect(await CoachContract.countDocuments()).toBe(1);
      });

      it('returns 400 for an unusable rate', async () => {
        const { agent } = await setup('quote-rate');

        const res = await agent.post('/api/v1/coach-contracts/pack-quotes').send({ packs: [TEN_PACK] });

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('studentBillingRate must be a number >= 0');
      });

      it.each(['coach', 'parent'])('returns 403 for a %s', async (role) => {
        await seedUser({ role, email: `pk-quote-${role}@example.com` });
        const agent = await loginAgent(`pk-quote-${role}@example.com`);

        const res = await agent
          .post('/api/v1/coach-contracts/pack-quotes')
          .send({ studentBillingRate: 65, packs: [TEN_PACK] });

        expect(res.status).toBe(403);
      });
    });
  });
});
