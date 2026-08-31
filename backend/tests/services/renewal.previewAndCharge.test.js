// STRIPE_SECRET_KEY must be loaded from the real .env BEFORE any module that
// requires src/config/stripe.js (paymentMethod.service.js, renewal.service.js)
// — same pattern as renewal.service.test.js.
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

// Mocked so this suite never touches nodemailer/Ethereal.
jest.mock('../../src/services/mail.service');

const User = require('../../src/models/user.model');
const Level = require('../../src/models/level.model');
const Location = require('../../src/models/location.model');
const GroupClass = require('../../src/models/groupClass.model');
const GroupClassSchedule = require('../../src/models/groupClassSchedule.model');
const Price = require('../../src/models/price.model');
const Subscription = require('../../src/models/subscription.model');
const PaymentMethod = require('../../src/models/paymentMethod.model');
const { SubscriptionCycleRegistration } = require('../../src/models/registration.model');
const stripe = require('../../src/config/stripe');
const paymentMethodService = require('../../src/services/paymentMethod.service');
const {
  previewRenewal,
  chargeNow,
  chargeProratedNow,
  recordManualPayment,
  renewOne,
  retryOne,
} = require('../../src/services/renewal.service');
const { computeProration } = require('../../src/services/billing/proration.service');
const { addOneMonth, todayAtMidnight, todayDateOnly } = require('../../src/utils/billingDates');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');
const { seedServices } = require('../../scripts/lib/seedServices');

const MONTHLY_FEE = 150;
const FAR_FUTURE_DATE = new Date('2099-01-01T00:00:00.000Z');

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

beforeEach(async () => {
  await seedServices();
});

afterEach(async () => {
  await clearTestDB();
});

async function seedLevelWithPriceAndSchedule(monthlyFee, { name = 'Level', order = 1 } = {}) {
  const level = await Level.create({ name, order });
  await Price.create({ levelId: level._id, monthlyFee });

  const location = await Location.create({ name: `${name} HQ`, address: '1 Main St' });
  const coach = await User.create({
    role: 'coach',
    firstName: 'Coach',
    lastName: name,
    email: `coach-${name}-${Date.now()}-${Math.random()}@example.com`,
  });
  const groupClass = await GroupClass.create({
    name: `${name} Class`,
    levelId: level._id,
    locationId: location._id,
    capacity: 10,
  });
  const schedule = await GroupClassSchedule.create({
    classId: groupClass._id,
    coachId: coach._id,
    dayOfWeek: 2,
    startTime: '16:00',
    endTime: '17:00',
    students: [],
  });

  return { level, schedule };
}

// A level with a class day on EVERY weekday — used only by tests that need
// a REAL, successful "prorated from today" Stripe charge regardless of
// which real calendar day the suite happens to run on. A single-weekday
// level (seedLevelWithPriceAndSchedule above) can legitimately prorate to
// $0 when "today" falls after that weekday's last occurrence in the
// current month — real, correct behavior, but below Stripe's minimum
// chargeable amount, which would fail these tests on some days and not
// others (the same pre-existing "today"-anchored flakiness class already
// documented elsewhere in this suite). Every day being a class day makes
// remainingClassDays >= 1 unconditionally (today itself always counts),
// so the prorated slice is always chargeable.
async function seedLevelWithPriceAndScheduleEveryDay(monthlyFee, { name = 'Level', order = 1 } = {}) {
  const level = await Level.create({ name, order });
  await Price.create({ levelId: level._id, monthlyFee });

  const location = await Location.create({ name: `${name} HQ`, address: '1 Main St' });
  const coach = await User.create({
    role: 'coach',
    firstName: 'Coach',
    lastName: name,
    email: `coach-${name}-${Date.now()}-${Math.random()}@example.com`,
  });
  const groupClass = await GroupClass.create({
    name: `${name} Class`,
    levelId: level._id,
    locationId: location._id,
    capacity: 10,
  });

  let schedule;

  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek += 1) {
    // eslint-disable-next-line no-await-in-loop -- test setup, negligible fan-out
    const created = await GroupClassSchedule.create({
      classId: groupClass._id,
      coachId: coach._id,
      dayOfWeek,
      startTime: '16:00',
      endTime: '17:00',
      students: [],
    });

    if (dayOfWeek === 2) schedule = created; // the subscription's own "home" schedule
  }

  return { level, schedule };
}

