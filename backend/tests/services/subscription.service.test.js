process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

// mail.service is mocked wholesale here (not nodemailer) — this suite's
// point is changeSchedule()'s WRITES (subscription pointer, registration
// pointer, old/new roster + sessions), not email content (that's covered
// in subscription.routes.test.js and mail.service.test.js). Mocking at this
// boundary also lets the "email failure never fails the change" regression
// force a rejection cleanly.
jest.mock('../../src/services/mail.service');

const mongoose = require('mongoose');

const subscriptionService = require('../../src/services/subscription.service');
const mailService = require('../../src/services/mail.service');
const User = require('../../src/models/user.model');
const Level = require('../../src/models/level.model');
const Location = require('../../src/models/location.model');
const GroupClass = require('../../src/models/groupClass.model');
const GroupClassSchedule = require('../../src/models/groupClassSchedule.model');
const GroupClassSession = require('../../src/models/groupClassSession.model');
const Registration = require('../../src/models/registration.model');
const Subscription = require('../../src/models/subscription.model');
const { hashPassword } = require('../../src/utils/password');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

afterEach(async () => {
  await clearTestDB();
  jest.clearAllMocks();
});

async function makeCoach(suffix) {
  return User.create({
    role: 'coach',
    firstName: 'Coach',
    lastName: suffix,
    email: `coach-${suffix}-${Date.now()}-${Math.random()}@example.com`,
    passwordHash: await hashPassword('irrelevant-password'),
  });
}

// Builds a real level/location/class/schedule + 8 generated sessions
// (mirrors groupClassSchedule.service.js's create(), the same generator
// production uses) so "future sessions get the roster pull/push" is a real
// property of the generator's output, not a hand-rolled fixture.
async function makeSchedule({ levelId, capacity = 10, suffix }) {
  const location = await Location.create({ name: `HQ ${suffix}`, address: '1 Main St' });
  const groupClass = await GroupClass.create({
    name: `Class ${suffix}`,
    levelId,
    locationId: location._id,
    capacity,
  });
  const coach = await makeCoach(suffix);

  const scheduleService = require('../../src/services/groupClassSchedule.service');
  const schedule = await scheduleService.create({
    classId: groupClass._id,
    coachId: coach._id,
    dayOfWeek: 3,
    startTime: '16:00',
    endTime: '17:00',
    students: [],
  });

  return { schedule, groupClass, coach };
}

async function makeParentAndStudent(suffix) {
  const parent = await User.create({
    role: 'parent',
    firstName: 'Parent',
    lastName: suffix,
    email: `parent-${suffix}-${Date.now()}-${Math.random()}@example.com`,
    passwordHash: await hashPassword('irrelevant-password'),
  });
  const student = await User.create({
    role: 'student',
    firstName: 'Student',
    lastName: suffix,
    parentId: parent._id,
  });

  return { parent, student };
}

async function enroll({ level, oldSchedule, groupClass, student, parent }) {
  await GroupClassSchedule.findByIdAndUpdate(oldSchedule._id, { $addToSet: { students: student._id } });
  await GroupClassSession.updateMany(
    { scheduleId: oldSchedule._id },
    { $push: { students: { studentId: student._id, isPresent: false } } }
  );

  const registration = await Registration.create({
    studentId: student._id,
    scheduleId: oldSchedule._id,
    status: 'active',
  });

  const subscription = await Subscription.create({
    studentId: student._id,
    scheduleId: oldSchedule._id,
    parentId: parent._id,
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
    nextBillingDate: new Date('2026-02-01T00:00:00.000Z'),
  });

  return { registration, subscription };
}

