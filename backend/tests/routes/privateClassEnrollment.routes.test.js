process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

// mail.service is mocked (same rationale as registration.routes.test.js) —
// this suite is about enrollment/slot-claim/cancellation behavior, not
// email content (mail.service.test.js and the Phase 2 renderEmail suite
// cover that).
jest.mock('../../src/services/mail.service');

// STRIPE_SECRET_KEY must be loaded from the real .env BEFORE app.js is
// required — savePaymentMethodFor hits Stripe's real TEST-mode API.
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const request = require('supertest');
const mongoose = require('mongoose');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const CoachContract = require('../../src/models/coachContract.model');
const PrivateClassSchedule = require('../../src/models/privateClassSchedule.model');
const PrivateClassEnrollment = require('../../src/models/privateClassEnrollment.model');
const PrivateClassSession = require('../../src/models/privateClassSession.model');
const stripe = require('../../src/config/stripe');
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

async function mintTestPaymentMethodId() {
  const paymentMethod = await stripe.paymentMethods.create({
    type: 'card',
    card: { token: 'tok_visa' },
  });
  return paymentMethod.id;
}

async function savePaymentMethodFor(parentAgent) {
  const stripePaymentMethodId = await mintTestPaymentMethodId();
  const res = await parentAgent.post('/api/v1/payment-methods').send({ stripePaymentMethodId });
  expect(res.status).toBe(201);
}

async function seedCoachWithSlot({ suffix, studentBillingRate = 65 }) {
  const coach = await seedUser({ role: 'coach', email: `pce-coach-${suffix}@example.com` });
  const adminEmail = `pce-admin-${suffix}-${Date.now()}-${Math.random()}@example.com`;
  await seedUser({ role: 'admin', email: adminEmail });
  const adminAgent = await loginAgent(adminEmail);

  const contractRes = await adminAgent.post('/api/v1/coach-contracts').send({
    coachId: coach._id.toString(),
    studentBillingRate,
    coachCompensationRate: 40,
  });
  const contract = await CoachContract.findById(contractRes.body.contract._id);

  const coachAgent = await loginAgent(`pce-coach-${suffix}@example.com`);
  const scheduleRes = await coachAgent
    .post('/api/v1/private-class-schedules')
    .send({ dayOfWeek: 2, startTime: '16:00', durationMinutes: 60 });

  return { coach, contract, schedule: scheduleRes.body.schedule };
}

async function seedParentAndStudent(suffix) {
  const parent = await seedUser({ role: 'parent', email: `pce-parent-${suffix}@example.com` });
  const student = await User.create({
    role: 'student',
    firstName: 'Kid',
    lastName: suffix,
    parentId: parent._id,
  });
  return { parent, student };
}

