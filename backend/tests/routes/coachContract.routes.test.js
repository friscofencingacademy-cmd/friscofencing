process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

const request = require('supertest');
const mongoose = require('mongoose');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const CoachContract = require('../../src/models/coachContract.model');
const PrivateClassSchedule = require('../../src/models/privateClassSchedule.model');
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

// $65/hr x 30 min = $32.50; a 10 x 30-minute pack's allowed range is $162.50–$324.99.
const TEN_PACK = { sessionDurationMinutes: 30, quantity: 10, price: 300 };
const OUT_OF_BAND = '10 × 30 min: price must be between $162.50 and $324.99';

let userCounter = 0;

async function setup(role = 'admin') {
  userCounter += 1;
  const coach = await seedUser({ role: 'coach', email: `cc-coach-${userCounter}@example.com` });
  await seedUser({ role, email: `cc-${role}-${userCounter}@example.com` });
  const agent = await loginAgent(`cc-${role}-${userCounter}@example.com`);
  return { coach, agent };
}

async function agentFor(role) {
  userCounter += 1;
  await seedUser({ role, email: `cc-other-${role}-${userCounter}@example.com` });
  return loginAgent(`cc-other-${role}-${userCounter}@example.com`);
}

function createContract(agent, coach, extra = {}) {
  return agent.post('/api/v1/coach-contracts').send({
    coachId: coach._id.toString(),
    studentBillingRate: 65,
    coachCompensationRate: 40,
    sessionDurationMinutes: 60,
    ...extra,
  });
}

function revise(agent, contractId, changes) {
  return agent.post(`/api/v1/coach-contracts/${contractId}/revisions`).send(changes);
}

