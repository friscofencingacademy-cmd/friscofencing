process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

// mail.service is mocked (same rationale as registration.routes.test.js) —
// this suite is about attendance/charge behavior, not email content.
jest.mock('../../src/services/mail.service');

// STRIPE_SECRET_KEY must be loaded from the real .env BEFORE app.js is
// required — this suite hits Stripe's real TEST-mode API for real charges,
// same convention as registration.routes.test.js.
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const request = require('supertest');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const PrivateClassSchedule = require('../../src/models/privateClassSchedule.model');
const PrivateClassEnrollment = require('../../src/models/privateClassEnrollment.model');
const PrivateClassSession = require('../../src/models/privateClassSession.model');
const { PerSessionRegistration } = require('../../src/models/registration.model');
const PaymentMethod = require('../../src/models/paymentMethod.model');
const stripe = require('../../src/config/stripe');
const { hashPassword } = require('../../src/utils/password');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');
const { computeSessionPrice } = require('../../src/utils/privateClassPricing');
const privateClassSessionService = require('../../src/services/privateClassSession.service');
const { seedServices } = require('../../scripts/lib/seedServices');

const TEST_PASSWORD = 'correct-password';
const HOURLY_RATE = 60;

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

beforeEach(async () => {
  // Coach contract setup + chargeSession() itself both resolve the
  // private-lessons Service now (docs/plans/service-registry-unified-
  // ledger-plan.md).
  await seedServices();
});

afterEach(async () => {
  await clearTestDB();
  jest.restoreAllMocks();
});

async function seedUser(overrides = {}) {
  const passwordHash = await hashPassword(TEST_PASSWORD);
  return User.create({ firstName: 'Test', lastName: 'User', passwordHash, ...overrides });
}

async function loginAgent(email) {
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD });
  return agent;
}

async function mintTestPaymentMethodId() {
  const paymentMethod = await stripe.paymentMethods.create({ type: 'card', card: { token: 'tok_visa' } });
  return paymentMethod.id;
}

async function savePaymentMethodFor(parentAgent) {
  const stripePaymentMethodId = await mintTestPaymentMethodId();
  const res = await parentAgent.post('/api/v1/payment-methods').send({ stripePaymentMethodId });
  expect(res.status).toBe(201);
}

// Builds a fully self-registered enrollment (coach + active contract +
// slot + parent + student + saved card + POST /private-class-enrollments),
// then backdates its FIRST generated session to `startDate` (default: an
// hour ago) so attendance can be marked against it. Returns everything the
// caller might need.
async function seedEnrollmentWithPastSession({
  suffix,
  startDate = new Date(Date.now() - 60 * 60 * 1000),
  durationMinutes = 60,
}) {
  const coach = await seedUser({ role: 'coach', email: `pcsess-coach-${suffix}@example.com` });
  const adminEmail = `pcsess-admin-${suffix}-${Date.now()}-${Math.random()}@example.com`;
  await seedUser({ role: 'admin', email: adminEmail });
  const adminAgent = await loginAgent(adminEmail);

  await adminAgent.post('/api/v1/coach-contracts').send({
    coachId: coach._id.toString(),
    studentBillingRate: HOURLY_RATE,
    coachCompensationRate: 35,
  });

  const coachAgent = await loginAgent(`pcsess-coach-${suffix}@example.com`);
  const scheduleRes = await coachAgent
    .post('/api/v1/private-class-schedules')
    .send({ dayOfWeek: 2, startTime: '16:00', durationMinutes });

  const parent = await seedUser({ role: 'parent', email: `pcsess-parent-${suffix}@example.com` });
  const student = await User.create({ role: 'student', firstName: 'Kid', lastName: suffix, parentId: parent._id });
  const parentAgent = await loginAgent(`pcsess-parent-${suffix}@example.com`);
  await savePaymentMethodFor(parentAgent);

  const enrollRes = await parentAgent.post('/api/v1/private-class-enrollments').send({
    studentId: student._id.toString(),
    scheduleId: scheduleRes.body.schedule._id,
  });
  expect(enrollRes.status).toBe(201);

  const enrollmentId = enrollRes.body.enrollment._id;
  const sessions = await PrivateClassSession.find({ enrollmentId }).sort({ startDate: 1 });
  const target = sessions[0];

  const endDate = new Date(startDate.getTime() + durationMinutes * 60000);
  await PrivateClassSession.findByIdAndUpdate(target._id, { startDate, endDate });

  return {
    coach,
    coachAgent,
    parent,
    parentAgent,
    student,
    enrollmentId,
    sessionId: target._id.toString(),
  };
}