async function seedParentAndStudent(email) {
  const parent = await User.create({
    role: 'parent',
    firstName: 'Parent',
    lastName: 'Test',
    email,
  });
  const student = await User.create({
    role: 'student',
    firstName: 'Kid',
    lastName: 'Test',
    parentId: parent._id,
  });

  return { parent, student };
}

async function savePaymentMethodForParent(parent) {
  const paymentMethod = await stripe.paymentMethods.create({
    type: 'card',
    card: { token: 'tok_visa' },
  });

  return paymentMethodService.savePaymentMethod(
    { stripePaymentMethodId: paymentMethod.id },
    parent
  );
}

function buildActiveSubscription({
  studentId,
  scheduleId,
  parentId,
  currentPeriodStart,
  currentPeriodEnd,
  nextBillingDate,
  cancelAtPeriodEnd = false,
}) {
  return Subscription.create({
    studentId,
    scheduleId,
    parentId,
    status: 'active',
    cancelAtPeriodEnd,
    currentPeriodStart,
    currentPeriodEnd,
    nextBillingDate,
  });
}

describe('previewRenewal', () => {
  it(
    "matches what renewOne then ACTUALLY charges for the same due, non-discounted subscription — the standing preview property (docs/decisions/001-in-house-subscription-billing.md's 2026-08-23 addendum)",
    async () => {
      const { schedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
        name: 'PreviewMatchesCharge',
        order: 1,
      });
      const { parent, student } = await seedParentAndStudent('preview-matches-charge@example.com');
      await savePaymentMethodForParent(parent);

      const currentPeriodStart = new Date('2020-01-01T00:00:00.000Z');
      const currentPeriodEnd = new Date('2020-02-01T00:00:00.000Z');

      const subscription = await buildActiveSubscription({
        studentId: student._id,
        scheduleId: schedule._id,
        parentId: parent._id,
        currentPeriodStart,
        currentPeriodEnd,
        nextBillingDate: currentPeriodEnd,
      });

      const preview = await previewRenewal(subscription._id);

      expect(preview.outcome).toBe('previewable');
      expect(preview.due).toBe(true);
      expect(preview.willFinalizeCancellation).toBe(false);
      expect(preview.inDunning).toBe(false);
      expect(preview.amount).toBe(MONTHLY_FEE);
      expect(preview.breakdown).toEqual({
        monthlyFee: MONTHLY_FEE,
        siblingDiscountApplied: false,
        siblingDiscountAmount: 0,
      });
      expect(preview.paymentMethod).toEqual(
        expect.objectContaining({ cardBrand: 'visa', cardLast4: expect.any(String) })
      );
      expect(preview.periodStart.toISOString()).toBe(currentPeriodEnd.toISOString());
      expect(preview.periodEnd.toISOString()).toBe(addOneMonth(currentPeriodEnd).toISOString());

      const result = await renewOne(subscription._id);

      expect(result.outcome).toBe('charged');
      expect(result.chargeAmount).toBe(preview.amount);
      expect(result.siblingDiscountApplied).toBe(preview.breakdown.siblingDiscountApplied);
    },
    30000
  );

  it(
    'matches the ACTUAL sibling-discounted charge amount too, not just the no-discount case',
    async () => {
      const { schedule: pricierSchedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE * 2, {
        name: 'PreviewSiblingPricier',
        order: 2,
      });
      const { schedule: cheaperSchedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
        name: 'PreviewSiblingCheap',
        order: 3,
      });

      const { parent } = await seedParentAndStudent('preview-sibling-cheap@example.com');
      const cheaperStudent = await User.create({
        role: 'student',
        firstName: 'Cheaper',
        lastName: 'Preview',
        parentId: parent._id,
      });
      const pricierStudent = await User.create({
        role: 'student',
        firstName: 'Pricier',
        lastName: 'Preview',
        parentId: parent._id,
      });
      await savePaymentMethodForParent(parent);

      const currentPeriodEnd = new Date('2020-02-01T00:00:00.000Z');

      await buildActiveSubscription({
        studentId: pricierStudent._id,
        scheduleId: pricierSchedule._id,
        parentId: parent._id,
        currentPeriodStart: new Date('2020-01-01T00:00:00.000Z'),
        currentPeriodEnd,
        nextBillingDate: currentPeriodEnd,
      });

      const cheaperSubscription = await buildActiveSubscription({
        studentId: cheaperStudent._id,
        scheduleId: cheaperSchedule._id,
        parentId: parent._id,
        currentPeriodStart: new Date('2020-01-01T00:00:00.000Z'),
        currentPeriodEnd,
        nextBillingDate: currentPeriodEnd,
      });

      const preview = await previewRenewal(cheaperSubscription._id);

      expect(preview.amount).toBe(MONTHLY_FEE * 0.9);
      expect(preview.breakdown.siblingDiscountApplied).toBe(true);
      expect(preview.breakdown.siblingDiscountAmount).toBe(MONTHLY_FEE * 0.1);

      const result = await renewOne(cheaperSubscription._id);

      expect(result.chargeAmount).toBe(preview.amount);
    },
    30000
  );

  it(
    'dunning: returns the LOCKED failed-row amount, not a live recalculation, and flags inDunning/retryCount/attemptsRemaining',
    async () => {
      const { level, schedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
        name: 'PreviewDunning',
        order: 4,
      });
      const { parent, student } = await seedParentAndStudent('preview-dunning@example.com');
      await savePaymentMethodForParent(parent);

      const Service = require('../../src/models/service.model');
      const groupClassesService = await Service.findOne({ code: 'group-classes' });

      const currentPeriodStart = new Date('2020-01-01T00:00:00.000Z');
      const currentPeriodEnd = new Date('2020-02-01T00:00:00.000Z');

      const subscription = await buildActiveSubscription({
        studentId: student._id,
        scheduleId: schedule._id,
        parentId: parent._id,
        currentPeriodStart,
        currentPeriodEnd,
        nextBillingDate: currentPeriodEnd,
      });

      await Subscription.findByIdAndUpdate(subscription._id, {
        retryCount: 1,
        nextRetryAt: new Date('2020-01-02T00:00:00.000Z'),
      });

      await SubscriptionCycleRegistration.create({
        serviceId: groupClassesService._id,
        subscriptionId: subscription._id,
        scheduleId: schedule._id,
        studentId: student._id,
        parentId: parent._id,
        eventType: 'renewal',
        status: 'failed',
        amount: MONTHLY_FEE,
        breakdown: { monthlyFee: MONTHLY_FEE, registrationFeeCharged: 0, siblingDiscountApplied: false, siblingDiscountAmount: 0 },
        periodStart: currentPeriodEnd,
        periodEnd: addOneMonth(currentPeriodEnd),
        failureMessage: 'a prior attempt failed',
      });

      // The level's live price changes AFTER the failure — the preview must
      // still show the LOCKED amount, never the new live price.
      await Price.findOneAndUpdate({ levelId: level._id }, { monthlyFee: MONTHLY_FEE + 50 });

      const preview = await previewRenewal(subscription._id);

      expect(preview.inDunning).toBe(true);
      expect(preview.retryCount).toBe(1);
      expect(preview.attemptsRemaining).toBe(2);
      expect(preview.amount).toBe(MONTHLY_FEE); // NOT MONTHLY_FEE + 50

      const result = await retryOne(subscription._id);

      expect(result.chargeAmount).toBe(preview.amount);
    },
    30000
  );

  it(
    'no card on file: paymentMethod is null',
    async () => {
      const { schedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
        name: 'PreviewNoCard',
        order: 5,
      });
      const { parent, student } = await seedParentAndStudent('preview-no-card@example.com');
      // Deliberately no savePaymentMethodForParent call.

      const currentPeriodStart = new Date('2020-01-01T00:00:00.000Z');
      const currentPeriodEnd = new Date('2020-02-01T00:00:00.000Z');

      const subscription = await buildActiveSubscription({
        studentId: student._id,
        scheduleId: schedule._id,
        parentId: parent._id,
        currentPeriodStart,
        currentPeriodEnd,
        nextBillingDate: currentPeriodEnd,
      });

      const preview = await previewRenewal(subscription._id);

      expect(preview.paymentMethod).toBeNull();
      // Still previewable — the amount is real; the frontend decides what
      // to do with a null paymentMethod (disable the confirm button).
      expect(preview.outcome).toBe('previewable');
      expect(preview.amount).toBe(MONTHLY_FEE);
    },
    30000
  );

  it(
    'card ON file: returns cardBrand/cardLast4',
    async () => {
      const { schedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
        name: 'PreviewCardOnFile',
        order: 6,
      });
      const { parent, student } = await seedParentAndStudent('preview-card-on-file@example.com');
      await savePaymentMethodForParent(parent);

      const currentPeriodEnd = new Date('2020-02-01T00:00:00.000Z');

      const subscription = await buildActiveSubscription({
        studentId: student._id,
        scheduleId: schedule._id,
        parentId: parent._id,
        currentPeriodStart: new Date('2020-01-01T00:00:00.000Z'),
        currentPeriodEnd,
        nextBillingDate: currentPeriodEnd,
      });

      const paymentMethodDoc = await PaymentMethod.findOne({ parentId: parent._id });
      const preview = await previewRenewal(subscription._id);

      expect(preview.paymentMethod).toEqual({
        cardBrand: paymentMethodDoc.cardBrand,
        cardLast4: paymentMethodDoc.cardLast4,
      });
    },
    30000
  );

  it(
    'due, pending-cancel subscription: willFinalizeCancellation true, no amount computed',
    async () => {
      const { schedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
        name: 'PreviewFinalize',
        order: 7,
      });
      const { parent, student } = await seedParentAndStudent('preview-finalize@example.com');

      const currentPeriodEnd = new Date('2020-02-01T00:00:00.000Z');

      const subscription = await buildActiveSubscription({
        studentId: student._id,
        scheduleId: schedule._id,
        parentId: parent._id,
        currentPeriodStart: new Date('2020-01-01T00:00:00.000Z'),
        currentPeriodEnd,
        nextBillingDate: currentPeriodEnd,
        cancelAtPeriodEnd: true,
      });

      const preview = await previewRenewal(subscription._id);

      expect(preview.due).toBe(true);
      expect(preview.willFinalizeCancellation).toBe(true);
      expect(preview.amount).toBeUndefined();
    },
    30000
  );

  it(
    'not-due, pending-cancel subscription: willFinalizeCancellation false (nothing to finalize yet)',
    async () => {
      const { schedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
        name: 'PreviewNotDueCancel',
        order: 8,
      });
      const { parent, student } = await seedParentAndStudent('preview-not-due-cancel@example.com');

      const subscription = await buildActiveSubscription({
        studentId: student._id,
        scheduleId: schedule._id,
        parentId: parent._id,
        currentPeriodStart: new Date('2020-01-01T00:00:00.000Z'),
        currentPeriodEnd: FAR_FUTURE_DATE,
        nextBillingDate: FAR_FUTURE_DATE,
        cancelAtPeriodEnd: true,
      });

      const preview = await previewRenewal(subscription._id);

      expect(preview.due).toBe(false);
      expect(preview.willFinalizeCancellation).toBe(false);
    },
    30000
  );

  it('returns not_found / inactive for a missing or cancelled subscription', async () => {
    const mongoose = require('mongoose');

    const missing = await previewRenewal(new mongoose.Types.ObjectId());
    expect(missing).toEqual({ outcome: 'not_found' });

    const { schedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
      name: 'PreviewInactive',
      order: 9,
    });
    const { parent, student } = await seedParentAndStudent('preview-inactive@example.com');
    const subscription = await buildActiveSubscription({
      studentId: student._id,
      scheduleId: schedule._id,
      parentId: parent._id,
      currentPeriodStart: new Date('2020-01-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2020-02-01T00:00:00.000Z'),
      nextBillingDate: new Date('2020-02-01T00:00:00.000Z'),
    });
    subscription.status = 'cancelled';
    await subscription.save();

    const inactive = await previewRenewal(subscription._id);
    expect(inactive.outcome).toBe('inactive');
  });
});

