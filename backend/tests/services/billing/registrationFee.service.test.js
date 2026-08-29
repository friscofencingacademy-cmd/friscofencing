const User = require('../../../src/models/user.model');
const Subscription = require('../../../src/models/subscription.model');
const Setting = require('../../../src/models/setting.model');
const Level = require('../../../src/models/level.model');
const Price = require('../../../src/models/price.model');
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

// A Level + Price pair, mirroring the real level->Price keying. `registrationFee`
// omitted (undefined) leaves the Price's own default (null) in place — i.e. "no
// per-level override, fall back to the academy-wide Setting.registrationFee" —
// which is what every pre-existing test in this file exercises now that
// resolveRegistrationFee always does a live Price lookup.
async function seedLevelAndPrice({ monthlyFee = 100, registrationFee } = {}) {
  const level = await Level.create({ name: `Level ${Date.now()}-${Math.random()}`, order: Math.floor(Math.random() * 100000) });
  const priceData = { levelId: level._id, monthlyFee };

  if (registrationFee !== undefined) {
    priceData.registrationFee = registrationFee;
  }

  const price = await Price.create(priceData);
  return { level, price };
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
    const { level } = await seedLevelAndPrice();

    const result = await resolveRegistrationFee(student._id, level._id);

    expect(result).toEqual({ amount: 0, waived: false, reason: null, standardAmount: 0 });
  });

  it('returns no charge when the configured fee is explicitly 0', async () => {
    await Setting.create({ registrationFee: 0, returningStudentGracePeriodMonths: 6 });
    const { student } = await seedParentAndStudent('zero-fee@example.com');
    const { level } = await seedLevelAndPrice();

    const result = await resolveRegistrationFee(student._id, level._id);

    expect(result).toEqual({ amount: 0, waived: false, reason: null, standardAmount: 0 });
  });

  it('charges the full fee for a brand-new student with no prior subscription history', async () => {
    await Setting.create({ registrationFee: 25, returningStudentGracePeriodMonths: 6 });
    const { student } = await seedParentAndStudent('brand-new@example.com');
    const { level } = await seedLevelAndPrice();

    const result = await resolveRegistrationFee(student._id, level._id);

    expect(result).toEqual({ amount: 25, waived: false, reason: null, standardAmount: 25 });
  });

  it('charges the full fee for a returning student when no grace period is configured', async () => {
    await Setting.create({ registrationFee: 25, returningStudentGracePeriodMonths: 0 });
    const { student } = await seedParentAndStudent('no-grace@example.com');
    const { level } = await seedLevelAndPrice();
    await seedCancelledSubscription(student, new Date()); // ended today — as recent as it gets

    const result = await resolveRegistrationFee(student._id, level._id);

    expect(result).toEqual({ amount: 25, waived: false, reason: null, standardAmount: 25 });
  });

  it('waives the fee for a student registering back within the configured grace period', async () => {
    await Setting.create({ registrationFee: 25, returningStudentGracePeriodMonths: 6 });
    const { student } = await seedParentAndStudent('returning-in-window@example.com');
    const { level } = await seedLevelAndPrice();

    // Ended 2 months ago — well within a 6-month grace period.
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    await seedCancelledSubscription(student, twoMonthsAgo);

    const result = await resolveRegistrationFee(student._id, level._id);

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
    const { level } = await seedLevelAndPrice();

    // Ended 8 months ago — past a 6-month grace period.
    const eightMonthsAgo = new Date();
    eightMonthsAgo.setMonth(eightMonthsAgo.getMonth() - 8);
    await seedCancelledSubscription(student, eightMonthsAgo);

    const result = await resolveRegistrationFee(student._id, level._id);

    expect(result).toEqual({ amount: 25, waived: false, reason: null, standardAmount: 25 });
  });

  it('uses the most recent prior subscription when a student has cancelled more than once', async () => {
    await Setting.create({ registrationFee: 25, returningStudentGracePeriodMonths: 6 });
    const { student } = await seedParentAndStudent('multiple-priors@example.com');
    const { level } = await seedLevelAndPrice();

    // An OLD lapse (way outside the window) and a RECENT one (inside it) —
    // the recent one must win, not whichever was created first.
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    await seedCancelledSubscription(student, twoYearsAgo);

    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    await seedCancelledSubscription(student, oneMonthAgo);

    const result = await resolveRegistrationFee(student._id, level._id);

    expect(result.amount).toBe(0);
    expect(result.waived).toBe(true);
  });

  it('grants the grace-period waiver of a singular "1 month" without a stray plural "s"', async () => {
    await Setting.create({ registrationFee: 25, returningStudentGracePeriodMonths: 1 });
    const { student } = await seedParentAndStudent('singular-month@example.com');
    const { level } = await seedLevelAndPrice();
    await seedCancelledSubscription(student, new Date());

    const result = await resolveRegistrationFee(student._id, level._id);

    expect(result.reason).toContain('1 month of');
    expect(result.reason).not.toContain('1 months');
  });

  it('never charges a fee to a student whose only history is a subscription that is still active (not "prior" at all)', async () => {
    await Setting.create({ registrationFee: 25, returningStudentGracePeriodMonths: 6 });
    const { student } = await seedParentAndStudent('still-active@example.com');
    const { level } = await seedLevelAndPrice();

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
    const result = await resolveRegistrationFee(student._id, level._id);

    expect(result).toEqual({ amount: 25, waived: false, reason: null, standardAmount: 25 });
  });

  // Named regression block — per-level registration fee
  // (docs/plans/per-level-registration-fee-plan.md): the level's own
  // Price.registrationFee overrides the academy-wide Setting.registrationFee
  // when set, including an explicit 0.
  describe('per-level override (per-level registration fee plan)', () => {
    it('charges the level fee, not the academy-wide default, when both are configured', async () => {
      await Setting.create({ registrationFee: 145, returningStudentGracePeriodMonths: 0 });
      const { student } = await seedParentAndStudent('level-override@example.com');
      const { level } = await seedLevelAndPrice({ registrationFee: 100 });

      const result = await resolveRegistrationFee(student._id, level._id);

      expect(result.amount).toBe(100);
      expect(result.standardAmount).toBe(100);
    });

    it('falls back to the academy-wide default when the level has no override configured', async () => {
      await Setting.create({ registrationFee: 145, returningStudentGracePeriodMonths: 0 });
      const { student } = await seedParentAndStudent('level-no-override@example.com');
      const { level } = await seedLevelAndPrice(); // registrationFee left unset (null)

      const result = await resolveRegistrationFee(student._id, level._id);

      expect(result.amount).toBe(145);
      expect(result.standardAmount).toBe(145);
    });

    it('charges NO fee when the level explicitly overrides to 0, even though the academy-wide default is positive', async () => {
      await Setting.create({ registrationFee: 145, returningStudentGracePeriodMonths: 0 });
      const { student } = await seedParentAndStudent('level-zero-override@example.com');
      const { level } = await seedLevelAndPrice({ registrationFee: 0 });

      const result = await resolveRegistrationFee(student._id, level._id);

      // The ??-not-|| regression guard: 0 is a real, distinct configured
      // value ("no fee at this level"), not "unset" — it must not fall
      // through to the academy-wide 145.
      expect(result).toEqual({ amount: 0, waived: false, reason: null, standardAmount: 0 });
    });

    it('falls back to the academy-wide default when no Price doc exists at all for the level', async () => {
      await Setting.create({ registrationFee: 145, returningStudentGracePeriodMonths: 0 });
      const { student } = await seedParentAndStudent('no-price-doc@example.com');
      const missingLevel = await Level.create({ name: 'No Price Level', order: 999 });

      const result = await resolveRegistrationFee(student._id, missingLevel._id);

      expect(result.amount).toBe(145);
    });

    it('charges the level fee even when the academy-wide default is unset (0)', async () => {
      await Setting.create({ registrationFee: 0, returningStudentGracePeriodMonths: 0 });
      const { student } = await seedParentAndStudent('level-override-no-default@example.com');
      const { level } = await seedLevelAndPrice({ registrationFee: 100 });

      const result = await resolveRegistrationFee(student._id, level._id);

      expect(result.amount).toBe(100);
      expect(result.standardAmount).toBe(100);
    });

    it('waives the level fee (not the academy-wide default) for a returning student within the grace period', async () => {
      await Setting.create({ registrationFee: 145, returningStudentGracePeriodMonths: 6 });
      const { student } = await seedParentAndStudent('level-waiver@example.com');
      const { level } = await seedLevelAndPrice({ registrationFee: 100 });

      const twoMonthsAgo = new Date();
      twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
      await seedCancelledSubscription(student, twoMonthsAgo);

      const result = await resolveRegistrationFee(student._id, level._id);

      expect(result.amount).toBe(0);
      expect(result.waived).toBe(true);
      // The Family Scorecard "you saved $X" line must read the LEVEL fee
      // (100), not the academy-wide default (145).
      expect(result.standardAmount).toBe(100);
    });
  });
});
