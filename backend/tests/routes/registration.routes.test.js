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
const Holiday = require('../../src/models/holiday.model');
const { computeProration } = require('../../src/services/billing/proration.service');
const { retryOne, renewOne, runRenewals, previewRenewal } = require('../../src/services/renewal.service');
const { todayDateOnly } = require('../../src/utils/billingDates');
const stripe = require('../../src/config/stripe');
const { hashPassword } = require('../../src/utils/password');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');
const mailService = require('../../src/services/mail.service');
const { seedServices } = require('../../scripts/lib/seedServices');
const Service = require('../../src/models/service.model');

const TEST_PASSWORD = 'correct-password';
const MONTHLY_FEE = 150;

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

beforeEach(async () => {
  // create() resolves the group-classes Service internally now
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

// A level with a class day on EVERY weekday — used only by a test that
// needs a real, successful Stripe charge from a registration whose EXACT
// dollar amount doesn't matter (unlike the proration-focused tests above,
// which anchor deliberately to prove a specific day-count). A single-
// weekday level can legitimately prorate to $0 depending on which real
// calendar day computeProration's OWN local-Date-getter reading of
// FROZEN_NOW resolves to on a given host (a documented pre-existing
// quirk — computeProration is correct under TZ=UTC, prod/CI's actual
// runtime, but a non-UTC dev machine can read a UTC-midnight sentinel as
// the PREVIOUS calendar day) — below Stripe's minimum chargeable amount,
// which would make an unrelated test flaky depending on the host it runs
// on. Every day being a class day makes remainingClassDays >= 1
// unconditionally, so the charge is always well above the minimum.
async function seedScheduleEveryDayWithFee(monthlyFee, { levelName = 'Level', levelOrder = 1 } = {}) {
  const level = await Level.create({ name: levelName, order: levelOrder });
  const location = await Location.create({ name: `Frisco HQ ${levelName}`, address: '123 Main St' });
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

  let scheduleId;

  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek += 1) {
    // eslint-disable-next-line no-await-in-loop -- test setup, negligible fan-out
    const scheduleRes = await adminAgent.post('/api/v1/group-class-schedules').send({
      classId: groupClass._id.toString(),
      coachId: coach._id.toString(),
      dayOfWeek,
      startTime: '17:00',
      endTime: '18:00',
      students: [],
    });

    expect(scheduleRes.status).toBe(201);

    if (dayOfWeek === 4) scheduleId = scheduleRes.body.schedule._id; // the one the caller registers against
  }

  return { scheduleId, levelId: level._id };
}

// Every real-Stripe registration test in this suite runs with `now` frozen
// to the 1st of a month (docs/decisions/007-calendar-month-billing.md).
// Under always-on proration (the Setting.prorationEnabled toggle is
// retired — docs/plans/billing-anchor-and-sibling-discount-plan.md D1),
// registering exactly on the 1st means remainingClassDays === totalClassDays
// for computeProration(), so proratedAmount always equals the raw
// monthlyFee — every pre-existing flat-fee assertion below (MONTHLY_FEE,
// MONTHLY_FEE * 2, etc.) stays numerically correct. Only the
// prorated/totalClassDays/remainingClassDays/dailyRate fields themselves
// flip from the old false/null shape to real computed values — asserted via
// expectedProrationFor() below (the real computeProration() function, never
// a hardcoded day count that could drift). A fixed literal instant, not
// "now + N days" (docs/TESTING_STRATEGY.md's no-time-bomb-dates rule).
const FROZEN_NOW = new Date('2026-10-01T15:00:00.000Z'); // Oct 1, 2026, 10am
// Central (CDT, UTC-5) — the 1st of the month in both UTC and Central, so
// todayDateOnly() resolves to the same calendar day regardless of which
// zone a reader mentally checks it against.

// Real computeProration() for `levelId`, anchored to FROZEN_NOW's calendar
// day — the single source of what "prorated / totalClassDays /
// remainingClassDays / dailyRate" SHOULD be for a registration/preview
// happening right now in this suite, so an assertion can never hardcode a
// day count that silently drifts if FROZEN_NOW or a schedule's weekday ever
// changes.
async function expectedProrationFor(levelId, monthlyFee = MONTHLY_FEE) {
  return computeProration({ levelId, monthlyFee, registrationDate: todayDateOnly() });
}

describe('Registration routes', () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: FROZEN_NOW,
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
  });

  afterEach(() => {
    jest.useRealTimers();
  });

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
        expect(res.body.paymentStatus).toBe('completed');
        expect(res.body.chargeAmount).toBe(MONTHLY_FEE);
        expect(res.body.registration.status).toBe('completed');
        expect(res.body.subscription.status).toBe('active');

        const registrations = await Registration.find({ studentId: student._id });
        expect(registrations).toHaveLength(1);

        // The ledger row itself — docs/plans/registration-ledger-plan.md D1/D3,
        // restructured onto the unified ledger by docs/plans/service-registry-
        // unified-ledger-plan.md (billingShape/serviceId are the new
        // dimensions; everything else is unchanged).
        const [ledgerRow] = registrations;
        const groupClassesService = await Service.findOne({ code: 'group-classes' });
        expect(ledgerRow.billingShape).toBe('subscription_cycle');
        expect(String(ledgerRow.serviceId)).toBe(String(groupClassesService._id));
        const subscriptionForLedger = await Subscription.findOne({ studentId: student._id });
        expect(String(ledgerRow.subscriptionId)).toBe(String(subscriptionForLedger._id));
        expect(ledgerRow.eventType).toBe('initial');
        expect(ledgerRow.status).toBe('completed');
        expect(ledgerRow.amount).toBe(res.body.totalChargeAmount);
        expect(ledgerRow.breakdown.monthlyFee).toBe(MONTHLY_FEE);
        // Always true now — proration is unconditional (ADR 007); this
        // registration happens to land exactly on the 1st (FROZEN_NOW), so
        // the prorated amount equals the full monthly fee.
        expect(ledgerRow.breakdown.prorated).toBe(true);
        expect(ledgerRow.breakdown.proratedAmount).toBe(MONTHLY_FEE);
        expect(ledgerRow.periodStart).toBeInstanceOf(Date);
        expect(ledgerRow.periodEnd).toBeInstanceOf(Date);
        expect(ledgerRow.periodEnd.getTime()).toBeGreaterThan(ledgerRow.periodStart.getTime());
        expect(typeof ledgerRow.stripePaymentIntentId).toBe('string');
        expect(ledgerRow.stripePaymentIntentId).not.toHaveLength(0);
        expect(ledgerRow.paidAt).toBeInstanceOf(Date);

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

    // docs/plans/manual-charge-and-pdf-invoice-plan.md PR 2.
    it(
      'attaches an invoice PDF (matching the ledger row it just created) to the confirmation email',
      async () => {
        const { scheduleId } = await seedSchedule();
        const { student } = await seedParentAndStudent('reg-invoice-attach@example.com');
        const parentAgent = await loginAgent('reg-invoice-attach@example.com');
        await savePaymentMethodFor(parentAgent);

        const res = await parentAgent.post('/api/v1/registrations').send({
          studentId: student._id.toString(),
          scheduleId,
        });

        expect(res.status).toBe(201);

        const call = mailService.sendRegistrationConfirmationEmail.mock.calls.find(
          (c) => c[0].parent?.email === 'reg-invoice-attach@example.com'
        )[0];
        expect(call.invoiceNumber).toBe(`INV-${res.body.registration._id}`);
        expect(Buffer.isBuffer(call.invoicePdf)).toBe(true);
        expect(call.invoicePdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      },
      30000
    );

    it(
      'a PDF generation failure still sends the confirmation email (no attachment) and does not affect the registration outcome',
      async () => {
        const invoiceService = require('../../src/services/invoice.service');
        const buildInvoiceDataSpy = jest
          .spyOn(invoiceService, 'buildInvoiceData')
          .mockRejectedValue(new Error('PDF generation exploded'));

        const { scheduleId } = await seedSchedule();
        const { student } = await seedParentAndStudent('reg-invoice-fail@example.com');
        const parentAgent = await loginAgent('reg-invoice-fail@example.com');
        await savePaymentMethodFor(parentAgent);

        const res = await parentAgent.post('/api/v1/registrations').send({
          studentId: student._id.toString(),
          scheduleId,
        });

        expect(res.status).toBe(201);
        expect(res.body.paymentStatus).toBe('completed');

        const call = mailService.sendRegistrationConfirmationEmail.mock.calls.find(
          (c) => c[0].parent?.email === 'reg-invoice-fail@example.com'
        )[0];
        expect(call.invoicePdf).toBeUndefined();
        expect(call.invoiceNumber).toBeUndefined();

        buildInvoiceDataSpy.mockRestore();
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
      'accepts the registration (201, paymentStatus: pending) on a real Stripe TEST-mode card decline, enters retry/dunning, and grants no roster access — docs/decisions/008-registration-create-pending-first.md',
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

        // The registration itself is accepted — only the FIRST charge
        // attempt failed. Not a 402: a brand-new signup's failed first
        // charge is no longer rejected outright, it enters the same
        // retry/dunning renewals already use.
        expect(res.status).toBe(201);
        expect(res.body.paymentStatus).toBe('pending');

        // The Subscription was reserved (Guard A's whole point) even though
        // no charge has ever succeeded — lastChargeAmount stays null, the
        // correct "never successfully charged" signal.
        const subscription = await Subscription.findOne({ studentId: student._id });
        expect(subscription).not.toBeNull();
        expect(subscription.status).toBe('active');
        expect(subscription.lastChargeAmount).toBeNull();
        expect(subscription.retryCount).toBe(1);
        expect(subscription.nextRetryAt).toBeInstanceOf(Date);

        // The ledger row records the failed attempt — kept permanently,
        // never deleted, same as a failed renewal's row.
        const registrations = await Registration.find({ studentId: student._id });
        expect(registrations).toHaveLength(1);
        expect(registrations[0].status).toBe('failed');
        expect(typeof registrations[0].failureMessage).toBe('string');

        // No roster/session access until a charge actually succeeds.
        const schedule = await GroupClassSchedule.findById(scheduleId);
        expect(
          schedule.students.some((id) => String(id) === String(student._id))
        ).toBe(false);

        // The payment-failure email fired for THIS parent — the parent must
        // be told to expect a retry, not a welcome. (This mock's call
        // history accumulates across the whole test file — no
        // clearAllMocks configured — so this asserts on THIS parent's own
        // call rather than an absolute "never called" across every test.)
        expect(mailService.sendPaymentFailureEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            parent: expect.objectContaining({ email: 'reg-decline@example.com' }),
            student: expect.objectContaining({ firstName: student.firstName }),
            isFinal: false,
            attemptNumber: 1,
          })
        );
        expect(mailService.sendRegistrationConfirmationEmail).not.toHaveBeenCalledWith(
          expect.objectContaining({
            parent: expect.objectContaining({ email: 'reg-decline@example.com' }),
          })
        );
      },
      30000
    );

    it(
      'cancels a subscription whose first-ever charge exhausts all retries — never granted roster access at any point',
      async () => {
        const { scheduleId } = await seedSchedule();
        const { student } = await seedParentAndStudent('reg-decline-exhaust@example.com');
        const parentAgent = await loginAgent('reg-decline-exhaust@example.com');

        await savePaymentMethodFor(parentAgent);

        const parent = await User.findOne({ email: 'reg-decline-exhaust@example.com' });
        await PaymentMethod.updateOne(
          { parentId: parent._id },
          { stripePaymentMethodId: 'pm_card_chargeDeclined' }
        );

        const res = await parentAgent.post('/api/v1/registrations').send({
          studentId: student._id.toString(),
          scheduleId,
        });
        expect(res.status).toBe(201);
        expect(res.body.paymentStatus).toBe('pending');

        const subscription = await Subscription.findOne({ studentId: student._id });

        // Runs the exact same retry machinery a failed RENEWAL uses — no
        // separate code path exists for a never-successfully-paid
        // subscription. Force each retry due now (real dates, not mocked
        // time) so this test doesn't need to wait real days.
        await Subscription.updateOne({ _id: subscription._id }, { $set: { nextRetryAt: new Date() } });
        await retryOne(subscription._id); // attempt 2, still declines
        await Subscription.updateOne({ _id: subscription._id }, { $set: { nextRetryAt: new Date() } });
        await retryOne(subscription._id); // attempt 3, still declines
        await Subscription.updateOne({ _id: subscription._id }, { $set: { nextRetryAt: new Date() } });
        const finalResult = await retryOne(subscription._id); // exhausted -> cancelled

        expect(finalResult.outcome).toBe('cancelled_exhausted');

        const cancelled = await Subscription.findById(subscription._id);
        expect(cancelled.status).toBe('cancelled');
        expect(cancelled.lastChargeAmount).toBeNull();

        const schedule = await GroupClassSchedule.findById(scheduleId);
        expect(
          schedule.students.some((id) => String(id) === String(student._id))
        ).toBe(false);
      },
      40000
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
        // The 409 loser must never have written a ledger row — only the one
        // real charge (the winner's) has a Registration row to show for it.
        expect(await Registration.countDocuments({ studentId: student._id })).toBe(1);
      },
      30000
    );

    it(
      'allows re-registering the same student + schedule after the first subscription was cancelled — Guard A (docs/plans/registration-ledger-plan.md D2) scopes uniqueness to ACTIVE subscriptions only',
      async () => {
        const { scheduleId } = await seedSchedule();
        const { student } = await seedParentAndStudent('reg-parent-recancel@example.com');
        const parentAgent = await loginAgent('reg-parent-recancel@example.com');

        await savePaymentMethodFor(parentAgent);

        const firstRes = await parentAgent.post('/api/v1/registrations').send({
          studentId: student._id.toString(),
          scheduleId,
        });
        expect(firstRes.status).toBe(201);

        await Subscription.updateOne(
          { studentId: student._id, scheduleId },
          { $set: { status: 'cancelled' } }
        );

        const secondRes = await parentAgent.post('/api/v1/registrations').send({
          studentId: student._id.toString(),
          scheduleId,
        });
        expect(secondRes.status).toBe(201);

        expect(await Subscription.countDocuments({ studentId: student._id })).toBe(2);
        expect(
          await Subscription.countDocuments({ studentId: student._id, status: 'active' })
        ).toBe(1);
        expect(await Registration.countDocuments({ studentId: student._id })).toBe(2);
      },
      30000
    );

    it(
      'closes the concurrent-registration race at the DB level: two simultaneous requests for the same student + schedule produce exactly one Subscription and one ledger row',
      async () => {
        const { scheduleId } = await seedSchedule();
        const { student } = await seedParentAndStudent('reg-parent-race@example.com');
        const parentAgent = await loginAgent('reg-parent-race@example.com');

        await savePaymentMethodFor(parentAgent);

        // Fired via Promise.all (not awaited sequentially) so both requests'
        // existingSubscription pre-checks run against the same
        // pre-registration DB state — there is no way to guarantee this
        // ordering, but Node's async I/O interleaving at the real Mongo/
        // Stripe network calls means both pre-checks reliably see "no
        // existing subscription" before either request's Subscription.create
        // resolves. What actually decides the outcome deterministically is
        // Guard A's unique index at the second create() call: exactly one of
        // the two inserts can succeed, however the pre-checks landed. Since
        // the Subscription is now RESERVED before either request ever
        // touches Stripe (docs/decisions/008-registration-create-pending-
        // first.md), the loser's card is never charged at all — see the
        // dedicated cross-schedule race test below for the direct assertion
        // of that (the actual bug this ADR closes).
        const [firstRes, secondRes] = await Promise.all([
          parentAgent.post('/api/v1/registrations').send({
            studentId: student._id.toString(),
            scheduleId,
          }),
          parentAgent.post('/api/v1/registrations').send({
            studentId: student._id.toString(),
            scheduleId,
          }),
        ]);

        const statuses = [firstRes.status, secondRes.status].sort();
        expect(statuses).toEqual([201, 409]);

        expect(await Subscription.countDocuments({ studentId: student._id })).toBe(1);
        // The 409 loser must never have written a ledger row — only the one
        // real charge (the winner's) has a Registration row to show for it.
        expect(await Registration.countDocuments({ studentId: student._id })).toBe(1);
      },
      30000
    );

    it(
      "closes the CROSS-schedule double-charge race (docs/decisions/008-registration-create-pending-first.md — the actual bug found while building the one-active-subscription guard): two simultaneous requests for the SAME student on TWO DIFFERENT schedules produce exactly one Subscription, one ledger row, and ONE real Stripe charge — the loser's card is never touched",
      async () => {
        const { scheduleId: scheduleA } = await seedSchedule();
        const scheduleBId = await seedScheduleWithFee(MONTHLY_FEE * 2, {
          levelName: 'RaceCrossSchedule',
          levelOrder: 50,
        });
        const { student } = await seedParentAndStudent('reg-parent-cross-race@example.com');
        const parentAgent = await loginAgent('reg-parent-cross-race@example.com');

        await savePaymentMethodFor(parentAgent);

        // Under the OLD charge-first create(), this race would let BOTH
        // requests charge Stripe for real (different schedules -> different
        // idempotency keys), with only one able to win the Subscription
        // write — leaving the loser's real charge with nothing to attach
        // to. Reserving the Subscription BEFORE charging closes this: the
        // loser's request never reaches Stripe at all.
        const [firstRes, secondRes] = await Promise.all([
          parentAgent.post('/api/v1/registrations').send({
            studentId: student._id.toString(),
            scheduleId: scheduleA,
          }),
          parentAgent.post('/api/v1/registrations').send({
            studentId: student._id.toString(),
            scheduleId: scheduleBId,
          }),
        ]);

        const statuses = [firstRes.status, secondRes.status].sort();
        expect(statuses).toEqual([201, 409]);

        expect(await Subscription.countDocuments({ studentId: student._id })).toBe(1);
        expect(await Registration.countDocuments({ studentId: student._id })).toBe(1);

        // The direct assertion this test exists for: exactly ONE real
        // Stripe PaymentIntent was ever created for this parent's charge —
        // not two. (This is a real, shared Stripe TEST-mode account, but
        // this parent/customer is unique to this test, so its own
        // PaymentIntent count is a meaningful, isolated signal.)
        const parent = await User.findOne({ email: 'reg-parent-cross-race@example.com' });
        const paymentIntents = await stripe.paymentIntents.list({ customer: parent.stripeCustomerId, limit: 10 });
        expect(paymentIntents.data).toHaveLength(1);
      },
      30000
    );

    it(
      'registers successfully even when the schedule is already at capacity, in premium mode (the live default)',
      async () => {
        // ENABLE_SCHEDULE_BASED_REGISTRATION is unset in this suite — the
        // live default is premium (docs/plans/premium-registration-and-
        // attendance-plan.md §0/§4). Premium students attend any session of
        // their level, so one schedule's roster filling up doesn't mean the
        // level has no room — registration.service.js's create() no longer
        // enforces per-schedule capacity in this mode.
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

        expect(res.status).toBe(201);

        expect(await Registration.countDocuments({ studentId: student._id })).toBe(1);
        expect(await Subscription.countDocuments({ studentId: student._id })).toBe(1);

        const schedule = await GroupClassSchedule.findById(scheduleId);
        expect(schedule.students).toHaveLength(11);
      },
      20000
    );

    it(
      'returns 409 and charges nothing when the schedule is already at capacity, in schedule-based mode',
      async () => {
        process.env.ENABLE_SCHEDULE_BASED_REGISTRATION = 'true';
        try {
          const { scheduleId } = await seedSchedule(); // capacity: 10
          const { student } = await seedParentAndStudent('reg-full-legacy@example.com');
          const parentAgent = await loginAgent('reg-full-legacy@example.com');

          await savePaymentMethodFor(parentAgent);

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
        } finally {
          delete process.env.ENABLE_SCHEDULE_BASED_REGISTRATION;
        }
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
    // (calculateChargeAmount.service.js, docs/decisions/006-sibling-
    // discount-family-rule.md) applies the 10% discount to whichever
    // active child has the LOWER fee. At registration time specifically,
    // this test covers the "own-fee" case — the second child IS the lower
    // payer, so their own bill gets the discount. The other direction (the
    // NEW child being the HIGHER payer, getting the bridge discount off
    // the family's already-lower fee) is covered by the dedicated bridge
    // test right after this one.
    it(
      "applies the 10% sibling discount to the second child's real Stripe charge when their class is priced lower than the first child's (own-fee case)",
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

    it(
      "applies the family sibling discount's BRIDGE case when the NEW child is the HIGHER payer — 10% off the EXISTING sibling's lower fee comes off THIS bill immediately, with a distinct reason (docs/decisions/006-sibling-discount-family-rule.md)",
      async () => {
        const parent = await seedUser({ role: 'parent', email: 'reg-sibling-bridge-parent@example.com' });
        const firstChild = await User.create({
          role: 'student',
          firstName: 'First',
          lastName: 'Bridge',
          parentId: parent._id,
        });
        const secondChild = await User.create({
          role: 'student',
          firstName: 'Second',
          lastName: 'Bridge',
          parentId: parent._id,
        });

        const parentAgent = await loginAgent('reg-sibling-bridge-parent@example.com');
        await savePaymentMethodFor(parentAgent);

        const cheaperScheduleId = await seedScheduleWithFee(MONTHLY_FEE, {
          levelName: 'BridgeCheap',
          levelOrder: 12,
        });
        const pricierScheduleId = await seedScheduleWithFee(MONTHLY_FEE * 2, {
          levelName: 'BridgePricier',
          levelOrder: 13,
        });

        // First child registers into the CHEAPER class first.
        const firstRes = await parentAgent.post('/api/v1/registrations').send({
          studentId: firstChild._id.toString(),
          scheduleId: cheaperScheduleId,
        });
        expect(firstRes.status).toBe(201);
        expect(firstRes.body.siblingDiscountApplied).toBe(false);

        // Second child registers into the PRICIER class — under the old
        // "lower-payer-only" rule this would get NO discount at all. Under
        // the family rule, the family discount applies immediately: 10% of
        // the family's current lower fee (the first child's MONTHLY_FEE)
        // comes off the SECOND child's own bill.
        const secondRes = await parentAgent.post('/api/v1/registrations').send({
          studentId: secondChild._id.toString(),
          scheduleId: pricierScheduleId,
        });

        expect(secondRes.status).toBe(201);
        expect(secondRes.body.siblingDiscountApplied).toBe(true);
        expect(secondRes.body.siblingDiscountAmount).toBe(MONTHLY_FEE * 0.1);
        expect(secondRes.body.chargeAmount).toBe(MONTHLY_FEE * 2 - MONTHLY_FEE * 0.1);
        expect(secondRes.body.siblingDiscountReason).toBe(
          "Your family's 10% sibling discount applies to this registration, based on your other child's lower-priced plan."
        );

        // The real Stripe charge reflects the bridge-discounted amount.
        const paymentIntents = await stripe.paymentIntents.list({ limit: 10 });
        const secondChildIntent = paymentIntents.data.find(
          (intent) => intent.amount === Math.round((MONTHLY_FEE * 2 - MONTHLY_FEE * 0.1) * 100)
        );
        expect(secondChildIntent).toBeDefined();
        expect(secondChildIntent.status).toBe('succeeded');

        // The ledger row carries the same fields — the audit "mark" the
        // owner asked for.
        const ledgerRow = await Registration.findOne({ studentId: secondChild._id });
        expect(ledgerRow.breakdown.siblingDiscountApplied).toBe(true);
        expect(ledgerRow.breakdown.siblingDiscountAmount).toBe(MONTHLY_FEE * 0.1);
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

    it(
      "charges the level's own registration fee override instead of the academy-wide default (docs/plans/per-level-registration-fee-plan.md)",
      async () => {
        await Setting.create({ registrationFee: 145, returningStudentGracePeriodMonths: 0 });

        // seedSchedule() creates a "Beginner" level's Price with no
        // registrationFee override — set one directly, same as an admin
        // would via the Prices page.
        const { scheduleId, levelId } = await seedSchedule();
        await Price.findOneAndUpdate({ levelId }, { registrationFee: 100 });

        const { student } = await seedParentAndStudent('reg-fee-level-override@example.com');
        const parentAgent = await loginAgent('reg-fee-level-override@example.com');
        await savePaymentMethodFor(parentAgent);

        const res = await parentAgent.post('/api/v1/registrations').send({
          studentId: student._id.toString(),
          scheduleId,
        });

        expect(res.status).toBe(201);
        expect(res.body.registrationFeeCharged).toBe(100);
        expect(res.body.totalChargeAmount).toBe(MONTHLY_FEE + 100);

        const paymentIntents = await stripe.paymentIntents.list({ limit: 10 });
        const intent = paymentIntents.data.find(
          (i) => i.amount === Math.round((MONTHLY_FEE + 100) * 100)
        );
        expect(intent).toBeDefined();
      },
      20000
    );
  });

  describe('prorated first-month billing', () => {
    it(
      'charges the full monthly fee and anchors the period to the next 1st when registering exactly on the 1st (proration is unconditional — ADR 007)',
      async () => {
        const { scheduleId, levelId } = await seedSchedule();
        const { student } = await seedParentAndStudent('proration-on-the-1st@example.com');
        const parentAgent = await loginAgent('proration-on-the-1st@example.com');
        await savePaymentMethodFor(parentAgent);

        const expected = await expectedProrationFor(levelId);

        const res = await parentAgent.post('/api/v1/registrations').send({
          studentId: student._id.toString(),
          scheduleId,
        });

        expect(res.status).toBe(201);
        expect(res.body.chargeAmount).toBe(MONTHLY_FEE);
        expect(res.body.prorated).toBe(true);
        expect(res.body.totalClassDays).toBe(expected.totalClassDays);
        expect(res.body.remainingClassDays).toBe(expected.totalClassDays); // on the 1st, nothing has passed yet
        expect(res.body.dailyRate).toBe(expected.dailyRate);

        const subscription = await Subscription.findOne({ studentId: student._id });
        expect(subscription.firstChargeProrated).toBe(true);
        // Calendar-month boundary (ADR 007), not a rolling month from
        // anchorDate — registering on the 1st, both would coincidentally
        // land on the same date, so this asserts the actual boundary
        // shape (getDate() === 1) rather than relying on that coincidence.
        expect(subscription.currentPeriodEnd.getUTCDate()).toBe(1);
        expect(subscription.currentPeriodEnd.getTime()).toBeGreaterThan(
          subscription.currentPeriodStart.getTime()
        );
      },
      20000
    );

    it(
      'prorates the real Stripe charge and anchors the period to the calendar-month boundary for a mid-month registration',
      async () => {
        // The suite's default FROZEN_NOW is deliberately the 1st (so the
        // OTHER tests' flat-fee assertions stay simple) — this specific
        // test needs a genuine partial month, so it moves the clock forward
        // mid-month before registering. Fake timers stay active throughout
        // (the outer beforeEach already set them up); this only changes
        // what "now" reads as.
        jest.setSystemTime(new Date('2026-10-15T15:00:00.000Z'));

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
          // Matches what the real code now anchors to when no explicit
          // startDate is chosen (docs/plans/timezone-consistency-plan.md
          // D10) — a date-only sentinel, not the exact current instant.
          // Using new Date() here would silently drift this fixture out of
          // sync with reality.
          registrationDate: todayDateOnly(),
        });

        // Prove this is a REAL partial-month charge, not a coincidental
        // full month — the point of this test, now that every registration
        // is prorated (a bug here would silently pass if this test also
        // landed on the 1st, same as the "on the 1st" test above it).
        expect(expected.remainingClassDays).toBeLessThan(expected.totalClassDays);

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

        // The ledger row's own breakdown reflects the prorated amount too —
        // the prorated counterpart to the non-prorated assertions in the
        // happy-path test above.
        const ledgerRow = await Registration.findOne({ studentId: student._id });
        expect(ledgerRow.breakdown.prorated).toBe(true);
        expect(ledgerRow.breakdown.proratedAmount).toBe(expected.proratedAmount);
        expect(ledgerRow.breakdown.monthlyFee).toBe(MONTHLY_FEE);
        expect(ledgerRow.amount).toBe(expected.proratedAmount);
        expect(ledgerRow.periodEnd.getFullYear()).toBe(expected.periodEnd.getFullYear());
        expect(ledgerRow.periodEnd.getMonth()).toBe(expected.periodEnd.getMonth());
        expect(ledgerRow.periodEnd.getDate()).toBe(expected.periodEnd.getDate());

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

    // docs/plans/timezone-consistency-plan.md D10 — the actual bug this
    // fixes: an immediate registration (no explicit startDate) placed
    // during the UTC/Central gap window used to anchor its proration to
    // the WRONG calendar day (raw new Date(), UTC-anchored in this test
    // runner). Fakes ONLY `now` (real timers stay real for the Stripe HTTP
    // round trip and the Mongo driver), same pattern as
    // privateClassSchedule.routes.test.js's own DST/gap-window test.
    it(
      'anchors proration to the correct Central calendar day for an immediate registration inside the UTC/Central gap window',
      async () => {
        // 2026-01-16T04:30:00.000Z is 2026-01-15 10:30pm Central (CST) but
        // already Jan 16 in UTC — the exact daily gap window this plan
        // closes.
        jest.useFakeTimers({
          now: new Date('2026-01-16T04:30:00.000Z'),
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
          const { scheduleId, levelId } = await seedSchedule();
          const { student } = await seedParentAndStudent('proration-gap-window@example.com');
          const parentAgent = await loginAgent('proration-gap-window@example.com');
          await savePaymentMethodFor(parentAgent);

          // The correct anchor: Central's Jan 15, not UTC's Jan 16.
          const expected = await computeProration({
            levelId,
            monthlyFee: MONTHLY_FEE,
            registrationDate: todayDateOnly(),
          });
          expect(todayDateOnly().toISOString()).toBe('2026-01-15T00:00:00.000Z');

          const res = await parentAgent.post('/api/v1/registrations').send({
            studentId: student._id.toString(),
            scheduleId,
          });

          expect(res.status).toBe(201);
          expect(res.body.remainingClassDays).toBe(expected.remainingClassDays);
          expect(res.body.chargeAmount).toBe(expected.proratedAmount);

          const subscription = await Subscription.findOne({ studentId: student._id });
          expect(subscription.currentPeriodStart.toISOString()).toBe('2026-01-15T00:00:00.000Z');
        } finally {
          jest.useRealTimers();
        }
      },
      20000
    );

    it(
      'applies proration BEFORE the sibling discount (owner-directed sequencing) — the 10% is computed on the prorated amount, not the raw list price',
      async () => {
        // Mid-month, same reasoning as the mid-month proration test above —
        // on the 1st, proratedAmount === monthlyFee exactly, which would
        // make this test pass without actually proving the sibling
        // comparison uses the PRORATED figure rather than the raw one.
        jest.setSystemTime(new Date('2026-10-15T15:00:00.000Z'));

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
          // Matches what the real code now anchors to when no explicit
          // startDate is chosen (docs/plans/timezone-consistency-plan.md
          // D10) — a date-only sentinel, not the exact current instant.
          // Using new Date() here would silently drift this fixture out of
          // sync with reality.
          registrationDate: todayDateOnly(),
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

  describe('start date selection', () => {
    it(
      'anchors proration and the Subscription period to a real, parent-chosen future session date instead of today',
      async () => {
        const { scheduleId, levelId } = await seedSchedule();
        const { student } = await seedParentAndStudent('startdate-future@example.com');
        const parentAgent = await loginAgent('startdate-future@example.com');
        await savePaymentMethodFor(parentAgent);

        // seedSchedule's real create route generates 8 real weekly sessions —
        // pick the second one (a genuine future date, not "today") so this
        // test actually exercises anchoring off something other than `now`.
        const sessions = await GroupClassSession.find({ scheduleId }).sort({ date: 1 });
        const chosenSession = sessions[1];

        const expected = await computeProration({
          levelId,
          monthlyFee: MONTHLY_FEE,
          registrationDate: chosenSession.date,
        });

        const res = await parentAgent.post('/api/v1/registrations').send({
          studentId: student._id.toString(),
          scheduleId,
          startDate: chosenSession.date.toISOString(),
        });

        expect(res.status).toBe(201);
        expect(res.body.prorated).toBe(true);
        expect(res.body.remainingClassDays).toBe(expected.remainingClassDays);
        expect(res.body.chargeAmount).toBe(expected.proratedAmount);

        const subscription = await Subscription.findOne({ studentId: student._id });
        expect(subscription.currentPeriodStart.getTime()).toBe(chosenSession.date.getTime());
        expect(subscription.currentPeriodEnd.getFullYear()).toBe(expected.periodEnd.getFullYear());
        expect(subscription.currentPeriodEnd.getMonth()).toBe(expected.periodEnd.getMonth());
        expect(subscription.currentPeriodEnd.getDate()).toBe(expected.periodEnd.getDate());
      },
      20000
    );

    it(
      'charges the FULL monthly fee (no proration) and anchors the period to the calendar month itself when the chosen start date falls in a FUTURE month (docs/plans/payment-airtight-plan.md D1)',
      async () => {
        const { scheduleId } = await seedSchedule();
        const { student } = await seedParentAndStudent('startdate-future-month@example.com');
        const parentAgent = await loginAgent('startdate-future-month@example.com');
        await savePaymentMethodFor(parentAgent);

        // seedSchedule's real create route generates 8 weekly sessions from
        // FROZEN_NOW (Oct 1, 2026) — the level's Wednesday sessions land
        // Oct 7/14/21/28, then Nov 4/11/18/25. sessions[4] (Nov 4) is a
        // genuine FUTURE-MONTH anchor, not just a future date within
        // October — the exact case the trigger incident
        // (viji.annadurai@gmail.com, 2026-08-30) got wrong: "Enroll for next
        // month" anchored to a real session date that wasn't the 1st, and
        // the old unconditional proration silently charged 16/17 of a
        // month that should have been billed in full.
        const sessions = await GroupClassSession.find({ scheduleId }).sort({ date: 1 });
        const chosenSession = sessions[4];
        expect(chosenSession.date.toISOString()).toBe('2026-11-04T00:00:00.000Z');

        const res = await parentAgent.post('/api/v1/registrations').send({
          studentId: student._id.toString(),
          scheduleId,
          startDate: chosenSession.date.toISOString(),
        });

        expect(res.status).toBe(201);
        expect(res.body.prorated).toBe(false);
        expect(res.body.chargeAmount).toBe(MONTHLY_FEE);
        expect(res.body.totalChargeAmount).toBe(MONTHLY_FEE);
        expect(res.body.totalClassDays).toBe(0);
        expect(res.body.remainingClassDays).toBe(0);

        const subscription = await Subscription.findOne({ studentId: student._id });
        expect(subscription.firstChargeProrated).toBe(false);
        // The billing period is the WHOLE calendar month, not anchored to
        // the 4th (the actual session/roster-join date) — Nov 1 -> Dec 1.
        expect(subscription.currentPeriodStart.toISOString()).toBe('2026-11-01T00:00:00.000Z');
        expect(subscription.currentPeriodEnd.toISOString()).toBe('2026-12-01T00:00:00.000Z');
        expect(subscription.nextBillingDate.toISOString()).toBe('2026-12-01T00:00:00.000Z');

        const ledgerRow = await Registration.findOne({ studentId: student._id });
        expect(ledgerRow.breakdown.prorated).toBe(false);
        expect(ledgerRow.breakdown.proratedAmount).toBeNull();
        expect(ledgerRow.periodStart.toISOString()).toBe('2026-11-01T00:00:00.000Z');
        expect(ledgerRow.periodEnd.toISOString()).toBe('2026-12-01T00:00:00.000Z');

        const paymentIntents = await stripe.paymentIntents.list({ limit: 10 });
        const intent = paymentIntents.data.find((i) => i.amount === Math.round(MONTHLY_FEE * 100));
        expect(intent).toBeDefined();
        expect(intent.status).toBe('succeeded');

        // The owner's edge case, pinned (docs/plans/payment-airtight-plan.md
        // Context section): register in one month for the next, then a
        // renewal check DURING that already-paid next month (whether the
        // unscheduled cron or the admin Charge button's preview) must
        // immediately recognize the month is paid for and charge nothing —
        // never re-derive "was this paid" from anything but nextBillingDate/
        // the ledger. Move the frozen clock into November (still before the
        // real Dec 1 due date) and re-check all three surfaces.
        jest.setSystemTime(new Date('2026-11-15T15:00:00.000Z'));

        const preview = await previewRenewal(subscription._id);
        expect(preview.outcome).toBe('previewable');
        expect(preview.due).toBe(false);

        const directResult = await renewOne(subscription._id);
        expect(directResult).toEqual({ subscriptionId: subscription._id, outcome: 'skipped_not_due' });

        const { total } = await runRenewals();
        expect(total).toBe(0);

        // Nothing charged twice — still exactly the one ledger row from the
        // original registration, subscription fields untouched.
        expect(await Registration.countDocuments({ studentId: student._id })).toBe(1);
        const unchangedSubscription = await Subscription.findById(subscription._id);
        expect(unchangedSubscription.currentPeriodEnd.toISOString()).toBe('2026-12-01T00:00:00.000Z');
        expect(unchangedSubscription.nextBillingDate.toISOString()).toBe('2026-12-01T00:00:00.000Z');
      },
      20000
    );

    it('GET /preview shows the full monthly fee, never a prorated one, for a startDate in a future month', async () => {
      const { scheduleId } = await seedSchedule();
      const { student } = await seedParentAndStudent('startdate-future-month-preview@example.com');
      const parentAgent = await loginAgent('startdate-future-month-preview@example.com');

      const sessions = await GroupClassSession.find({ scheduleId }).sort({ date: 1 });
      const chosenSession = sessions[4];

      const res = await parentAgent.get('/api/v1/registrations/preview').query({
        studentId: student._id.toString(),
        scheduleId,
        startDate: chosenSession.date.toISOString(),
      });

      expect(res.status).toBe(200);
      expect(res.body.prorated).toBe(false);
      expect(res.body.chargeAmount).toBe(MONTHLY_FEE);
      expect(res.body.totalChargeAmount).toBe(MONTHLY_FEE);
    });

    it('returns 400 and creates/charges nothing when startDate does not match a real session for the schedule', async () => {
      const { scheduleId } = await seedSchedule();
      const { student } = await seedParentAndStudent('startdate-fake@example.com');
      const parentAgent = await loginAgent('startdate-fake@example.com');
      await savePaymentMethodFor(parentAgent);

      const farFuture = new Date();
      farFuture.setFullYear(farFuture.getFullYear() + 1);

      const res = await parentAgent.post('/api/v1/registrations').send({
        studentId: student._id.toString(),
        scheduleId,
        startDate: farFuture.toISOString(),
      });

      expect(res.status).toBe(400);
      expect(await Registration.countDocuments({ studentId: student._id })).toBe(0);
      expect(await Subscription.countDocuments({ studentId: student._id })).toBe(0);
    });

    it('returns 400 and creates/charges nothing when startDate falls on an academy holiday (docs/plans/holiday-blocking-plan.md D7)', async () => {
      const { scheduleId } = await seedSchedule();
      const { student } = await seedParentAndStudent('startdate-holiday@example.com');
      const parentAgent = await loginAgent('startdate-holiday@example.com');
      await savePaymentMethodFor(parentAgent);

      const session = await GroupClassSession.findOne({ scheduleId });
      await Holiday.create({ name: 'Holiday', startDate: session.date, endDate: session.date });

      const res = await parentAgent.post('/api/v1/registrations').send({
        studentId: student._id.toString(),
        scheduleId,
        startDate: session.date.toISOString(),
      });

      expect(res.status).toBe(400);
      expect(await Registration.countDocuments({ studentId: student._id })).toBe(0);
      expect(await Subscription.countDocuments({ studentId: student._id })).toBe(0);
    });

    it('GET /preview returns 400 when startDate falls on an academy holiday', async () => {
      const { scheduleId } = await seedSchedule();
      const { student } = await seedParentAndStudent('startdate-holiday-preview@example.com');
      const parentAgent = await loginAgent('startdate-holiday-preview@example.com');

      const session = await GroupClassSession.findOne({ scheduleId });
      await Holiday.create({ name: 'Holiday', startDate: session.date, endDate: session.date });

      const res = await parentAgent.get('/api/v1/registrations/preview').query({
        studentId: student._id.toString(),
        scheduleId,
        startDate: session.date.toISOString(),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when startDate is a real session date but in the past', async () => {
      const { scheduleId } = await seedSchedule();
      const { student } = await seedParentAndStudent('startdate-past@example.com');
      const parentAgent = await loginAgent('startdate-past@example.com');
      await savePaymentMethodFor(parentAgent);

      const session = await GroupClassSession.findOne({ scheduleId });
      await GroupClassSession.updateOne(
        { _id: session._id },
        { date: new Date('2020-01-01T00:00:00.000Z') }
      );

      const res = await parentAgent.post('/api/v1/registrations').send({
        studentId: student._id.toString(),
        scheduleId,
        startDate: '2020-01-01T00:00:00.000Z',
      });

      expect(res.status).toBe(400);
    });

    it('GET /preview anchors proration to a provided startDate the same way the real charge does', async () => {
      const { scheduleId, levelId } = await seedSchedule();
      const { student } = await seedParentAndStudent('startdate-preview@example.com');
      const parentAgent = await loginAgent('startdate-preview@example.com');

      const sessions = await GroupClassSession.find({ scheduleId }).sort({ date: 1 });
      const chosenSession = sessions[1];

      const expected = await computeProration({
        levelId,
        monthlyFee: MONTHLY_FEE,
        registrationDate: chosenSession.date,
      });

      const res = await parentAgent.get('/api/v1/registrations/preview').query({
        studentId: student._id.toString(),
        scheduleId,
        startDate: chosenSession.date.toISOString(),
      });

      expect(res.status).toBe(200);
      expect(res.body.prorated).toBe(true);
      expect(res.body.remainingClassDays).toBe(expected.remainingClassDays);
      expect(res.body.chargeAmount).toBe(expected.proratedAmount);
    });
  });

  describe('GET /api/v1/registrations/preview', () => {
    it('returns the undiscounted monthly fee for an only child, and creates/charges nothing', async () => {
      const { scheduleId, levelId } = await seedSchedule();
      const { student } = await seedParentAndStudent('reg-preview1@example.com');
      const parentAgent = await loginAgent('reg-preview1@example.com');

      const expected = await expectedProrationFor(levelId);

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
        // Proration is unconditional now (ADR 007) — this preview happens
        // to land on the 1st (FROZEN_NOW), so the prorated amount equals
        // the full monthly fee, but prorated/totalClassDays/
        // remainingClassDays/dailyRate are real computed values now, never
        // false/null.
        prorated: expected.prorated,
        totalClassDays: expected.totalClassDays,
        remainingClassDays: expected.remainingClassDays,
        dailyRate: expected.dailyRate,
        // Family Scorecard checkout quote panel (docs/plans/wordpress-ui-
        // alignment-plan.md, Phase 3) — an only child with no fee
        // configured has nothing to save on either front.
        savings: { siblingDiscount: 0, registrationFeeWaived: 0, total: 0 },
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

    it("previews the level's own registration fee override instead of the academy-wide default (docs/plans/per-level-registration-fee-plan.md)", async () => {
      await Setting.create({ registrationFee: 145, returningStudentGracePeriodMonths: 0 });

      const { scheduleId, levelId } = await seedSchedule();
      await Price.findOneAndUpdate({ levelId }, { registrationFee: 100 });

      const { student } = await seedParentAndStudent('reg-preview-level-override@example.com');
      const parentAgent = await loginAgent('reg-preview-level-override@example.com');

      const res = await parentAgent.get('/api/v1/registrations/preview').query({
        studentId: student._id.toString(),
        scheduleId,
      });

      expect(res.status).toBe(200);
      expect(res.body.registrationFeeCharged).toBe(100);
      expect(res.body.totalChargeAmount).toBe(MONTHLY_FEE + 100);
    });

    it('previews the academy-wide default when the level has no override configured', async () => {
      await Setting.create({ registrationFee: 145, returningStudentGracePeriodMonths: 0 });

      const { scheduleId } = await seedSchedule(); // no override set on this level's Price
      const { student } = await seedParentAndStudent('reg-preview-level-default@example.com');
      const parentAgent = await loginAgent('reg-preview-level-default@example.com');

      const res = await parentAgent.get('/api/v1/registrations/preview').query({
        studentId: student._id.toString(),
        scheduleId,
      });

      expect(res.status).toBe(200);
      expect(res.body.registrationFeeCharged).toBe(145);
      expect(res.body.totalChargeAmount).toBe(MONTHLY_FEE + 145);
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

        const cheaperSchedule = await GroupClassSchedule.findById(cheaperScheduleId);
        const cheaperGroupClass = await GroupClass.findById(cheaperSchedule.classId);
        const expected = await expectedProrationFor(cheaperGroupClass.levelId);

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
          prorated: expected.prorated,
          totalClassDays: expected.totalClassDays,
          remainingClassDays: expected.remainingClassDays,
          dailyRate: expected.dailyRate,
          // Family Scorecard checkout quote panel (docs/plans/wordpress-ui-
          // alignment-plan.md, Phase 3) — the sibling discount is the only
          // savings here (no registration fee configured in this test).
          savings: { siblingDiscount: MONTHLY_FEE * 0.1, registrationFeeWaived: 0, total: MONTHLY_FEE * 0.1 },
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

    it('exposes the waived registration fee\'s dollar value in savings.registrationFeeWaived, even though registrationFeeCharged is 0 (Family Scorecard checkout quote panel, docs/plans/wordpress-ui-alignment-plan.md Phase 3)', async () => {
      await Setting.create({ registrationFee: 25, returningStudentGracePeriodMonths: 6 });

      const { scheduleId } = await seedSchedule();
      const { student } = await seedParentAndStudent('reg-preview-fee-waived@example.com');
      const parentAgent = await loginAgent('reg-preview-fee-waived@example.com');

      // A prior enrollment that ended 2 months ago — well inside the
      // 6-month grace period (same seeding pattern as the end-to-end
      // "waives the fee" test in the 'one-time registration fee' describe
      // block above, just previewed instead of actually charged).
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

      const res = await parentAgent.get('/api/v1/registrations/preview').query({
        studentId: student._id.toString(),
        scheduleId,
      });

      expect(res.status).toBe(200);
      expect(res.body.registrationFeeCharged).toBe(0);
      expect(res.body.registrationFeeWaived).toBe(true);
      // The dollar value the fee WOULD have been — this is what
      // registrationFeeCharged alone can never expose, since it's 0
      // whenever the fee is waived.
      expect(res.body.savings).toEqual({ siblingDiscount: 0, registrationFeeWaived: 25, total: 25 });
    });

    it(
      'matches the real charge exactly for the BRIDGE sibling discount case too — preview and reality never disagree when the new child is the higher payer',
      async () => {
        const parent = await seedUser({ role: 'parent', email: 'reg-preview-bridge@example.com' });
        const firstChild = await User.create({
          role: 'student',
          firstName: 'First',
          lastName: 'PreviewBridge',
          parentId: parent._id,
        });
        const secondChild = await User.create({
          role: 'student',
          firstName: 'Second',
          lastName: 'PreviewBridge',
          parentId: parent._id,
        });

        const parentAgent = await loginAgent('reg-preview-bridge@example.com');
        await savePaymentMethodFor(parentAgent);

        const cheaperScheduleId = await seedScheduleWithFee(MONTHLY_FEE, {
          levelName: 'PreviewBridgeCheap',
          levelOrder: 22,
        });
        const pricierScheduleId = await seedScheduleWithFee(MONTHLY_FEE * 2, {
          levelName: 'PreviewBridgePricier',
          levelOrder: 23,
        });

        const firstRes = await parentAgent.post('/api/v1/registrations').send({
          studentId: firstChild._id.toString(),
          scheduleId: cheaperScheduleId,
        });
        expect(firstRes.status).toBe(201);

        // Preview the second (pricier) child — the bridge case.
        const previewRes = await parentAgent.get('/api/v1/registrations/preview').query({
          studentId: secondChild._id.toString(),
          scheduleId: pricierScheduleId,
        });

        expect(previewRes.status).toBe(200);
        expect(previewRes.body.siblingDiscountApplied).toBe(true);
        expect(previewRes.body.siblingDiscountAmount).toBe(MONTHLY_FEE * 0.1);
        expect(previewRes.body.siblingDiscountReason).toBe(
          "Your family's 10% sibling discount applies to this registration, based on your other child's lower-priced plan."
        );

        const secondRes = await parentAgent.post('/api/v1/registrations').send({
          studentId: secondChild._id.toString(),
          scheduleId: pricierScheduleId,
        });

        expect(secondRes.status).toBe(201);
        expect(secondRes.body.chargeAmount).toBe(previewRes.body.chargeAmount);
        expect(secondRes.body.siblingDiscountApplied).toBe(previewRes.body.siblingDiscountApplied);
        expect(secondRes.body.siblingDiscountAmount).toBe(previewRes.body.siblingDiscountAmount);
        expect(secondRes.body.siblingDiscountReason).toBe(previewRes.body.siblingDiscountReason);
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

    it(
      "lastPayment reflects what the ledger row actually charged (fee INCLUDED), never Subscription.lastChargeAmount " +
        '(deliberately fee-free) — docs/plans/payment-airtight-plan.md D11',
      async () => {
        await Setting.create({ registrationFee: 25, returningStudentGracePeriodMonths: 0 });

        // Every-weekday level (not seedSchedule()'s single Wednesday) —
        // this test isn't about proration math, so it shouldn't be exposed
        // to the small chance a single-weekday level prorates to $0 on a
        // given real calendar day (see seedScheduleEveryDayWithFee's own
        // comment).
        const { scheduleId } = await seedScheduleEveryDayWithFee(MONTHLY_FEE, {
          levelName: 'MineLastPayment',
          levelOrder: 38,
        });
        const { student } = await seedParentAndStudent('reg-mine-last-payment@example.com');
        const parentAgent = await loginAgent('reg-mine-last-payment@example.com');
        await savePaymentMethodFor(parentAgent);

        const regRes = await parentAgent.post('/api/v1/registrations').send({
          studentId: student._id.toString(),
          scheduleId,
        });
        expect(regRes.status).toBe(201);
        expect(regRes.body.paymentStatus).toBe('completed');
        // Never hardcode the raw MONTHLY_FEE here — the first month may be
        // prorated depending on which real calendar day this test happens
        // to run on (docs/plans/payment-airtight-plan.md D1); the actual
        // relationship under test is chargeAmount + fee === totalChargeAmount,
        // and that lastPayment/lastChargeAmount each reflect their own real
        // half of it, whatever the real prorated amount turns out to be.
        expect(regRes.body.totalChargeAmount).toBe(regRes.body.chargeAmount + 25);
        expect(regRes.body.registrationFeeCharged).toBe(25);

        const mineRes = await parentAgent.get('/api/v1/registrations/mine');
        expect(mineRes.status).toBe(200);

        const row = mineRes.body.subscriptions[0];
        // Subscription.lastChargeAmount stays fee-free by design.
        expect(row.lastChargeAmount).toBe(regRes.body.chargeAmount);
        // lastPayment, sourced from the ledger row, is the real total —
        // fee included.
        expect(row.lastPayment).toEqual(
          expect.objectContaining({ amount: regRes.body.totalChargeAmount, chargeMethod: 'card' })
        );
      },
      30000
    );
  });

  describe('GET /api/v1/registrations/history', () => {
    it('returns 401 unauthenticated and 403 for a role that is neither parent nor admin/superadmin', async () => {
      const unauthRes = await request(app).get('/api/v1/registrations/history');
      expect(unauthRes.status).toBe(401);

      await seedUser({ role: 'coach', email: 'reg-history-403@example.com' });
      const coachAgent = await loginAgent('reg-history-403@example.com');
      const coachRes = await coachAgent.get('/api/v1/registrations/history');
      expect(coachRes.status).toBe(403);
    });

    // Admin/superadmin viewing a family's history from /admin/subscriptions
    // (docs/plans/manual-charge-and-pdf-invoice-plan.md's 2026-08-31
    // addendum) — reuses listHistory() verbatim, so this is purely a
    // controller-level access-scoping test, not a re-test of listHistory's
    // own row-shaping logic (already covered by the parent-role tests below).
    it("lets an admin view a specific parent's history via ?parentId=, and a parent's own parentId query param is ignored (never lets a parent snoop another family's)", async () => {
      const { scheduleId } = await seedScheduleEveryDayWithFee(MONTHLY_FEE, {
        levelName: 'HistoryAdminView',
        levelOrder: 43,
      });
      const { parent, student } = await seedParentAndStudent('reg-history-admin-target@example.com');
      const parentAgent = await loginAgent('reg-history-admin-target@example.com');
      await savePaymentMethodFor(parentAgent);

      const res = await parentAgent.post('/api/v1/registrations').send({
        studentId: student._id.toString(),
        scheduleId,
      });
      expect(res.status).toBe(201);

      await seedUser({ role: 'admin', email: 'reg-history-admin-viewer@example.com' });
      const adminAgent = await loginAgent('reg-history-admin-viewer@example.com');

      const adminRes = await adminAgent
        .get('/api/v1/registrations/history')
        .query({ parentId: parent._id.toString() });
      expect(adminRes.status).toBe(200);
      expect(adminRes.body.history).toHaveLength(1);
      expect(adminRes.body.history[0].studentName).toBe(`${student.firstName} ${student.lastName}`);

      // Security guard: a parent sending ?parentId= (their own, or anyone
      // else's) still only ever gets their OWN history — the query param is
      // never honored for that role, so an attacker can't snoop by simply
      // appending a different id.
      const { parent: otherParent } = await seedParentAndStudent('reg-history-admin-other@example.com');
      const spoofRes = await parentAgent
        .get('/api/v1/registrations/history')
        .query({ parentId: otherParent._id.toString() });
      expect(spoofRes.status).toBe(200);
      expect(spoofRes.body.history).toHaveLength(1);
      expect(spoofRes.body.history[0].studentName).toBe(`${student.firstName} ${student.lastName}`);
    });

    it(
      "returns only the requesting parent's own rows, newest first, with a real class description and " +
        'invoiceAvailable reflecting status',
      async () => {
        const { scheduleId, levelId } = await seedScheduleEveryDayWithFee(MONTHLY_FEE, {
          levelName: 'HistoryOwnRows',
          levelOrder: 39,
        });
        const { student } = await seedParentAndStudent('reg-history-own@example.com');
        const parentAgent = await loginAgent('reg-history-own@example.com');
        await savePaymentMethodFor(parentAgent);

        // A second, unrelated parent's own registration must never appear —
        // its own distinct level (levels are globally uniquely named/
        // ordered), also every-weekday for the same real-Stripe-charge
        // reliability reason.
        const { scheduleId: otherScheduleId } = await seedScheduleEveryDayWithFee(MONTHLY_FEE, {
          levelName: 'HistoryOtherParent',
          levelOrder: 40,
        });
        const { student: otherStudent } = await seedParentAndStudent('reg-history-other@example.com');
        const otherAgent = await loginAgent('reg-history-other@example.com');
        await savePaymentMethodFor(otherAgent);
        const otherRes = await otherAgent.post('/api/v1/registrations').send({
          studentId: otherStudent._id.toString(),
          scheduleId: otherScheduleId,
        });
        expect(otherRes.status).toBe(201);

        const res = await parentAgent.post('/api/v1/registrations').send({
          studentId: student._id.toString(),
          scheduleId,
        });
        expect(res.status).toBe(201);
        expect(res.body.paymentStatus).toBe('completed');

        const historyRes = await parentAgent.get('/api/v1/registrations/history');
        expect(historyRes.status).toBe(200);
        expect(historyRes.body.history).toHaveLength(1);

        const row = historyRes.body.history[0];
        expect(row.billingShape).toBe('subscription_cycle');
        expect(row.status).toBe('completed');
        expect(row.amount).toBe(res.body.totalChargeAmount);
        expect(row.chargeMethod).toBe('card');
        expect(row.studentName).toBe(`${student.firstName} ${student.lastName}`);
        expect(row.description).toContain('Group Class Registration');
        expect(row.periodStart).toBeTruthy();
        expect(row.periodEnd).toBeTruthy();
        expect(row.invoiceAvailable).toBe(true);
        expect(row.breakdown.monthlyFee).toBe(MONTHLY_FEE);

        // Confirm the level really is this student's, proving the
        // description was resolved from real data, not invented.
        const level = await Level.findById(levelId);
        expect(row.description).toContain(level.name);
      },
      30000
    );

    it(
      'newest-first ordering across two registrations, and invoiceAvailable is false for a non-completed row',
      async () => {
        const { scheduleId: scheduleA } = await seedScheduleEveryDayWithFee(MONTHLY_FEE, {
          levelName: 'HistoryOrderA',
          levelOrder: 41,
        });
        const { scheduleId: scheduleB } = await seedScheduleEveryDayWithFee(MONTHLY_FEE, {
          levelName: 'HistoryOrderB',
          levelOrder: 42,
        });
        const { parent, student: studentA } = await seedParentAndStudent('reg-history-order@example.com');
        const parentAgent = await loginAgent('reg-history-order@example.com');
        await savePaymentMethodFor(parentAgent);

        const studentB = await User.create({
          role: 'student',
          firstName: 'Second',
          lastName: 'HistoryOrder',
          parentId: parent._id,
        });

        const firstRes = await parentAgent.post('/api/v1/registrations').send({
          studentId: studentA._id.toString(),
          scheduleId: scheduleA,
        });
        expect(firstRes.status).toBe(201);

        const secondRes = await parentAgent.post('/api/v1/registrations').send({
          studentId: studentB._id.toString(),
          scheduleId: scheduleB,
        });
        expect(secondRes.status).toBe(201);

        // Simulates a charge that never completed (a declined card, a
        // pending retry) — invoiceAvailable must reflect the REAL status,
        // never assume every row is downloadable.
        await Registration.findByIdAndUpdate(secondRes.body.registration._id, { status: 'failed' });

        const historyRes = await parentAgent.get('/api/v1/registrations/history');
        expect(historyRes.status).toBe(200);
        expect(historyRes.body.history).toHaveLength(2);
        // Newest first — the second registration's row comes before the first's.
        expect(historyRes.body.history[0]._id).toBe(secondRes.body.registration._id);
        expect(historyRes.body.history[1]._id).toBe(firstRes.body.registration._id);

        expect(historyRes.body.history[0].status).toBe('failed');
        expect(historyRes.body.history[0].invoiceAvailable).toBe(false);
        expect(historyRes.body.history[1].status).toBe('completed');
        expect(historyRes.body.history[1].invoiceAvailable).toBe(true);
      },
      30000
    );
  });

  // docs/plans/manual-charge-and-pdf-invoice-plan.md PR 2, §2.4.
  describe('GET /api/v1/registrations/:id/invoice', () => {
    async function seedCompletedRegistration(parentEmail) {
      const { scheduleId } = await seedSchedule();
      const { student } = await seedParentAndStudent(parentEmail);
      const parentAgent = await loginAgent(parentEmail);
      await savePaymentMethodFor(parentAgent);

      const res = await parentAgent.post('/api/v1/registrations').send({
        studentId: student._id.toString(),
        scheduleId,
      });
      expect(res.status).toBe(201);
      expect(res.body.paymentStatus).toBe('completed');

      return { registrationId: res.body.registration._id, parentAgent };
    }

    it(
      'lets the owning parent download the PDF, with the right headers and magic bytes',
      async () => {
        const { registrationId, parentAgent } = await seedCompletedRegistration('inv-owner1@example.com');

        const res = await parentAgent.get(`/api/v1/registrations/${registrationId}/invoice`);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('application/pdf');
        expect(res.headers['content-disposition']).toBe(`attachment; filename="INV-${registrationId}.pdf"`);
        expect(Buffer.isBuffer(res.body)).toBe(true);
        expect(res.body.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      },
      30000
    );

    it(
      'returns 403 for a different parent',
      async () => {
        const { registrationId } = await seedCompletedRegistration('inv-owner2@example.com');
        await seedUser({ role: 'parent', email: 'inv-other2@example.com' });
        const otherAgent = await loginAgent('inv-other2@example.com');

        const res = await otherAgent.get(`/api/v1/registrations/${registrationId}/invoice`);

        expect(res.status).toBe(403);
      },
      30000
    );

    it(
      "lets an admin download any parent's invoice",
      async () => {
        const { registrationId } = await seedCompletedRegistration('inv-owner3@example.com');
        await seedUser({ role: 'admin', email: 'inv-admin3@example.com' });
        const adminAgent = await loginAgent('inv-admin3@example.com');

        const res = await adminAgent.get(`/api/v1/registrations/${registrationId}/invoice`);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('application/pdf');
      },
      30000
    );

    it(
      'returns 403 for a coach',
      async () => {
        const { registrationId } = await seedCompletedRegistration('inv-owner4@example.com');
        await seedUser({ role: 'coach', email: 'inv-coach4@example.com' });
        const coachAgent = await loginAgent('inv-coach4@example.com');

        const res = await coachAgent.get(`/api/v1/registrations/${registrationId}/invoice`);

        expect(res.status).toBe(403);
      },
      30000
    );

    it('returns 404 for an unknown registration id', async () => {
      await seedUser({ role: 'admin', email: 'inv-admin404@example.com' });
      const adminAgent = await loginAgent('inv-admin404@example.com');

      const res = await adminAgent.get(`/api/v1/registrations/${new mongoose.Types.ObjectId()}/invoice`);

      expect(res.status).toBe(404);
    });

    it(
      'returns 409 for a pending (not yet completed) row',
      async () => {
        const groupClassesService = await Service.findOne({ code: 'group-classes' });
        const { student, parent } = await seedParentAndStudent('inv-pending5@example.com');
        const parentAgent = await loginAgent('inv-pending5@example.com');
        const { scheduleId } = await seedSchedule();

        const pendingRow = await Registration.SubscriptionCycleRegistration.create({
          serviceId: groupClassesService._id,
          subscriptionId: new mongoose.Types.ObjectId(),
          scheduleId,
          studentId: student._id,
          parentId: parent._id,
          eventType: 'initial',
          status: 'pending',
          amount: MONTHLY_FEE,
          breakdown: { monthlyFee: MONTHLY_FEE, registrationFeeCharged: 0 },
          periodStart: new Date(),
          periodEnd: new Date(),
        });

        const res = await parentAgent.get(`/api/v1/registrations/${pendingRow._id}/invoice`);

        expect(res.status).toBe(409);
      },
      30000
    );
  });
});
