// STRIPE_SECRET_KEY must be loaded from the real .env BEFORE any module that
// requires src/config/stripe.js (paymentMethod.service.js, renewal.service.js)
// — this test hits Stripe's real TEST-mode API for real, same pattern as
// registration.routes.test.js.
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

// Mocked so this suite never touches nodemailer/Ethereal — receipt email is
// Phase 10's own concern (see mail.service.test.js), unrelated to what this
// suite exists to cover (real Stripe TEST-mode renewal charges).
jest.mock('../../src/services/mail.service');

const User = require('../../src/models/user.model');
const Level = require('../../src/models/level.model');
const Location = require('../../src/models/location.model');
const GroupClass = require('../../src/models/groupClass.model');
const GroupClassSchedule = require('../../src/models/groupClassSchedule.model');
const GroupClassSession = require('../../src/models/groupClassSession.model');
const Visit = require('../../src/models/visit.model');
const Price = require('../../src/models/price.model');
const Subscription = require('../../src/models/subscription.model');
const PaymentMethod = require('../../src/models/paymentMethod.model');
const { SubscriptionCycleRegistration } = require('../../src/models/registration.model');
const stripe = require('../../src/config/stripe');
const paymentMethodService = require('../../src/services/paymentMethod.service');
const { generateInitialSessions } = require('../../src/services/groupClassSession.service');
const { addStudentToRoster } = require('../../src/services/roster.service');
const { renewOne, runRenewals } = require('../../src/services/renewal.service');
const { addOneMonth, addOneDay, todayAtMidnight } = require('../../src/utils/billingDates');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');
const mailService = require('../../src/services/mail.service');
const { seedServices } = require('../../scripts/lib/seedServices');

const MONTHLY_FEE = 150;
// Fixed historical/far-future instants, never "now + N days" — see
// TESTING_STRATEGY.md's no-time-bomb-dates rule. 2020-01-01 is always in the
// past; 2099-01-01 is fixed and far enough out that it will remain "not due"
// for the realistic lifetime of this suite.
const FAR_FUTURE_DATE = new Date('2099-01-01T00:00:00.000Z');

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