describe('chargeNow', () => {
  it(
    'routes to renewOne when retryCount is 0 (a fresh renewal, not in dunning)',
    async () => {
      const { schedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
        name: 'ChargeNowRenewal',
        order: 10,
      });
      const { parent, student } = await seedParentAndStudent('chargenow-renewal@example.com');
      await savePaymentMethodForParent(parent);

      const currentPeriodEnd = new Date('2020-02-01T00:00:00.000Z');
      const subscription = await buildActiveSubscription({
        studentId: student._id,
        scheduleId: schedule._id,
        parentId: parent._id,
        currentPeriodStart: new Date('2020-01-01T00:00:00.000Z'),
        currentPeriodEnd,
        nextBillingDate: currentPeriodEnd,
      });

      const result = await chargeNow(subscription._id);

      expect(result.outcome).toBe('charged');
      expect(result.chargeAmount).toBe(MONTHLY_FEE);

      // renewOne's own path creates exactly one ledger row at attempt 1.
      const rows = await SubscriptionCycleRegistration.find({ subscriptionId: subscription._id });
      expect(rows).toHaveLength(1);
      expect(rows[0].attempt).toBe(1);
    },
    30000
  );

  it(
    'routes to retryOne when retryCount > 0 (in dunning) — charges the LOCKED failed-row amount, flips the SAME row to attempt 2',
    async () => {
      const { schedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
        name: 'ChargeNowRetry',
        order: 11,
      });
      const { parent, student } = await seedParentAndStudent('chargenow-retry@example.com');
      await savePaymentMethodForParent(parent);

      const Service = require('../../src/models/service.model');
      const groupClassesService = await Service.findOne({ code: 'group-classes' });

      const currentPeriodEnd = new Date('2020-02-01T00:00:00.000Z');
      const subscription = await buildActiveSubscription({
        studentId: student._id,
        scheduleId: schedule._id,
        parentId: parent._id,
        currentPeriodStart: new Date('2020-01-01T00:00:00.000Z'),
        currentPeriodEnd,
        nextBillingDate: currentPeriodEnd,
      });

      await Subscription.findByIdAndUpdate(subscription._id, {
        retryCount: 1,
        nextRetryAt: new Date('2020-01-02T00:00:00.000Z'),
      });

      const failedRow = await SubscriptionCycleRegistration.create({
        serviceId: groupClassesService._id,
        subscriptionId: subscription._id,
        scheduleId: schedule._id,
        studentId: student._id,
        parentId: parent._id,
        eventType: 'renewal',
        status: 'failed',
        amount: MONTHLY_FEE,
        breakdown: { monthlyFee: MONTHLY_FEE, registrationFeeCharged: 0 },
        periodStart: currentPeriodEnd,
        periodEnd: addOneMonth(currentPeriodEnd),
        failureMessage: 'a prior attempt failed',
        attempt: 1,
      });

      const result = await chargeNow(subscription._id);

      expect(result.outcome).toBe('charged');
      expect(result.chargeAmount).toBe(MONTHLY_FEE);

      const updatedRow = await SubscriptionCycleRegistration.findById(failedRow._id);
      expect(updatedRow.status).toBe('completed');
      expect(updatedRow.attempt).toBe(2);

      // Same row updated, no second row created.
      const rows = await SubscriptionCycleRegistration.find({ subscriptionId: subscription._id });
      expect(rows).toHaveLength(1);
    },
    30000
  );

  it('returns not_found for a missing subscription', async () => {
    const mongoose = require('mongoose');
    const result = await chargeNow(new mongoose.Types.ObjectId());
    expect(result.outcome).toBe('not_found');
  });
});

