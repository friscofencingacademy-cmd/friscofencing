process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

const request = require('supertest');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const Level = require('../../src/models/level.model');
const Location = require('../../src/models/location.model');
const GroupClass = require('../../src/models/groupClass.model');
const GroupClassSession = require('../../src/models/groupClassSession.model');
const GroupClassSchedule = require('../../src/models/groupClassSchedule.model');
const Visit = require('../../src/models/visit.model');
const Subscription = require('../../src/models/subscription.model');
const Holiday = require('../../src/models/holiday.model');
const { hashPassword } = require('../../src/utils/password');
const { addStudentToRoster } = require('../../src/services/roster.service');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');
const { createSession, makeSessionAttendable } = require('../testUtils/sessions');

const TEST_PASSWORD = 'correct-password';

// Fakes ONLY Date, leaving every timer real — the real Mongo driver and
// supertest's HTTP round trip need them.
const REAL_TIMERS = [
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
  'nextTick',
];

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

async function seedAdmin(overrides = {}) {
  const passwordHash = await hashPassword(TEST_PASSWORD);

  return User.create({
    role: 'admin',
    firstName: 'Test',
    lastName: 'Admin',
    email: 'test-admin@example.com',
    passwordHash,
    ...overrides,
  });
}

async function loginAgent(email) {
  const agent = request.agent(app);

  await agent.post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD });

  return agent;
}

async function seedClass() {
  const level = await Level.create({ name: 'Beginner', order: 1 });
  const location = await Location.create({ name: 'Frisco HQ', address: '123 Main St' });

  return GroupClass.create({
    name: 'Beginner Foil',
    levelId: level._id,
    locationId: location._id,
    capacity: 10,
  });
}

// Builds a schedule (via the real create route, so sessions are generated
// the same way production does — no inline `students` in the create
// payload, since the real admin UI never sends one; createSchedule's own
// type Picks only classId/coachId/dayOfWeek/startTime/endTime) with an
// assigned coach and two enrolled students, and returns everything a test
// needs to exercise attendance marking against the first generated session.
// Enrollment goes through the real roster.service.js helper (the same one
// registration.service.js uses) so each student gets a real
// GroupClassSchedule.students entry AND scheduled Visit rows across every
// generated session — exactly what a real registration produces.
async function seedScheduleWithSession(adminAgent) {
  const groupClass = await seedClass();

  const coach = await User.create({
    role: 'coach',
    firstName: 'Assigned',
    lastName: 'Coach',
    email: 'assigned-coach@example.com',
    passwordHash: await hashPassword(TEST_PASSWORD),
  });

  const otherCoach = await User.create({
    role: 'coach',
    firstName: 'Other',
    lastName: 'Coach',
    email: 'other-coach@example.com',
    passwordHash: await hashPassword(TEST_PASSWORD),
  });

  const student1 = await User.create({ role: 'student', firstName: 'Ada', lastName: 'One' });
  const student2 = await User.create({ role: 'student', firstName: 'Ben', lastName: 'Two' });

  const createRes = await adminAgent.post('/api/v1/group-class-schedules').send({
    classId: groupClass._id.toString(),
    coachId: coach._id.toString(),
    dayOfWeek: 3,
    startTime: '16:00',
    endTime: '17:00',
  });

  expect(createRes.status).toBe(201);
  const scheduleId = createRes.body.schedule._id;

  const schedule = await GroupClassSchedule.findById(scheduleId);
  await addStudentToRoster(schedule, student1._id);
  await addStudentToRoster(schedule, student2._id);

  // The LAST generated session — always weeks ahead, so the roster helper
  // (which only creates Visits for not-yet-started sessions) has always
  // created its Visits; sessions[0] may be today's occurrence, which would
  // make these tests depend on the day they run. It is then made attendable
  // (moved to a fixed past day — attendance opens on a session's own day,
  // docs/plans/duplication-cleanup-plan.md A-D1). The second-to-last session
  // stays weeks ahead: tests that need a CLOSED session use `closedSessionId`.
  const sessions = await GroupClassSession.find({ scheduleId }).sort({ date: 1 });
  const session = await makeSessionAttendable(sessions[sessions.length - 1], schedule);
  const closedSession = sessions[sessions.length - 2];

  return {
    coach,
    otherCoach,
    student1,
    student2,
    schedule,
    scheduleId,
    sessionId: session._id.toString(),
    closedSessionId: closedSession._id.toString(),
  };
}