beforeEach(async () => {
  // renewOne now resolves the Service registry (getServiceByCode) before
  // writing any ledger row — every test in this file would otherwise die on
  // the catalog's fail-closed "not seeded" error before reaching what it
  // actually tests. Same one-line setup every suite touched by the
  // unified-ledger restructure already uses (docs/plans/next-batch-
  // execution-plan.md Item 2 delta #4).
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

// Generates the schedule's initial sessions, then puts the student on the
// schedule's live roster via the real roster.service.js helper — the same
// one registration.service.js uses, so this produces exactly what a real
// registration backfills into every already-generated future session
// (schedule.students entry + a scheduled Visit per session).
async function enrollStudentOnRosterAndSessions(schedule, studentId) {
  const sessions = generateInitialSessions(schedule);
  await GroupClassSession.insertMany(sessions);

  await addStudentToRoster(schedule, studentId, todayAtMidnight());

  return GroupClassSession.find({ scheduleId: schedule._id }).sort({ date: 1 });
}

// Saves a real Stripe TEST-mode card on file for `parent`, via the actual
// service function (attach + Stripe Customer side effects are the real
// ones), using the documented `tok_visa` token — same pattern as
// registration.routes.test.js's mintTestPaymentMethodId.
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

describe('renewOne', () => {
  it(
    'charges a due, active, non-cancelling subscription and advances its period fields',
    async () => {
      const { schedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
        name: 'ChargeOK',
        order: 1,
      });
      const { parent, student } = await seedParentAndStudent('renew-charge-ok@example.com');
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

      const result = await renewOne(subscription._id);

      expect(result.outcome).toBe('charged');
      expect(result.chargeAmount).toBe(MONTHLY_FEE);
      expect(result.siblingDiscountApplied).toBe(false);

      // Expected value is computed via the SAME shared addOneMonth helper
      // renewOne itself uses (not a hardcoded literal) — addOneMonth's
      // rollover math is local-timezone-dependent (JS Date's own
      // getMonth/setMonth), an existing, unchanged-by-this-phase behavior
      // inherited verbatim from registration.service.js, so hardcoding an
      // exact UTC literal here would be testing the wrong thing.
      const expectedNewPeriodEnd = addOneMonth(currentPeriodEnd);

      const updated = await Subscription.findById(subscription._id);
      expect(updated.status).toBe('active');
      expect(updated.currentPeriodStart.toISOString()).toBe(currentPeriodEnd.toISOString());
      expect(updated.currentPeriodEnd.toISOString()).toBe(expectedNewPeriodEnd.toISOString());
      expect(updated.nextBillingDate.toISOString()).toBe(expectedNewPeriodEnd.toISOString());
      expect(updated.lastChargeAmount).toBe(MONTHLY_FEE);
      expect(updated.lastSiblingDiscountApplied).toBe(false);
      // retry/dunning state stays clean on a straightforward success.
      expect(updated.retryCount).toBe(0);
      expect(updated.nextRetryAt).toBeNull();

      // The ledger row itself — docs/plans/registration-ledger-plan.md D4:
      // completed, locked amount, correct period, real Stripe PI id, keyed
      // on the row's own id (not the old renewal-{subId}-{periodEnd}
      // string).
      const ledgerRow = await SubscriptionCycleRegistration.findOne({ subscriptionId: subscription._id });
      expect(ledgerRow).not.toBeNull();
      expect(ledgerRow.eventType).toBe('renewal');
      expect(ledgerRow.status).toBe('completed');
      expect(ledgerRow.amount).toBe(MONTHLY_FEE);
      expect(ledgerRow.breakdown.registrationFeeCharged).toBe(0);
      expect(ledgerRow.periodStart.toISOString()).toBe(currentPeriodEnd.toISOString());
      expect(ledgerRow.periodEnd.toISOString()).toBe(expectedNewPeriodEnd.toISOString());
      expect(ledgerRow.stripePaymentIntentId).toBeTruthy();
      expect(ledgerRow.paidAt).not.toBeNull();

      const paymentIntent = await stripe.paymentIntents.retrieve(ledgerRow.stripePaymentIntentId);
      expect(paymentIntent.metadata.registrationId).toBe(String(ledgerRow._id));

      // Confirms the mail wiring actually fires on the 'charged' branch with
      // the right participants — proving it fires, not just that mocking it
      // doesn't break the renewal.
      expect(mailService.sendRenewalReceiptEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: expect.objectContaining({ email: 'renew-charge-ok@example.com' }),
          student: expect.objectContaining({ firstName: student.firstName }),
          chargeAmount: MONTHLY_FEE,
        })
      );
    },
    30000
  );

  it(
    'finalizes a cancelling subscription WITHOUT charging, removing the student from the schedule roster and every future session',
    async () => {
      const { schedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
        name: 'CancelFinal',
        order: 2,
      });
      const { parent, student } = await seedParentAndStudent('renew-cancel-final@example.com');
      // Deliberately NO payment method saved for this parent. If the
      // finalize-cancellation path incorrectly tried to charge, it would
      // have to reach paymentMethodService.getMine, find nothing, and
      // return 'failed_no_payment_method' instead of
      // 'cancelled_finalized' — so asserting the outcome below is itself
      // proof no charge was attempted.

      const sessions = await enrollStudentOnRosterAndSessions(schedule, student._id);
      expect(sessions.length).toBeGreaterThan(0);
      const scheduledVisits = await Visit.find({
        studentId: student._id,
        groupClassSessionId: { $in: sessions.map((session) => session._id) },
        status: { $ne: 'cancelled' },
      });
      expect(scheduledVisits).toHaveLength(sessions.length);

      const currentPeriodStart = new Date('2020-01-01T00:00:00.000Z');
      const currentPeriodEnd = new Date('2020-02-01T00:00:00.000Z');

      const subscription = await buildActiveSubscription({
        studentId: student._id,
        scheduleId: schedule._id,
        parentId: parent._id,
        currentPeriodStart,
        currentPeriodEnd,
        nextBillingDate: currentPeriodEnd,
        cancelAtPeriodEnd: true,
      });

      const result = await renewOne(subscription._id);

      expect(result).toEqual({ subscriptionId: subscription._id, outcome: 'cancelled_finalized' });

      const updatedSubscription = await Subscription.findById(subscription._id);
      expect(updatedSubscription.status).toBe('cancelled');

      const updatedSchedule = await GroupClassSchedule.findById(schedule._id);
      expect(
        updatedSchedule.students.some((id) => String(id) === String(student._id))
      ).toBe(false);

      const updatedSessions = await GroupClassSession.find({ scheduleId: schedule._id });
      expect(updatedSessions.length).toBe(sessions.length);
      const remainingActiveVisits = await Visit.find({
        studentId: student._id,
        groupClassSessionId: { $in: updatedSessions.map((session) => session._id) },
        status: { $ne: 'cancelled' },
      });
      expect(remainingActiveVisits).toHaveLength(0);
    },
    20000
  );

  it(
    'returns skipped_inactive and attempts no charge when the subscription was already cancelled by something else before renewOne runs (the re-verification race guard)',
    async () => {
      const { schedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
        name: 'Reverify',
        order: 3,
      });
      const { parent, student } = await seedParentAndStudent('renew-reverify@example.com');
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

      // Simulate "something else cancelled it already" — flip status
      // directly in the DB, bypassing subscription.service.js entirely,
      // before renewOne ever looks at this id. A real payment method DOES
      // exist for this parent, so if renewOne incorrectly skipped its own
      // fresh re-fetch and trusted a stale/no status check, it would
      // actually succeed in charging real Stripe test money and advancing
      // the period fields below — which the assertions catch.
      subscription.status = 'cancelled';
      await subscription.save();

      const result = await renewOne(subscription._id);

      expect(result).toEqual({ subscriptionId: subscription._id, outcome: 'skipped_inactive' });

      const after = await Subscription.findById(subscription._id);
      expect(after.status).toBe('cancelled');
      expect(after.lastChargeAmount).toBeNull();
      expect(after.currentPeriodStart.toISOString()).toBe(currentPeriodStart.toISOString());
      expect(after.currentPeriodEnd.toISOString()).toBe(currentPeriodEnd.toISOString());
      expect(after.nextBillingDate.toISOString()).toBe(currentPeriodEnd.toISOString());
    },
    30000
  );

  it(
    'returns skipped_not_due and leaves the subscription completely untouched when nextBillingDate is in the future',
    async () => {
      const { schedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
        name: 'NotDue',
        order: 4,
      });
      const { parent, student } = await seedParentAndStudent('renew-not-due@example.com');
      await savePaymentMethodForParent(parent);

      const currentPeriodStart = new Date('2020-01-01T00:00:00.000Z');

      const subscription = await buildActiveSubscription({
        studentId: student._id,
        scheduleId: schedule._id,
        parentId: parent._id,
        currentPeriodStart,
        currentPeriodEnd: FAR_FUTURE_DATE,
        nextBillingDate: FAR_FUTURE_DATE,
      });

      const result = await renewOne(subscription._id);

      expect(result).toEqual({ subscriptionId: subscription._id, outcome: 'skipped_not_due' });

      const after = await Subscription.findById(subscription._id);
      expect(after.status).toBe('active');
      expect(after.lastChargeAmount).toBeNull();
      expect(after.currentPeriodEnd.toISOString()).toBe(FAR_FUTURE_DATE.toISOString());
      expect(after.nextBillingDate.toISOString()).toBe(FAR_FUTURE_DATE.toISOString());
    },
    30000
  );

  it(
    'returns failed_payment and leaves period fields completely untouched on a real Stripe TEST-mode card decline',
    async () => {
      const { schedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
        name: 'Decline',
        order: 5,
      });
      const { parent, student } = await seedParentAndStudent('renew-decline@example.com');

      // A real PaymentMethod doc IS saved for this parent (via tok_visa, so
      // the attach step succeeds) — but its stripePaymentMethodId is then
      // overwritten to Stripe's documented shared test id for a guaranteed
      // decline (`pm_card_chargeDeclined`). Verified directly against the
      // real Stripe TEST-mode API before writing this test: this id cannot
      // be attach()ed to a customer at all (Stripe rejects that with a
      // card_declined error immediately), but it CAN be passed directly as
      // `payment_method` on a PaymentIntent — which is exactly what
      // renewOne does — where it reliably throws a StripeCardError.
      await savePaymentMethodForParent(parent);
      await PaymentMethod.findOneAndUpdate(
        { parentId: parent._id },
        { stripePaymentMethodId: 'pm_card_chargeDeclined' }
      );

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

      const result = await renewOne(subscription._id);

      expect(result.subscriptionId).toEqual(subscription._id);
      expect(result.outcome).toBe('failed_payment');
      expect(result.failureMessage).toBeTruthy();

      const after = await Subscription.findById(subscription._id);
      expect(after.status).toBe('active');
      // Period fields NOT rolled — the failed period stays "due" until a
      // retry (PR 3) succeeds or exhausts.
      expect(after.currentPeriodStart.toISOString()).toBe(currentPeriodStart.toISOString());
      expect(after.currentPeriodEnd.toISOString()).toBe(currentPeriodEnd.toISOString());
      expect(after.nextBillingDate.toISOString()).toBe(currentPeriodEnd.toISOString());
      expect(after.lastChargeAmount).toBeNull();

      // Retry/dunning state entered (D6: Day 0 -> +1 day).
      expect(after.retryCount).toBe(1);
      expect(after.nextRetryAt).not.toBeNull();
      const expectedNextRetryAt = addOneDay(todayAtMidnight());
      expect(after.nextRetryAt.toISOString()).toBe(expectedNextRetryAt.toISOString());

      // The ledger row this attempt created — failed, locked amount, not
      // blocking a future retry (Guard B excludes 'failed' from its
      // uniqueness scope).
      const ledgerRow = await SubscriptionCycleRegistration.findOne({ subscriptionId: subscription._id });
      expect(ledgerRow).not.toBeNull();
      expect(ledgerRow.status).toBe('failed');
      expect(ledgerRow.amount).toBe(MONTHLY_FEE);
      expect(ledgerRow.failureMessage).toBeTruthy();
      expect(ledgerRow.periodStart.toISOString()).toBe(currentPeriodEnd.toISOString());

      // Day-0 failure email fires with the right participants and amount.
      expect(mailService.sendPaymentFailureEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: expect.objectContaining({ email: 'renew-decline@example.com' }),
          student: expect.objectContaining({ firstName: student.firstName }),
          amountDue: MONTHLY_FEE,
          attemptNumber: 1,
          isFinal: false,
        })
      );
    },
    30000
  );

  // docs/plans/registration-ledger-plan.md D4 step 2 — Guard B behaviorally:
  // a concurrent renewOne double-call for the same period yields exactly
  // one charged outcome and one skip, never two ledger rows.
  it(
    'ledger dedup: a concurrent double-call for the same subscription yields one charged outcome and one skipped_concurrent — exactly one non-failed row exists',
    async () => {
      const { schedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
        name: 'Concurrent',
        order: 7,
      });
      const { parent, student } = await seedParentAndStudent('renew-concurrent@example.com');
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

      const [resultA, resultB] = await Promise.all([
        renewOne(subscription._id),
        renewOne(subscription._id),
      ]);

      const outcomes = [resultA.outcome, resultB.outcome].sort();
      // One racer wins ('charged'); the other loses the Guard B insert
      // race ('skipped_concurrent') — the two calls started from the same
      // pre-charge state (no existing ledger row yet for either), so this
      // is the E11000-catch path (D4 step 4), not the dedup pre-check
      // (D4 step 2, exercised by the "already charged" test below).
      expect(outcomes).toEqual(['charged', 'skipped_concurrent']);

      const rows = await SubscriptionCycleRegistration.find({ subscriptionId: subscription._id });
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('completed');
    },
    30000
  );

  // D4 step 2's dedup pre-check — a row already 'completed' for this exact
  // period (e.g. a prior run died after charging but before the period
  // rolled) must self-heal the subscription without a second charge.
  it(
    'skips and un-sticks the subscription when a completed ledger row already exists for this period, with no new Stripe charge',
    async () => {
      const { schedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
        name: 'AlreadyCharged',
        order: 8,
      });
      const { parent, student } = await seedParentAndStudent('renew-already-charged@example.com');
      await savePaymentMethodForParent(parent);

      const Service = require('../../src/models/service.model');
      const groupClassesService = await Service.findOne({ code: 'group-classes' });

      const currentPeriodStart = new Date('2020-01-01T00:00:00.000Z');
      const currentPeriodEnd = new Date('2020-02-01T00:00:00.000Z');
      const nextPeriodEnd = addOneMonth(currentPeriodEnd);

      const subscription = await buildActiveSubscription({
        studentId: student._id,
        scheduleId: schedule._id,
        parentId: parent._id,
        currentPeriodStart,
        currentPeriodEnd,
        nextBillingDate: currentPeriodEnd,
      });

      // A prior run's already-completed row for this exact period — no
      // Subscription roll-forward happened for it (the "died after
      // charging" scenario).
      await SubscriptionCycleRegistration.create({
        serviceId: groupClassesService._id,
        subscriptionId: subscription._id,
        scheduleId: schedule._id,
        studentId: student._id,
        parentId: parent._id,
        eventType: 'renewal',
        status: 'completed',
        amount: MONTHLY_FEE,
        breakdown: { monthlyFee: MONTHLY_FEE, registrationFeeCharged: 0 },
        periodStart: currentPeriodEnd,
        periodEnd: nextPeriodEnd,
        stripePaymentIntentId: 'pi_prior_run_already_charged',
        paidAt: new Date(),
      });

      const paymentIntentsBefore = await stripe.paymentIntents.list({ limit: 10 });

      const result = await renewOne(subscription._id);

      expect(result).toEqual({ subscriptionId: subscription._id, outcome: 'skipped_already_charged' });

      const after = await Subscription.findById(subscription._id);
      expect(after.currentPeriodStart.toISOString()).toBe(currentPeriodEnd.toISOString());
      expect(after.currentPeriodEnd.toISOString()).toBe(nextPeriodEnd.toISOString());
      expect(after.nextBillingDate.toISOString()).toBe(nextPeriodEnd.toISOString());
      expect(after.retryCount).toBe(0);

      // No new PaymentIntent was created.
      const paymentIntentsAfter = await stripe.paymentIntents.list({ limit: 10 });
      expect(paymentIntentsAfter.data.length).toBe(paymentIntentsBefore.data.length);

      // Still exactly one ledger row for this subscription.
      const rows = await SubscriptionCycleRegistration.find({ subscriptionId: subscription._id });
      expect(rows).toHaveLength(1);
    },
    30000
  );

  // D5 — stale-pending recovery, case (a): a pending row whose PaymentIntent
  // actually succeeded (the process died between the Stripe response and
  // updating the row) must be adopted, not re-charged.
  it(
    'stale-pending recovery: adopts a succeeded PaymentIntent found via metadata search, with NO second charge',
    async () => {
      const { schedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
        name: 'StaleAdopt',
        order: 9,
      });
      const { parent, student } = await seedParentAndStudent('renew-stale-adopt@example.com');
      await savePaymentMethodForParent(parent);

      const Service = require('../../src/models/service.model');
      const groupClassesService = await Service.findOne({ code: 'group-classes' });

      const currentPeriodStart = new Date('2020-01-01T00:00:00.000Z');
      const currentPeriodEnd = new Date('2020-02-01T00:00:00.000Z');
      const nextPeriodEnd = addOneMonth(currentPeriodEnd);

      const subscription = await buildActiveSubscription({
        studentId: student._id,
        scheduleId: schedule._id,
        parentId: parent._id,
        currentPeriodStart,
        currentPeriodEnd,
        nextBillingDate: currentPeriodEnd,
      });

      // Insert the pending row FIRST (as renewOne itself would, D4 step 4),
      // then charge it directly via Stripe carrying the SAME metadata
      // renewOne's own chargeLedgerRow would use — simulating "the process
      // died right after Stripe confirmed success, before the row/
      // Subscription were updated."
      const pendingRow = await SubscriptionCycleRegistration.create({
        serviceId: groupClassesService._id,
        subscriptionId: subscription._id,
        scheduleId: schedule._id,
        studentId: student._id,
        parentId: parent._id,
        eventType: 'renewal',
        status: 'pending',
        amount: MONTHLY_FEE,
        breakdown: { monthlyFee: MONTHLY_FEE, registrationFeeCharged: 0 },
        periodStart: currentPeriodEnd,
        periodEnd: nextPeriodEnd,
      });

      const paymentMethod = await PaymentMethod.findOne({ parentId: parent._id });
      const stripeCustomer = await stripe.customers.list({ email: parent.email, limit: 1 });
      const succeededPI = await stripe.paymentIntents.create(
        {
          amount: Math.round(MONTHLY_FEE * 100),
          currency: 'usd',
          customer: stripeCustomer.data[0].id,
          payment_method: paymentMethod.stripePaymentMethodId,
          off_session: true,
          confirm: true,
          metadata: { registrationId: String(pendingRow._id) },
        },
        { idempotencyKey: `payment_${pendingRow._id}` }
      );
      expect(succeededPI.status).toBe('succeeded');

      const paymentIntentsBefore = await stripe.paymentIntents.list({ limit: 10 });

      const result = await renewOne(subscription._id);

      expect(result.outcome).toBe('charged');
      expect(result.chargeAmount).toBe(MONTHLY_FEE);

      // No second charge — same count as before renewOne ran.
      const paymentIntentsAfter = await stripe.paymentIntents.list({ limit: 10 });
      expect(paymentIntentsAfter.data.length).toBe(paymentIntentsBefore.data.length);

      const updatedRow = await SubscriptionCycleRegistration.findById(pendingRow._id);
      expect(updatedRow.status).toBe('completed');
      expect(updatedRow.stripePaymentIntentId).toBe(succeededPI.id);

      const after = await Subscription.findById(subscription._id);
      expect(after.currentPeriodStart.toISOString()).toBe(currentPeriodEnd.toISOString());
      expect(after.currentPeriodEnd.toISOString()).toBe(nextPeriodEnd.toISOString());
      expect(after.retryCount).toBe(0);
    },
    30000
  );

  // D5 — stale-pending recovery, case (b): a pending row with no matching
  // PaymentIntent at all must be re-driven under the SAME idempotency key.
  it(
    'stale-pending recovery: re-drives the charge under the same idempotency key when no matching PaymentIntent is found',
    async () => {
      const { schedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
        name: 'StaleRedrive',
        order: 10,
      });
      const { parent, student } = await seedParentAndStudent('renew-stale-redrive@example.com');
      await savePaymentMethodForParent(parent);

      const Service = require('../../src/models/service.model');
      const groupClassesService = await Service.findOne({ code: 'group-classes' });

      const currentPeriodStart = new Date('2020-01-01T00:00:00.000Z');
      const currentPeriodEnd = new Date('2020-02-01T00:00:00.000Z');
      const nextPeriodEnd = addOneMonth(currentPeriodEnd);

      const subscription = await buildActiveSubscription({
        studentId: student._id,
        scheduleId: schedule._id,
        parentId: parent._id,
        currentPeriodStart,
        currentPeriodEnd,
        nextBillingDate: currentPeriodEnd,
      });

      // A pending row that never actually reached Stripe (the process died
      // right after the insert, before the charge call) — no PaymentIntent
      // anywhere carries its id.
      const pendingRow = await SubscriptionCycleRegistration.create({
        serviceId: groupClassesService._id,
        subscriptionId: subscription._id,
        scheduleId: schedule._id,
        studentId: student._id,
        parentId: parent._id,
        eventType: 'renewal',
        status: 'pending',
        amount: MONTHLY_FEE,
        breakdown: { monthlyFee: MONTHLY_FEE, registrationFeeCharged: 0 },
        periodStart: currentPeriodEnd,
        periodEnd: nextPeriodEnd,
      });

      const result = await renewOne(subscription._id);

      expect(result.outcome).toBe('charged');
      expect(result.chargeAmount).toBe(MONTHLY_FEE);

      const updatedRow = await SubscriptionCycleRegistration.findById(pendingRow._id);
      expect(updatedRow.status).toBe('completed');
      expect(updatedRow.stripePaymentIntentId).toBeTruthy();

      const paymentIntent = await stripe.paymentIntents.retrieve(updatedRow.stripePaymentIntentId);
      expect(paymentIntent.metadata.registrationId).toBe(String(pendingRow._id));

      const after = await Subscription.findById(subscription._id);
      expect(after.currentPeriodEnd.toISOString()).toBe(nextPeriodEnd.toISOString());
    },
    30000
  );

  // Failed row does NOT block a later attempt — Guard B's index excludes
  // 'failed' from its uniqueness scope, expressed as behavior rather than
  // asserted against the raw index directly (TESTING_STRATEGY.md's "no raw
  // index tests" rule).
  it(
    'a failed row for this period does not block a later successful renewOne call for the same period',
    async () => {
      const { schedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
        name: 'FailedThenRetry',
        order: 11,
      });
      const { parent, student } = await seedParentAndStudent('renew-failed-then-ok@example.com');
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

      // A failed row already exists for this exact period (e.g. from an
      // earlier retry attempt scenario) — Guard B must not block a fresh
      // insert for the same {subscriptionId, periodStart}.
      await SubscriptionCycleRegistration.create({
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
      });

      const result = await renewOne(subscription._id);

      expect(result.outcome).toBe('charged');

      const rows = await SubscriptionCycleRegistration.find({ subscriptionId: subscription._id });
      expect(rows).toHaveLength(2);
      expect(rows.filter((row) => row.status === 'completed')).toHaveLength(1);
      expect(rows.filter((row) => row.status === 'failed')).toHaveLength(1);
    },
    30000
  );
});