async function seedAdmin(email) {
  return User.create({ role: 'superadmin', firstName: 'Super', lastName: 'Admin', email });
}

describe(
  'previewRenewal — options.fullMonth / options.prorated / monthAlreadyPaid (docs/plans/payment-airtight-plan.md D4/D8)',
  () => {
    it(
      'options.fullMonth mirrors the top-level amount/breakdown/period exactly, and options.prorated matches ' +
        'a direct computeProration() call anchored at today',
      async () => {
        const { level, schedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
          name: 'PreviewOptions',
          order: 20,
        });
        const { parent, student } = await seedParentAndStudent('preview-options@example.com');
        await savePaymentMethodForParent(parent);

        const currentPeriodEnd = new Date('2020-02-01T00:00:00.000Z');
        const subscription = await buildActiveSubscription({
          studentId: student._id,
          scheduleId: schedule._id,
          parentId: parent._id,
          currentPeriodStart: new Date('2020-01-01T00:00:00.000Z'),
          currentPeriodEnd,
          nextBillingDate: currentPeriodEnd,
        });

        const preview = await previewRenewal(subscription._id);

        expect(preview.options.fullMonth.amount).toBe(preview.amount);
        expect(preview.options.fullMonth.breakdown).toEqual(preview.breakdown);
        expect(preview.options.fullMonth.periodStart.toISOString()).toBe(preview.periodStart.toISOString());
        expect(preview.options.fullMonth.periodEnd.toISOString()).toBe(preview.periodEnd.toISOString());

        // Same function real code calls (D4), used here only to compute what
        // previewRenewal SHOULD report for "right now" — not a
        // reimplementation of the math, so this stays deterministic
        // regardless of what day of the month it actually runs on.
        const today = todayDateOnly();
        const expectedProration = await computeProration({
          levelId: level._id,
          monthlyFee: MONTHLY_FEE,
          registrationDate: today,
        });

        expect(preview.options.prorated).not.toBeNull();
        expect(preview.options.prorated.amount).toBe(expectedProration.proratedAmount);
        expect(preview.options.prorated.breakdown.prorated).toBe(expectedProration.prorated);
        expect(preview.options.prorated.breakdown.proratedAmount).toBe(expectedProration.proratedAmount);
        expect(preview.options.prorated.periodStart.toISOString()).toBe(today.toISOString());
        expect(preview.options.prorated.periodEnd.toISOString()).toBe(expectedProration.periodEnd.toISOString());

        expect(preview.monthAlreadyPaid).toBeNull();
      },
      30000
    );

    it('monthAlreadyPaid reflects a completed row for the CURRENT month, however it was created', async () => {
      const { schedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
        name: 'PreviewMonthAlreadyPaid',
        order: 21,
      });
      const { parent, student } = await seedParentAndStudent('preview-month-already-paid@example.com');
      await savePaymentMethodForParent(parent);
      const adminUser = await seedAdmin('preview-month-already-paid-admin@example.com');

      // Deliberately not-due (FAR_FUTURE_DATE) — proves monthAlreadyPaid is
      // sourced from the LEDGER, not inferred from `due`.
      const subscription = await buildActiveSubscription({
        studentId: student._id,
        scheduleId: schedule._id,
        parentId: parent._id,
        currentPeriodStart: new Date('2020-01-01T00:00:00.000Z'),
        currentPeriodEnd: FAR_FUTURE_DATE,
        nextBillingDate: FAR_FUTURE_DATE,
      });

      const manualResult = await recordManualPayment(
        subscription._id,
        { amount: 42, note: 'Partial catch-up', period: 'prorated' },
        adminUser
      );
      expect(manualResult.outcome).toBe('charged');

      const preview = await previewRenewal(subscription._id);

      expect(preview.monthAlreadyPaid).toEqual(
        expect.objectContaining({ amount: 42, chargeMethod: 'manual' })
      );
    });
  }
);