describe('Private class session routes', () => {
  describe('PATCH /api/v1/private-class-sessions/:id/attendance', () => {
    it(
      "marks attended, charges completed for rate x duration/60, and sends the receipt email",
      async () => {
        const { coachAgent, sessionId } = await seedEnrollmentWithPastSession({ suffix: 'attend1' });

        const res = await coachAgent
          .patch(`/api/v1/private-class-sessions/${sessionId}/attendance`)
          .send({ status: 'attended' });

        expect(res.status).toBe(200);
        expect(res.body.session.attendance).toBe('attended');
        expect(res.body.charged).toBe(true);
        expect(res.body.charge.status).toBe('completed');
        expect(res.body.charge.amount).toBe(computeSessionPrice(HOURLY_RATE, 60));

        const chargeInDb = await PerSessionRegistration.findOne({ sessionId });
        expect(chargeInDb.status).toBe('completed');
        expect(chargeInDb.stripePaymentIntentId).toBeTruthy();

        const mailService = require('../../src/services/mail.service');
        expect(mailService.sendPrivateClassSessionReceiptEmail).toHaveBeenCalled();
      },
      20000
    );

    it('returns 400 for a session that has not yet occurred', async () => {
      const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const { coachAgent, sessionId } = await seedEnrollmentWithPastSession({
        suffix: 'future1',
        startDate: futureStart,
      });

      const res = await coachAgent
        .patch(`/api/v1/private-class-sessions/${sessionId}/attendance`)
        .send({ status: 'attended' });

      expect(res.status).toBe(400);
    });

    it('ownership regression: a different coach gets 403; the assigned coach and an admin both succeed', async () => {
      const { sessionId } = await seedEnrollmentWithPastSession({ suffix: 'owner1' });

      await seedUser({ role: 'coach', email: 'pcsess-other-coach@example.com' });
      const otherCoachAgent = await loginAgent('pcsess-other-coach@example.com');

      const forbiddenRes = await otherCoachAgent
        .patch(`/api/v1/private-class-sessions/${sessionId}/attendance`)
        .send({ status: 'missed' });
      expect(forbiddenRes.status).toBe(403);

      await seedUser({ role: 'admin', email: 'pcsess-owner-admin@example.com' });
      const adminAgent = await loginAgent('pcsess-owner-admin@example.com');

      const adminRes = await adminAgent
        .patch(`/api/v1/private-class-sessions/${sessionId}/attendance`)
        .send({ status: 'missed' });
      expect(adminRes.status).toBe(200);
    }, 20000);

    it('marking missed records no charge', async () => {
      const { coachAgent, sessionId } = await seedEnrollmentWithPastSession({ suffix: 'missed1' });

      const res = await coachAgent
        .patch(`/api/v1/private-class-sessions/${sessionId}/attendance`)
        .send({ status: 'missed' });

      expect(res.status).toBe(200);
      expect(res.body.session.attendance).toBe('missed');
      expect(res.body.charged).toBe(false);
      expect(await PerSessionRegistration.countDocuments({ sessionId })).toBe(0);
    }, 20000);

    it('idempotency: marking attended twice results in exactly one non-failed charge', async () => {
      const { coachAgent, sessionId } = await seedEnrollmentWithPastSession({ suffix: 'idem1' });

      const firstRes = await coachAgent
        .patch(`/api/v1/private-class-sessions/${sessionId}/attendance`)
        .send({ status: 'attended' });
      expect(firstRes.status).toBe(200);
      expect(firstRes.body.charge.status).toBe('completed');

      const secondRes = await coachAgent
        .patch(`/api/v1/private-class-sessions/${sessionId}/attendance`)
        .send({ status: 'attended' });
      expect(secondRes.status).toBe(200);
      expect(secondRes.body.charged).toBe(true);

      const charges = await PerSessionRegistration.find({ sessionId, status: { $in: ['pending', 'completed'] } });
      expect(charges).toHaveLength(1);
    }, 30000);

    it('a genuine race between two concurrent charge attempts still produces exactly one non-failed charge (E11000 dedup)', async () => {
      const { sessionId } = await seedEnrollmentWithPastSession({ suffix: 'race1' });
      const session = await PrivateClassSession.findById(sessionId);
      const requestingUser = { role: 'admin' };

      const [first, second] = await Promise.all([
        privateClassSessionService.markAttendance(sessionId, 'attended', requestingUser),
        privateClassSessionService.markAttendance(sessionId, 'attended', requestingUser),
      ]);

      expect([first.charged, second.charged]).toContain(true);

      const nonFailedCharges = await PerSessionRegistration.find({
        sessionId,
        status: { $in: ['pending', 'completed'] },
      });
      expect(nonFailedCharges).toHaveLength(1);
    }, 30000);

    it('cancel-then-charge race: enrollment cancelled before the session date -> attendance recorded, charged:false, zero Stripe calls', async () => {
      const { parentAgent, enrollmentId, sessionId } = await seedEnrollmentWithPastSession({
        suffix: 'cancelrace1',
      });

      // Cancel BEFORE the session's start (a delivered-nothing cancellation).
      const session = await PrivateClassSession.findById(sessionId);
      await PrivateClassEnrollment.findByIdAndUpdate(enrollmentId, {
        status: 'cancelled',
        endDate: new Date(session.startDate.getTime() - 60 * 60 * 1000),
      });

      const createSpy = jest.spyOn(stripe.paymentIntents, 'create');

      const coach = await User.findOne({ role: 'coach' });
      const coachAgent = await loginAgent(coach.email);

      const res = await coachAgent
        .patch(`/api/v1/private-class-sessions/${sessionId}/attendance`)
        .send({ status: 'attended' });

      expect(res.status).toBe(200);
      expect(res.body.session.attendance).toBe('attended');
      expect(res.body.charged).toBe(false);
      expect(res.body.reason).toBe('enrollment_cancelled');
      expect(createSpy).not.toHaveBeenCalled();
      expect(await PerSessionRegistration.countDocuments({ sessionId })).toBe(0);
    }, 20000);

    it('delivered-before-cancellation: session start is before the cancellation endDate -> still charges', async () => {
      const { parentAgent, enrollmentId, sessionId } = await seedEnrollmentWithPastSession({
        suffix: 'deliveredrace1',
      });

      const session = await PrivateClassSession.findById(sessionId);
      // Cancellation endDate is AFTER the session's start -> this session was
      // delivered before the cancellation took effect.
      await PrivateClassEnrollment.findByIdAndUpdate(enrollmentId, {
        status: 'cancelled',
        endDate: new Date(session.startDate.getTime() + 60 * 60 * 1000),
      });

      const coach = await User.findOne({ role: 'coach' });
      const coachAgent = await loginAgent(coach.email);

      const res = await coachAgent
        .patch(`/api/v1/private-class-sessions/${sessionId}/attendance`)
        .send({ status: 'attended' });

      expect(res.status).toBe(200);
      expect(res.body.charged).toBe(true);
    }, 20000);

    it(
      'a declined card fails the charge and sends the failure email; retry with a fresh attempt succeeds',
      async () => {
        const { parent, coachAgent, sessionId } = await seedEnrollmentWithPastSession({
          suffix: 'decline1',
        });

        await PaymentMethod.updateOne(
          { parentId: parent._id },
          { stripePaymentMethodId: 'pm_card_chargeDeclined' }
        );

        const attendRes = await coachAgent
          .patch(`/api/v1/private-class-sessions/${sessionId}/attendance`)
          .send({ status: 'attended' });

        expect(attendRes.status).toBe(200);
        expect(attendRes.body.session.attendance).toBe('attended');
        expect(attendRes.body.charged).toBe(false);
        expect(attendRes.body.chargeStatus).toBe('failed');

        const mailService = require('../../src/services/mail.service');
        expect(mailService.sendPrivateClassPaymentFailedEmail).toHaveBeenCalled();

        const failedCharge = await PerSessionRegistration.findOne({ sessionId });
        expect(failedCharge.attempt).toBe(1);

        // Fix the card, then retry.
        await PaymentMethod.updateOne({ parentId: parent._id }, { stripePaymentMethodId: (await mintTestPaymentMethodId()) });

        const retryRes = await coachAgent.post(`/api/v1/private-class-sessions/${sessionId}/retry-charge`);

        expect(retryRes.status).toBe(200);
        expect(retryRes.body.charged).toBe(true);
        expect(retryRes.body.charge.attempt).toBe(2);
        expect(retryRes.body.charge.status).toBe('completed');
      },
      30000
    );

    it('returns 409 when attempting attended -> missed after a completed charge', async () => {
      const { coachAgent, sessionId } = await seedEnrollmentWithPastSession({ suffix: 'flip1' });

      const attendRes = await coachAgent
        .patch(`/api/v1/private-class-sessions/${sessionId}/attendance`)
        .send({ status: 'attended' });
      expect(attendRes.body.charge.status).toBe('completed');

      const flipRes = await coachAgent
        .patch(`/api/v1/private-class-sessions/${sessionId}/attendance`)
        .send({ status: 'missed' });

      expect(flipRes.status).toBe(409);
    }, 20000);
  });

  describe('POST /api/v1/private-class-sessions/:id/retry-charge', () => {
    it('returns 409 when the latest charge is not failed', async () => {
      const { coachAgent, sessionId } = await seedEnrollmentWithPastSession({ suffix: 'retryguard1' });

      const res = await coachAgent.post(`/api/v1/private-class-sessions/${sessionId}/retry-charge`);
      expect(res.status).toBe(409);
    });
  });

  describe('GET /api/v1/private-class-sessions/mine', () => {
    it('enriches each session with a computed sessionPrice and a populated parent name, filtered by window', async () => {
      const { coachAgent, parent, sessionId } = await seedEnrollmentWithPastSession({
        suffix: 'listmine1',
      });

      const unmarkedRes = await coachAgent.get('/api/v1/private-class-sessions/mine?window=unmarked');
      expect(unmarkedRes.status).toBe(200);
      expect(unmarkedRes.body.sessions).toHaveLength(1);
      expect(unmarkedRes.body.sessions[0]._id).toBe(sessionId);
      expect(unmarkedRes.body.sessions[0].sessionPrice).toBe(computeSessionPrice(HOURLY_RATE, 60));
      expect(unmarkedRes.body.sessions[0].parentId.firstName).toBe(parent.firstName);

      const upcomingRes = await coachAgent.get('/api/v1/private-class-sessions/mine?window=upcoming');
      // 7 of the 8 generated sessions remain in the future (one was
      // backdated by the test helper).
      expect(upcomingRes.body.sessions).toHaveLength(7);
    });
  });
});