describe('runRenewals', () => {
  it(
    'processes a mix of 3 due subscriptions in different states sequentially and returns a summary whose counts match reality',
    async () => {
      const { schedule } = await seedLevelWithPriceAndSchedule(MONTHLY_FEE, {
        name: 'RunMix',
        order: 6,
      });

      const duePeriodStart = new Date('2020-01-01T00:00:00.000Z');
      const duePeriodEnd = new Date('2020-02-01T00:00:00.000Z');

      const { parent: chargeParent, student: chargeStudent } = await seedParentAndStudent(
        'renew-run-charge@example.com'
      );
      await savePaymentMethodForParent(chargeParent);
      const chargeSub = await buildActiveSubscription({
        studentId: chargeStudent._id,
        scheduleId: schedule._id,
        parentId: chargeParent._id,
        currentPeriodStart: duePeriodStart,
        currentPeriodEnd: duePeriodEnd,
        nextBillingDate: duePeriodEnd,
      });

      const { parent: cancelParent, student: cancelStudent } = await seedParentAndStudent(
        'renew-run-cancel@example.com'
      );
      const cancelSub = await buildActiveSubscription({
        studentId: cancelStudent._id,
        scheduleId: schedule._id,
        parentId: cancelParent._id,
        currentPeriodStart: duePeriodStart,
        currentPeriodEnd: duePeriodEnd,
        nextBillingDate: duePeriodEnd,
        cancelAtPeriodEnd: true,
      });

      const { parent: noPmParent, student: noPmStudent } = await seedParentAndStudent(
        'renew-run-nopm@example.com'
      );
      const noPmSub = await buildActiveSubscription({
        studentId: noPmStudent._id,
        scheduleId: schedule._id,
        parentId: noPmParent._id,
        currentPeriodStart: duePeriodStart,
        currentPeriodEnd: duePeriodEnd,
        nextBillingDate: duePeriodEnd,
      });

      const summary = await runRenewals();

      expect(summary.total).toBe(3);
      expect(summary.results).toHaveLength(3);

      const byId = new Map(
        summary.results.map((result) => [String(result.subscriptionId), result])
      );

      expect(byId.get(String(chargeSub._id)).outcome).toBe('charged');
      expect(byId.get(String(cancelSub._id)).outcome).toBe('cancelled_finalized');
      expect(byId.get(String(noPmSub._id)).outcome).toBe('failed_no_payment_method');

      const outcomeCounts = summary.results.reduce((acc, result) => {
        acc[result.outcome] = (acc[result.outcome] || 0) + 1;
        return acc;
      }, {});

      expect(outcomeCounts).toEqual({
        charged: 1,
        cancelled_finalized: 1,
        failed_no_payment_method: 1,
      });

      // Reality-check each subscription's persisted state matches its
      // reported outcome, not just the in-memory summary.
      const chargedInDb = await Subscription.findById(chargeSub._id);
      expect(chargedInDb.lastChargeAmount).toBe(MONTHLY_FEE);

      const cancelledInDb = await Subscription.findById(cancelSub._id);
      expect(cancelledInDb.status).toBe('cancelled');

      const noPmInDb = await Subscription.findById(noPmSub._id);
      expect(noPmInDb.status).toBe('active');
      expect(noPmInDb.lastChargeAmount).toBeNull();
    },
    40000
  );
});