describe('Private class enrollment routes', () => {
  describe('POST /api/v1/private-class-enrollments', () => {
    it(
      'self-registers: enrollment active, rate pinned from the contract, slot claimed, 8 sessions generated, confirmation email sent',
      async () => {
        const { coach, schedule } = await seedCoachWithSlot({ suffix: 'happy', studentBillingRate: 65 });
        const { student } = await seedParentAndStudent('happy');
        const parentAgent = await loginAgent('pce-parent-happy@example.com');
        await savePaymentMethodFor(parentAgent);

        const res = await parentAgent.post('/api/v1/private-class-enrollments').send({
          studentId: student._id.toString(),
          scheduleId: schedule._id,
        });

        expect(res.status).toBe(201);
        expect(res.body.enrollment.status).toBe('active');
        expect(res.body.enrollment.agreedHourlyRate).toBe(65);
        expect(res.body.sessionPrice).toBe(65);
        expect(res.body.firstSessionDate).toBeDefined();

        const claimedSchedule = await PrivateClassSchedule.findById(schedule._id);
        expect(String(claimedSchedule.studentId)).toBe(String(student._id));
        expect(String(claimedSchedule.enrollmentId)).toBe(String(res.body.enrollment._id));

        const sessions = await PrivateClassSession.find({ enrollmentId: res.body.enrollment._id });
        expect(sessions).toHaveLength(8);
        sessions.forEach((session) => {
          expect(String(session.coachId)).toBe(String(coach._id));
          expect(String(session.studentId)).toBe(String(student._id));
          expect(session.attendance).toBe('scheduled');
        });

        const mailService = require('../../src/services/mail.service');
        expect(mailService.sendPrivateClassConfirmationEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            student: expect.objectContaining({ firstName: 'Kid' }),
          })
        );
      },
      20000
    );

    it('returns 403 when registering a child belonging to a different parent', async () => {
      const { schedule } = await seedCoachWithSlot({ suffix: 'notmychild' });
      await seedUser({ role: 'parent', email: 'pce-parent-wrong@example.com' });
      const { student } = await seedParentAndStudent('notmychildowner');
      const parentAgent = await loginAgent('pce-parent-wrong@example.com');

      const res = await parentAgent.post('/api/v1/private-class-enrollments').send({
        studentId: student._id.toString(),
        scheduleId: schedule._id,
      });

      expect(res.status).toBe(403);
    });

    it('returns 400 when the parent has no payment method on file', async () => {
      const { schedule } = await seedCoachWithSlot({ suffix: 'nopm' });
      const { student } = await seedParentAndStudent('nopm');
      const parentAgent = await loginAgent('pce-parent-nopm@example.com');

      const res = await parentAgent.post('/api/v1/private-class-enrollments').send({
        studentId: student._id.toString(),
        scheduleId: schedule._id,
      });

      expect(res.status).toBe(400);
      expect(await PrivateClassEnrollment.countDocuments({ studentId: student._id })).toBe(0);
    });

    it('returns 409 when the coach has no active contract', async () => {
      const coach = await seedUser({ role: 'coach', email: 'pce-nocontract-coach@example.com' });
      const schedule = await PrivateClassSchedule.create({
        coachId: coach._id,
        dayOfWeek: 2,
        startTime: '16:00',
        durationMinutes: 60,
      });
      const { student } = await seedParentAndStudent('nocontract');
      const parentAgent = await loginAgent('pce-parent-nocontract@example.com');
      await savePaymentMethodFor(parentAgent);

      const res = await parentAgent.post('/api/v1/private-class-enrollments').send({
        studentId: student._id.toString(),
        scheduleId: schedule._id.toString(),
      });

      expect(res.status).toBe(409);
    });

    it(
      'slot race regression: pre-claiming the slot returns 409 and leaves no orphan enrollment',
      async () => {
        const { schedule } = await seedCoachWithSlot({ suffix: 'race' });
        const { student } = await seedParentAndStudent('race');
        const parentAgent = await loginAgent('pce-parent-race@example.com');
        await savePaymentMethodFor(parentAgent);

        // Simulate another parent winning the race a moment earlier.
        const otherStudent = await User.create({ role: 'student', firstName: 'Other', lastName: 'Kid' });
        await PrivateClassSchedule.findByIdAndUpdate(schedule._id, {
          studentId: otherStudent._id,
          enrollmentId: new mongoose.Types.ObjectId(),
        });

        const res = await parentAgent.post('/api/v1/private-class-enrollments').send({
          studentId: student._id.toString(),
          scheduleId: schedule._id,
        });

        expect(res.status).toBe(409);
        expect(await PrivateClassEnrollment.countDocuments({ studentId: student._id })).toBe(0);
      },
      20000
    );

    it(
      'rate-pin regression: a contract rate change after enrollment does not change the pinned agreedHourlyRate',
      async () => {
        const { coach, schedule } = await seedCoachWithSlot({ suffix: 'ratepin', studentBillingRate: 65 });
        const { student } = await seedParentAndStudent('ratepin');
        const parentAgent = await loginAgent('pce-parent-ratepin@example.com');
        await savePaymentMethodFor(parentAgent);

        const res = await parentAgent.post('/api/v1/private-class-enrollments').send({
          studentId: student._id.toString(),
          scheduleId: schedule._id,
        });
        expect(res.status).toBe(201);
        expect(res.body.enrollment.agreedHourlyRate).toBe(65);

        // Contract rate changes after enrollment (a new contract raises the rate).
        const adminEmail = `pce-ratepin-admin-${Date.now()}@example.com`;
        await seedUser({ role: 'admin', email: adminEmail });
        const adminAgent = await loginAgent(adminEmail);
        await adminAgent.post('/api/v1/coach-contracts').send({
          coachId: coach._id.toString(),
          studentBillingRate: 90,
          coachCompensationRate: 50,
        });

        const enrollmentAfter = await PrivateClassEnrollment.findById(res.body.enrollment._id);
        expect(enrollmentAfter.agreedHourlyRate).toBe(65);
      },
      20000
    );
  });

  describe('POST /api/v1/private-class-enrollments/:id/cancel', () => {
    it(
      'frees the slot, deletes only future sessions, keeps past ones, and sends the cancellation email',
      async () => {
        const { schedule } = await seedCoachWithSlot({ suffix: 'cancel1' });
        const { student } = await seedParentAndStudent('cancel1');
        const parentAgent = await loginAgent('pce-parent-cancel1@example.com');
        await savePaymentMethodFor(parentAgent);

        const createRes = await parentAgent.post('/api/v1/private-class-enrollments').send({
          studentId: student._id.toString(),
          scheduleId: schedule._id,
        });
        const enrollmentId = createRes.body.enrollment._id;

        // Backdate one session into the past to prove it survives cancellation.
        const sessions = await PrivateClassSession.find({ enrollmentId }).sort({ startDate: 1 });
        await PrivateClassSession.findByIdAndUpdate(sessions[0]._id, {
          startDate: new Date('2020-01-01T16:00:00.000Z'),
          endDate: new Date('2020-01-01T17:00:00.000Z'),
        });

        const res = await parentAgent.post(`/api/v1/private-class-enrollments/${enrollmentId}/cancel`);

        expect(res.status).toBe(200);
        expect(res.body.enrollment.status).toBe('cancelled');

        const freedSchedule = await PrivateClassSchedule.findById(schedule._id);
        expect(freedSchedule.studentId).toBeNull();
        expect(freedSchedule.enrollmentId).toBeNull();

        const remainingSessions = await PrivateClassSession.find({ enrollmentId });
        expect(remainingSessions).toHaveLength(1);
        expect(remainingSessions[0].startDate.getTime()).toBe(new Date('2020-01-01T16:00:00.000Z').getTime());

        const mailService = require('../../src/services/mail.service');
        expect(mailService.sendPrivateClassCancellationEmail).toHaveBeenCalled();
      },
      20000
    );

    it('returns 409 on a double-cancel', async () => {
      const { schedule } = await seedCoachWithSlot({ suffix: 'cancel2' });
      const { student } = await seedParentAndStudent('cancel2');
      const parentAgent = await loginAgent('pce-parent-cancel2@example.com');
      await savePaymentMethodFor(parentAgent);

      const createRes = await parentAgent.post('/api/v1/private-class-enrollments').send({
        studentId: student._id.toString(),
        scheduleId: schedule._id,
      });
      const enrollmentId = createRes.body.enrollment._id;

      const firstCancel = await parentAgent.post(`/api/v1/private-class-enrollments/${enrollmentId}/cancel`);
      expect(firstCancel.status).toBe(200);

      const secondCancel = await parentAgent.post(`/api/v1/private-class-enrollments/${enrollmentId}/cancel`);
      expect(secondCancel.status).toBe(409);
    }, 20000);

    it('returns 403 when a different parent attempts to cancel', async () => {
      const { schedule } = await seedCoachWithSlot({ suffix: 'cancel3' });
      const { student } = await seedParentAndStudent('cancel3');
      const parentAgent = await loginAgent('pce-parent-cancel3@example.com');
      await savePaymentMethodFor(parentAgent);

      const createRes = await parentAgent.post('/api/v1/private-class-enrollments').send({
        studentId: student._id.toString(),
        scheduleId: schedule._id,
      });

      await seedUser({ role: 'parent', email: 'pce-parent-cancel3-other@example.com' });
      const otherAgent = await loginAgent('pce-parent-cancel3-other@example.com');

      const res = await otherAgent.post(
        `/api/v1/private-class-enrollments/${createRes.body.enrollment._id}/cancel`
      );

      expect(res.status).toBe(403);
    }, 20000);
  });
});
