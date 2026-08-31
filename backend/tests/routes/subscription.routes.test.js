process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

// mail.service.js's own transport call is mocked at the nodemailer boundary
// (not the whole mail.service module) so this suite can assert on the
// ACTUAL rendered email content cancel()/reactivate() send, the same
// pattern mail.service.test.js itself uses — never real SMTP/Ethereal
// network activity.
jest.mock('nodemailer');

const request = require('supertest');
const mongoose = require('mongoose');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const Level = require('../../src/models/level.model');
const Location = require('../../src/models/location.model');
const GroupClass = require('../../src/models/groupClass.model');
const GroupClassSchedule = require('../../src/models/groupClassSchedule.model');
const Subscription = require('../../src/models/subscription.model');
const Registration = require('../../src/models/registration.model');
const { SubscriptionCycleRegistration } = require('../../src/models/registration.model');
const { hashPassword } = require('../../src/utils/password');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');
const { seedServices } = require('../../scripts/lib/seedServices');
const { getServiceByCode } = require('../../src/services/serviceCatalog.service');
const { addOneMonth } = require('../../src/utils/billingDates');

const TEST_PASSWORD = 'correct-password';

let mongod;
let nodemailer;
let sendMail;

beforeAll(async () => {
  mongod = await connectTestDB();

  // eslint-disable-next-line global-require
  nodemailer = require('nodemailer');
  sendMail = jest.fn().mockResolvedValue({ messageId: 'fake-message-id' });
  nodemailer.createTransport.mockReturnValue({ sendMail });
  nodemailer.createTestAccount.mockResolvedValue({
    user: 'ethereal-user',
    pass: 'ethereal-pass',
    smtp: { host: 'smtp.ethereal.email', port: 587, secure: false },
  });

  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(async () => {
  await disconnectTestDB(mongod);
  jest.restoreAllMocks();
});

afterEach(async () => {
  await clearTestDB();
  sendMail.mockClear();
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
// cancel()/reactivate() core writes — only the fire-and-forget email step
// looks them up, and that step degrades to '' on a miss (mail.service.js's
// scheduleLabel/fullName null-guards) rather than throwing — so a bare,
// unrelated ObjectId is enough for tests that don't care about email
// CONTENT, only that cancel/reactivate itself still succeeds.
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

// Builds a real level/location/class/schedule (with a real coach) via the
// real create route so the level relationship + roster/session generation
// are the real production ones — used by the changeSchedule happy-path and
// list-populate-shape tests.
async function seedSchedule({ levelName = 'Level', levelOrder = 1, capacity = 10 } = {}) {
  const level = await Level.create({ name: levelName, order: levelOrder });
  const location = await Location.create({ name: `${levelName} HQ`, address: '123 Main St' });
  const groupClass = await GroupClass.create({
    name: `${levelName} Foil`,
    levelId: level._id,
    locationId: location._id,
    capacity,
  });

  const coach = await User.create({
    role: 'coach',
    firstName: 'Coach',
    lastName: levelName,
    email: `coach-${levelName}-${Date.now()}-${Math.random()}@example.com`,
    passwordHash: await hashPassword(TEST_PASSWORD),
  });

  const adminEmail = `admin-${levelName}-${Date.now()}-${Math.random()}@example.com`;
  await seedUser({ role: 'admin', email: adminEmail });
  const adminAgent = await loginAgent(adminEmail);

  const scheduleRes = await adminAgent.post('/api/v1/group-class-schedules').send({
    classId: groupClass._id.toString(),
    coachId: coach._id.toString(),
    dayOfWeek: 3,
    startTime: '16:00',
    endTime: '17:00',
    students: [],
  });

  return { schedule: scheduleRes.body.schedule, level, location, groupClass, coach };
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

    it('sends a cancellation confirmation email to the parent', async () => {
      const parent = await seedUser({ role: 'parent', email: 'sub-parent-email@example.com' });
      const parentAgent = await loginAgent('sub-parent-email@example.com');

      const subscription = await buildSubscription({ parentId: parent._id });

      const res = await parentAgent.post(`/api/v1/subscriptions/${subscription._id}/cancel`);

      expect(res.status).toBe(200);
      expect(sendMail).toHaveBeenCalledTimes(1);
      const call = sendMail.mock.calls[0][0];
      expect(call.to).toBe('sub-parent-email@example.com');
      expect(call.subject.toLowerCase()).toContain('cancellation');
    });

    it('still cancels even when the email send rejects', async () => {
      sendMail.mockRejectedValueOnce(new Error('SMTP exploded'));

      const parent = await seedUser({ role: 'parent', email: 'sub-parent-rejects@example.com' });
      const parentAgent = await loginAgent('sub-parent-rejects@example.com');

      const subscription = await buildSubscription({ parentId: parent._id });

      const res = await parentAgent.post(`/api/v1/subscriptions/${subscription._id}/cancel`);

      expect(res.status).toBe(200);
      expect(res.body.subscription.cancelAtPeriodEnd).toBe(true);
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

  describe('POST /api/v1/subscriptions/:id/reactivate', () => {
    it('lets the owning parent reactivate a pending-cancel subscription and sends the email', async () => {
      const parent = await seedUser({ role: 'parent', email: 'react-parent1@example.com' });
      const parentAgent = await loginAgent('react-parent1@example.com');

      const subscription = await buildSubscription({
        parentId: parent._id,
        cancelAtPeriodEnd: true,
        lastChargeAmount: 150,
        lastSiblingDiscountApplied: false,
      });

      const res = await parentAgent.post(`/api/v1/subscriptions/${subscription._id}/reactivate`);

      expect(res.status).toBe(200);
      expect(res.body.subscription.cancelAtPeriodEnd).toBe(false);
      expect(res.body.subscription.status).toBe('active');
      // Reactivation never touches billing/record-keeping fields.
      expect(res.body.subscription.lastChargeAmount).toBe(150);

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(sendMail.mock.calls[0][0].to).toBe('react-parent1@example.com');
    });

    it('returns 409 when the subscription is not pending cancellation', async () => {
      const parent = await seedUser({ role: 'parent', email: 'react-parent2@example.com' });
      const parentAgent = await loginAgent('react-parent2@example.com');

      const subscription = await buildSubscription({ parentId: parent._id, cancelAtPeriodEnd: false });

      const res = await parentAgent.post(`/api/v1/subscriptions/${subscription._id}/reactivate`);

      expect(res.status).toBe(409);
    });

    it('returns 403 when a different parent attempts to reactivate', async () => {
      const owner = await seedUser({ role: 'parent', email: 'react-owner3@example.com' });
      await seedUser({ role: 'parent', email: 'react-other3@example.com' });
      const otherParentAgent = await loginAgent('react-other3@example.com');

      const subscription = await buildSubscription({ parentId: owner._id, cancelAtPeriodEnd: true });

      const res = await otherParentAgent.post(`/api/v1/subscriptions/${subscription._id}/reactivate`);

      expect(res.status).toBe(403);

      const inDb = await Subscription.findById(subscription._id);
      expect(inDb.cancelAtPeriodEnd).toBe(true);
    });

    it('lets an admin reactivate any subscription', async () => {
      const parent = await seedUser({ role: 'parent', email: 'react-parent4@example.com' });
      await seedUser({ role: 'admin', email: 'react-admin4@example.com' });
      const adminAgent = await loginAgent('react-admin4@example.com');

      const subscription = await buildSubscription({ parentId: parent._id, cancelAtPeriodEnd: true });

      const res = await adminAgent.post(`/api/v1/subscriptions/${subscription._id}/reactivate`);

      expect(res.status).toBe(200);
      expect(res.body.subscription.cancelAtPeriodEnd).toBe(false);
    });

    it('returns 404 when the subscription does not exist', async () => {
      await seedUser({ role: 'parent', email: 'react-parent5@example.com' });
      const parentAgent = await loginAgent('react-parent5@example.com');

      const res = await parentAgent.post(
        `/api/v1/subscriptions/${new mongoose.Types.ObjectId()}/reactivate`
      );

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/subscriptions', () => {
    it('returns 403 for a parent', async () => {
      const parentAgent = await loginAgent(
        (await seedUser({ role: 'parent', email: 'list-parent1@example.com' })).email
      );

      const res = await parentAgent.get('/api/v1/subscriptions');

      expect(res.status).toBe(403);
    });

    it('returns a populated, paginated list for admin with status filtering', async () => {
      const { schedule } = await seedSchedule({ levelName: 'ListLevel', levelOrder: 30 });
      const parent = await seedUser({ role: 'parent', email: 'list-parent2@example.com' });
      const student = await User.create({
        role: 'student',
        firstName: 'Kid',
        lastName: 'List',
        parentId: parent._id,
      });
      // A second, sibling student — a student can hold at most ONE active
      // subscription at all, on any schedule (Guard A, subscription.model
      // .js's partial unique index on {studentId, status:'active'} —
      // originally docs/plans/registration-ledger-plan.md D2, tightened
      // from {studentId, scheduleId} by docs/decisions/005-one-active-
      // subscription-per-student.md), so this fixture uses two students the
      // way it would actually happen in production, rather than colliding
      // on one.
      const sibling = await User.create({
        role: 'student',
        firstName: 'Kid',
        lastName: 'ListSibling',
        parentId: parent._id,
      });

      await Subscription.create({
        studentId: student._id,
        scheduleId: schedule._id,
        parentId: parent._id,
        status: 'active',
        cancelAtPeriodEnd: false,
        currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
        nextBillingDate: new Date('2026-02-01T00:00:00.000Z'),
      });
      await Subscription.create({
        studentId: sibling._id,
        scheduleId: schedule._id,
        parentId: parent._id,
        status: 'active',
        cancelAtPeriodEnd: true,
        currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
        nextBillingDate: new Date('2026-02-01T00:00:00.000Z'),
      });

      await seedUser({ role: 'admin', email: 'list-admin2@example.com' });
      const adminAgent = await loginAgent('list-admin2@example.com');

      const allRes = await adminAgent.get('/api/v1/subscriptions');
      expect(allRes.status).toBe(200);
      expect(allRes.body.total).toBe(2);
      expect(allRes.body.subscriptions[0].studentId.firstName).toBe('Kid');
      expect(allRes.body.subscriptions[0].scheduleId.classId.levelId.name).toBe('ListLevel');

      const activeRes = await adminAgent.get('/api/v1/subscriptions?status=active');
      expect(activeRes.body.total).toBe(1);
      expect(activeRes.body.subscriptions[0].cancelAtPeriodEnd).toBe(false);

      const pendingRes = await adminAgent.get('/api/v1/subscriptions?status=pending_cancel');
      expect(pendingRes.body.total).toBe(1);
      expect(pendingRes.body.subscriptions[0].cancelAtPeriodEnd).toBe(true);

      const qRes = await adminAgent.get('/api/v1/subscriptions?q=list-parent2');
      expect(qRes.body.total).toBe(2);

      const qMissRes = await adminAgent.get('/api/v1/subscriptions?q=nobody-matches-this');
      expect(qMissRes.body.total).toBe(0);
    });

    it(
      "lastPayment is sourced from the Registration ledger's most recent completed row (fee included), " +
        'and null when no completed row exists yet — docs/plans/payment-airtight-plan.md D11',
      async () => {
        await seedServices();
        const { schedule } = await seedSchedule({ levelName: 'ListLastPayment', levelOrder: 31 });
        const parent = await seedUser({ role: 'parent', email: 'list-last-payment@example.com' });
        const paidStudent = await User.create({
          role: 'student',
          firstName: 'Paid',
          lastName: 'List',
          parentId: parent._id,
        });
        const neverPaidStudent = await User.create({
          role: 'student',
          firstName: 'NeverPaid',
          lastName: 'List',
          parentId: parent._id,
        });

        const paidSubscription = await Subscription.create({
          studentId: paidStudent._id,
          scheduleId: schedule._id,
          parentId: parent._id,
          status: 'active',
          cancelAtPeriodEnd: false,
          currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
          nextBillingDate: new Date('2026-02-01T00:00:00.000Z'),
        });
        await Subscription.create({
          studentId: neverPaidStudent._id,
          scheduleId: schedule._id,
          parentId: parent._id,
          status: 'active',
          cancelAtPeriodEnd: false,
          currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
          nextBillingDate: new Date('2026-02-01T00:00:00.000Z'),
        });

        const groupClassesService = await getServiceByCode('group-classes', { requireActive: true });
        await SubscriptionCycleRegistration.create({
          serviceId: groupClassesService._id,
          subscriptionId: paidSubscription._id,
          scheduleId: schedule._id,
          studentId: paidStudent._id,
          parentId: parent._id,
          eventType: 'initial',
          status: 'completed',
          amount: 175, // monthly fee + a one-time registration fee bundled in
          chargeMethod: 'manual',
          manualNote: 'Paid by check',
          breakdown: { monthlyFee: 150, siblingDiscountApplied: false, siblingDiscountAmount: 0, registrationFeeCharged: 25 },
          periodStart: new Date('2026-01-01T00:00:00.000Z'),
          periodEnd: new Date('2026-02-01T00:00:00.000Z'),
          paidAt: new Date('2026-01-01T12:00:00.000Z'),
        });

        await seedUser({ role: 'admin', email: 'list-last-payment-admin@example.com' });
        const adminAgent = await loginAgent('list-last-payment-admin@example.com');

        const res = await adminAgent.get('/api/v1/subscriptions?q=list-last-payment');
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(2);

        const paidRow = res.body.subscriptions.find((s) => s.studentId.firstName === 'Paid');
        const neverPaidRow = res.body.subscriptions.find((s) => s.studentId.firstName === 'NeverPaid');

        // The real total (fee included), never Subscription.lastChargeAmount.
        expect(paidRow.lastPayment).toEqual(
          expect.objectContaining({ amount: 175, chargeMethod: 'manual' })
        );
        expect(neverPaidRow.lastPayment).toBeNull();
      }
    );
  });

  // Manual Charge button (docs/plans/manual-charge-and-pdf-invoice-plan.md
  // PR 1) — role-guard + wiring coverage only. Every fixture below is
  // deliberately built so the underlying renewOne/retryOne call never
  // reaches Stripe (not-due, pending-cancel-finalize, or no-payment-method
  // early-return branches), matching this file's existing no-real-Stripe-key
  // setup — the "does the amount match a real charge" property is covered
  // by the service-level suite (renewal.previewAndCharge.test.js), which
  // loads a real Stripe TEST-mode key the way renewal.service.test.js does.
  describe('GET /api/v1/subscriptions/:id/charge-preview', () => {
    it('returns 401 unauthenticated', async () => {
      const subscription = await buildSubscription({ parentId: new mongoose.Types.ObjectId() });

      const res = await request(app).get(`/api/v1/subscriptions/${subscription._id}/charge-preview`);

      expect(res.status).toBe(401);
    });

    it.each(['parent', 'admin', 'coach'])('returns 403 for role %s', async (role) => {
      const email = `charge-preview-403-${role}@example.com`;
      await seedUser({ role, email });
      const agent = await loginAgent(email);

      const subscription = await buildSubscription({ parentId: new mongoose.Types.ObjectId() });

      const res = await agent.get(`/api/v1/subscriptions/${subscription._id}/charge-preview`);

      expect(res.status).toBe(403);
    });

    it('returns a well-formed, not-due preview for superadmin — degrades to no_price when the schedule/price chain is unresolvable, never crashes (D9-style)', async () => {
      await seedUser({ role: 'superadmin', email: 'charge-preview-super1@example.com' });
      const superAgent = await loginAgent('charge-preview-super1@example.com');

      // Deliberately a bare, unresolvable scheduleId — this endpoint never
      // calls Stripe (previewRenewal is read-only, no getServiceByCode
      // call), so the amount-resolution property (previewRenewal agrees
      // with a REAL renewOne charge) is covered at the service level
      // (renewal.previewAndCharge.test.js) with a real Price/schedule chain
      // instead of duplicating that fixture here.
      const subscription = await buildSubscription({
        parentId: new mongoose.Types.ObjectId(),
        currentPeriodEnd: new Date('2099-01-01T00:00:00.000Z'),
        nextBillingDate: new Date('2099-01-01T00:00:00.000Z'),
      });

      const res = await superAgent.get(`/api/v1/subscriptions/${subscription._id}/charge-preview`);

      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe('no_price');
      expect(res.body.due).toBe(false);
      expect(res.body.paymentMethod).toBeNull();
    });
  });

  describe('POST /api/v1/subscriptions/:id/charge', () => {
    it('returns 401 unauthenticated', async () => {
      const subscription = await buildSubscription({ parentId: new mongoose.Types.ObjectId() });

      const res = await request(app).post(`/api/v1/subscriptions/${subscription._id}/charge`);

      expect(res.status).toBe(401);
    });

    it.each(['parent', 'admin', 'coach'])('returns 403 for role %s', async (role) => {
      const email = `charge-403-${role}@example.com`;
      await seedUser({ role, email });
      const agent = await loginAgent(email);

      const subscription = await buildSubscription({ parentId: new mongoose.Types.ObjectId() });

      const res = await agent.post(`/api/v1/subscriptions/${subscription._id}/charge`);

      expect(res.status).toBe(403);
    });

    it('lets superadmin trigger a not-due subscription and returns skipped_not_due, untouched', async () => {
      await seedUser({ role: 'superadmin', email: 'charge-super-notdue@example.com' });
      const superAgent = await loginAgent('charge-super-notdue@example.com');

      const subscription = await buildSubscription({
        parentId: new mongoose.Types.ObjectId(),
        currentPeriodEnd: new Date('2099-01-01T00:00:00.000Z'),
        nextBillingDate: new Date('2099-01-01T00:00:00.000Z'),
      });

      const res = await superAgent.post(`/api/v1/subscriptions/${subscription._id}/charge`);

      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe('skipped_not_due');
    });

    it('lets superadmin finalize a due, pending-cancel subscription with no charge', async () => {
      await seedUser({ role: 'superadmin', email: 'charge-super-finalize@example.com' });
      const superAgent = await loginAgent('charge-super-finalize@example.com');

      const subscription = await buildSubscription({
        parentId: new mongoose.Types.ObjectId(),
        cancelAtPeriodEnd: true,
      });

      const res = await superAgent.post(`/api/v1/subscriptions/${subscription._id}/charge`);

      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe('cancelled_finalized');

      const inDb = await Subscription.findById(subscription._id);
      expect(inDb.status).toBe('cancelled');
    });

    // The "due, resolvable price, no card on file -> failed_no_payment_method"
    // and "outcome matches a real Stripe charge" scenarios need the full
    // Service-catalog + Price/schedule fixture renewal.service.test.js
    // already builds — covered at the service level
    // (renewal.previewAndCharge.test.js) rather than duplicated here.
  });

  // docs/plans/payment-airtight-plan.md D5 — the manual/offline payment
  // path. Never calls Stripe, so these run fast without the real-Stripe
  // fixtures renewal.service.test.js needs; the full "period: 'full' vs
  // 'prorated'" amount MATH (not just wiring/validation) is covered there
  // instead, alongside chargeProratedNow's own card-path tests.
  describe('POST /api/v1/subscriptions/:id/record-payment', () => {
    it('returns 401 unauthenticated', async () => {
      const subscription = await buildSubscription({ parentId: new mongoose.Types.ObjectId() });

      const res = await request(app)
        .post(`/api/v1/subscriptions/${subscription._id}/record-payment`)
        .send({ amount: 100, note: 'Paid by check', period: 'full' });

      expect(res.status).toBe(401);
    });

    it.each(['parent', 'admin', 'coach'])('returns 403 for role %s', async (role) => {
      const email = `record-payment-403-${role}@example.com`;
      await seedUser({ role, email });
      const agent = await loginAgent(email);

      const subscription = await buildSubscription({ parentId: new mongoose.Types.ObjectId() });

      const res = await agent
        .post(`/api/v1/subscriptions/${subscription._id}/record-payment`)
        .send({ amount: 100, note: 'Paid by check', period: 'full' });

      expect(res.status).toBe(403);
    });

    it('returns invalid_amount and creates/changes nothing for a zero or negative amount', async () => {
      await seedUser({ role: 'superadmin', email: 'record-payment-invalid-amount@example.com' });
      const superAgent = await loginAgent('record-payment-invalid-amount@example.com');

      const subscription = await buildSubscription({ parentId: new mongoose.Types.ObjectId() });

      const res = await superAgent
        .post(`/api/v1/subscriptions/${subscription._id}/record-payment`)
        .send({ amount: 0, note: 'Paid by check', period: 'full' });

      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe('invalid_amount');

      const inDb = await Subscription.findById(subscription._id);
      expect(inDb.currentPeriodEnd.toISOString()).toBe(subscription.currentPeriodEnd.toISOString());
      expect(await Registration.countDocuments({ subscriptionId: subscription._id })).toBe(0);
    });

    it('returns invalid_note and creates nothing when note is missing/blank', async () => {
      await seedUser({ role: 'superadmin', email: 'record-payment-invalid-note@example.com' });
      const superAgent = await loginAgent('record-payment-invalid-note@example.com');

      const subscription = await buildSubscription({ parentId: new mongoose.Types.ObjectId() });

      const res = await superAgent
        .post(`/api/v1/subscriptions/${subscription._id}/record-payment`)
        .send({ amount: 100, note: '   ', period: 'full' });

      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe('invalid_note');
      expect(await Registration.countDocuments({ subscriptionId: subscription._id })).toBe(0);
    });

    it(
      'records a "full" period manual payment: completes the ledger row with chargeMethod/manualNote/recordedBy, ' +
        'rolls the subscription period forward, and clears dunning state',
      async () => {
        await seedServices();
        const superadmin = await seedUser({ role: 'superadmin', email: 'record-payment-full@example.com' });
        const superAgent = await loginAgent('record-payment-full@example.com');

        const currentPeriodEnd = new Date('2026-02-01T00:00:00.000Z');
        const subscription = await buildSubscription({
          parentId: new mongoose.Types.ObjectId(),
          currentPeriodEnd,
          nextBillingDate: currentPeriodEnd,
          // Already mid-dunning from a prior failed card attempt — the
          // manual recording below must clear this (D6).
          retryCount: 2,
          nextRetryAt: new Date('2026-01-20T00:00:00.000Z'),
        });

        const res = await superAgent
          .post(`/api/v1/subscriptions/${subscription._id}/record-payment`)
          .send({ amount: 137.5, note: 'Paid by check #1042', period: 'full' });

        expect(res.status).toBe(200);
        expect(res.body.outcome).toBe('charged');
        expect(res.body.chargeAmount).toBe(137.5);

        // Expected value computed via the SAME shared addOneMonth helper
        // recordManualPayment's own 'full' branch uses (not a hardcoded
        // literal) — addOneMonth's rollover math is local-timezone-
        // dependent (JS Date's own getMonth/setMonth), matching renewal
        // .service.test.js's own established convention for this exact
        // reason.
        const expectedNewPeriodEnd = addOneMonth(currentPeriodEnd);

        const inDb = await Subscription.findById(subscription._id);
        expect(inDb.currentPeriodStart.toISOString()).toBe(currentPeriodEnd.toISOString());
        expect(inDb.currentPeriodEnd.toISOString()).toBe(expectedNewPeriodEnd.toISOString());
        expect(inDb.lastChargeAmount).toBe(137.5);
        expect(inDb.retryCount).toBe(0);
        expect(inDb.nextRetryAt).toBeNull();

        const row = await Registration.findOne({ subscriptionId: subscription._id });
        expect(row.status).toBe('completed');
        expect(row.chargeMethod).toBe('manual');
        expect(row.manualNote).toBe('Paid by check #1042');
        expect(row.recordedBy.toString()).toBe(superadmin._id.toString());
        expect(row.stripePaymentIntentId).toBeNull();
        expect(row.periodMonth).toBe('2026-02');
      }
    );

    it(
      'records a "prorated" period manual payment even when the schedule/level chain is unresolvable — ' +
        'never blocks on the informational breakdown math (D5)',
      async () => {
        await seedServices();
        await seedUser({ role: 'superadmin', email: 'record-payment-prorated-broken@example.com' });
        const superAgent = await loginAgent('record-payment-prorated-broken@example.com');

        // buildSubscription's bare scheduleId never resolves to a real
        // GroupClassSchedule/GroupClass/Price chain.
        const subscription = await buildSubscription({ parentId: new mongoose.Types.ObjectId() });

        const res = await superAgent
          .post(`/api/v1/subscriptions/${subscription._id}/record-payment`)
          .send({ amount: 60, note: 'Partial catch-up payment', period: 'prorated' });

        expect(res.status).toBe(200);
        expect(res.body.outcome).toBe('charged');

        const row = await Registration.findOne({ subscriptionId: subscription._id });
        expect(row.chargeMethod).toBe('manual');
        expect(row.amount).toBe(60);
        expect(row.breakdown.prorated).toBe(true);
        expect(row.breakdown.proratedAmount).toBe(60);
      }
    );

    it('returns skipped_already_charged and writes nothing new when the target month is already completed', async () => {
      await seedServices();
      await seedUser({ role: 'superadmin', email: 'record-payment-already-paid@example.com' });
      const superAgent = await loginAgent('record-payment-already-paid@example.com');

      const currentPeriodEnd = new Date('2026-02-01T00:00:00.000Z');
      const subscription = await buildSubscription({
        parentId: new mongoose.Types.ObjectId(),
        currentPeriodEnd,
        nextBillingDate: currentPeriodEnd,
      });

      const groupClassesService = await getServiceByCode('group-classes', { requireActive: true });
      await SubscriptionCycleRegistration.create({
        serviceId: groupClassesService._id,
        subscriptionId: subscription._id,
        scheduleId: subscription.scheduleId,
        studentId: subscription.studentId,
        parentId: subscription.parentId,
        eventType: 'renewal',
        status: 'completed',
        amount: 150,
        breakdown: { monthlyFee: 150, siblingDiscountApplied: false, siblingDiscountAmount: 0, registrationFeeCharged: 0 },
        periodStart: currentPeriodEnd,
        periodEnd: new Date('2026-03-01T00:00:00.000Z'),
        paidAt: new Date('2026-01-15T00:00:00.000Z'),
      });

      const res = await superAgent
        .post(`/api/v1/subscriptions/${subscription._id}/record-payment`)
        .send({ amount: 150, note: 'Duplicate attempt', period: 'full' });

      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe('skipped_already_charged');
      expect(await Registration.countDocuments({ subscriptionId: subscription._id })).toBe(1);
    });
  });
});