describe('chargeProratedNow (docs/plans/payment-airtight-plan.md D4)', () => {
  it(
    'charges the real prorated-from-today amount, rolls the subscription period to today -> next month, and records recordedBy',
    async () => {
      const { level, schedule } = await seedLevelWithPriceAndScheduleEveryDay(MONTHLY_FEE, {
        name: 'ChargeProratedNow',
        order: 22,
      });
      const { parent, student } = await seedParentAndStudent('charge-prorated-now@example.com');
      await savePaymentMethodForParent(parent);
      const adminUser = await seedAdmin('charge-prorated-now-admin@example.com');

      // Deliberately not-due — chargeProratedNow is an off-cycle tool that
      // never gates on nextBillingDate (D4).
      const subscription = await buildActiveSubscription({
        studentId: student._id,
        scheduleId: schedule._id,
        parentId: parent._id,
        currentPeriodStart: new Date('2020-01-01T00:00:00.000Z'),
        currentPeriodEnd: FAR_FUTURE_DATE,
        nextBillingDate: FAR_FUTURE_DATE,
      });

      const today = todayDateOnly();
      const expected = await computeProration({ levelId: level._id, monthlyFee: MONTHLY_FEE, registrationDate: today });

      const result = await chargeProratedNow(subscription._id, adminUser);

      expect(result.outcome).toBe('charged');
      expect(result.chargeAmount).toBe(expected.proratedAmount);

      const updated = await Subscription.findById(subscription._id);
      expect(updated.currentPeriodStart.toISOString()).toBe(today.toISOString());
      expect(updated.currentPeriodEnd.toISOString()).toBe(expected.periodEnd.toISOString());
      expect(updated.nextBillingDate.toISOString()).toBe(expected.periodEnd.toISOString());

      const row = await SubscriptionCycleRegistration.findOne({ subscriptionId: subscription._id });
      expect(row.status).toBe('completed');
      expect(row.chargeMethod).toBe('card');
      expect(row.recordedBy.toString()).toBe(adminUser._id.toString());
      expect(row.breakdown.prorated).toBe(true);
    },
    30000
  );

  it('returns skipped_inactive for a cancelled subscription', async () => {
    const { schedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
      name: 'ChargeProratedInactive',
      order: 23,
    });
    const { parent, student } = await seedParentAndStudent('charge-prorated-inactive@example.com');
    const adminUser = await seedAdmin('charge-prorated-inactive-admin@example.com');

    const subscription = await buildActiveSubscription({
      studentId: student._id,
      scheduleId: schedule._id,
      parentId: parent._id,
      currentPeriodStart: new Date('2020-01-01T00:00:00.000Z'),
      currentPeriodEnd: FAR_FUTURE_DATE,
      nextBillingDate: FAR_FUTURE_DATE,
    });
    subscription.status = 'cancelled';
    await subscription.save();

    const result = await chargeProratedNow(subscription._id, adminUser);
    expect(result.outcome).toBe('skipped_inactive');
  });
});

