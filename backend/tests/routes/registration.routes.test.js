process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

// Mocked so this suite never touches nodemailer/Ethereal — confirmation
// email is Phase 10's own concern (see mail.service.test.js), unrelated to
// what these routes tests exist to cover (real Stripe TEST-mode charges).
jest.mock('../../src/services/mail.service');

// STRIPE_SECRET_KEY must be loaded from the real .env BEFORE app.js (and
// therefore src/config/stripe.js) is required below — this test hits
// Stripe's real TEST-mode API over the network rather than mocking the
// Stripe SDK (see paymentMethod.routes.test.js spec: Stripe explicitly
// designs test mode for exactly this kind of real integration testing).
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const request = require('supertest');
const mongoose = require('mongoose');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const Level = require('../../src/models/level.model');
const Location = require('../../src/models/location.model');
const GroupClass = require('../../src/models/groupClass.model');
const GroupClassSchedule = require('../../src/models/groupClassSchedule.model');
const GroupClassSession = require('../../src/models/groupClassSession.model');
const Visit = require('../../src/models/visit.model');
const Price = require('../../src/models/price.model');
const Registration = require('../../src/models/registration.model');
const Subscription = require('../../src/models/subscription.model');
const PaymentMethod = require('../../src/models/paymentMethod.model');
const Setting = require('../../src/models/setting.model');
const { computeProration } = require('../../src/services/billing/proration.service');
const stripe = require('../../src/config/stripe');
const { hashPassword } = require('../../src/utils/password');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');
const mailService = require('../../src/services/mail.service');

const TEST_PASSWORD = 'correct-password';
const MONTHLY_FEE = 150;

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

// Mints a fresh, real Stripe TEST-mode PaymentMethod via Stripe's documented
// `tok_visa` test token. A PaymentMethod can only ever be attached once, so
// every test that needs one calls this fresh rather than sharing an id.
async function mintTestPaymentMethodId() {
  const paymentMethod = await stripe.paymentMethods.create({
    type: 'card',
    card: { token: 'tok_visa' },
  });

  return paymentMethod.id;
}

// Saves a real Stripe test card on file for `parentAgent`, via the actual
// POST /payment-methods route (Phase 7a) rather than reaching into the model
// directly, so the Stripe Customer + attach side effects are the real ones.
async function savePaymentMethodFor(parentAgent) {
  const stripePaymentMethodId = await mintTestPaymentMethodId();

  const res = await parentAgent
    .post('/api/v1/payment-methods')
    .send({ stripePaymentMethodId });

  expect(res.status).toBe(201);
}

// Builds a real class/schedule (via the real create route, so the 8 initial
// sessions are generated the same way production does) with a Price
// configured for its level, unless `skipPrice` is set.
async function seedSchedule({ skipPrice = false } = {}) {
  const level = await Level.create({ name: 'Beginner', order: 1 });
  const location = await Location.create({ name: 'Frisco HQ', address: '123 Main St' });
  const groupClass = await GroupClass.create({
    name: 'Beginner Foil',
    levelId: level._id,
    locationId: location._id,
    capacity: 10,
  });

  if (!skipPrice) {
    await Price.create({ levelId: level._id, monthlyFee: MONTHLY_FEE });
  }

  const coach = await User.create({
    role: 'coach',
    firstName: 'Coach',
    lastName: 'Reg',
    email: 'coach-reg@example.com',
    passwordHash: await hashPassword(TEST_PASSWORD),
  });

  await seedUser({ role: 'admin', email: 'admin-reg-setup@example.com' });
  const adminAgent = await loginAgent('admin-reg-setup@example.com');

  const scheduleRes = await adminAgent.post('/api/v1/group-class-schedules').send({
    classId: groupClass._id.toString(),
    coachId: coach._id.toString(),
    dayOfWeek: 3,
    startTime: '16:00',
    endTime: '17:00',
    students: [],
  });

  expect(scheduleRes.status).toBe(201);

  return { scheduleId: scheduleRes.body.schedule._id, levelId: level._id };
}

async function seedParentAndStudent(parentEmail) {
  const parent = await seedUser({ role: 'parent', email: parentEmail });
  const student = await User.create({
    role: 'student',
    firstName: 'Kid',
    lastName: 'Reg',
    parentId: parent._id,
  });

  return { parent, student };
}

// Like seedSchedule, but lets the caller set a different monthlyFee — used
// by the sibling-discount test, which needs two schedules priced
// differently so the second child's price is strictly higher than the
// first's.
async function seedScheduleWithFee(monthlyFee, { levelName = 'Level', levelOrder = 1 } = {}) {
  const level = await Level.create({ name: levelName, order: levelOrder });
  const location = await Location.create({
    name: `Frisco HQ ${levelName}`,
    address: '123 Main St',
  });
  const groupClass = await GroupClass.create({
    name: `${levelName} Foil`,
    levelId: level._id,
    locationId: location._id,
    capacity: 10,
  });

  await Price.create({ levelId: level._id, monthlyFee });

  const coach = await User.create({
    role: 'coach',
    firstName: 'Coach',
    lastName: levelName,
    email: `coach-${levelName}-${Date.now()}@example.com`,
    passwordHash: await hashPassword(TEST_PASSWORD),
  });

  await seedUser({ role: 'admin', email: `admin-${levelName}-setup@example.com` });
  const adminAgent = await loginAgent(`admin-${levelName}-setup@example.com`);

  const scheduleRes = await adminAgent.post('/api/v1/group-class-schedules').send({
    classId: groupClass._id.toString(),
    coachId: coach._id.toString(),
    dayOfWeek: 4,
    startTime: '17:00',
    endTime: '18:00',
    students: [],
  });

  expect(scheduleRes.status).toBe(201);

  return scheduleRes.body.schedule._id;
}

