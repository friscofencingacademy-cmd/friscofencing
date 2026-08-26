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
// something real to traverse.
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

async function seedActiveSubscription(student, parent, scheduleId) {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const currentPeriodEnd = new Date('2026-02-01T00:00:00.000Z');

  return Subscription.create({
    studentId: student._id,
    scheduleId,
    parentId: parent._id,
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodStart: now,
    currentPeriodEnd,
    nextBillingDate: currentPeriodEnd,
  });
}

describe('calculateChargeAmount', () => {
  it('returns full price with no discount when the student has no siblings with an active subscription', async () => {
    const parent = await seedParent('parent-no-sibling@example.com');
    const student = await seedStudent(parent._id);

    const result = await calculateChargeAmount(student, 150);

    expect(result).toEqual({
      amount: 150,
      siblingDiscountApplied: false,
      siblingDiscountAmount: 0,
      reason: null,
    });
  });

  it('gives THIS student the 10% discount when their sibling has a strictly higher current fee', async () => {
    const pricierLevel = await seedLevelWithPrice(200, { name: 'Pricier', order: 2 });

    const parent = await seedParent('parent-cheaper-wins@example.com');
    const thisStudent = await seedStudent(parent._id, { firstName: 'Cheaper' });
    const sibling = await seedStudent(parent._id, { firstName: 'Pricier' });

    const siblingSchedule = await seedScheduleForLevel(pricierLevel, {
      locationName: 'loc-a',
      scheduleName: 'Pricier Class',
    });
    await seedActiveSubscription(sibling, parent, siblingSchedule._id);

    // thisStudent's own price (100) is strictly lower than the sibling's
    // current fee (200) -> thisStudent wins the discount.
    const result = await calculateChargeAmount(thisStudent, 100);

    expect(result).toEqual({
      amount: 90,
      siblingDiscountApplied: true,
      siblingDiscountAmount: 10,
      reason: 'This is the lower-priced plan among your active children, so the 10% sibling discount applies here.',
    });
  });

  it('charges THIS student full price when their sibling has a strictly lower current fee', async () => {
    const cheapLevel = await seedLevelWithPrice(100, { name: 'Cheap', order: 1 });

    const parent = await seedParent('parent-pricier-loses@example.com');
    const thisStudent = await seedStudent(parent._id, { firstName: 'Pricier' });
    const sibling = await seedStudent(parent._id, { firstName: 'Cheaper' });

    const siblingSchedule = await seedScheduleForLevel(cheapLevel, {
      locationName: 'loc-b',
      scheduleName: 'Cheap Class',
    });
    await seedActiveSubscription(sibling, parent, siblingSchedule._id);

    // thisStudent's own price (200) is strictly higher than the sibling's
    // current fee (100) -> the sibling wins the discount, not thisStudent.
    const result = await calculateChargeAmount(thisStudent, 200);

    expect(result).toEqual({
      amount: 200,
      siblingDiscountApplied: false,
      siblingDiscountAmount: 0,
      reason: 'Your other child has the lower-priced plan, so the sibling discount applies to their plan instead.',
    });
  });

  it('breaks an exact price tie deterministically by studentId, so calling from EITHER sibling\'s perspective produces exactly one winner', async () => {
    const level = await seedLevelWithPrice(150, { name: 'Tie Level', order: 1 });

    const parent = await seedParent('parent-tie@example.com');
    const studentA = await seedStudent(parent._id, { firstName: 'A' });
    const studentB = await seedStudent(parent._id, { firstName: 'B' });

    const scheduleA = await seedScheduleForLevel(level, {
      locationName: 'loc-tie-a',
      scheduleName: 'Tie Class A',
    });
    const scheduleB = await seedScheduleForLevel(level, {
      locationName: 'loc-tie-b',
      scheduleName: 'Tie Class B',
    });

    await seedActiveSubscription(studentA, parent, scheduleA._id);
    await seedActiveSubscription(studentB, parent, scheduleB._id);

    // Call once from A's perspective, once from B's perspective, at the same
    // (tied) price. Exactly one of the two must come back with the discount
    // — this is the test that catches the double-discount bug if the
    // tie-break were implemented as "am I <= my sibling" from each side
    // independently, which would let BOTH sides win simultaneously.
    const resultFromA = await calculateChargeAmount(studentA, 150);
    const resultFromB = await calculateChargeAmount(studentB, 150);

    expect([resultFromA.siblingDiscountApplied, resultFromB.siblingDiscountApplied]).toContain(
      true
    );
    expect(
      resultFromA.siblingDiscountApplied && resultFromB.siblingDiscountApplied
    ).toBe(false);

    const expectedWinnerIsA = String(studentA._id) < String(studentB._id);

    expect(resultFromA.siblingDiscountApplied).toBe(expectedWinnerIsA);
    expect(resultFromB.siblingDiscountApplied).toBe(!expectedWinnerIsA);
  });

  it('re-verifies live: losing the discount once the discount-granting sibling is cancelled, never reading a cached/stale value', async () => {
    const pricierLevel = await seedLevelWithPrice(200, { name: 'Pricier', order: 2 });

    const parent = await seedParent('parent-reverify@example.com');
    // `remainingStudent` is the cheaper-priced student, who should win the
    // discount as long as their pricier sibling has an active subscription.
    const remainingStudent = await seedStudent(parent._id, { firstName: 'Cheaper' });
    const activeSibling = await seedStudent(parent._id, { firstName: 'Pricier' });

    const siblingSchedule = await seedScheduleForLevel(pricierLevel, {
      locationName: 'loc-reverify',
      scheduleName: 'Pricier Class Reverify',
    });
    const siblingSubscription = await seedActiveSubscription(
      activeSibling,
      parent,
      siblingSchedule._id
    );

    const beforeCancel = await calculateChargeAmount(remainingStudent, 100);
    expect(beforeCancel).toEqual({
      amount: 90,
      siblingDiscountApplied: true,
      siblingDiscountAmount: 10,
      reason: 'This is the lower-priced plan among your active children, so the 10% sibling discount applies here.',
    });

    siblingSubscription.status = 'cancelled';
    await siblingSubscription.save();

    const afterCancel = await calculateChargeAmount(remainingStudent, 100);

    expect(afterCancel).toEqual({
      amount: 100,
      siblingDiscountApplied: false,
      siblingDiscountAmount: 0,
      reason: null,
    });
  });
});
