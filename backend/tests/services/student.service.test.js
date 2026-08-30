const mongoose = require('mongoose');

const studentService = require('../../src/services/student.service');
const User = require('../../src/models/user.model');
const GroupClassSchedule = require('../../src/models/groupClassSchedule.model');
const GroupClassSession = require('../../src/models/groupClassSession.model');
const Subscription = require('../../src/models/subscription.model');
const TrialClass = require('../../src/models/trialClass.model');
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
});

// Fakes ONLY Date (via `now`), leaving every timer function real — same
// technique groupClassSession.routes.test.js uses; faking setTimeout/
// setImmediate/nextTick here would hang the real Mongo driver this suite's
// mongodb-memory-server connection depends on.
const DO_NOT_FAKE = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick'];

async function makeParent(suffix) {
  return User.create({
    role: 'parent',
    firstName: 'Parent',
    lastName: suffix,
    email: `parent-${suffix}@example.com`,
    passwordHash: await hashPassword('irrelevant-password'),
  });
}

async function makeStudent(parentId, suffix) {
  return User.create({ role: 'student', firstName: 'Kid', lastName: suffix, parentId });
}

// classId/coachId don't need to resolve to a real doc — attachEnrollment
// never populates them, only dayOfWeek/startTime/endTime.
async function makeSchedule(overrides = {}) {
  return GroupClassSchedule.create({
    classId: new mongoose.Types.ObjectId(),
    coachId: new mongoose.Types.ObjectId(),
    dayOfWeek: 3,
    startTime: '16:00',
    endTime: '17:00',
    ...overrides,
  });
}

async function makeActiveSubscription(studentId, parentId, scheduleId) {
  return Subscription.create({
    studentId,
    scheduleId,
    parentId,
    status: 'active',
    currentPeriodStart: new Date('2026-08-01'),
    currentPeriodEnd: new Date('2026-09-01'),
    nextBillingDate: new Date('2026-09-01'),
  });
}

async function makeSession(date) {
  return GroupClassSession.create({ scheduleId: new mongoose.Types.ObjectId(), date });
}

function findResult(results, studentId) {
  return results.find((result) => String(result._id) === String(studentId));
}