// Two schedules under the SAME class, different coaches, one student
// enrolled on each — exactly the "premium student attends a sibling
// schedule of their level" scenario the walk-in mechanism exists for.
async function seedTwoSchedulesSameClass(adminAgent) {
  const groupClass = await seedClass();

  const coachA = await User.create({
    role: 'coach',
    firstName: 'Coach',
    lastName: 'A',
    email: 'walkin-coach-a@example.com',
    passwordHash: await hashPassword(TEST_PASSWORD),
  });
  const coachB = await User.create({
    role: 'coach',
    firstName: 'Coach',
    lastName: 'B',
    email: 'walkin-coach-b@example.com',
    passwordHash: await hashPassword(TEST_PASSWORD),
  });

  const scheduleARes = await adminAgent.post('/api/v1/group-class-schedules').send({
    classId: groupClass._id.toString(),
    coachId: coachA._id.toString(),
    dayOfWeek: 2,
    startTime: '16:00',
    endTime: '17:00',
  });
  const scheduleBRes = await adminAgent.post('/api/v1/group-class-schedules').send({
    classId: groupClass._id.toString(),
    coachId: coachB._id.toString(),
    dayOfWeek: 4,
    startTime: '18:00',
    endTime: '19:00',
  });

  const scheduleA = await GroupClassSchedule.findById(scheduleARes.body.schedule._id);
  const scheduleB = await GroupClassSchedule.findById(scheduleBRes.body.schedule._id);

  const studentA = await User.create({ role: 'student', firstName: 'On', lastName: 'ScheduleA' });
  const studentB = await User.create({ role: 'student', firstName: 'On', lastName: 'ScheduleB' });
  const unrelatedStudent = await User.create({ role: 'student', firstName: 'No', lastName: 'Subscription' });

  await addStudentToRoster(scheduleA, studentA._id);
  await addStudentToRoster(scheduleB, studentB._id);

  const parent = await User.create({ role: 'parent', firstName: 'P', lastName: 'Rent' });
  await Subscription.create({
    studentId: studentA._id,
    scheduleId: scheduleA._id,
    parentId: parent._id,
    status: 'active',
    currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
    nextBillingDate: new Date('2026-02-01T00:00:00.000Z'),
    isPremium: true,
  });
  await Subscription.create({
    studentId: studentB._id,
    scheduleId: scheduleB._id,
    parentId: parent._id,
    status: 'active',
    currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
    nextBillingDate: new Date('2026-02-01T00:00:00.000Z'),
    isPremium: true,
  });

  // Same convention as seedScheduleWithSession: the last session is made
  // attendable (a fixed past day); the one before it stays weeks ahead,
  // for tests that need a CLOSED session.
  const sessionsA = await GroupClassSession.find({ scheduleId: scheduleA._id }).sort({ date: 1 });
  const sessionA = await makeSessionAttendable(sessionsA[sessionsA.length - 1], scheduleA);

  return {
    coachA,
    coachB,
    studentA,
    studentB,
    unrelatedStudent,
    sessionAId: sessionA._id.toString(),
    closedSessionAId: sessionsA[sessionsA.length - 2]._id.toString(),
  };
}

async function seedParent(overrides = {}) {
  const passwordHash = await hashPassword(TEST_PASSWORD);

  return User.create({
    role: 'parent',
    firstName: 'Test',
    lastName: 'Parent',
    email: 'test-parent@example.com',
    passwordHash,
    ...overrides,
  });
}

