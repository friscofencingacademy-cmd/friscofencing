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

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const Level = require('../../src/models/level.model');
const Location = require('../../src/models/location.model');
const GroupClass = require('../../src/models/groupClass.model');
const GroupClassSchedule = require('../../src/models/groupClassSchedule.model');
const GroupClassSession = require('../../src/models/groupClassSession.model');
const Price = require('../../src/models/price.model');
const Registration = require('../../src/models/registration.model');
const Subscription = require('../../src/models/subscription.model');
const PaymentMethod = require('../../src/models/paymentMethod.model');
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

        const schedule = await GroupClassSchedule.findById(scheduleId);
        expect(
          schedule.students.some((id) => String(id) === String(student._id))
        ).toBe(true);

        const sessions = await GroupClassSession.find({ scheduleId }).sort({ date: 1 });
        expect(sessions.length).toBeGreaterThan(0);
        sessions.forEach((session) => {
          const onRoster = session.students.some(
            (entry) => String(entry.studentId) === String(student._id)
          );
          expect(onRoster).toBe(true);
        });

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
});