describe('subscription.service — changeSchedule', () => {
  it('performs all four writes on a same-level schedule change: subscription pointer, registration pointer, old roster+sessions pulled, new roster+sessions pushed', async () => {
    const level = await Level.create({ name: 'SameLevel', order: 1 });
    const { schedule: oldSchedule, groupClass: oldClass } = await makeSchedule({
      levelId: level._id,
      suffix: 'old',
    });
    const { schedule: newSchedule, groupClass: newClass } = await makeSchedule({
      levelId: level._id,
      suffix: 'new',
    });
    const { parent, student } = await makeParentAndStudent('happy');
    const { registration, subscription } = await enroll({
      level,
      oldSchedule,
      groupClass: oldClass,
      student,
      parent,
    });

    const result = await subscriptionService.changeSchedule(subscription._id, newSchedule._id);

    expect(String(result.scheduleId._id || result.scheduleId)).toBe(String(newSchedule._id));

    const updatedSubscription = await Subscription.findById(subscription._id);
    expect(String(updatedSubscription.scheduleId)).toBe(String(newSchedule._id));

    const updatedRegistration = await Registration.findById(registration._id);
    expect(String(updatedRegistration.scheduleId)).toBe(String(newSchedule._id));

    const oldScheduleAfter = await GroupClassSchedule.findById(oldSchedule._id);
    expect(oldScheduleAfter.students.map(String)).not.toContain(String(student._id));

    const oldSessionsAfter = await GroupClassSession.find({ scheduleId: oldSchedule._id });
    oldSessionsAfter.forEach((session) => {
      expect(session.students.some((e) => String(e.studentId) === String(student._id))).toBe(false);
    });

    const newScheduleAfter = await GroupClassSchedule.findById(newSchedule._id);
    expect(newScheduleAfter.students.map(String)).toContain(String(student._id));

    const newSessionsAfter = await GroupClassSession.find({ scheduleId: newSchedule._id });
    expect(newSessionsAfter.length).toBeGreaterThan(0);
    newSessionsAfter.forEach((session) => {
      expect(session.students.some((e) => String(e.studentId) === String(student._id))).toBe(true);
    });

    // Billing untouched — same level, same price.
    expect(updatedSubscription.lastChargeAmount).toBeNull();

    // Email carries both the old and new schedule/class context.
    expect(mailService.sendScheduleChangeConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        old: expect.objectContaining({ groupClass: expect.objectContaining({ name: oldClass.name }) }),
        next: expect.objectContaining({ groupClass: expect.objectContaining({ name: newClass.name }) }),
      })
    );
  });

  it('returns 409 when the new schedule belongs to a different level', async () => {
    const levelA = await Level.create({ name: 'LevelA', order: 2 });
    const levelB = await Level.create({ name: 'LevelB', order: 3 });
    const { schedule: oldSchedule, groupClass } = await makeSchedule({ levelId: levelA._id, suffix: 'a' });
    const { schedule: newSchedule } = await makeSchedule({ levelId: levelB._id, suffix: 'b' });
    const { parent, student } = await makeParentAndStudent('samelevel');
    const { subscription } = await enroll({ oldSchedule, groupClass, student, parent });

    await expect(
      subscriptionService.changeSchedule(subscription._id, newSchedule._id)
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('same level') });

    const unchanged = await Subscription.findById(subscription._id);
    expect(String(unchanged.scheduleId)).toBe(String(oldSchedule._id));
  });

  it('returns 409 when the new schedule is at capacity', async () => {
    const level = await Level.create({ name: 'CapLevel', order: 4 });
    const { schedule: oldSchedule, groupClass } = await makeSchedule({ levelId: level._id, suffix: 'capold' });
    const { schedule: newSchedule } = await makeSchedule({
      levelId: level._id,
      suffix: 'capnew',
      capacity: 1,
    });
    const { parent, student } = await makeParentAndStudent('cap1');
    const { subscription } = await enroll({ oldSchedule, groupClass, student, parent });

    // Fill the new schedule to capacity with a different student first.
    const filler = await User.create({ role: 'student', firstName: 'Filler', lastName: 'Kid' });
    await GroupClassSchedule.findByIdAndUpdate(newSchedule._id, { $addToSet: { students: filler._id } });

    await expect(
      subscriptionService.changeSchedule(subscription._id, newSchedule._id)
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('capacity') });
  });

  it('returns 409 when the student already has an active subscription on the target schedule', async () => {
    const level = await Level.create({ name: 'DupLevel', order: 5 });
    const { schedule: oldSchedule, groupClass } = await makeSchedule({ levelId: level._id, suffix: 'dupold' });
    const { schedule: newSchedule } = await makeSchedule({ levelId: level._id, suffix: 'dupnew' });
    const { parent, student } = await makeParentAndStudent('dup1');
    const { subscription } = await enroll({ oldSchedule, groupClass, student, parent });

    await Subscription.create({
      studentId: student._id,
      scheduleId: newSchedule._id,
      parentId: parent._id,
      status: 'active',
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
      nextBillingDate: new Date('2026-02-01T00:00:00.000Z'),
    });

    await expect(
      subscriptionService.changeSchedule(subscription._id, newSchedule._id)
    ).rejects.toMatchObject({ status: 409 });
  });

  it('returns 409 when the subscription is not active (already cancelled)', async () => {
    const level = await Level.create({ name: 'InactiveLevel', order: 6 });
    const { schedule: oldSchedule, groupClass } = await makeSchedule({ levelId: level._id, suffix: 'inold' });
    const { schedule: newSchedule } = await makeSchedule({ levelId: level._id, suffix: 'innew' });
    const { parent, student } = await makeParentAndStudent('inactive1');
    const { subscription } = await enroll({ oldSchedule, groupClass, student, parent });

    subscription.status = 'cancelled';
    await subscription.save();

    await expect(
      subscriptionService.changeSchedule(subscription._id, newSchedule._id)
    ).rejects.toMatchObject({ status: 409 });
  });

  it('a pending-cancel (but still active) subscription CAN change schedules', async () => {
    const level = await Level.create({ name: 'PendingLevel', order: 7 });
    const { schedule: oldSchedule, groupClass } = await makeSchedule({ levelId: level._id, suffix: 'pold' });
    const { schedule: newSchedule } = await makeSchedule({ levelId: level._id, suffix: 'pnew' });
    const { parent, student } = await makeParentAndStudent('pending1');
    const { subscription } = await enroll({ oldSchedule, groupClass, student, parent });

    subscription.cancelAtPeriodEnd = true;
    await subscription.save();

    const result = await subscriptionService.changeSchedule(subscription._id, newSchedule._id);
    expect(String(result.scheduleId._id || result.scheduleId)).toBe(String(newSchedule._id));
  });

  it('the schedule change still succeeds even when the confirmation email send throws', async () => {
    mailService.sendScheduleChangeConfirmationEmail.mockRejectedValueOnce(new Error('boom'));

    const level = await Level.create({ name: 'EmailFailLevel', order: 8 });
    const { schedule: oldSchedule, groupClass } = await makeSchedule({ levelId: level._id, suffix: 'efold' });
    const { schedule: newSchedule } = await makeSchedule({ levelId: level._id, suffix: 'efnew' });
    const { parent, student } = await makeParentAndStudent('emailfail1');
    const { subscription } = await enroll({ oldSchedule, groupClass, student, parent });

    const result = await subscriptionService.changeSchedule(subscription._id, newSchedule._id);

    expect(String(result.scheduleId._id || result.scheduleId)).toBe(String(newSchedule._id));

    const updated = await Subscription.findById(subscription._id);
    expect(String(updated.scheduleId)).toBe(String(newSchedule._id));
  });

  it('returns 404 for an unknown subscription id', async () => {
    await expect(
      subscriptionService.changeSchedule(new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId())
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns 409 when newScheduleId equals the current schedule', async () => {
    const level = await Level.create({ name: 'SameSchedLevel', order: 9 });
    const { schedule: oldSchedule, groupClass } = await makeSchedule({ levelId: level._id, suffix: 'same' });
    const { parent, student } = await makeParentAndStudent('samesched1');
    const { subscription } = await enroll({ oldSchedule, groupClass, student, parent });

    await expect(
      subscriptionService.changeSchedule(subscription._id, oldSchedule._id)
    ).rejects.toMatchObject({ status: 409 });
  });
});