// docs/plans/coach-pack-pricing-plan.md — packs on the contract (§1) and
// contracts kept as versions (§8).
describe('Coach contract routes', () => {
  describe('POST /api/v1/coach-contracts (Add — a coach with no current contract)', () => {
    it('creates a contract with its packs, each with an id', async () => {
      const { coach, agent } = await setup();

      const res = await createContract(agent, coach, { privateLessonPacks: [TEN_PACK] });

      expect(res.status).toBe(201);
      expect(res.body.contract).toMatchObject({ studentBillingRate: 65, isActive: true });
      expect(res.body.contract.privateLessonPacks[0]).toMatchObject(TEN_PACK);
      expect(res.body.contract.privateLessonPacks[0]._id).toBeDefined();
      expect(res.body.contract.effectiveTo).toBeUndefined();
    });

    it('defaults to no packs', async () => {
      const { coach, agent } = await setup();

      const res = await createContract(agent, coach);

      expect(res.status).toBe(201);
      expect(res.body.contract.privateLessonPacks).toEqual([]);
    });

    it('refuses a second contract for a coach who already has one (409) — edit it instead', async () => {
      const { coach, agent } = await setup();
      await createContract(agent, coach);

      const res = await createContract(agent, coach, { studentBillingRate: 70 });

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('This coach already has a contract — edit it instead');
      expect(await CoachContract.countDocuments({ coachId: coach._id })).toBe(1);
    });

    it('allows a new contract after the previous one was deactivated', async () => {
      const { coach, agent } = await setup();
      const first = await createContract(agent, coach);
      await agent.post(`/api/v1/coach-contracts/${first.body.contract._id}/deactivate`);

      const res = await createContract(agent, coach, { studentBillingRate: 70 });

      expect(res.status).toBe(201);
      expect(await CoachContract.countDocuments({ coachId: coach._id, isActive: true })).toBe(1);
    });

    it('refuses a pack outside the price band with a 400 naming it, and writes nothing', async () => {
      const { coach, agent } = await setup();

      const res = await createContract(agent, coach, { privateLessonPacks: [{ ...TEN_PACK, price: 325 }] });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(OUT_OF_BAND);
      expect(await CoachContract.countDocuments({ coachId: coach._id })).toBe(0);
    });

    it('returns 400 when coachId does not refer to a coach', async () => {
      const { agent } = await setup();
      const notACoach = await seedUser({ role: 'parent', email: 'cc-notcoach@example.com' });

      const res = await agent.post('/api/v1/coach-contracts').send({
        coachId: notACoach._id.toString(),
        studentBillingRate: 65,
        coachCompensationRate: 40,
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for an unusable rate', async () => {
      const { coach, agent } = await setup();

      const res = await createContract(agent, coach, { studentBillingRate: 'lots' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('studentBillingRate must be a number >= 0');
    });

    it('returns 403 for a coach', async () => {
      const { coach } = await setup();
      const coachAgent = await agentFor('coach');

      expect((await createContract(coachAgent, coach)).status).toBe(403);
    });
  });

  describe('POST /api/v1/coach-contracts/:id/revisions (Edit — a new version)', () => {
    it('ends the current version and starts a new one with the edited terms, from the same instant', async () => {
      const { coach, agent } = await setup();
      const created = await createContract(agent, coach, { privateLessonPacks: [TEN_PACK] });
      const oldId = created.body.contract._id;

      const res = await revise(agent, oldId, {
        studentBillingRate: 70,
        coachCompensationRate: 45,
        sessionDurationMinutes: 60,
        privateLessonPacks: [TEN_PACK],
      });

      expect(res.status).toBe(201);
      expect(res.body.contract).toMatchObject({ studentBillingRate: 70, coachCompensationRate: 45, isActive: true });
      expect(res.body.contract._id).not.toBe(oldId);
      expect(res.body.previous).toMatchObject({ _id: oldId, isActive: false, endReason: 'revised', studentBillingRate: 65 });
      expect(res.body.previous.effectiveTo).toBe(res.body.contract.effectiveFrom);

      // The old version is unchanged apart from being ended.
      const old = await CoachContract.findById(oldId);
      expect(old.studentBillingRate).toBe(65);
      expect(old.coachCompensationRate).toBe(40);
      expect(await CoachContract.countDocuments({ coachId: coach._id, isActive: true })).toBe(1);
    });

    it("gives the new version's packs new ids, even when a pack is unchanged", async () => {
      const { coach, agent } = await setup();
      const created = await createContract(agent, coach, { privateLessonPacks: [TEN_PACK] });
      const oldPack = created.body.contract.privateLessonPacks[0];

      const res = await revise(agent, created.body.contract._id, {
        studentBillingRate: 70,
        privateLessonPacks: [oldPack],
      });

      expect(res.status).toBe(201);
      expect(res.body.contract.privateLessonPacks[0]).toMatchObject(TEN_PACK);
      expect(res.body.contract.privateLessonPacks[0]._id).not.toBe(oldPack._id);
    });

    it('keeps fields left out of the request', async () => {
      const { coach, agent } = await setup();
      const created = await createContract(agent, coach, { privateLessonPacks: [TEN_PACK], notes: 'Fridays only' });

      const res = await revise(agent, created.body.contract._id, { coachCompensationRate: 42 });

      expect(res.status).toBe(201);
      expect(res.body.contract).toMatchObject({
        studentBillingRate: 65,
        coachCompensationRate: 42,
        sessionDurationMinutes: 60,
        notes: 'Fridays only',
      });
      expect(res.body.contract.privateLessonPacks[0]).toMatchObject(TEN_PACK);
    });

    it('refuses a save that changes nothing (400), writing nothing', async () => {
      const { coach, agent } = await setup();
      const created = await createContract(agent, coach, { privateLessonPacks: [TEN_PACK] });

      const res = await revise(agent, created.body.contract._id, {
        studentBillingRate: 65,
        coachCompensationRate: 40,
        sessionDurationMinutes: 60,
        privateLessonPacks: [TEN_PACK],
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Nothing changed');
      expect(await CoachContract.countDocuments({ coachId: coach._id })).toBe(1);
      expect((await CoachContract.findById(created.body.contract._id)).isActive).toBe(true);
    });

    it('refuses a rate change that pushes a pack out of the band, leaving the current version untouched', async () => {
      const { coach, agent } = await setup();
      const created = await createContract(agent, coach, { privateLessonPacks: [TEN_PACK] });

      // $20/hr x 30 min = $10; 10 of them = $100, so a $300 pack is far above the ceiling.
      const res = await revise(agent, created.body.contract._id, { studentBillingRate: 20 });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('10 × 30 min: price must be between $50.00 and $99.99');
      const current = await CoachContract.findById(created.body.contract._id);
      expect(current.isActive).toBe(true);
      expect(current.effectiveTo).toBeUndefined();
      expect(await CoachContract.countDocuments({ coachId: coach._id })).toBe(1);
    });

    it('refuses a pack edit outside the band (400) with the same message a preview shows', async () => {
      const { coach, agent } = await setup();
      const created = await createContract(agent, coach);
      const badPack = { ...TEN_PACK, price: 100 };

      const res = await revise(agent, created.body.contract._id, { privateLessonPacks: [badPack] });
      const previewRes = await agent
        .post('/api/v1/coach-contracts/preview')
        .send({ studentBillingRate: 65, sessionDurationMinutes: 60, packs: [badPack] });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(OUT_OF_BAND);
      expect(previewRes.body.packs[0].error).toBe(res.body.message);
    });

    it('returns 409 when editing a version that is no longer current', async () => {
      const { coach, agent } = await setup();
      const created = await createContract(agent, coach);
      await revise(agent, created.body.contract._id, { studentBillingRate: 70 });

      const res = await revise(agent, created.body.contract._id, { studentBillingRate: 75 });

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Only the current contract can be edited');
    });

    it('returns 404 for an unknown contract', async () => {
      const { agent } = await setup();

      const res = await revise(agent, new mongoose.Types.ObjectId(), { studentBillingRate: 70 });

      expect(res.status).toBe(404);
    });

    it('lets a plain admin (not only a superadmin) edit (plan D13)', async () => {
      const { coach, agent } = await setup('admin');
      const created = await createContract(agent, coach);

      expect((await revise(agent, created.body.contract._id, { studentBillingRate: 70 })).status).toBe(201);
    });

    it.each(['coach', 'parent'])('returns 403 for a %s', async (role) => {
      const { coach, agent: adminAgent } = await setup();
      const created = await createContract(adminAgent, coach);
      const agent = await agentFor(role);

      expect((await revise(agent, created.body.contract._id, { studentBillingRate: 70 })).status).toBe(403);
    });
  });

  describe('POST /api/v1/coach-contracts/:id/deactivate', () => {
    it('ends the current version with no successor, recording when and why', async () => {
      const { coach, agent } = await setup();
      const created = await createContract(agent, coach);

      const res = await agent.post(`/api/v1/coach-contracts/${created.body.contract._id}/deactivate`);

      expect(res.status).toBe(200);
      expect(res.body.contract).toMatchObject({ isActive: false, endReason: 'deactivated' });
      expect(res.body.contract.effectiveTo).toBeDefined();
      expect(await CoachContract.countDocuments({ coachId: coach._id, isActive: true })).toBe(0);
    });

    it('leaves an already-ended version as it was', async () => {
      const { coach, agent } = await setup();
      const created = await createContract(agent, coach);
      const revised = await revise(agent, created.body.contract._id, { studentBillingRate: 70 });

      const res = await agent.post(`/api/v1/coach-contracts/${created.body.contract._id}/deactivate`);

      expect(res.status).toBe(200);
      expect(res.body.contract).toMatchObject({ endReason: 'revised', effectiveTo: revised.body.previous.effectiveTo });
    });

    it('returns 404 for an unknown contract id', async () => {
      const { agent } = await setup();

      const res = await agent.post(`/api/v1/coach-contracts/${new mongoose.Types.ObjectId()}/deactivate`);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/coach-contracts', () => {
    it('lists every version, populated with coach info, filterable by coachId', async () => {
      const { coach: coachA, agent } = await setup();
      const coachB = await seedUser({ role: 'coach', email: 'cc-list-b@example.com' });
      const created = await createContract(agent, coachA);
      await revise(agent, created.body.contract._id, { studentBillingRate: 70 });
      await createContract(agent, coachB, { studentBillingRate: 55 });

      const allRes = await agent.get('/api/v1/coach-contracts');
      expect(allRes.status).toBe(200);
      expect(allRes.body.contracts).toHaveLength(3);
      expect(allRes.body.contracts[0].coachId.email).toBeDefined();

      const filteredRes = await agent.get(`/api/v1/coach-contracts?coachId=${coachA._id}`);
      expect(filteredRes.body.contracts.map((contract) => contract.studentBillingRate).sort()).toEqual([65, 70]);
    });

    it('returns 403 for a coach', async () => {
      const coachAgent = await agentFor('coach');

      expect((await coachAgent.get('/api/v1/coach-contracts')).status).toBe(403);
    });
  });

  describe('POST /api/v1/coach-contracts/preview', () => {
    it('returns lesson prices and a per-pack preview, from the backend', async () => {
      const { agent } = await setup();

      const res = await agent
        .post('/api/v1/coach-contracts/preview')
        .send({ studentBillingRate: 65, sessionDurationMinutes: 60, packs: [TEN_PACK] });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        sessionPrices: [
          { durationMinutes: 30, price: 32.5 },
          { durationMinutes: 60, price: 65 },
        ],
        packs: [
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
        ],
      });
    });

    it("includes every length the coach currently publishes when given the coach", async () => {
      const { coach, agent } = await setup();
      await PrivateClassSchedule.create({
        coachId: coach._id,
        dayOfWeek: 2,
        startTime: '16:30',
        durationMinutes: 45,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2099-12-31'),
      });

      const res = await agent
        .post('/api/v1/coach-contracts/preview')
        .send({ studentBillingRate: 60, sessionDurationMinutes: 60, packs: [], coachId: coach._id.toString() });

      expect(res.body.sessionPrices).toEqual([
        { durationMinutes: 45, price: 45 },
        { durationMinutes: 60, price: 60 },
      ]);
    });

    it('writes nothing', async () => {
      const { coach, agent } = await setup();
      await createContract(agent, coach);

      await agent
        .post('/api/v1/coach-contracts/preview')
        .send({ studentBillingRate: 99, sessionDurationMinutes: 60, packs: [TEN_PACK] });

      expect(await CoachContract.countDocuments()).toBe(1);
      expect((await CoachContract.findOne()).studentBillingRate).toBe(65);
    });

    it('returns 400 for an unusable rate', async () => {
      const { agent } = await setup();

      const res = await agent.post('/api/v1/coach-contracts/preview').send({ packs: [TEN_PACK] });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('studentBillingRate must be a number >= 0');
    });

    it.each(['coach', 'parent'])('returns 403 for a %s', async (role) => {
      const agent = await agentFor(role);

      const res = await agent
        .post('/api/v1/coach-contracts/preview')
        .send({ studentBillingRate: 65, sessionDurationMinutes: 60, packs: [] });

      expect(res.status).toBe(403);
    });
  });
});