describe('GroupClassSession routes', () => {
  describe('GET /by-class/:classId', () => {
    it('merges sessions across every schedule on the class, sorted by date then schedule, with no roster leak', async () => {
      await seedAdmin();
      const adminAgent = await loginAgent('test-admin@example.com');
      await seedParent();
      const parentAgent = await loginAgent('test-parent@example.com');

      const groupClass = await seedClass();
      const coach = await User.create({
        role: 'coach',
        firstName: 'A',
        lastName: 'Coach',
        email: 'gcs-coach@example.com',
        passwordHash: await hashPassword(TEST_PASSWORD),
      });
      const otherStudent = await User.create({ role: 'student', firstName: 'Not', lastName: 'Mine' });

      // Two schedules on the SAME class, different days — this is exactly
      // the case that used to force a parent to pick a schedule first.
      const scheduleA = await adminAgent.post('/api/v1/group-class-schedules').send({
        classId: groupClass._id.toString(),
        coachId: coach._id.toString(),
        dayOfWeek: 2,
        startTime: '16:00',
        endTime: '17:00',
      });
      const scheduleB = await adminAgent.post('/api/v1/group-class-schedules').send({
        classId: groupClass._id.toString(),
        coachId: coach._id.toString(),
        dayOfWeek: 4,
        startTime: '18:00',
        endTime: '19:00',
      });
      const scheduleADoc = await GroupClassSchedule.findById(scheduleA.body.schedule._id);
      await addStudentToRoster(scheduleADoc, otherStudent._id);

      const res = await parentAgent.get(`/api/v1/group-class-sessions/by-class/${groupClass._id}`);

      expect(res.status).toBe(200);
      const scheduleIds = res.body.sessions.map((s) => s.scheduleId._id);
      expect(scheduleIds).toEqual(expect.arrayContaining([scheduleA.body.schedule._id, scheduleB.body.schedule._id]));

      // Sorted by date ascending — never assume insertion order.
      const dates = res.body.sessions.map((s) => new Date(s.date).getTime());
      expect(dates).toEqual([...dates].sort((a, b) => a - b));

      // Only display fields populated — never the roster or coach.
      res.body.sessions.forEach((session) => {
        expect(session.scheduleId).toMatchObject({
          dayOfWeek: expect.any(Number),
          startTime: expect.any(String),
          endTime: expect.any(String),
        });
        expect(session.scheduleId.students).toBeUndefined();
        expect(session.scheduleId.coachId).toBeUndefined();
      });
      expect(JSON.stringify(res.body)).not.toContain('Not');
      expect(JSON.stringify(res.body)).not.toContain('Mine');
    });

    it('returns an empty list for a class with no schedules', async () => {
      await seedAdmin();
      const adminAgent = await loginAgent('test-admin@example.com');

      const groupClass = await seedClass();

      const res = await adminAgent.get(`/api/v1/group-class-sessions/by-class/${groupClass._id}`);

      expect(res.status).toBe(200);
      expect(res.body.sessions).toEqual([]);
    });

    it('includes only sessions within the next 30 days (today-inclusive), excluding later weekly occurrences', async () => {
      // Fakes ONLY Date (via `now`) and explicitly leaves every timer
      // function real — faking setTimeout/setImmediate/nextTick here would
      // hang the real Mongo driver + supertest's HTTP round trip this test
      // still needs to make.
      jest.useFakeTimers({
        now: new Date('2026-08-25T12:00:00.000Z'), // a Tuesday, UTC midday
        doNotFake: REAL_TIMERS,
      });

      try {
        await seedAdmin();
        const adminAgent = await loginAgent('test-admin@example.com');

        const groupClass = await seedClass();
        const coach = await User.create({
          role: 'coach',
          firstName: 'B',
          lastName: 'Coach',
          email: 'gcs-coach2@example.com',
          passwordHash: await hashPassword(TEST_PASSWORD),
        });

        // dayOfWeek 2 = Tuesday, same day as "today" in the frozen clock —
        // the schedule's first generated session lands on today at 00:00,
        // proving the today-inclusive edge. 8 weekly sessions are generated
        // (today, +7, +14, +21, +28, +35, +42, +49) — only the first 5
        // (offsets 0-28) fall within the 30-day window.
        const scheduleRes = await adminAgent.post('/api/v1/group-class-schedules').send({
          classId: groupClass._id.toString(),
          coachId: coach._id.toString(),
          dayOfWeek: 2,
          startTime: '16:00',
          endTime: '17:00',
        });

        const res = await adminAgent.get(`/api/v1/group-class-sessions/by-class/${groupClass._id}`);

        expect(res.status).toBe(200);
        expect(res.body.sessions).toHaveLength(5);

        const allGenerated = await GroupClassSession.find({
          scheduleId: scheduleRes.body.schedule._id,
        }).sort({ date: 1 });
        expect(allGenerated).toHaveLength(8);
        // The first returned session IS today, at true UTC midnight — a
        // calendar-day sentinel (docs/plans/utc-date-standard-plan.md),
        // superseding this test's previous Central-midnight-INSTANT
        // expectation (docs/plans/timezone-consistency-plan.md D4/D5):
        // that shape rendered a day early for any viewer/formatter west of
        // Central, and disagreed with every other sentinel field in this
        // codebase.
        expect(new Date(res.body.sessions[0].date).toISOString()).toBe('2026-08-25T00:00:00.000Z');
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('GET /:id', () => {
    it('returns the session with student names populated, not bare ObjectIds', async () => {
      await seedAdmin();
      const adminAgent = await loginAgent('test-admin@example.com');

      const { student1, student2, sessionId } = await seedScheduleWithSession(adminAgent);

      const res = await adminAgent.get(`/api/v1/group-class-sessions/${sessionId}`);

      expect(res.status).toBe(200);
      const returnedStudentIds = res.body.session.students.map((s) => s.studentId._id).sort();
      expect(returnedStudentIds).toEqual(
        [student1._id.toString(), student2._id.toString()].sort()
      );

      const byId = new Map(res.body.session.students.map((s) => [s.studentId._id, s.studentId]));
      expect(byId.get(student1._id.toString())).toMatchObject({
        firstName: 'Ada',
        lastName: 'One',
      });
      expect(byId.get(student2._id.toString())).toMatchObject({
        firstName: 'Ben',
        lastName: 'Two',
      });
    });
  });

  describe('PATCH /:id/attendance', () => {
    it('lets the assigned coach mark attendance, and it persists', async () => {
      await seedAdmin();
      const adminAgent = await loginAgent('test-admin@example.com');

      const { coach, student1, student2, sessionId } = await seedScheduleWithSession(adminAgent);
      const coachAgent = await loginAgent(coach.email);

      const res = await coachAgent.patch(`/api/v1/group-class-sessions/${sessionId}/attendance`).send({
        students: [
          { studentId: student1._id.toString(), isPresent: true },
          { studentId: student2._id.toString(), isPresent: false },
        ],
      });

      expect(res.status).toBe(200);

      const visits = await Visit.find({ groupClassSessionId: sessionId });
      const statusByStudent = new Map(visits.map((v) => [String(v.studentId), v.status]));
      expect(statusByStudent.get(student1._id.toString())).toBe('attended');
      expect(statusByStudent.get(student2._id.toString())).toBe('missed');
    });

    it('returns 403 for a coach not assigned to this session', async () => {
      await seedAdmin();
      const adminAgent = await loginAgent('test-admin@example.com');

      const { otherCoach, student1, sessionId } = await seedScheduleWithSession(adminAgent);
      const otherCoachAgent = await loginAgent(otherCoach.email);

      const res = await otherCoachAgent
        .patch(`/api/v1/group-class-sessions/${sessionId}/attendance`)
        .send({ students: [{ studentId: student1._id.toString(), isPresent: true }] });

      expect(res.status).toBe(403);
    });

    it('lets an admin mark attendance regardless of assigned coach', async () => {
      await seedAdmin();
      const adminAgent = await loginAgent('test-admin@example.com');

      const { student1, sessionId } = await seedScheduleWithSession(adminAgent);

      const res = await adminAgent
        .patch(`/api/v1/group-class-sessions/${sessionId}/attendance`)
        .send({ students: [{ studentId: student1._id.toString(), isPresent: true }] });

      expect(res.status).toBe(200);

      const visit = await Visit.findOne({ groupClassSessionId: sessionId, studentId: student1._id });
      expect(visit.status).toBe('attended');
    });

    it('creates the Visit on the fly for a student with an active Subscription on this schedule but no pre-existing Visit (defensive fallback, matches CKQ)', async () => {
      await seedAdmin();
      const adminAgent = await loginAgent('test-admin@example.com');

      const { coach, sessionId, scheduleId } = await seedScheduleWithSession(adminAgent);
      const coachAgent = await loginAgent(coach.email);

      const parent = await User.create({ role: 'parent', firstName: 'P', lastName: 'Rent' });
      const lateStudent = await User.create({
        role: 'student',
        firstName: 'Subscribed',
        lastName: 'NoVisitYet',
        parentId: parent._id,
      });
      // Deliberately bypasses roster.service.js — a real Subscription on
      // this exact schedule, but no Visit ever created for it, mimicking
      // generateInitialSessions running again after this student registered
      // (§3.3's documented defensive-fallback scenario).
      await Subscription.create({
        studentId: lateStudent._id,
        scheduleId,
        parentId: parent._id,
        status: 'active',
        currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
        nextBillingDate: new Date('2026-02-01T00:00:00.000Z'),
      });

      const res = await coachAgent
        .patch(`/api/v1/group-class-sessions/${sessionId}/attendance`)
        .send({ students: [{ studentId: lateStudent._id.toString(), isPresent: true }] });

      expect(res.status).toBe(200);

      const visit = await Visit.findOne({ groupClassSessionId: sessionId, studentId: lateStudent._id });
      expect(visit).not.toBeNull();
      expect(visit.status).toBe('attended');
      expect(visit.classType).toBe('regular');
    });

    it('returns 400 when a studentId is not on the session roster', async () => {
      await seedAdmin();
      const adminAgent = await loginAgent('test-admin@example.com');

      const { coach, sessionId } = await seedScheduleWithSession(adminAgent);
      const coachAgent = await loginAgent(coach.email);

      const strangerStudent = await User.create({
        role: 'student',
        firstName: 'Not',
        lastName: 'OnRoster',
      });

      const res = await coachAgent
        .patch(`/api/v1/group-class-sessions/${sessionId}/attendance`)
        .send({ students: [{ studentId: strangerStudent._id.toString(), isPresent: true }] });

      expect(res.status).toBe(400);
      // Asserted so this can never pass for the wrong reason (e.g. the
      // same-day gate firing first).
      expect(res.body.message).toMatch(/Unknown studentId/);
    });
  });

  describe('Walk-in attendance (Phase 3 — addStudentToSession/removeStudentFromSession/getEligibleStudentsForSession)', () => {
    it("eligible-students returns the sibling-schedule student, excluding this session's own roster and anyone with no subscription", async () => {
      await seedAdmin();
      const adminAgent = await loginAgent('test-admin@example.com');
      const { coachA, studentA, studentB, unrelatedStudent, sessionAId } = await seedTwoSchedulesSameClass(adminAgent);
      const coachAAgent = await loginAgent(coachA.email);

      const res = await coachAAgent.get(`/api/v1/group-class-sessions/${sessionAId}/eligible-students`);

      expect(res.status).toBe(200);
      const ids = res.body.students.map((s) => s._id);
      expect(ids).toContain(studentB._id.toString());
      expect(ids).not.toContain(studentA._id.toString());
      expect(ids).not.toContain(unrelatedStudent._id.toString());
    });

    it('returns 403 for eligible-students when the caller is not this session\'s assigned coach', async () => {
      await seedAdmin();
      const adminAgent = await loginAgent('test-admin@example.com');
      const { coachB, sessionAId } = await seedTwoSchedulesSameClass(adminAgent);
      const coachBAgent = await loginAgent(coachB.email);

      const res = await coachBAgent.get(`/api/v1/group-class-sessions/${sessionAId}/eligible-students`);

      expect(res.status).toBe(403);
    });

    it('adds an eligible walk-in as attended + isMakeupClass, then 409s on a repeat add', async () => {
      await seedAdmin();
      const adminAgent = await loginAgent('test-admin@example.com');
      const { coachA, studentB, sessionAId } = await seedTwoSchedulesSameClass(adminAgent);
      const coachAAgent = await loginAgent(coachA.email);

      const res = await coachAAgent
        .post(`/api/v1/group-class-sessions/${sessionAId}/students`)
        .send({ studentId: studentB._id.toString() });

      expect(res.status).toBe(200);

      const visit = await Visit.findOne({ groupClassSessionId: sessionAId, studentId: studentB._id });
      expect(visit.status).toBe('attended');
      expect(visit.isMakeupClass).toBe(true);
      expect(visit.classType).toBe('regular');

      const repeat = await coachAAgent
        .post(`/api/v1/group-class-sessions/${sessionAId}/students`)
        .send({ studentId: studentB._id.toString() });

      expect(repeat.status).toBe(409);
    });

    it('returns 400 adding a student not on the eligible list (no subscription anywhere at this level)', async () => {
      await seedAdmin();
      const adminAgent = await loginAgent('test-admin@example.com');
      const { coachA, unrelatedStudent, sessionAId } = await seedTwoSchedulesSameClass(adminAgent);
      const coachAAgent = await loginAgent(coachA.email);

      const res = await coachAAgent
        .post(`/api/v1/group-class-sessions/${sessionAId}/students`)
        .send({ studentId: unrelatedStudent._id.toString() });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('This student is not eligible to be added to this session');
    });

    it('removes a walk-in (isMakeupClass) but refuses to remove a genuine roster student', async () => {
      await seedAdmin();
      const adminAgent = await loginAgent('test-admin@example.com');
      const { coachA, studentA, studentB, sessionAId } = await seedTwoSchedulesSameClass(adminAgent);
      const coachAAgent = await loginAgent(coachA.email);

      await coachAAgent
        .post(`/api/v1/group-class-sessions/${sessionAId}/students`)
        .send({ studentId: studentB._id.toString() });

      const removeWalkIn = await coachAAgent.delete(
        `/api/v1/group-class-sessions/${sessionAId}/students/${studentB._id}`
      );
      expect(removeWalkIn.status).toBe(200);

      const cancelledVisit = await Visit.findOne({ groupClassSessionId: sessionAId, studentId: studentB._id });
      expect(cancelledVisit.status).toBe('cancelled');

      const removeRoster = await coachAAgent.delete(
        `/api/v1/group-class-sessions/${sessionAId}/students/${studentA._id}`
      );
      expect(removeRoster.status).toBe(400);
    });

    it('returns 400 adding a walk-in to a holiday-date session, writing no Visit (docs/plans/holiday-blocking-plan.md D7)', async () => {
      await seedAdmin();
      const adminAgent = await loginAgent('test-admin@example.com');
      const { coachA, studentB, sessionAId } = await seedTwoSchedulesSameClass(adminAgent);
      const coachAAgent = await loginAgent(coachA.email);

      const session = await GroupClassSession.findById(sessionAId);
      await Holiday.create({ name: 'Holiday', startDate: session.date, endDate: session.date });

      const res = await coachAAgent
        .post(`/api/v1/group-class-sessions/${sessionAId}/students`)
        .send({ studentId: studentB._id.toString() });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Attendance cannot be marked on an academy holiday');
      expect(await Visit.findOne({ groupClassSessionId: sessionAId, studentId: studentB._id })).toBeNull();
    });
  });

  // docs/plans/duplication-cleanup-plan.md PR A — attendance opens on the
  // session's own calendar day (Central), for admins and coaches alike, with
  // no late cutoff. The seed helpers' attendable session sits on a fixed PAST
  // day, so every existing "lets ... mark attendance" test above already
  // proves the no-late-cutoff half; these cover the closed half.
  describe('Same-day attendance gate', () => {
    const GATE_MESSAGE = "Attendance can only be marked on or after the session's day";

    afterEach(() => {
      jest.useRealTimers();
    });

    function markAs(agent, sessionId, studentId) {
      return agent
        .patch(`/api/v1/group-class-sessions/${sessionId}/attendance`)
        .send({ students: [{ studentId: studentId.toString(), isPresent: true }] });
    }

    // A real schedule + coach + a roster student, plus ONE extra session on a
    // fixed calendar day (with the roster Visit a real registration would
    // have created). Logins happen here, BEFORE any test freezes the clock.
    async function seedDatedSession(dateStr) {
      await seedAdmin();
      const adminAgent = await loginAgent('test-admin@example.com');
      const { coach, student1, schedule } = await seedScheduleWithSession(adminAgent);
      const coachAgent = await loginAgent(coach.email);

      const session = await createSession(schedule, new Date(`${dateStr}T00:00:00.000Z`));
      await Visit.create({
        studentId: student1._id,
        groupClassSessionId: session._id,
        groupClassScheduleId: schedule._id,
        classType: 'regular',
        status: 'scheduled',
      });

      return { coachAgent, student1, sessionId: session._id.toString() };
    }

    it('returns 400 with the same-day message for a coach marking a not-yet-open session, and changes nothing', async () => {
      await seedAdmin();
      const adminAgent = await loginAgent('test-admin@example.com');
      const { coach, student1, closedSessionId } = await seedScheduleWithSession(adminAgent);
      const coachAgent = await loginAgent(coach.email);

      const res = await markAs(coachAgent, closedSessionId, student1._id);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(GATE_MESSAGE);
      const visit = await Visit.findOne({ groupClassSessionId: closedSessionId, studentId: student1._id });
      expect(visit.status).toBe('scheduled');
    });

    it('applies the same rule to an admin — no override', async () => {
      await seedAdmin();
      const adminAgent = await loginAgent('test-admin@example.com');
      const { student1, closedSessionId } = await seedScheduleWithSession(adminAgent);

      const res = await markAs(adminAgent, closedSessionId, student1._id);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(GATE_MESSAGE);
    });

    it('returns 400 with the same-day message for a walk-in add to a not-yet-open session, writing no Visit', async () => {
      await seedAdmin();
      const adminAgent = await loginAgent('test-admin@example.com');
      const { coachA, studentB, closedSessionAId } = await seedTwoSchedulesSameClass(adminAgent);
      const coachAAgent = await loginAgent(coachA.email);

      const res = await coachAAgent
        .post(`/api/v1/group-class-sessions/${closedSessionAId}/students`)
        .send({ studentId: studentB._id.toString() });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(GATE_MESSAGE);
      expect(await Visit.findOne({ groupClassSessionId: closedSessionAId, studentId: studentB._id })).toBeNull();
    });

    it('does NOT gate removing a walk-in — the request reaches its own rule, not the same-day guard', async () => {
      await seedAdmin();
      const adminAgent = await loginAgent('test-admin@example.com');
      const { coachA, studentA, closedSessionAId } = await seedTwoSchedulesSameClass(adminAgent);
      const coachAAgent = await loginAgent(coachA.email);

      const res = await coachAAgent.delete(
        `/api/v1/group-class-sessions/${closedSessionAId}/students/${studentA._id}`
      );

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Cannot remove a student who is enrolled/);
    });

    it('holiday wins over the same-day message when a not-yet-open session is also a holiday', async () => {
      await seedAdmin();
      const adminAgent = await loginAgent('test-admin@example.com');
      const { coach, student1, closedSessionId } = await seedScheduleWithSession(adminAgent);
      const coachAgent = await loginAgent(coach.email);

      const closed = await GroupClassSession.findById(closedSessionId);
      await Holiday.create({ name: 'Holiday', startDate: closed.date, endDate: closed.date });

      const res = await markAs(coachAgent, closedSessionId, student1._id);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Attendance cannot be marked on an academy holiday');
    });

    // Session day Wed 2026-08-26 (CDT, UTC-5): Central midnight is 05:00Z.
    it('opens exactly at Central midnight of the session day — CDT', async () => {
      const { coachAgent, student1, sessionId } = await seedDatedSession('2026-08-26');

      jest.useFakeTimers({ now: new Date('2026-08-26T04:59:00.000Z'), doNotFake: REAL_TIMERS }); // Tue 23:59 CDT
      const before = await markAs(coachAgent, sessionId, student1._id);
      expect(before.status).toBe(400);
      expect(before.body.message).toBe(GATE_MESSAGE);

      jest.setSystemTime(new Date('2026-08-26T05:00:00.000Z')); // Wed 00:00 CDT
      const at = await markAs(coachAgent, sessionId, student1._id);
      expect(at.status).toBe(200);
    });

    // Session day Wed 2026-01-14 (CST, UTC-6): Central midnight is 06:00Z.
    it('opens exactly at Central midnight of the session day — CST', async () => {
      const { coachAgent, student1, sessionId } = await seedDatedSession('2026-01-14');

      jest.useFakeTimers({ now: new Date('2026-01-14T05:59:00.000Z'), doNotFake: REAL_TIMERS }); // Tue 23:59 CST
      const before = await markAs(coachAgent, sessionId, student1._id);
      expect(before.status).toBe(400);

      jest.setSystemTime(new Date('2026-01-14T06:00:00.000Z')); // Wed 00:00 CST
      const at = await markAs(coachAgent, sessionId, student1._id);
      expect(at.status).toBe(200);
    });

    it('is open all day on the session day, including before the class starts (same-day is the grace period)', async () => {
      const { coachAgent, student1, sessionId } = await seedDatedSession('2026-08-26');

      jest.useFakeTimers({ now: new Date('2026-08-26T14:00:00.000Z'), doNotFake: REAL_TIMERS }); // Wed 09:00 CDT, class is 16:00
      const res = await markAs(coachAgent, sessionId, student1._id);

      expect(res.status).toBe(200);
    });

    // 20:00 Central on Tuesday is already Wednesday in UTC. A comparison made
    // in UTC would wrongly open Wednesday's session five hours early.
    it('stays closed at 20:00 Central the evening before, even though it is already the session day in UTC', async () => {
      const { coachAgent, student1, sessionId } = await seedDatedSession('2026-08-26');

      jest.useFakeTimers({ now: new Date('2026-08-26T01:00:00.000Z'), doNotFake: REAL_TIMERS }); // Tue 20:00 CDT
      const res = await markAs(coachAgent, sessionId, student1._id);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(GATE_MESSAGE);
    });

    it('GET /:id and GET /by-schedule/:scheduleId report attendanceOpen consistently with what PATCH actually does', async () => {
      await seedAdmin();
      const adminAgent = await loginAgent('test-admin@example.com');
      const { student1, scheduleId, sessionId, closedSessionId } = await seedScheduleWithSession(adminAgent);

      const list = await adminAgent.get(`/api/v1/group-class-sessions/by-schedule/${scheduleId}`);
      const rowFor = (id) => list.body.sessions.find((s) => s._id === id);

      const closedDetail = await adminAgent.get(`/api/v1/group-class-sessions/${closedSessionId}`);
      expect(closedDetail.body.session.attendanceOpen).toBe(false);
      expect(rowFor(closedSessionId).attendanceOpen).toBe(false);
      expect((await markAs(adminAgent, closedSessionId, student1._id)).status).toBe(400);

      const openDetail = await adminAgent.get(`/api/v1/group-class-sessions/${sessionId}`);
      expect(openDetail.body.session.attendanceOpen).toBe(true);
      expect(rowFor(sessionId).attendanceOpen).toBe(true);
      expect((await markAs(adminAgent, sessionId, student1._id)).status).toBe(200);
    });
  });

  describe('Holiday blocking (docs/plans/holiday-blocking-plan.md)', () => {
    it('returns 400 marking attendance on a holiday-date session, writing no Visit', async () => {
      await seedAdmin();
      const adminAgent = await loginAgent('test-admin@example.com');

      const { coach, student1, sessionId } = await seedScheduleWithSession(adminAgent);
      const coachAgent = await loginAgent(coach.email);

      const session = await GroupClassSession.findById(sessionId);
      await Holiday.create({ name: 'Holiday', startDate: session.date, endDate: session.date });

      const res = await coachAgent
        .patch(`/api/v1/group-class-sessions/${sessionId}/attendance`)
        .send({ students: [{ studentId: student1._id.toString(), isPresent: true }] });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Attendance cannot be marked on an academy holiday');
      const visit = await Visit.findOne({ groupClassSessionId: sessionId, studentId: student1._id });
      // A Visit already exists from roster enrollment (status 'scheduled') —
      // the guard must fire before markAttendance() ever changes it.
      expect(visit.status).toBe('scheduled');
    });

    it('GET /:id and GET /by-schedule/:scheduleId annotate isHoliday/holidayName', async () => {
      await seedAdmin();
      const adminAgent = await loginAgent('test-admin@example.com');

      const { sessionId, scheduleId } = await seedScheduleWithSession(adminAgent);
      const session = await GroupClassSession.findById(sessionId);
      await Holiday.create({ name: 'Founders Day', startDate: session.date, endDate: session.date });

      const byIdRes = await adminAgent.get(`/api/v1/group-class-sessions/${sessionId}`);
      expect(byIdRes.status).toBe(200);
      expect(byIdRes.body.session.isHoliday).toBe(true);
      expect(byIdRes.body.session.holidayName).toBe('Founders Day');

      const byScheduleRes = await adminAgent.get(`/api/v1/group-class-sessions/by-schedule/${scheduleId}`);
      expect(byScheduleRes.status).toBe(200);
      const annotated = byScheduleRes.body.sessions.find((s) => s._id === sessionId);
      expect(annotated.isHoliday).toBe(true);
      expect(annotated.holidayName).toBe('Founders Day');
    });
  });
});
