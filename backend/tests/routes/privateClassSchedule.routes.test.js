process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

const request = require('supertest');
const mongoose = require('mongoose');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const PrivateClassSchedule = require('../../src/models/privateClassSchedule.model');
const { hashPassword } = require('../../src/utils/password');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');
const { computeSessionPrice } = require('../../src/utils/privateClassPricing');
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
  // Coach contract setup (used throughout this file) resolves the
  // private-lessons Service internally now (docs/plans/service-registry-
  // unified-ledger-plan.md).
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

async function seedCoachWithContract({ email, studentBillingRate = 65, coachCompensationRate = 40 }) {
  const coach = await seedUser({ role: 'coach', email });
  const adminEmail = `admin-setup-${Date.now()}-${Math.random()}@example.com`;
  await seedUser({ role: 'admin', email: adminEmail });
  const adminAgent = await loginAgent(adminEmail);

  await adminAgent.post('/api/v1/coach-contracts').send({
    coachId: coach._id.toString(),
    studentBillingRate,
    coachCompensationRate,
  });

  return coach;
}

describe('Private class schedule routes', () => {
  describe('POST /api/v1/private-class-schedules', () => {
    it('lets a coach create their own slot (self)', async () => {
      const coach = await seedCoachWithContract({ email: 'pcs-coach1@example.com' });
      const coachAgent = await loginAgent('pcs-coach1@example.com');

      const res = await coachAgent.post('/api/v1/private-class-schedules').send({
        dayOfWeek: 2,
        startTime: '16:00',
        durationMinutes: 60,
      });

      expect(res.status).toBe(201);
      expect(String(res.body.schedule.coachId)).toBe(String(coach._id));
      expect(res.body.schedule.studentId).toBeNull();
    });

    it('lets an admin create a slot on behalf of a coach (body coachId)', async () => {
      const coach = await seedCoachWithContract({ email: 'pcs-coach2@example.com' });
      await seedUser({ role: 'admin', email: 'pcs-admin2@example.com' });
      const adminAgent = await loginAgent('pcs-admin2@example.com');

      const res = await adminAgent.post('/api/v1/private-class-schedules').send({
        coachId: coach._id.toString(),
        dayOfWeek: 3,
        startTime: '17:00',
      });

      expect(res.status).toBe(201);
      expect(String(res.body.schedule.coachId)).toBe(String(coach._id));
    });

    it('returns 400 when the coach has no active contract', async () => {
      const coach = await seedUser({ role: 'coach', email: 'pcs-nocontract@example.com' });
      const coachAgent = await loginAgent('pcs-nocontract@example.com');

      const res = await coachAgent.post('/api/v1/private-class-schedules').send({
        dayOfWeek: 2,
        startTime: '16:00',
      });

      expect(res.status).toBe(400);
    });

    it('returns 409 on a duplicate slot (same coach + day + time)', async () => {
      await seedCoachWithContract({ email: 'pcs-dup@example.com' });
      const coachAgent = await loginAgent('pcs-dup@example.com');

      const firstRes = await coachAgent
        .post('/api/v1/private-class-schedules')
        .send({ dayOfWeek: 2, startTime: '16:00' });
      expect(firstRes.status).toBe(201);

      const secondRes = await coachAgent
        .post('/api/v1/private-class-schedules')
        .send({ dayOfWeek: 2, startTime: '16:00' });
      expect(secondRes.status).toBe(409);
    });
  });

  describe('GET /api/v1/private-class-schedules/mine', () => {
    it("returns only the coach's own slots", async () => {
      await seedCoachWithContract({ email: 'pcs-mine1@example.com' });
      const coachAgent1 = await loginAgent('pcs-mine1@example.com');
      await coachAgent1.post('/api/v1/private-class-schedules').send({ dayOfWeek: 1, startTime: '15:00' });

      await seedCoachWithContract({ email: 'pcs-mine2@example.com' });
      const coachAgent2 = await loginAgent('pcs-mine2@example.com');
      await coachAgent2.post('/api/v1/private-class-schedules').send({ dayOfWeek: 2, startTime: '16:00' });

      const res = await coachAgent1.get('/api/v1/private-class-schedules/mine');

      expect(res.status).toBe(200);
      expect(res.body.schedules).toHaveLength(1);
      expect(res.body.schedules[0].startTime).toBe('15:00');
    });

    it('returns 403 for a parent', async () => {
      const parent = await seedUser({ role: 'parent', email: 'pcs-mine-parent@example.com' });
      const parentAgent = await loginAgent('pcs-mine-parent@example.com');

      const res = await parentAgent.get('/api/v1/private-class-schedules/mine');
      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/v1/private-class-schedules/:id', () => {
    it('lets a coach delete their own free slot', async () => {
      await seedCoachWithContract({ email: 'pcs-del1@example.com' });
      const coachAgent = await loginAgent('pcs-del1@example.com');

      const createRes = await coachAgent
        .post('/api/v1/private-class-schedules')
        .send({ dayOfWeek: 1, startTime: '15:00' });

      const res = await coachAgent.delete(`/api/v1/private-class-schedules/${createRes.body.schedule._id}`);

      expect(res.status).toBe(200);
      expect(await PrivateClassSchedule.findById(createRes.body.schedule._id)).toBeNull();
    });

    it('returns 409 when the slot has an enrolled student', async () => {
      const coach = await seedCoachWithContract({ email: 'pcs-del2@example.com' });
      const coachAgent = await loginAgent('pcs-del2@example.com');

      const createRes = await coachAgent
        .post('/api/v1/private-class-schedules')
        .send({ dayOfWeek: 1, startTime: '15:00' });

      const student = await User.create({ role: 'student', firstName: 'Kid', lastName: 'Occupied' });
      await PrivateClassSchedule.findByIdAndUpdate(createRes.body.schedule._id, {
        studentId: student._id,
      });

      const res = await coachAgent.delete(`/api/v1/private-class-schedules/${createRes.body.schedule._id}`);
      expect(res.status).toBe(409);
      expect(await PrivateClassSchedule.findById(createRes.body.schedule._id)).not.toBeNull();
    });

    it("returns 403 when a different coach tries to delete someone else's slot", async () => {
      await seedCoachWithContract({ email: 'pcs-del3-owner@example.com' });
      const ownerAgent = await loginAgent('pcs-del3-owner@example.com');
      const createRes = await ownerAgent
        .post('/api/v1/private-class-schedules')
        .send({ dayOfWeek: 1, startTime: '15:00' });

      await seedCoachWithContract({ email: 'pcs-del3-other@example.com' });
      const otherAgent = await loginAgent('pcs-del3-other@example.com');

      const res = await otherAgent.delete(`/api/v1/private-class-schedules/${createRes.body.schedule._id}`);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/private-class-schedules/public', () => {
    it('requires no auth, excludes taken/inactive slots and contract-less coaches, and matches computeSessionPrice', async () => {
      const coach = await seedCoachWithContract({
        email: 'pcs-public1@example.com',
        studentBillingRate: 60,
      });
      const coachAgent = await loginAgent('pcs-public1@example.com');

      const availableRes = await coachAgent
        .post('/api/v1/private-class-schedules')
        .send({ dayOfWeek: 2, startTime: '16:00', durationMinutes: 60 });
      const takenRes = await coachAgent
        .post('/api/v1/private-class-schedules')
        .send({ dayOfWeek: 3, startTime: '17:00', durationMinutes: 60 });
      const inactiveRes = await coachAgent
        .post('/api/v1/private-class-schedules')
        .send({ dayOfWeek: 4, startTime: '18:00', durationMinutes: 60 });

      const student = await User.create({ role: 'student', firstName: 'Taken', lastName: 'Kid' });
      await PrivateClassSchedule.findByIdAndUpdate(takenRes.body.schedule._id, { studentId: student._id });
      await PrivateClassSchedule.findByIdAndUpdate(inactiveRes.body.schedule._id, { isActive: false });

      // A coach with no active contract publishing a slot directly (bypassing
      // the create-route guard) must still be excluded from the public list.
      const noContractCoach = await seedUser({ role: 'coach', email: 'pcs-public-nc@example.com' });
      await PrivateClassSchedule.create({
        coachId: noContractCoach._id,
        dayOfWeek: 5,
        startTime: '19:00',
        durationMinutes: 60,
      });

      // No Authorization/cookie at all.
      const res = await request(app).get('/api/v1/private-class-schedules/public');

      expect(res.status).toBe(200);
      expect(res.body.coaches).toHaveLength(1);
      expect(res.body.coaches[0].coachId).toBe(String(coach._id));
      expect(res.body.coaches[0].slots).toHaveLength(1);

      const slot = res.body.coaches[0].slots[0];
      expect(slot.scheduleId).toBe(String(availableRes.body.schedule._id));
      expect(slot.sessionPrice).toBe(computeSessionPrice(60, 60));
      expect(slot.hourlyRate).toBe(60);
      expect(slot.dayName).toBe('Tuesday');
      // Raw "HH:mm" — the frontend formats it (lib/formatTime.ts), never
      // the backend. Regression lock: a redundant `displayTime` field
      // (byte-identical to startTime, but named as if pre-formatted) used
      // to sit here too and was the exact trap that shipped 24-hour times
      // to parents on /private-classes and /parent/register-private —
      // never reintroduce it.
      expect(slot.startTime).toBe('16:00');
      expect(slot).not.toHaveProperty('displayTime');
      // No student/parent data leaks.
      expect(JSON.stringify(res.body)).not.toContain('email');
    });

    // orphaned-coach-reference-fix-plan D1 — reproduces the live
    // /private-classes 500: a coach hard-deleted (bypassing the D5
    // delete-guard, simulating a pre-existing orphan from before that guard
    // shipped) leaves a free PrivateClassSchedule with a coachId that no
    // longer resolves. The endpoint must degrade (exclude the slot), not
    // crash on the null populate.
    it('excludes a slot whose coach was deleted, instead of crashing', async () => {
      const coach = await seedCoachWithContract({ email: 'pcs-orphan@example.com' });
      const coachAgent = await loginAgent('pcs-orphan@example.com');
      await coachAgent
        .post('/api/v1/private-class-schedules')
        .send({ dayOfWeek: 2, startTime: '16:00', durationMinutes: 60 });

      await User.deleteOne({ _id: coach._id });

      const res = await request(app).get('/api/v1/private-class-schedules/public');

      expect(res.status).toBe(200);
      expect(res.body.coaches).toHaveLength(0);
    });

    it('firstSessionDate is strictly after "today", never today itself', async () => {
      // Fakes ONLY Date (via `now`) and explicitly leaves every timer
      // function real — faking setTimeout/setImmediate/nextTick here would
      // hang the real Mongo driver + supertest's HTTP round trip this test
      // still needs to make.
      jest.useFakeTimers({
        now: new Date('2026-08-25T12:00:00.000Z'), // a Tuesday, UTC midday
        doNotFake: [
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
          'setImmediate',
          'clearImmediate',
          'nextTick',
        ],
      });

      try {
        const coach = await seedCoachWithContract({ email: 'pcs-public2@example.com' });
        const coachAgent = await loginAgent('pcs-public2@example.com');

        // dayOfWeek 2 = Tuesday, same day as "today" in the frozen clock.
        await coachAgent
          .post('/api/v1/private-class-schedules')
          .send({ dayOfWeek: 2, startTime: '16:00', durationMinutes: 60 });

        const res = await request(app).get('/api/v1/private-class-schedules/public');

        expect(res.status).toBe(200);
        const firstSessionDate = new Date(res.body.coaches[0].slots[0].firstSessionDate);
        // Strictly after today (Aug 25) -> the NEXT Tuesday, Sept 1, not today.
        expect(firstSessionDate.getTime()).toBeGreaterThan(new Date('2026-08-25T23:59:59.999Z').getTime());
        expect(String(coach._id)).toBe(res.body.coaches[0].coachId);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