// The core proof of docs/plans/payment-airtight-plan.md's whole premise:
// one payment per subscription per calendar month, enforced by Guard B's
// (subscriptionId, periodMonth) index, REGARDLESS of which pathway wrote
// the first row or which day within the month either row anchors to.
describe('Guard B across pathways — one payment per subscription per calendar month (D7)', () => {
  it('a card "prorated from today" charge blocks a SECOND one for the same month', async () => {
    const { schedule } = await seedLevelWithPriceAndScheduleEveryDay(MONTHLY_FEE, {
      name: 'GuardBCardTwice',
      order: 24,
    });
    const { parent, student } = await seedParentAndStudent('guardb-card-twice@example.com');
    await savePaymentMethodForParent(parent);
    const adminUser = await seedAdmin('guardb-card-twice-admin@example.com');

    const subscription = await buildActiveSubscription({
      studentId: student._id,
      scheduleId: schedule._id,
      parentId: parent._id,
      currentPeriodStart: new Date('2020-01-01T00:00:00.000Z'),
      currentPeriodEnd: FAR_FUTURE_DATE,
      nextBillingDate: FAR_FUTURE_DATE,
    });

    const first = await chargeProratedNow(subscription._id, adminUser);
    expect(first.outcome).toBe('charged');

    const second = await chargeProratedNow(subscription._id, adminUser);
    expect(second.outcome).toBe('skipped_already_charged');

    const rows = await SubscriptionCycleRegistration.find({ subscriptionId: subscription._id });
    expect(rows).toHaveLength(1);
  });

  it(
    'a MANUAL "prorated" payment blocks a SUBSEQUENT card "prorated from today" charge for the same month — ' +
      'the exact cross-pathway gap the OLD exact-periodStart index would have missed',
    async () => {
      const { schedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
        name: 'GuardBManualThenCard',
        order: 25,
      });
      const { parent, student } = await seedParentAndStudent('guardb-manual-then-card@example.com');
      await savePaymentMethodForParent(parent);
      const adminUser = await seedAdmin('guardb-manual-then-card-admin@example.com');

      const subscription = await buildActiveSubscription({
        studentId: student._id,
        scheduleId: schedule._id,
        parentId: parent._id,
        currentPeriodStart: new Date('2020-01-01T00:00:00.000Z'),
        currentPeriodEnd: FAR_FUTURE_DATE,
        nextBillingDate: FAR_FUTURE_DATE,
      });

      const manualResult = await recordManualPayment(
        subscription._id,
        { amount: 50, note: 'Partial catch-up', period: 'prorated' },
        adminUser
      );
      expect(manualResult.outcome).toBe('charged');

      const cardResult = await chargeProratedNow(subscription._id, adminUser);
      expect(cardResult.outcome).toBe('skipped_already_charged');

      const rows = await SubscriptionCycleRegistration.find({ subscriptionId: subscription._id });
      expect(rows).toHaveLength(1);
      expect(rows[0].chargeMethod).toBe('manual');
    }
  );

  it(
    'a "full month" renewal (currentPeriodEnd-anchored) and a "prorated from today" charge for the SAME calendar ' +
      "month collide too, even though their periodStart values are different DAYS — the OLD index's exact blind spot",
    async () => {
      const { schedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
        name: 'GuardBFullThenProrated',
        order: 26,
      });
      const { parent, student } = await seedParentAndStudent('guardb-full-then-prorated@example.com');
      await savePaymentMethodForParent(parent);
      const adminUser = await seedAdmin('guardb-full-then-prorated-admin@example.com');

      // currentPeriodEnd anchored to TODAY's own calendar month (the 1st),
      // so a real renewOne() "full month" charge and chargeProratedNow's
      // "today" anchor land in the SAME periodMonth bucket but on
      // DIFFERENT days (the 1st vs. today).
      const today = todayDateOnly();
      const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

      const subscription = await buildActiveSubscription({
        studentId: student._id,
        scheduleId: schedule._id,
        parentId: parent._id,
        currentPeriodStart: new Date('2020-01-01T00:00:00.000Z'),
        currentPeriodEnd: monthStart,
        nextBillingDate: monthStart,
      });

      const fullResult = await renewOne(subscription._id);
      expect(fullResult.outcome).toBe('charged');

      const proratedResult = await chargeProratedNow(subscription._id, adminUser);
      expect(proratedResult.outcome).toBe('skipped_already_charged');

      const rows = await SubscriptionCycleRegistration.find({ subscriptionId: subscription._id });
      expect(rows).toHaveLength(1);
    },
    30000
  );
});
