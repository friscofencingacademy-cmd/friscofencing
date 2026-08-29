const User = require('../../../src/models/user.model');
const Subscription = require('../../../src/models/subscription.model');
const Setting = require('../../../src/models/setting.model');
const { resolveRegistrationFee } = require('../../../src/services/billing/registrationFee.service');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');

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

async function seedParentAndStudent(email) {
  const parent = await User.create({ role: 'parent', firstName: 'Parent', lastName: 'Test', email });
  const student = await User.create({ role: 'student', firstName: 'Kid', lastName: 'Test', parentId: parent._id });
  return { parent, student };
}

// A minimal, already-cancelled Subscription for `student` — the only fields
// resolveRegistrationFee actually reads (studentId, status, currentPeriodEnd).
// scheduleId/parentId/currentPeriodStart/nextBillingDate are required by the
// schema but not semantically relevant here, so any valid ObjectId/date works.
async function seedCancelledSubscription(student, currentPeriodEnd) {
  return Subscription.create({
    studentId: student._id,
    scheduleId: student._id, // any valid ObjectId — never read for this test
    parentId: student.parentId,
    status: 'cancelled',
    currentPeriodStart: new Date('2025-01-01T00:00:00.000Z'),
    currentPeriodEnd,
    nextBillingDate: currentPeriodEnd,
  });
}

describe('resolveRegistrationFee', () => {
  it('returns no charge when no fee is configured (no Setting doc at all)', async () => {
    const { student } = await seedParentAndStudent('no-setting@example.com');

    const result = await resolveRegistrationFee(student._id);

    expect(result).toEqual({ amount: 0, waived: false, reason: null, standardAmount: 0 });
  });

  it('returns no charge when the configured fee is explicitly 0', async () => {
    await Setting.create({ registrationFee: 0, returningStudentGracePeriodMonths: 6 });
    const { student } = await seedParentAndStudent('zero-fee@example.com');

    const result = await resolveRegistrationFee(student._id);

    expect(result).toEqual({ amount: 0, waived: false, reason: null, standardAmount: 0 });
  });

  it('charges the full fee for a brand-new student with no prior subscription history', async () => {
    await Setting.create({ registrationFee: 25, returningStudentGracePeriodMonths: 6 });
    const { student } = await seedParentAndStudent('brand-new@example.com');

    const result = await resolveRegistrationFee(student._id);

    expect(result).toEqual({ amount: 25, waived: false, reason: null, standardAmount: 25 });
  });

  it('charges the full fee for a returning student when no grace period is configured', async () => {
    await Setting.create({ registrationFee: 25, returningStudentGracePeriodMonths: 0 });
    const { student } = await seedParentAndStudent('no-grace@example.com');
    await seedCancelledSubscription(student, new Date()); // ended today — as recent as it gets

    const result = await resolveRegistrationFee(student._id);

    expect(result).toEqual({ amount: 25, waived: false, reason: null, standardAmount: 25 });
  });

  it('waives the fee for a student registering back within the configured grace period', async () => {
    await Setting.create({ registrationFee: 25, returningStudentGracePeriodMonths: 6 });
    const { student } = await seedParentAndStudent('returning-in-window@example.com');

    // Ended 2 months ago — well within a 6-month grace period.
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    await seedCancelledSubscription(student, twoMonthsAgo);

    const result = await resolveRegistrationFee(student._id);

    expect(result.amount).toBe(0);
    expect(result.waived).toBe(true);
    expect(result.reason).toMatch(/waived/i);
    expect(result.reason).toContain('6 months');
    // The Family Scorecard checkout quote panel's "you saved $X" line reads
    // this — the configured fee's value must survive the waiver, not
    // collapse to 0 along with `amount` (docs/plans/wordpress-ui-alignment
    // -plan.md, Phase 3).
    expect(result.standardAmount).toBe(25);
  });

  it('charges the full fee for a student registering back OUTSIDE the configured grace period', async () => {
    await Setting.create({ registrationFee: 25, returningStudentGracePeriodMonths: 6 });
    const { student } = await seedParentAndStudent('returning-outside-window@example.com');

    // Ended 8 months ago — past a 6-month grace period.
    const eightMonthsAgo = new Date();
    eightMonthsAgo.setMonth(eightMonthsAgo.getMonth() - 8);
    await seedCancelledSubscription(student, eightMonthsAgo);

    const result = await resolveRegistrationFee(student._id);

    expect(result).toEqual({ amount: 25, waived: false, reason: null, standardAmount: 25 });
  });

  it('uses the most recent prior subscription when a student has cancelled more than once', async () => {
    await Setting.create({ registrationFee: 25, returningStudentGracePeriodMonths: 6 });
    const { student } = await seedParentAndStudent('multiple-priors@example.com');

    // An OLD lapse (way outside the window) and a RECENT one (inside it) —
    // the recent one must win, not whichever was created first.
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    await seedCancelledSubscription(student, twoYearsAgo);

    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    await seedCancelledSubscription(student, oneMonthAgo);

    const result = await resolveRegistrationFee(student._id);

    expect(result.amount).toBe(0);
    expect(result.waived).toBe(true);
  });

  it('grants the grace-period waiver of a singular "1 month" without a stray plural "s"', async () => {
    await Setting.create({ registrationFee: 25, returningStudentGracePeriodMonths: 1 });
    const { student } = await seedParentAndStudent('singular-month@example.com');
    await seedCancelledSubscription(student, new Date());

    const result = await resolveRegistrationFee(student._id);

    expect(result.reason).toContain('1 month of');
    expect(result.reason).not.toContain('1 months');
  });

  it('never charges a fee to a student whose only history is a subscription that is still active (not "prior" at all)', async () => {
    await Setting.create({ registrationFee: 25, returningStudentGracePeriodMonths: 6 });
    const { student } = await seedParentAndStudent('still-active@example.com');

    const currentPeriodEnd = new Date();
    currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
    await Subscription.create({
      studentId: student._id,
      scheduleId: student._id,
      parentId: student.parentId,
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd,
      nextBillingDate: currentPeriodEnd,
    });

    // create() never calls resolveRegistrationFee for an already-active
    // student (the existingSubscription 409 guard fires first) — this test
    // documents that resolveRegistrationFee itself, called in isolation,
    // correctly ignores a still-active subscription as "prior history" and
    // charges the full fee as if brand-new, rather than crashing or waiving.
    const result = await resolveRegistrationFee(student._id);

    expect(result).toEqual({ amount: 25, waived: false, reason: null, standardAmount: 25 });
  });
});