describe('Registration routes', () => {
  describe('POST /api/v1/registrations', () => {
    it(
      'lets a parent register their child, charges the saved card, creates Registration + Subscription, and backfills the roster into schedule + every future session',
      async () => {
        const { scheduleId } = await seedSchedule();
        const { student } = await seedParentAndStudent('reg-parent1@example.com');
        const parentAgent = await loginAgent('reg-parent1@example.com');

        await savePaymentMethodFor(parentAgent);

        const res = await parentAgent.post('/api/v1/registrations').send({
          studentId: student._id.toString(),
          scheduleId,
        });

        expect(res.status).toBe(201);
        expect(res.body.paymentIntentStatus).toBe('succeeded');
        expect(res.body.chargeAmount).toBe(MONTHLY_FEE);
        expect(res.body.registration.status).toBe('active');
        expect(res.body.subscription.status).toBe('active');

        const registrations = await Registration.find({ studentId: student._id });
        expect(registrations).toHaveLength(1);

        const subscriptions = await Subscription.find({ studentId: student._id });
        expect(subscriptions).toHaveLength(1);
        // ENABLE_SCHEDULE_BASED_REGISTRATION is unset in this suite — the
        // live default is premium (docs/plans/premium-registration-and-
        // attendance-plan.md §0/§4).
        expect(subscriptions[0].isPremium).toBe(true);

        const schedule = await GroupClassSchedule.findById(scheduleId);
        expect(
          schedule.students.some((id) => String(id) === String(student._id))
        ).toBe(true);

        const sessions = await GroupClassSession.find({ scheduleId }).sort({ date: 1 });
        expect(sessions.length).toBeGreaterThan(0);
        const scheduledVisits = await Visit.find({
          studentId: student._id,
          groupClassSessionId: { $in: sessions.map((session) => session._id) },
          status: { $ne: 'cancelled' },
        });
        expect(scheduledVisits).toHaveLength(sessions.length);

        // Confirms the mail wiring actually fires with the right shape —
        // proving it fires, not just that mocking it doesn't break the
        // route.
        expect(mailService.sendRegistrationConfirmationEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            parent: expect.objectContaining({ email: 'reg-parent1@example.com' }),
            student: expect.objectContaining({ firstName: student.firstName }),
            chargeAmount: expect.any(Number),
          })
        );
      },
      30000
    );

    it(
      'sets isPremium: false when ENABLE_SCHEDULE_BASED_REGISTRATION=true (the rollback flag)',
      async () => {
        process.env.ENABLE_SCHEDULE_BASED_REGISTRATION = 'true';
        try {
          const { scheduleId } = await seedSchedule();
          const { student } = await seedParentAndStudent('reg-parent-legacy@example.com');
          const parentAgent = await loginAgent('reg-parent-legacy@example.com');

          await savePaymentMethodFor(parentAgent);

          const res = await parentAgent.post('/api/v1/registrations').send({
            studentId: student._id.toString(),
            scheduleId,
          });

          expect(res.status).toBe(201);

          const subscription = await Subscription.findOne({ studentId: student._id });
          expect(subscription.isPremium).toBe(false);
        } finally {
          delete process.env.ENABLE_SCHEDULE_BASED_REGISTRATION;
        }
      },
      30000
    );

    it(
      'returns 400 and creates nothing when the parent has no payment method on file',
      async () => {
        const { scheduleId } = await seedSchedule();
        const { student } = await seedParentAndStudent('reg-parent2@example.com');
        const parentAgent = await loginAgent('reg-parent2@example.com');

        const res = await parentAgent.post('/api/v1/registrations').send({
          studentId: student._id.toString(),
          scheduleId,
        });

        expect(res.status).toBe(400);

        expect(await Registration.countDocuments({ studentId: student._id })).toBe(0);
        expect(await Subscription.countDocuments({ studentId: student._id })).toBe(0);

        const schedule = await GroupClassSchedule.findById(scheduleId);
        expect(
          schedule.students.some((id) => String(id) === String(student._id))
        ).toBe(false);
      },
      20000
    );

    it(
      'returns 402 and creates nothing on a real Stripe TEST-mode card decline',
      async () => {
        const { scheduleId } = await seedSchedule();
        const { student } = await seedParentAndStudent('reg-decline@example.com');
        const parentAgent = await loginAgent('reg-decline@example.com');

        await savePaymentMethodFor(parentAgent);

        // Same technique as renewal.service.test.js's decline case: overwrite
        // the just-saved real PaymentMethod's id with Stripe's documented
        // shared test id for a guaranteed decline (`pm_card_chargeDeclined`),
        // which throws a StripeCardError when charged.
        const parent = await User.findOne({ email: 'reg-decline@example.com' });
        await PaymentMethod.updateOne(
          { parentId: parent._id },
          { stripePaymentMethodId: 'pm_card_chargeDeclined' }
        );

        const res = await parentAgent.post('/api/v1/registrations').send({
          studentId: student._id.toString(),
          scheduleId,
        });

        expect(res.status).toBe(402);

        expect(await Registration.countDocuments({ studentId: student._id })).toBe(0);
        expect(await Subscription.countDocuments({ studentId: student._id })).toBe(0);

        const schedule = await GroupClassSchedule.findById(scheduleId);
        expect(
          schedule.students.some((id) => String(id) === String(student._id))
        ).toBe(false);
      },
      30000
    );

    it(
      "returns 404 and creates/charges nothing when the class's level has no Price configured",
      async () => {
        const { scheduleId } = await seedSchedule({ skipPrice: true });
        const { student } = await seedParentAndStudent('reg-parent3@example.com');
        const parentAgent = await loginAgent('reg-parent3@example.com');

        await savePaymentMethodFor(parentAgent);

        const res = await parentAgent.post('/api/v1/registrations').send({
          studentId: student._id.toString(),
          scheduleId,
        });

        expect(res.status).toBe(404);

        expect(await Registration.countDocuments({ studentId: student._id })).toBe(0);
        expect(await Subscription.countDocuments({ studentId: student._id })).toBe(0);
      },
      20000
    );

    it(
      'returns 409 on a second registration attempt for the same student + schedule',
      async () => {
        const { scheduleId } = await seedSchedule();
        const { student } = await seedParentAndStudent('reg-parent4@example.com');
        const parentAgent = await loginAgent('reg-parent4@example.com');

        await savePaymentMethodFor(parentAgent);

        const firstRes = await parentAgent.post('/api/v1/registrations').send({
          studentId: student._id.toString(),
          scheduleId,
        });
        expect(firstRes.status).toBe(201);

        const secondRes = await parentAgent.post('/api/v1/registrations').send({
          studentId: student._id.toString(),
          scheduleId,
        });
        expect(secondRes.status).toBe(409);

        expect(await Subscription.countDocuments({ studentId: student._id })).toBe(1);
      },
      30000
    );

    it(
      'returns 409 and charges nothing when the schedule is already at capacity',
      async () => {
        const { scheduleId } = await seedSchedule(); // capacity: 10
        const { student } = await seedParentAndStudent('reg-full@example.com');
        const parentAgent = await loginAgent('reg-full@example.com');

        await savePaymentMethodFor(parentAgent);

        // Fills the roster to capacity directly (this test is about
        // registration.service's capacity guard, not roster-population
        // mechanics, which are already covered by the happy-path test above).
        const fillerIds = Array.from({ length: 10 }, () => new mongoose.Types.ObjectId());
        await GroupClassSchedule.findByIdAndUpdate(scheduleId, { students: fillerIds });

        const res = await parentAgent.post('/api/v1/registrations').send({
          studentId: student._id.toString(),
          scheduleId,
        });

        expect(res.status).toBe(409);
        expect(res.body.message).toBe('This class is full');

        expect(await Registration.countDocuments({ studentId: student._id })).toBe(0);
        expect(await Subscription.countDocuments({ studentId: student._id })).toBe(0);

        const schedule = await GroupClassSchedule.findById(scheduleId);
        expect(schedule.students).toHaveLength(10);
      },
      20000
    );

    it('returns 403 when registering a child belonging to a different parent', async () => {
      const { scheduleId } = await seedSchedule();
      await seedUser({ role: 'parent', email: 'reg-parent5@example.com' });
      const { student } = await seedParentAndStudent('reg-other-parent5@example.com');
      const parentAgent = await loginAgent('reg-parent5@example.com');

      const res = await parentAgent.post('/api/v1/registrations').send({
        studentId: student._id.toString(),
        scheduleId,
      });

      expect(res.status).toBe(403);
    });

    it('returns 403 when a non-parent role attempts to register', async () => {
      const { scheduleId } = await seedSchedule();
      const { student } = await seedParentAndStudent('reg-parent6@example.com');

      await seedUser({ role: 'admin', email: 'reg-admin6@example.com' });
      const adminAgent = await loginAgent('reg-admin6@example.com');

      const res = await adminAgent.post('/api/v1/registrations').send({
        studentId: student._id.toString(),
        scheduleId,
      });

      expect(res.status).toBe(403);
    });

    // Sibling discount E2E case. NOTE ON PRICING DIRECTION: the algorithm
    // (calculateChargeAmount.service.js) implements the "dynamic
    // lower-payer rule" from ADR 001 — whichever sibling has the strictly
    // LOWER price gets 10% off THEIR OWN price. So for the second child's
    // registration to actually receive the discount, their class must be
    // priced LOWER than the already-active first child's class, not
    // higher. (A "higher-priced second child" would make the FIRST child
    // the winner instead, and the second child's own charge — the one this
    // test is asserting on — would be full price.)
    it(
      "applies the 10% sibling discount to the second child's real Stripe charge when their class is priced lower than the first child's (the sibling discount's lower-payer rule, per ADR 001)",
      async () => {
        const parent = await seedUser({ role: 'parent', email: 'reg-sibling-parent@example.com' });
        const firstChild = await User.create({
          role: 'student',
          firstName: 'First',
          lastName: 'Sibling',
          parentId: parent._id,
        });
        const secondChild = await User.create({
          role: 'student',
          firstName: 'Second',
          lastName: 'Sibling',
          parentId: parent._id,
        });

        const parentAgent = await loginAgent('reg-sibling-parent@example.com');
        await savePaymentMethodFor(parentAgent);

        const pricierScheduleId = await seedScheduleWithFee(MONTHLY_FEE * 2, {
          levelName: 'SiblingPricier',
          levelOrder: 10,
        });
        const cheaperScheduleId = await seedScheduleWithFee(MONTHLY_FEE, {
          levelName: 'SiblingCheap',
          levelOrder: 11,
        });

        // First child registers for the pricier class first — no sibling
        // with an active subscription exists yet, so no discount.
        const firstRes = await parentAgent.post('/api/v1/registrations').send({
          studentId: firstChild._id.toString(),
          scheduleId: pricierScheduleId,
        });

        expect(firstRes.status).toBe(201);
        expect(firstRes.body.chargeAmount).toBe(MONTHLY_FEE * 2);
        expect(firstRes.body.siblingDiscountApplied).toBe(false);

        // Second child registers for the cheaper class. Their own price
        // (MONTHLY_FEE) is strictly lower than the first child's current
        // fee (2x MONTHLY_FEE) -> second child is the lower payer and gets
        // 10% off their own price.
        const secondRes = await parentAgent.post('/api/v1/registrations').send({
          studentId: secondChild._id.toString(),
          scheduleId: cheaperScheduleId,
        });

        expect(secondRes.status).toBe(201);
        expect(secondRes.body.chargeAmount).toBe(MONTHLY_FEE * 0.9);
        expect(secondRes.body.siblingDiscountApplied).toBe(true);
        expect(secondRes.body.siblingDiscountAmount).toBe(MONTHLY_FEE * 0.1);

        const secondSubscription = await Subscription.findOne({
          studentId: secondChild._id,
        });
        expect(secondSubscription.lastSiblingDiscountApplied).toBe(true);
        expect(secondSubscription.lastChargeAmount).toBe(MONTHLY_FEE * 0.9);

        // Verify the actual Stripe PaymentIntent was charged for the
        // discounted amount, not the full price — the real assertion this
        // test exists for: the real-Stripe-test-mode charge reflects the
        // discount, not just our own response body's math.
        const paymentIntents = await stripe.paymentIntents.list({ limit: 10 });
        const secondChildIntent = paymentIntents.data.find(
          (intent) => intent.amount === Math.round(MONTHLY_FEE * 0.9 * 100)
        );
        expect(secondChildIntent).toBeDefined();
        expect(secondChildIntent.status).toBe('succeeded');
      },
      40000
    );
  });

  describe('one-time registration fee', () => {
    it(
      'bundles the configured registration fee into the same real Stripe charge as the monthly fee, and persists it on the Subscription',
      async () => {
        await Setting.create({ registrationFee: 25, returningStudentGracePeriodMonths: 6 });

        const { scheduleId } = await seedSchedule();
        const { student } = await seedParentAndStudent('reg-fee-basic@example.com');
        const parentAgent = await loginAgent('reg-fee-basic@example.com');
        await savePaymentMethodFor(parentAgent);

        const res = await parentAgent.post('/api/v1/registrations').send({
          studentId: student._id.toString(),
          scheduleId,
        });

        expect(res.status).toBe(201);
        expect(res.body.chargeAmount).toBe(MONTHLY_FEE);
        expect(res.body.registrationFeeCharged).toBe(25);
        expect(res.body.registrationFeeWaived).toBe(false);
        expect(res.body.totalChargeAmount).toBe(MONTHLY_FEE + 25);

        const subscription = await Subscription.findOne({ studentId: student._id });
        expect(subscription.registrationFeeCharged).toBe(25);
        // The historical charge-amount record stays the recurring monthly
        // amount only — the one-time fee is tracked in its own field, never
        // folded into lastChargeAmount (that field is what future renewals
        // compare against; the fee never recurs).
        expect(subscription.lastChargeAmount).toBe(MONTHLY_FEE);

        // The real, single Stripe PaymentIntent reflects monthly + fee together.
        const paymentIntents = await stripe.paymentIntents.list({ limit: 10 });
        const intent = paymentIntents.data.find(
          (i) => i.amount === Math.round((MONTHLY_FEE + 25) * 100)
        );
        expect(intent).toBeDefined();
        expect(intent.status).toBe('succeeded');
      },
      20000
    );

    it('charges nothing extra when no Setting has ever been saved — existing behavior is unchanged', async () => {
      const { scheduleId } = await seedSchedule();
      const { student } = await seedParentAndStudent('reg-fee-unset@example.com');
      const parentAgent = await loginAgent('reg-fee-unset@example.com');
      await savePaymentMethodFor(parentAgent);

      const res = await parentAgent.post('/api/v1/registrations').send({
        studentId: student._id.toString(),
        scheduleId,
      });

      expect(res.status).toBe(201);
      expect(res.body.registrationFeeCharged).toBe(0);
      expect(res.body.totalChargeAmount).toBe(MONTHLY_FEE);
    });

    it(
      'waives the fee end-to-end for a student returning within the grace period — real charge excludes it',
      async () => {
        await Setting.create({ registrationFee: 25, returningStudentGracePeriodMonths: 6 });

        const { scheduleId } = await seedSchedule();
        const { student } = await seedParentAndStudent('reg-fee-waived@example.com');
        const parentAgent = await loginAgent('reg-fee-waived@example.com');
        await savePaymentMethodFor(parentAgent);

        // Simulate a prior enrollment that ended 2 months ago (well inside
        // the 6-month grace period) — the renewal cron is what would
        // normally produce this 'cancelled' state; seeded directly here
        // since only the resulting document matters for this test.
        const twoMonthsAgo = new Date();
        twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
        await Subscription.create({
          studentId: student._id,
          scheduleId,
          parentId: student.parentId,
          status: 'cancelled',
          currentPeriodStart: new Date('2025-01-01T00:00:00.000Z'),
          currentPeriodEnd: twoMonthsAgo,
          nextBillingDate: twoMonthsAgo,
        });

        const res = await parentAgent.post('/api/v1/registrations').send({
          studentId: student._id.toString(),
          scheduleId,
        });

        expect(res.status).toBe(201);
        expect(res.body.registrationFeeCharged).toBe(0);
        expect(res.body.registrationFeeWaived).toBe(true);
        expect(res.body.registrationFeeReason).toMatch(/waived/i);
        expect(res.body.totalChargeAmount).toBe(MONTHLY_FEE);

        const paymentIntents = await stripe.paymentIntents.list({ limit: 10 });
        const intent = paymentIntents.data.find((i) => i.amount === Math.round(MONTHLY_FEE * 100));
        expect(intent).toBeDefined();
      },
      20000
    );
  });

  describe('prorated first-month billing', () => {
    it(
      'charges nothing extra and keeps the existing rolling period when prorationEnabled is OFF (the default) — byte-identical to pre-proration behavior',
      async () => {
        const { scheduleId } = await seedSchedule();
        const { student } = await seedParentAndStudent('proration-off@example.com');
        const parentAgent = await loginAgent('proration-off@example.com');
        await savePaymentMethodFor(parentAgent);

        const res = await parentAgent.post('/api/v1/registrations').send({
          studentId: student._id.toString(),
          scheduleId,
        });

        expect(res.status).toBe(201);
        expect(res.body.chargeAmount).toBe(MONTHLY_FEE);
        expect(res.body.prorated).toBe(false);
        expect(res.body.totalClassDays).toBeNull();
        expect(res.body.remainingClassDays).toBeNull();
        expect(res.body.dailyRate).toBeNull();

        const subscription = await Subscription.findOne({ studentId: student._id });
        expect(subscription.firstChargeProrated).toBe(false);
        // Rolling one-month period, not a calendar-month boundary.
        const daysUntilPeriodEnd =
          (subscription.currentPeriodEnd.getTime() - subscription.currentPeriodStart.getTime()) /
          (1000 * 60 * 60 * 24);
        expect(daysUntilPeriodEnd).toBeGreaterThan(27); // ~a full month out, not "days left this month"
      },
      20000
    );

    it(
      'explicitly toggling prorationEnabled OFF (a Setting doc exists but disabled) is the same as no Setting at all',
      async () => {
        await Setting.create({ prorationEnabled: false });

        const { scheduleId } = await seedSchedule();
        const { student } = await seedParentAndStudent('proration-explicit-off@example.com');
        const parentAgent = await loginAgent('proration-explicit-off@example.com');
        await savePaymentMethodFor(parentAgent);

        const res = await parentAgent.post('/api/v1/registrations').send({
          studentId: student._id.toString(),
          scheduleId,
        });

        expect(res.status).toBe(201);
        expect(res.body.chargeAmount).toBe(MONTHLY_FEE);
        expect(res.body.prorated).toBe(false);
      },
      20000
    );

    it(
      'prorates the real Stripe charge and anchors the period to calendar month-end when prorationEnabled is ON',
      async () => {
        await Setting.create({ prorationEnabled: true });

        const { scheduleId, levelId } = await seedSchedule();
        const { student } = await seedParentAndStudent('proration-on@example.com');
        const parentAgent = await loginAgent('proration-on@example.com');
        await savePaymentMethodFor(parentAgent);

        // Same function the real code calls (docs/plans/prorated-first-
        // month-billing-plan.md, D3) — used here only to compute what the
        // real API SHOULD return for "right now", not a reimplementation of
        // the math, so this test stays deterministic regardless of what day
        // of the month it actually runs on.
        const expected = await computeProration({
          levelId,
          monthlyFee: MONTHLY_FEE,
          registrationDate: new Date(),
        });

        const res = await parentAgent.post('/api/v1/registrations').send({
          studentId: student._id.toString(),
          scheduleId,
        });

        expect(res.status).toBe(201);
        expect(res.body.prorated).toBe(true);
        expect(res.body.totalClassDays).toBe(expected.totalClassDays);
        expect(res.body.remainingClassDays).toBe(expected.remainingClassDays);
        expect(res.body.chargeAmount).toBe(expected.proratedAmount);
        expect(res.body.totalChargeAmount).toBe(expected.proratedAmount);

        const subscription = await Subscription.findOne({ studentId: student._id });
        expect(subscription.firstChargeProrated).toBe(true);
        expect(subscription.currentPeriodEnd.getFullYear()).toBe(expected.periodEnd.getFullYear());
        expect(subscription.currentPeriodEnd.getMonth()).toBe(expected.periodEnd.getMonth());
        expect(subscription.currentPeriodEnd.getDate()).toBe(expected.periodEnd.getDate());

        // The real Stripe PaymentIntent reflects the prorated amount, not
        // the full monthly fee.
        const paymentIntents = await stripe.paymentIntents.list({ limit: 10 });
        const intent = paymentIntents.data.find(
          (i) => i.amount === Math.round(expected.proratedAmount * 100)
        );
        expect(intent).toBeDefined();
        expect(intent.status).toBe('succeeded');
      },
      20000
    );

    it(
      'applies proration BEFORE the sibling discount (owner-directed sequencing) — the 10% is computed on the prorated amount, not the raw list price',
      async () => {
        await Setting.create({ prorationEnabled: true });

        const parent = await seedUser({ role: 'parent', email: 'proration-sibling@example.com' });
        const firstChild = await User.create({
          role: 'student',
          firstName: 'First',
          lastName: 'Proration',
          parentId: parent._id,
        });
        const secondChild = await User.create({
          role: 'student',
          firstName: 'Second',
          lastName: 'Proration',
          parentId: parent._id,
        });

        const parentAgent = await loginAgent('proration-sibling@example.com');
        await savePaymentMethodFor(parentAgent);

        const pricierScheduleId = await seedScheduleWithFee(MONTHLY_FEE * 2, {
          levelName: 'ProrationPricier',
          levelOrder: 40,
        });
        const cheaperScheduleId = await seedScheduleWithFee(MONTHLY_FEE, {
          levelName: 'ProrationCheap',
          levelOrder: 41,
        });

        // First child registers into the pricier level — no active sibling
        // yet, so no discount regardless of proration.
        const firstRes = await parentAgent.post('/api/v1/registrations').send({
          studentId: firstChild._id.toString(),
          scheduleId: pricierScheduleId,
        });
        expect(firstRes.status).toBe(201);

        const cheaperSchedule = await GroupClassSchedule.findById(cheaperScheduleId);
        const cheaperGroupClass = await GroupClass.findById(cheaperSchedule.classId);

        const expectedProration = await computeProration({
          levelId: cheaperGroupClass.levelId,
          monthlyFee: MONTHLY_FEE,
          registrationDate: new Date(),
        });
        const expectedDiscount = Number((expectedProration.proratedAmount * 0.1).toFixed(2));
        const expectedFinal = Number((expectedProration.proratedAmount - expectedDiscount).toFixed(2));

        // Second child registers into the cheaper level, prorated — the
        // sibling comparison must use the PRORATED amount, not MONTHLY_FEE.
        const secondRes = await parentAgent.post('/api/v1/registrations').send({
          studentId: secondChild._id.toString(),
          scheduleId: cheaperScheduleId,
        });

        expect(secondRes.status).toBe(201);
        expect(secondRes.body.prorated).toBe(true);
        expect(secondRes.body.siblingDiscountApplied).toBe(true);
        expect(secondRes.body.siblingDiscountAmount).toBe(expectedDiscount);
        expect(secondRes.body.chargeAmount).toBe(expectedFinal);
      },
      40000
    );
  });

  describe('GET /api/v1/registrations/preview', () => {
    it('returns the undiscounted monthly fee for an only child, and creates/charges nothing', async () => {
      const { scheduleId } = await seedSchedule();
      const { student } = await seedParentAndStudent('reg-preview1@example.com');
      const parentAgent = await loginAgent('reg-preview1@example.com');

      const res = await parentAgent.get('/api/v1/registrations/preview').query({
        studentId: student._id.toString(),
        scheduleId,
      });

      expect(res.status).toBe(200);
      const { periodEnd, ...rest } = res.body;
      expect(rest).toEqual({
        monthlyFee: MONTHLY_FEE,
        chargeAmount: MONTHLY_FEE,
        totalChargeAmount: MONTHLY_FEE,
        siblingDiscountApplied: false,
        siblingDiscountAmount: 0,
        siblingDiscountReason: null,
        registrationFeeCharged: 0,
        registrationFeeWaived: false,
        registrationFeeReason: null,
        // Proration defaults to OFF — byte-identical to pre-proration
        // behavior — until an admin explicitly enables it.
        prorated: false,
        totalClassDays: null,
        remainingClassDays: null,
        dailyRate: null,
      });
      // periodEnd is always present (even when not prorated) so the wizard
      // can always show a "renews on" date — asserted loosely since it's
      // relative to whenever this test actually runs.
      expect(new Date(periodEnd).getTime()).toBeGreaterThan(Date.now());

      // The critical "this is truly read-only" regression guard: no
      // Registration/Subscription got created. A global stripe.paymentIntents
      // .list() assertion isn't reliable here — this is a real, SHARED
      // Stripe TEST-mode account (other tests in this file, and other test
      // files hitting the same account, may run before/around this one), so
      // "the list is empty" isn't a meaningful claim. What IS meaningful:
      // this test deliberately never calls savePaymentMethodFor(), so if
      // previewChargeAmount() ever regressed into attempting a real charge,
      // it would have no payment method to charge and would fail loudly
      // (not return a clean 200) — the 200 assertion above already proves no
      // charge attempt happened.
      expect(await Registration.countDocuments({ studentId: student._id })).toBe(0);
      expect(await Subscription.countDocuments({ studentId: student._id })).toBe(0);
    });

    it(
      "matches the real charge exactly for the sibling discount case — preview and reality never disagree",
      async () => {
        const parent = await seedUser({ role: 'parent', email: 'reg-preview-sibling@example.com' });
        const firstChild = await User.create({
          role: 'student',
          firstName: 'First',
          lastName: 'Preview',
          parentId: parent._id,
        });
        const secondChild = await User.create({
          role: 'student',
          firstName: 'Second',
          lastName: 'Preview',
          parentId: parent._id,
        });

        const parentAgent = await loginAgent('reg-preview-sibling@example.com');
        await savePaymentMethodFor(parentAgent);

        const pricierScheduleId = await seedScheduleWithFee(MONTHLY_FEE * 2, {
          levelName: 'PreviewPricier',
          levelOrder: 20,
        });
        const cheaperScheduleId = await seedScheduleWithFee(MONTHLY_FEE, {
          levelName: 'PreviewCheap',
          levelOrder: 21,
        });

        const firstRes = await parentAgent.post('/api/v1/registrations').send({
          studentId: firstChild._id.toString(),
          scheduleId: pricierScheduleId,
        });
        expect(firstRes.status).toBe(201);

        // Preview the second child's registration — no POST yet.
        const previewRes = await parentAgent.get('/api/v1/registrations/preview').query({
          studentId: secondChild._id.toString(),
          scheduleId: cheaperScheduleId,
        });

        expect(previewRes.status).toBe(200);
        const { periodEnd: siblingPreviewPeriodEnd, ...siblingPreviewRest } = previewRes.body;
        expect(siblingPreviewRest).toEqual({
          monthlyFee: MONTHLY_FEE,
          chargeAmount: MONTHLY_FEE * 0.9,
          totalChargeAmount: MONTHLY_FEE * 0.9,
          siblingDiscountApplied: true,
          siblingDiscountAmount: MONTHLY_FEE * 0.1,
          siblingDiscountReason:
            'This is the lower-priced plan among your active children, so the 10% sibling discount applies here.',
          registrationFeeCharged: 0,
          registrationFeeWaived: false,
          registrationFeeReason: null,
          prorated: false,
          totalClassDays: null,
          remainingClassDays: null,
          dailyRate: null,
        });
        expect(new Date(siblingPreviewPeriodEnd).getTime()).toBeGreaterThan(Date.now());

        // Preview created nothing.
        expect(await Subscription.countDocuments({ studentId: secondChild._id })).toBe(0);

        // Now actually register — the real charge must match the preview.
        const secondRes = await parentAgent.post('/api/v1/registrations').send({
          studentId: secondChild._id.toString(),
          scheduleId: cheaperScheduleId,
        });

        expect(secondRes.status).toBe(201);
        expect(secondRes.body.chargeAmount).toBe(previewRes.body.chargeAmount);
        expect(secondRes.body.siblingDiscountApplied).toBe(previewRes.body.siblingDiscountApplied);
        expect(secondRes.body.siblingDiscountAmount).toBe(previewRes.body.siblingDiscountAmount);
      },
      40000
    );

    it('returns 403 when previewing a child belonging to a different parent', async () => {
      const { scheduleId } = await seedSchedule();
      await seedUser({ role: 'parent', email: 'reg-preview-other@example.com' });
      const { student } = await seedParentAndStudent('reg-preview-owner@example.com');
      const parentAgent = await loginAgent('reg-preview-other@example.com');

      const res = await parentAgent.get('/api/v1/registrations/preview').query({
        studentId: student._id.toString(),
        scheduleId,
      });

      expect(res.status).toBe(403);
    });

    it('returns 400 when studentId or scheduleId is missing', async () => {
      const { student } = await seedParentAndStudent('reg-preview-missing@example.com');
      const parentAgent = await loginAgent('reg-preview-missing@example.com');

      const res = await parentAgent
        .get('/api/v1/registrations/preview')
        .query({ studentId: student._id.toString() });

      expect(res.status).toBe(400);
    });

    it("returns 404 when the class's level has no Price configured", async () => {
      const { scheduleId } = await seedSchedule({ skipPrice: true });
      const { student } = await seedParentAndStudent('reg-preview-nopricing@example.com');
      const parentAgent = await loginAgent('reg-preview-nopricing@example.com');

      const res = await parentAgent.get('/api/v1/registrations/preview').query({
        studentId: student._id.toString(),
        scheduleId,
      });

      expect(res.status).toBe(404);
    });

    it('returns 403 when a non-parent role attempts to preview', async () => {
      const { scheduleId } = await seedSchedule();
      const { student } = await seedParentAndStudent('reg-preview-role@example.com');

      await seedUser({ role: 'admin', email: 'reg-preview-admin@example.com' });
      const adminAgent = await loginAgent('reg-preview-admin@example.com');

      const res = await adminAgent.get('/api/v1/registrations/preview').query({
        studentId: student._id.toString(),
        scheduleId,
      });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/registrations/mine', () => {
    it(
      'enriches each active subscription with a LIVE currentCharge that reflects a sibling discount only true after a LATER registration — never a stale lastChargeAmount snapshot',
      async () => {
        const parent = await seedUser({ role: 'parent', email: 'reg-mine-sibling@example.com' });
        const firstChild = await User.create({
          role: 'student',
          firstName: 'First',
          lastName: 'Mine',
          parentId: parent._id,
        });
        const secondChild = await User.create({
          role: 'student',
          firstName: 'Second',
          lastName: 'Mine',
          parentId: parent._id,
        });

        const parentAgent = await loginAgent('reg-mine-sibling@example.com');
        await savePaymentMethodFor(parentAgent);

        const pricierScheduleId = await seedScheduleWithFee(MONTHLY_FEE * 2, {
          levelName: 'MinePricier',
          levelOrder: 30,
        });
        const cheaperScheduleId = await seedScheduleWithFee(MONTHLY_FEE, {
          levelName: 'MineCheap',
          levelOrder: 31,
        });

        // First (pricier) child registers first — no sibling yet, full
        // price, and this is what gets recorded as lastChargeAmount /
        // lastSiblingDiscountApplied on their Subscription.
        const firstRes = await parentAgent.post('/api/v1/registrations').send({
          studentId: firstChild._id.toString(),
          scheduleId: pricierScheduleId,
        });
        expect(firstRes.status).toBe(201);

        // Second (cheaper) child registers second — wins the discount.
        const secondRes = await parentAgent.post('/api/v1/registrations').send({
          studentId: secondChild._id.toString(),
          scheduleId: cheaperScheduleId,
        });
        expect(secondRes.status).toBe(201);

        const mineRes = await parentAgent.get('/api/v1/registrations/mine');
        expect(mineRes.status).toBe(200);

        const firstRow = mineRes.body.subscriptions.find(
          (sub) => sub.studentId._id === firstChild._id.toString()
        );
        const secondRow = mineRes.body.subscriptions.find(
          (sub) => sub.studentId._id === secondChild._id.toString()
        );

        // The stale, historical fields from firstChild's OWN charge (taken
        // before secondChild existed) are untouched — still full price, no
        // discount. This is the exact snapshot a parent would have seen
        // before this fix, and it never gets rewritten retroactively.
        expect(firstRow.lastChargeAmount).toBe(MONTHLY_FEE * 2);
        expect(firstRow.lastSiblingDiscountApplied).toBeFalsy();

        // But the LIVE currentCharge correctly shows firstChild is no
        // longer the lower payer, with a clear reason — not just a silently
        // missing discount that looks broken.
        expect(firstRow.currentCharge).toEqual({
          amount: MONTHLY_FEE * 2,
          siblingDiscountApplied: false,
          siblingDiscountAmount: 0,
          reason:
            'Your other child has the lower-priced plan, so the sibling discount applies to their plan instead.',
        });

        expect(secondRow.currentCharge).toEqual({
          amount: MONTHLY_FEE * 0.9,
          siblingDiscountApplied: true,
          siblingDiscountAmount: MONTHLY_FEE * 0.1,
          reason:
            'This is the lower-priced plan among your active children, so the 10% sibling discount applies here.',
        });
      },
      40000
    );

    it('omits currentCharge for a cancelled subscription', async () => {
      const { scheduleId } = await seedSchedule();
      const { student } = await seedParentAndStudent('reg-mine-cancelled@example.com');
      const parentAgent = await loginAgent('reg-mine-cancelled@example.com');
      await savePaymentMethodFor(parentAgent);

      const regRes = await parentAgent.post('/api/v1/registrations').send({
        studentId: student._id.toString(),
        scheduleId,
      });
      expect(regRes.status).toBe(201);

      await Subscription.findByIdAndUpdate(regRes.body.subscription._id, { status: 'cancelled' });

      const mineRes = await parentAgent.get('/api/v1/registrations/mine');
      expect(mineRes.status).toBe(200);
      expect(mineRes.body.subscriptions[0].status).toBe('cancelled');
      expect(mineRes.body.subscriptions[0].currentCharge).toBeUndefined();
    });
  });
});