describe('student.service — listMine() enrollment', () => {
  it('returns "enrolled" with the schedule details for a student with an active subscription', async () => {
    const parent = await makeParent('enrolled');
    const student = await makeStudent(parent._id, 'Enrolled');
    const schedule = await makeSchedule({ dayOfWeek: 2, startTime: '16:00', endTime: '17:00' });
    await makeActiveSubscription(student._id, parent._id, schedule._id);

    const [result] = await studentService.listMine(parent._id);

    expect(result.enrollment).toEqual({
      status: 'enrolled',
      canBookTrial: false,
      schedule: { dayOfWeek: 2, startTime: '16:00', endTime: '17:00' },
    });
  });

  it('returns "not_enrolled" with canBookTrial true when neither an active subscription nor any trial exists', async () => {
    const parent = await makeParent('none');
    await makeStudent(parent._id, 'None');

    const [result] = await studentService.listMine(parent._id);

    expect(result.enrollment).toEqual({ status: 'not_enrolled', canBookTrial: true, schedule: null });
  });

  // Named per TESTING_STRATEGY's regression-naming convention — the bug the
  // original design brief missed: TrialClass has no status field, so a
  // trial from months ago read as "Trial class scheduled" forever before
  // this PR.
  describe('stale "Trial class scheduled" regression (bug fix)', () => {
    it('returns "trial_scheduled" for a trial whose session date is today (Central time)', async () => {
      jest.useFakeTimers({ now: new Date('2026-08-25T12:00:00.000Z'), doNotFake: DO_NOT_FAKE }); // midday UTC

      try {
        const parent = await makeParent('trial-today');
        const student = await makeStudent(parent._id, 'TrialToday');
        const session = await makeSession(new Date('2026-08-25')); // today, Central
        await TrialClass.create({ studentId: student._id, sessionId: session._id });

        const [result] = await studentService.listMine(parent._id);

        expect(result.enrollment).toEqual({ status: 'trial_scheduled', canBookTrial: false, schedule: null });
      } finally {
        jest.useRealTimers();
      }
    });

    it('returns "trial_completed" — not "trial_scheduled" forever — for a trial whose session date has already passed', async () => {
      jest.useFakeTimers({ now: new Date('2026-08-25T12:00:00.000Z'), doNotFake: DO_NOT_FAKE });

      try {
        const parent = await makeParent('trial-past');
        const student = await makeStudent(parent._id, 'TrialPast');
        const session = await makeSession(new Date('2026-06-01')); // months ago
        await TrialClass.create({ studentId: student._id, sessionId: session._id });

        const [result] = await studentService.listMine(parent._id);

        expect(result.enrollment).toEqual({ status: 'trial_completed', canBookTrial: false, schedule: null });
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('canBookTrial', () => {
    it('is false for a trial-completed-but-unenrolled student — the previously-impossible combination this PR makes real', async () => {
      jest.useFakeTimers({ now: new Date('2026-08-25T12:00:00.000Z'), doNotFake: DO_NOT_FAKE });

      try {
        const parent = await makeParent('completed-no-cta');
        const student = await makeStudent(parent._id, 'CompletedNoCta');
        const session = await makeSession(new Date('2026-01-01'));
        await TrialClass.create({ studentId: student._id, sessionId: session._id });

        const [result] = await studentService.listMine(parent._id);

        expect(result.enrollment.status).toBe('trial_completed');
        expect(result.enrollment.canBookTrial).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    it('is false for an enrolled student', async () => {
      const parent = await makeParent('enrolled-no-cta');
      const student = await makeStudent(parent._id, 'EnrolledNoCta');
      const schedule = await makeSchedule();
      await makeActiveSubscription(student._id, parent._id, schedule._id);

      const [result] = await studentService.listMine(parent._id);

      expect(result.enrollment.canBookTrial).toBe(false);
    });

    it('is true only when neither an active subscription nor any trial record exists', async () => {
      const parent = await makeParent('cta-true');
      await makeStudent(parent._id, 'CtaTrue');

      const [result] = await studentService.listMine(parent._id);

      expect(result.enrollment.canBookTrial).toBe(true);
    });
  });

  describe('batching — one call resolves every child correctly, no per-student loop', () => {
    it('resolves independent, correct enrollment for two students of the same parent in a single call', async () => {
      const parent = await makeParent('batch');
      const enrolledStudent = await makeStudent(parent._id, 'BatchEnrolled');
      const notEnrolledStudent = await makeStudent(parent._id, 'BatchNotEnrolled');
      const schedule = await makeSchedule({ dayOfWeek: 4, startTime: '17:00', endTime: '18:00' });
      await makeActiveSubscription(enrolledStudent._id, parent._id, schedule._id);

      const results = await studentService.listMine(parent._id);

      expect(results).toHaveLength(2);
      expect(findResult(results, enrolledStudent._id).enrollment.status).toBe('enrolled');
      expect(findResult(results, notEnrolledStudent._id).enrollment).toEqual({
        status: 'not_enrolled',
        canBookTrial: true,
        schedule: null,
      });
    });

    it('issues exactly two queries total regardless of household size — never a per-student loop', async () => {
      const parent = await makeParent('batch-query-count');
      const schedule = await makeSchedule();
      const students = await Promise.all(
        Array.from({ length: 4 }, (_, i) => makeStudent(parent._id, `BatchQuery${i}`))
      );
      await makeActiveSubscription(students[0]._id, parent._id, schedule._id);

      const subscriptionFindSpy = jest.spyOn(Subscription, 'find');
      const trialFindSpy = jest.spyOn(TrialClass, 'find');

      await studentService.listMine(parent._id);

      expect(subscriptionFindSpy).toHaveBeenCalledTimes(1);
      expect(trialFindSpy).toHaveBeenCalledTimes(1);

      subscriptionFindSpy.mockRestore();
      trialFindSpy.mockRestore();
    });
  });

  describe('orphaned references (docs/plans/orphaned-coach-reference-fix-plan.md pattern) — degrade, never throw', () => {
    it('keeps "enrolled" but drops the schedule display when an active subscription\'s schedule was deleted', async () => {
      const parent = await makeParent('orphan-sub');
      const student = await makeStudent(parent._id, 'OrphanSub');
      const schedule = await makeSchedule();
      await makeActiveSubscription(student._id, parent._id, schedule._id);
      await GroupClassSchedule.findByIdAndDelete(schedule._id);

      const [result] = await studentService.listMine(parent._id);

      expect(result.enrollment).toEqual({ status: 'enrolled', canBookTrial: false, schedule: null });
    });

    it('keeps canBookTrial false (never a doomed-retry CTA) when a trial\'s session was deleted', async () => {
      const parent = await makeParent('orphan-trial');
      const student = await makeStudent(parent._id, 'OrphanTrial');
      const session = await makeSession(new Date('2026-01-01'));
      await TrialClass.create({ studentId: student._id, sessionId: session._id });
      await GroupClassSession.findByIdAndDelete(session._id);

      const [result] = await studentService.listMine(parent._id);

      expect(result.enrollment).toEqual({ status: 'trial_completed', canBookTrial: false, schedule: null });
    });
  });
});
