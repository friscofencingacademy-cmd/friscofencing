const User = require('../../../src/models/user.model');
const Level = require('../../../src/models/level.model');
const Location = require('../../../src/models/location.model');
const GroupClass = require('../../../src/models/groupClass.model');
const GroupClassSchedule = require('../../../src/models/groupClassSchedule.model');
const Price = require('../../../src/models/price.model');
const Subscription = require('../../../src/models/subscription.model');
const { calculateChargeAmount } = require('../../../src/services/billing/calculateChargeAmount.service');
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

// Builds a real Level + Price pair, priced at `monthlyFee`.
async function seedLevelWithPrice(monthlyFee, { name = 'Level', order = 1 } = {}) {
  const level = await Level.create({ name, order });
  await Price.create({ levelId: level._id, monthlyFee });
  return level;
}

// Builds a real GroupClass + GroupClassSchedule for `level`, so
// resolveCurrentFee's live schedule -> class -> level -> Price walk has
// something real to traverse. Each call needs its own locationName —
// GroupClass has no uniqueness constraint of its own, but Location does
// via its name in some seed helpers elsewhere in this repo; kept unique
// here for parity.
async function seedScheduleForLevel(level, { locationName = 'HQ', scheduleName = 'Class' } = {}) {
  const location = await Location.create({ name: locationName, address: '1 Main St' });
  const coach = await User.create({
    role: 'coach',
    firstName: 'Coach',
    lastName: 'Test',
    email: `coach-${locationName}-${Date.now()}-${Math.random()}@example.com`,
  });
  const groupClass = await GroupClass.create({
    name: scheduleName,
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

  return schedule;
}

async function seedParent(email) {
  return User.create({ role: 'parent', firstName: 'Parent', lastName: 'Test', email });
}

async function seedStudent(parentId, { firstName = 'Kid' } = {}) {
  return User.create({ role: 'student', firstName, lastName: 'Test', parentId });
}

// `createdAt` can be passed explicitly to control tiebreak ordering — every
// real call site's own `timestamps: true` field, just deterministic here
// instead of relying on wall-clock creation order.
async function seedActiveSubscription(
  student,
  parent,
  scheduleId,
  { cancelAtPeriodEnd = false, currentPeriodEnd, createdAt } = {}
) {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const periodEnd = currentPeriodEnd ?? new Date('2026-02-01T00:00:00.000Z');

  const subscription = await Subscription.create({
    studentId: student._id,
    scheduleId,
    parentId: parent._id,
    status: 'active',
    cancelAtPeriodEnd,
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    nextBillingDate: periodEnd,
  });

  if (createdAt) {
    // Mongoose's timestamps plugin sets createdAt on insert and won't
    // accept an override in the create() call itself — set it directly
    // after, for tests that need explicit control over tiebreak ordering
    // rather than relying on wall-clock creation order.
    await Subscription.updateOne({ _id: subscription._id }, { $set: { createdAt } });
    subscription.createdAt = createdAt;
  }

  return subscription;
}

describe('calculateChargeAmount', () => {
  describe('input contract', () => {
    it('throws when mode is missing or invalid — every caller must state intent explicitly', async () => {
      const parent = await seedParent('parent-no-mode@example.com');
      const student = await seedStudent(parent._id);

      await expect(calculateChargeAmount(student, 150)).rejects.toThrow(/mode/);
      await expect(calculateChargeAmount(student, 150, {})).rejects.toThrow(/mode/);
      await expect(calculateChargeAmount(student, 150, { mode: 'bogus' })).rejects.toThrow(/mode/);
    });

    it("throws in 'renewal' mode without the student's own subscription", async () => {
      const parent = await seedParent('parent-no-sub@example.com');
      const student = await seedStudent(parent._id);

      await expect(calculateChargeAmount(student, 150, { mode: 'renewal' })).rejects.toThrow(/subscription/);
    });
  });

  describe('no active siblings (both modes)', () => {
    it('returns full price, no discount, in renewal mode', async () => {
      const parent = await seedParent('parent-no-sibling-renewal@example.com');
      const student = await seedStudent(parent._id);
      const level = await seedLevelWithPrice(150);
      const schedule = await seedScheduleForLevel(level, { locationName: 'loc-no-sib-renewal' });
      const subscription = await seedActiveSubscription(student, parent, schedule._id);

      const result = await calculateChargeAmount(student, 150, { mode: 'renewal', subscription });

      expect(result).toEqual({ amount: 150, siblingDiscountApplied: false, siblingDiscountAmount: 0, reason: null });
    });

    it('returns full price, no discount, in registration mode', async () => {
      const parent = await seedParent('parent-no-sibling-reg@example.com');
      const student = await seedStudent(parent._id);

      const result = await calculateChargeAmount(student, 150, { mode: 'registration' });

      expect(result).toEqual({ amount: 150, siblingDiscountApplied: false, siblingDiscountAmount: 0, reason: null });
    });
  });

  describe("mode: 'renewal' — top-payer-excluded rule", () => {
    it('gives the lower-fee student the 10% discount (2 kids)', async () => {
      const pricierLevel = await seedLevelWithPrice(200, { name: 'Pricier', order: 2 });
      const parent = await seedParent('parent-renewal-2-lower@example.com');
      const thisStudent = await seedStudent(parent._id, { firstName: 'Cheaper' });
      const sibling = await seedStudent(parent._id, { firstName: 'Pricier' });
      const siblingSchedule = await seedScheduleForLevel(pricierLevel, { locationName: 'loc-r2-a' });
      const thisSchedule = await seedScheduleForLevel(await seedLevelWithPrice(100, { name: 'Cheap', order: 1 }), {
        locationName: 'loc-r2-b',
      });
      await seedActiveSubscription(sibling, parent, siblingSchedule._id);
      const thisSubscription = await seedActiveSubscription(thisStudent, parent, thisSchedule._id);

      const result = await calculateChargeAmount(thisStudent, 100, { mode: 'renewal', subscription: thisSubscription });

      expect(result).toEqual({
        amount: 90,
        siblingDiscountApplied: true,
        siblingDiscountAmount: 10,
        reason: 'This is the lower-priced plan among your active children, so the 10% sibling discount applies here.',
      });
    });

    it('charges the higher-fee student full price — the top payer (2 kids)', async () => {
      const cheapLevel = await seedLevelWithPrice(100, { name: 'Cheap', order: 1 });
      const parent = await seedParent('parent-renewal-2-higher@example.com');
      const thisStudent = await seedStudent(parent._id, { firstName: 'Pricier' });
      const sibling = await seedStudent(parent._id, { firstName: 'Cheaper' });
      const siblingSchedule = await seedScheduleForLevel(cheapLevel, { locationName: 'loc-r2c-a' });
      const thisSchedule = await seedScheduleForLevel(await seedLevelWithPrice(200, { name: 'Pricier2', order: 2 }), {
        locationName: 'loc-r2c-b',
      });
      await seedActiveSubscription(sibling, parent, siblingSchedule._id);
      const thisSubscription = await seedActiveSubscription(thisStudent, parent, thisSchedule._id);

      const result = await calculateChargeAmount(thisStudent, 200, { mode: 'renewal', subscription: thisSubscription });

      expect(result).toEqual({
        amount: 200,
        siblingDiscountApplied: false,
        siblingDiscountAmount: 0,
        reason: 'Your other child has the lower-priced plan, so the sibling discount applies to their plan instead.',
      });
    });

    it('with 3 kids, only the top payer is excluded — the other TWO both get the discount (owner: "3 kids -> 2 discounts")', async () => {
      const parent = await seedParent('parent-renewal-3kids@example.com');
      const top = await seedStudent(parent._id, { firstName: 'Top' });
      const mid = await seedStudent(parent._id, { firstName: 'Mid' });
      const low = await seedStudent(parent._id, { firstName: 'Low' });

      const topLevel = await seedLevelWithPrice(300, { name: 'Top3', order: 1 });
      const midLevel = await seedLevelWithPrice(200, { name: 'Mid3', order: 2 });
      const lowLevel = await seedLevelWithPrice(100, { name: 'Low3', order: 3 });

      const topSchedule = await seedScheduleForLevel(topLevel, { locationName: 'loc-3k-top' });
      const midSchedule = await seedScheduleForLevel(midLevel, { locationName: 'loc-3k-mid' });
      const lowSchedule = await seedScheduleForLevel(lowLevel, { locationName: 'loc-3k-low' });

      const topSub = await seedActiveSubscription(top, parent, topSchedule._id);
      const midSub = await seedActiveSubscription(mid, parent, midSchedule._id);
      const lowSub = await seedActiveSubscription(low, parent, lowSchedule._id);

      const topResult = await calculateChargeAmount(top, 300, { mode: 'renewal', subscription: topSub });
      const midResult = await calculateChargeAmount(mid, 200, { mode: 'renewal', subscription: midSub });
      const lowResult = await calculateChargeAmount(low, 100, { mode: 'renewal', subscription: lowSub });

      expect(topResult.siblingDiscountApplied).toBe(false);
      expect(topResult.amount).toBe(300);
      expect(midResult.siblingDiscountApplied).toBe(true);
      expect(midResult.amount).toBe(180);
      expect(lowResult.siblingDiscountApplied).toBe(true);
      expect(lowResult.amount).toBe(90);
    });

    it('breaks an exact tie at the family max by earliest-enrolled-pays-full (CKQ ADR backend-002), regardless of studentId ordering', async () => {
      const level = await seedLevelWithPrice(150, { name: 'TieLevel', order: 1 });
      const parent = await seedParent('parent-tie-createdat@example.com');
      const studentA = await seedStudent(parent._id, { firstName: 'A' });
      const studentB = await seedStudent(parent._id, { firstName: 'B' });
      const scheduleA = await seedScheduleForLevel(level, { locationName: 'loc-tie-a' });
      const scheduleB = await seedScheduleForLevel(level, { locationName: 'loc-tie-b' });

      // B enrolled FIRST (earlier createdAt) even though A's studentId may
      // sort smaller — the old studentId-based tiebreak would pick
      // whichever has the lexicographically smaller id; this asserts the
      // NEW rule follows enrollment order instead, regardless of which way
      // that cuts against studentId ordering.
      const subB = await seedActiveSubscription(studentB, parent, scheduleB._id, {
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      const subA = await seedActiveSubscription(studentA, parent, scheduleA._id, {
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      });

      const resultFromA = await calculateChargeAmount(studentA, 150, { mode: 'renewal', subscription: subA });
      const resultFromB = await calculateChargeAmount(studentB, 150, { mode: 'renewal', subscription: subB });

      // B enrolled earlier -> B is the "top payer" (full price); A gets the
      // discount. Exactly one winner, symmetric regardless of which
      // student's perspective this is called from.
      expect(resultFromB.siblingDiscountApplied).toBe(false);
      expect(resultFromA.siblingDiscountApplied).toBe(true);
      expect(resultFromA.amount).toBe(135);
    });

    it('falls back to the smaller studentId on an exact createdAt tie', async () => {
      const level = await seedLevelWithPrice(150, { name: 'ExactTieLevel', order: 1 });
      const parent = await seedParent('parent-exact-tie@example.com');
      const studentA = await seedStudent(parent._id, { firstName: 'A' });
      const studentB = await seedStudent(parent._id, { firstName: 'B' });
      const scheduleA = await seedScheduleForLevel(level, { locationName: 'loc-exact-tie-a' });
      const scheduleB = await seedScheduleForLevel(level, { locationName: 'loc-exact-tie-b' });

      const sameInstant = new Date('2026-01-01T00:00:00.000Z');
      const subA = await seedActiveSubscription(studentA, parent, scheduleA._id, { createdAt: sameInstant });
      const subB = await seedActiveSubscription(studentB, parent, scheduleB._id, { createdAt: sameInstant });

      const resultFromA = await calculateChargeAmount(studentA, 150, { mode: 'renewal', subscription: subA });
      const resultFromB = await calculateChargeAmount(studentB, 150, { mode: 'renewal', subscription: subB });

      // The smaller studentId is the deterministic "winner" (pays full,
      // no discount) on an exact createdAt tie.
      const smallerIdIsA = String(studentA._id) < String(studentB._id);
      expect(resultFromA.siblingDiscountApplied).toBe(!smallerIdIsA);
      expect(resultFromB.siblingDiscountApplied).toBe(smallerIdIsA);
    });

    it('F3: excludes a pending-cancel sibling whose paid period has already ended', async () => {
      const pricierLevel = await seedLevelWithPrice(200, { name: 'F3Pricier', order: 2 });
      const parent = await seedParent('parent-f3-past@example.com');
      const thisStudent = await seedStudent(parent._id, { firstName: 'Remaining' });
      const sibling = await seedStudent(parent._id, { firstName: 'PendingCancelPast' });
      const siblingSchedule = await seedScheduleForLevel(pricierLevel, { locationName: 'loc-f3-past' });
      const thisSchedule = await seedScheduleForLevel(await seedLevelWithPrice(100, { name: 'F3This', order: 1 }), {
        locationName: 'loc-f3-past-this',
      });

      // Sibling's period ended in the past — only awaiting cron
      // finalization, no longer really "active" for discount purposes.
      await seedActiveSubscription(sibling, parent, siblingSchedule._id, {
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date('2020-01-01T00:00:00.000Z'),
      });
      const thisSubscription = await seedActiveSubscription(thisStudent, parent, thisSchedule._id);

      const result = await calculateChargeAmount(thisStudent, 100, { mode: 'renewal', subscription: thisSubscription });

      // No siblings counted at all -> no discount, not even the "lower
      // payer" outcome that would apply if the pricier sibling still
      // counted.
      expect(result).toEqual({ amount: 100, siblingDiscountApplied: false, siblingDiscountAmount: 0, reason: null });
    });

    it('F3: still counts a pending-cancel sibling whose paid period has NOT ended yet', async () => {
      const pricierLevel = await seedLevelWithPrice(200, { name: 'F3StillIn', order: 2 });
      const parent = await seedParent('parent-f3-still-in@example.com');
      const thisStudent = await seedStudent(parent._id, { firstName: 'Remaining2' });
      const sibling = await seedStudent(parent._id, { firstName: 'PendingCancelActive' });
      const siblingSchedule = await seedScheduleForLevel(pricierLevel, { locationName: 'loc-f3-active' });
      const thisSchedule = await seedScheduleForLevel(await seedLevelWithPrice(100, { name: 'F3ThisActive', order: 1 }), {
        locationName: 'loc-f3-active-this',
      });

      // Far-future period end -> still inside their paid period, mid-cycle
      // cancellation, correctly still "active" for discount purposes.
      await seedActiveSubscription(sibling, parent, siblingSchedule._id, {
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date('2099-01-01T00:00:00.000Z'),
      });
      const thisSubscription = await seedActiveSubscription(thisStudent, parent, thisSchedule._id);

      const result = await calculateChargeAmount(thisStudent, 100, { mode: 'renewal', subscription: thisSubscription });

      expect(result.siblingDiscountApplied).toBe(true);
      expect(result.amount).toBe(90);
    });

    it('F4: rounds the discount to cents rather than a raw repeating fraction', async () => {
      const pricierLevel = await seedLevelWithPrice(200, { name: 'RoundPricier', order: 2 });
      const parent = await seedParent('parent-rounding@example.com');
      const thisStudent = await seedStudent(parent._id, { firstName: 'RoundThis' });
      const sibling = await seedStudent(parent._id, { firstName: 'RoundSibling' });
      const siblingSchedule = await seedScheduleForLevel(pricierLevel, { locationName: 'loc-round-a' });
      const thisSchedule = await seedScheduleForLevel(await seedLevelWithPrice(149.99, { name: 'RoundThisLevel', order: 1 }), {
        locationName: 'loc-round-b',
      });
      await seedActiveSubscription(sibling, parent, siblingSchedule._id);
      const thisSubscription = await seedActiveSubscription(thisStudent, parent, thisSchedule._id);

      const result = await calculateChargeAmount(thisStudent, 149.99, { mode: 'renewal', subscription: thisSubscription });

      expect(result.siblingDiscountAmount).toBe(15);
      expect(result.amount).toBe(134.99);
    });

    it('re-verifies live: losing the discount once the discount-granting sibling is cancelled, never reading a cached/stale value', async () => {
      const pricierLevel = await seedLevelWithPrice(200, { name: 'ReverifyPricier', order: 2 });
      const parent = await seedParent('parent-reverify@example.com');
      const remainingStudent = await seedStudent(parent._id, { firstName: 'Cheaper' });
      const activeSibling = await seedStudent(parent._id, { firstName: 'Pricier' });
      const siblingSchedule = await seedScheduleForLevel(pricierLevel, { locationName: 'loc-reverify' });
      const thisSchedule = await seedScheduleForLevel(await seedLevelWithPrice(100, { name: 'ReverifyThis', order: 1 }), {
        locationName: 'loc-reverify-this',
      });
      const siblingSubscription = await seedActiveSubscription(activeSibling, parent, siblingSchedule._id);
      const thisSubscription = await seedActiveSubscription(remainingStudent, parent, thisSchedule._id);

      const beforeCancel = await calculateChargeAmount(remainingStudent, 100, { mode: 'renewal', subscription: thisSubscription });
      expect(beforeCancel).toEqual({
        amount: 90,
        siblingDiscountApplied: true,
        siblingDiscountAmount: 10,
        reason: 'This is the lower-priced plan among your active children, so the 10% sibling discount applies here.',
      });

      siblingSubscription.status = 'cancelled';
      await siblingSubscription.save();

      const afterCancel = await calculateChargeAmount(remainingStudent, 100, { mode: 'renewal', subscription: thisSubscription });

      expect(afterCancel).toEqual({ amount: 100, siblingDiscountApplied: false, siblingDiscountAmount: 0, reason: null });
    });
  });

  describe("mode: 'registration' — the family discount always applies (ADR 006 bridge)", () => {
    it('new child is the LOWER payer: 10% off their own (new) fee', async () => {
      const pricierLevel = await seedLevelWithPrice(200, { name: 'RegLowerPricier', order: 2 });
      const parent = await seedParent('parent-reg-lower@example.com');
      const existingChild = await seedStudent(parent._id, { firstName: 'Existing' });
      const newChild = await seedStudent(parent._id, { firstName: 'New' });
      const existingSchedule = await seedScheduleForLevel(pricierLevel, { locationName: 'loc-reg-lower-a' });
      await seedActiveSubscription(existingChild, parent, existingSchedule._id);

      const result = await calculateChargeAmount(newChild, 100, { mode: 'registration' });

      expect(result).toEqual({
        amount: 90,
        siblingDiscountApplied: true,
        siblingDiscountAmount: 10,
        reason: 'This is the lower-priced plan among your active children, so the 10% sibling discount applies here.',
      });
    });

    it('new child is the HIGHER payer: the bridge — 10% off the EXISTING sibling\'s lower fee comes off THIS bill, with a distinct reason', async () => {
      const cheapLevel = await seedLevelWithPrice(100, { name: 'RegHigherCheap', order: 1 });
      const parent = await seedParent('parent-reg-higher@example.com');
      const existingChild = await seedStudent(parent._id, { firstName: 'ExistingCheap' });
      const newChild = await seedStudent(parent._id, { firstName: 'NewPricier' });
      const existingSchedule = await seedScheduleForLevel(cheapLevel, { locationName: 'loc-reg-higher-a' });
      await seedActiveSubscription(existingChild, parent, existingSchedule._id);

      const result = await calculateChargeAmount(newChild, 200, { mode: 'registration' });

      // 10% of the LOWER (existing sibling's) fee, 100 -> 10, off the new
      // child's 200 bill -> 190. NOT 10% of 200.
      expect(result).toEqual({
        amount: 190,
        siblingDiscountApplied: true,
        siblingDiscountAmount: 10,
        reason: "Your family's 10% sibling discount applies to this registration, based on your other child's lower-priced plan.",
      });
    });

    it('applies to a PRORATED fee below the sibling fee — 10% of the prorated amount, not the raw list price', async () => {
      const pricierLevel = await seedLevelWithPrice(200, { name: 'RegProratedPricier', order: 2 });
      const parent = await seedParent('parent-reg-prorated@example.com');
      const existingChild = await seedStudent(parent._id, { firstName: 'ExistingProrated' });
      const newChild = await seedStudent(parent._id, { firstName: 'NewProrated' });
      const existingSchedule = await seedScheduleForLevel(pricierLevel, { locationName: 'loc-reg-prorated-a' });
      await seedActiveSubscription(existingChild, parent, existingSchedule._id);

      // feeNow here simulates an already-prorated amount (e.g. $45 of a
      // $150 list price) — this function never knows or cares whether the
      // caller prorated first; it just compares whatever fee it's given.
      const result = await calculateChargeAmount(newChild, 45, { mode: 'registration' });

      expect(result.amount).toBe(40.5);
      expect(result.siblingDiscountAmount).toBe(4.5);
    });

    it('3-kid bridge: min(newFee, topExistingFee) in both directions', async () => {
      const parent = await seedParent('parent-reg-3kid-bridge@example.com');
      const existingLow = await seedStudent(parent._id, { firstName: 'ExistingLow' });
      const existingHigh = await seedStudent(parent._id, { firstName: 'ExistingHigh' });
      const newChild = await seedStudent(parent._id, { firstName: 'NewMid' });

      const lowLevel = await seedLevelWithPrice(100, { name: 'Bridge3Low', order: 1 });
      const highLevel = await seedLevelWithPrice(300, { name: 'Bridge3High', order: 2 });
      const lowSchedule = await seedScheduleForLevel(lowLevel, { locationName: 'loc-bridge3-low' });
      const highSchedule = await seedScheduleForLevel(highLevel, { locationName: 'loc-bridge3-high' });

      await seedActiveSubscription(existingLow, parent, lowSchedule._id);
      await seedActiveSubscription(existingHigh, parent, highSchedule._id);

      // New child's fee (200) sits between the two existing fees — the
      // family's current top is 300, so base = min(200, 300) = 200 (the
      // new child's OWN fee, since it's still below the family max).
      const result = await calculateChargeAmount(newChild, 200, { mode: 'registration' });

      expect(result.siblingDiscountAmount).toBe(20);
      expect(result.amount).toBe(180);
    });

    it('never returns a negative amount', async () => {
      const level = await seedLevelWithPrice(50, { name: 'NeverNegative', order: 1 });
      const parent = await seedParent('parent-reg-never-negative@example.com');
      const existingChild = await seedStudent(parent._id, { firstName: 'ExistingSmall' });
      const newChild = await seedStudent(parent._id, { firstName: 'NewSmall' });
      const schedule = await seedScheduleForLevel(level, { locationName: 'loc-never-negative' });
      await seedActiveSubscription(existingChild, parent, schedule._id);

      const result = await calculateChargeAmount(newChild, 1, { mode: 'registration' });

      expect(result.amount).toBeGreaterThanOrEqual(0);
    });
  });
});
