// Real payment-provider TEST mode (never mocked), reached only through
// tests/testUtils/payments.js — same convention as
// renewal.service.test.js/registration.routes.test.js.
require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });

const User = require('../../../src/models/user.model');
const Level = require('../../../src/models/level.model');
const Location = require('../../../src/models/location.model');
const GroupClass = require('../../../src/models/groupClass.model');
const GroupClassSchedule = require('../../../src/models/groupClassSchedule.model');
const Price = require('../../../src/models/price.model');
const Subscription = require('../../../src/models/subscription.model');
const { SubscriptionCycleRegistration } = require('../../../src/models/registration.model');
const paymentMethodService = require('../../../src/services/paymentMethod.service');
const { ensureCustomer } = require('../../../src/services/paymentCustomer.service');
const { mintCardToken, declineAtChargeCardId, retrievePayment } = require('../../testUtils/payments');
const {
  chargeLedgerRow,
  finalizeSuccessfulCharge,
  finalizeFailedCharge,
  chargeAndFinalize,
  advanceSubscriptionPeriod,
} = require('../../../src/services/billing/chargeFinalization.service');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');
const { seedServices } = require('../../../scripts/lib/seedServices');
const Service = require('../../../src/models/service.model');

const MONTHLY_FEE = 150;

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

async function seedSubscriptionAndRow({ amount = MONTHLY_FEE, breakdownOverrides = {} } = {}) {
  const level = await Level.create({ name: 'ChargeFinalization', order: 1 });
  await Price.create({ levelId: level._id, monthlyFee: MONTHLY_FEE });
  const location = await Location.create({ name: 'HQ', address: '1 Main St' });
  const coach = await User.create({
    role: 'coach',
    firstName: 'Coach',
    lastName: 'Test',
    email: `coach-${Date.now()}-${Math.random()}@example.com`,
  });
  const groupClass = await GroupClass.create({
    name: 'Class',
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

  const parent = await User.create({ role: 'parent', firstName: 'Parent', lastName: 'Test', email: `parent-${Date.now()}-${Math.random()}@example.com` });
  const student = await User.create({ role: 'student', firstName: 'Kid', lastName: 'Test', parentId: parent._id });

  const currentPeriodStart = new Date('2026-10-01T00:00:00.000Z');
  const currentPeriodEnd = new Date('2026-11-01T00:00:00.000Z');

  const subscription = await Subscription.create({
    studentId: student._id,
    scheduleId: schedule._id,
    parentId: parent._id,
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodStart,
    currentPeriodEnd,
    nextBillingDate: currentPeriodEnd,
  });

  const groupClassesService = await Service.findOne({ code: 'group-classes' });

  const row = await SubscriptionCycleRegistration.create({
    serviceId: groupClassesService._id,
    subscriptionId: subscription._id,
    scheduleId: schedule._id,
    studentId: student._id,
    parentId: parent._id,
    eventType: 'initial',
    status: 'pending',
    amount,
    breakdown: {
      monthlyFee: MONTHLY_FEE,
      registrationFeeCharged: 0,
      siblingDiscountApplied: false,
      ...breakdownOverrides,
    },
    periodStart: currentPeriodStart,
    periodEnd: currentPeriodEnd,
  });

  return { subscription, row, parent, student };
}

// Resolves the provider customer, then saves a card for it. `parent` is
// deliberately left stale (never refreshed after ensureCustomer's own write):
// ensureCustomer reads the stored state, so the save resolves the SAME
// customer. Returns { paymentMethod, providerCustomerId } so callers never
// need a separate ensureCustomer() call of their own.
async function savePaymentMethodForParent(parent) {
  const providerCustomerId = await ensureCustomer(parent);

  const paymentMethod = await paymentMethodService.savePaymentMethod(
    { paymentMethodToken: await mintCardToken('success') },
    parent
  );

  return { paymentMethod, providerCustomerId };
}

describe('chargeFinalization.service', () => {
  describe('chargeLedgerRow', () => {
    it(
      'returns outcome:"succeeded" for a real test-mode charge, keyed on the row id',
      async () => {
        const { row, parent } = await seedSubscriptionAndRow();
        const { paymentMethod, providerCustomerId } = await savePaymentMethodForParent(parent);

        const result = await chargeLedgerRow({ row, paymentMethod, providerCustomerId });

        expect(result.outcome).toBe('succeeded');
        expect(typeof result.paymentId).toBe('string');

        const payment = await retrievePayment(result.paymentId);
        expect(payment.status).toBe('succeeded');
        expect(payment.amount).toBe(MONTHLY_FEE);
        expect(payment.reference).toBe(String(row._id));
      },
      20000
    );

    it(
      'returns outcome:"failed" with the provider decline message for a real test-mode decline, without throwing',
      async () => {
        const { row, parent } = await seedSubscriptionAndRow();
        const { paymentMethod, providerCustomerId } = await savePaymentMethodForParent(parent);
        paymentMethod.providerPaymentMethodId = declineAtChargeCardId();

        const result = await chargeLedgerRow({ row, paymentMethod, providerCustomerId });

        expect(result.outcome).toBe('failed');
        expect(typeof result.failureMessage).toBe('string');
      },
      20000
    );

    it('is safe to call twice for the same row — the second call replays the first via the shared idempotency key, never double-charging', async () => {
      const { row, parent } = await seedSubscriptionAndRow();
      const { paymentMethod, providerCustomerId } = await savePaymentMethodForParent(parent);

      const first = await chargeLedgerRow({ row, paymentMethod, providerCustomerId });
      const second = await chargeLedgerRow({ row, paymentMethod, providerCustomerId });

      expect(first.paymentId).toBe(second.paymentId);
    }, 20000);
  });

  describe('finalizeSuccessfulCharge', () => {
    it('marks the row completed and advances the subscription period', async () => {
      const { subscription, row } = await seedSubscriptionAndRow();

      const result = await finalizeSuccessfulCharge({
        row,
        subscription,
        provider: 'stripe',
        paymentId: 'pi_test_123',
        siblingDiscountApplied: true,
      });

      expect(result).toEqual({
        subscriptionId: subscription._id,
        outcome: 'charged',
        chargeAmount: MONTHLY_FEE,
        siblingDiscountApplied: true,
      });

      const updatedRow = await SubscriptionCycleRegistration.findById(row._id);
      expect(updatedRow.status).toBe('completed');
      expect(updatedRow.providerPaymentId).toBe('pi_test_123');
      expect(updatedRow.paidAt).toBeInstanceOf(Date);

      const updatedSub = await Subscription.findById(subscription._id);
      expect(updatedSub.currentPeriodStart.toISOString()).toBe(row.periodStart.toISOString());
      expect(updatedSub.currentPeriodEnd.toISOString()).toBe(row.periodEnd.toISOString());
      expect(updatedSub.lastChargeAmount).toBe(MONTHLY_FEE);
      expect(updatedSub.lastSiblingDiscountApplied).toBe(true);
      expect(updatedSub.retryCount).toBe(0);
    });
  });

  describe('finalizeFailedCharge', () => {
    it('marks the row failed and puts the subscription into dunning without touching the period', async () => {
      const { subscription, row } = await seedSubscriptionAndRow();

      const result = await finalizeFailedCharge({
        row,
        subscription,
        failureMessage: 'Your card was declined.',
        provider: 'stripe',
        paymentId: null,
        attemptNumber: 1,
      });

      expect(result.outcome).toBe('failed_payment');
      expect(result.attemptNumber).toBe(1);
      expect(result.nextRetryAt).toBeInstanceOf(Date);

      const updatedRow = await SubscriptionCycleRegistration.findById(row._id);
      expect(updatedRow.status).toBe('failed');
      expect(updatedRow.failureMessage).toBe('Your card was declined.');

      const updatedSub = await Subscription.findById(subscription._id);
      expect(updatedSub.retryCount).toBe(1);
      expect(updatedSub.nextRetryAt).toBeInstanceOf(Date);
      // The period is untouched — still whatever it was set to at creation,
      // not rolled forward, so this period stays "due" until a retry
      // succeeds or the subscription is cancelled after exhaustion.
      expect(updatedSub.currentPeriodEnd.toISOString()).toBe(subscription.currentPeriodEnd.toISOString());
    });
  });

  describe('chargeAndFinalize', () => {
    it('orchestrates a successful charge end-to-end', async () => {
      const { subscription, row, parent } = await seedSubscriptionAndRow();
      const { paymentMethod, providerCustomerId } = await savePaymentMethodForParent(parent);

      const result = await chargeAndFinalize({
        row,
        subscription,
        paymentMethod,
        providerCustomerId,
        siblingDiscountApplied: false,
      });

      expect(result.outcome).toBe('charged');

      const updatedRow = await SubscriptionCycleRegistration.findById(row._id);
      expect(updatedRow.status).toBe('completed');
    }, 20000);

    it('orchestrates a failed charge end-to-end, without throwing', async () => {
      const { subscription, row, parent } = await seedSubscriptionAndRow();
      const { paymentMethod, providerCustomerId } = await savePaymentMethodForParent(parent);
      paymentMethod.providerPaymentMethodId = declineAtChargeCardId();

      const result = await chargeAndFinalize({
        row,
        subscription,
        paymentMethod,
        providerCustomerId,
        siblingDiscountApplied: false,
      });

      expect(result.outcome).toBe('failed_payment');

      const updatedRow = await SubscriptionCycleRegistration.findById(row._id);
      expect(updatedRow.status).toBe('failed');

      const updatedSub = await Subscription.findById(subscription._id);
      expect(updatedSub.retryCount).toBe(1);
    }, 20000);
  });

  describe('advanceSubscriptionPeriod', () => {
    it('is a $set, not an increment — safe to call on a subscription whose period fields were already set at creation (the initial-registration case)', async () => {
      const { subscription } = await seedSubscriptionAndRow();

      await advanceSubscriptionPeriod(
        subscription._id,
        subscription.currentPeriodStart,
        subscription.currentPeriodEnd,
        MONTHLY_FEE,
        false
      );

      const updated = await Subscription.findById(subscription._id);
      expect(updated.currentPeriodStart.toISOString()).toBe(subscription.currentPeriodStart.toISOString());
      expect(updated.currentPeriodEnd.toISOString()).toBe(subscription.currentPeriodEnd.toISOString());
      expect(updated.lastChargeAmount).toBe(MONTHLY_FEE);
    });
  });
});
