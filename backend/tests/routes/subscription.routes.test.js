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
const { hashPassword } = require('../../src/utils/password');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');

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
  });
});
