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
const { hashPassword } = require('../../src/utils/password');
const { addStudentToRoster } = require('../../src/services/roster.service');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');

const TEST_PASSWORD = 'correct-password';

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

const FAKE_TIMER_PASSTHROUGH = [
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
  'nextTick',
];

afterEach(async () => {
  jest.useRealTimers();
  await clearTestDB();
  delete process.env.ENABLE_SCHEDULE_BASED_REGISTRATION;
});

async function seedUser(overrides = {}) {
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

describe('GroupClassSchedule routes', () => {
  it('generates exactly 8 weekly sessions on creation, each on the requested day-of-week', async () => {
    await seedUser();
    const adminAgent = await loginAgent('test-admin@example.com');

    const groupClass = await seedClass();
    const coach = await User.create({
      role: 'coach',
      firstName: 'Coach',
      lastName: 'Test',
      email: 'test-coach@example.com',
      passwordHash: await hashPassword(TEST_PASSWORD),
    });

    const DAY_OF_WEEK = 3; // Wednesday

    // No `students` in the create payload — the real admin UI never sends
    // one (createSchedule's own type Picks only classId/coachId/dayOfWeek/
    // startTime/endTime). Enrollment happens later, via registration, which
    // is what creates each student's roster entry AND scheduled Visit rows
    // (docs/plans/premium-registration-and-attendance-plan.md §1/§3.2) —
    // covered by registration.routes.test.js, not schedule creation.
    const createRes = await adminAgent.post('/api/v1/group-class-schedules').send({
      classId: groupClass._id.toString(),
      coachId: coach._id.toString(),
      dayOfWeek: DAY_OF_WEEK,
      startTime: '16:00',
      endTime: '17:00',
    });

    expect(createRes.status).toBe(201);
    const scheduleId = createRes.body.schedule._id;

    const sessions = await GroupClassSession.find({ scheduleId }).sort({ date: 1 });

    expect(sessions).toHaveLength(8);

    sessions.forEach((session, index) => {
      expect(session.date.getDay()).toBe(DAY_OF_WEEK);

      if (index > 0) {
        const previousDate = sessions[index - 1].date;
        const diffDays = (session.date - previousDate) / (1000 * 60 * 60 * 24);
        expect(diffDays).toBe(7);
      }
    });

    const listRes = await adminAgent.get(
      `/api/v1/group-class-sessions/by-schedule/${scheduleId}`
    );
    expect(listRes.status).toBe(200);
    expect(listRes.body.sessions).toHaveLength(8);
  });

  it('GET /by-schedule/:scheduleId attaches each session\'s roster (student count), computed live from Visit — the exact shape the admin/coach sessions-list pages read', async () => {
    // Frozen on a Tuesday so every generated Wednesday session is still ahead
    // of "now" — the roster helper only creates Visits for not-yet-started
    // sessions, so a real-clock run on a Wednesday evening would otherwise
    // leave today's session with no Visit. Only Date is faked; real timers
    // are needed by the Mongo driver + supertest.
    jest.useFakeTimers({ now: new Date('2026-08-25T12:00:00.000Z'), doNotFake: FAKE_TIMER_PASSTHROUGH });

    await seedUser();
    const adminAgent = await loginAgent('test-admin@example.com');

    const groupClass = await seedClass();
    const coach = await User.create({
      role: 'coach',
      firstName: 'Coach',
      lastName: 'Roster',
      email: 'test-coach-roster@example.com',
      passwordHash: await hashPassword(TEST_PASSWORD),
    });
    const student = await User.create({ role: 'student', firstName: 'S', lastName: 'Roster' });

    const createRes = await adminAgent.post('/api/v1/group-class-schedules').send({
      classId: groupClass._id.toString(),
      coachId: coach._id.toString(),
      dayOfWeek: 3,
      startTime: '16:00',
      endTime: '17:00',
    });
    const scheduleId = createRes.body.schedule._id;

    const schedule = await GroupClassSchedule.findById(scheduleId);
    await addStudentToRoster(schedule, student._id);

    const listRes = await adminAgent.get(`/api/v1/group-class-sessions/by-schedule/${scheduleId}`);

    expect(listRes.status).toBe(200);
    listRes.body.sessions.forEach((session) => {
      expect(session.students).toHaveLength(1);
      expect(session.students[0]).toEqual({
        studentId: student._id.toString(),
        isPresent: false,
        classType: 'regular',
      });
    });
  });

  it('returns 400 when coachId does not refer to a coach', async () => {
    await seedUser();
    const adminAgent = await loginAgent('test-admin@example.com');

    const groupClass = await seedClass();
    const notACoach = await User.create({
      role: 'parent',
      firstName: 'Not',
      lastName: 'Coach',
      email: 'test-notcoach@example.com',
      passwordHash: await hashPassword(TEST_PASSWORD),
    });

    const res = await adminAgent.post('/api/v1/group-class-schedules').send({
      classId: groupClass._id.toString(),
      coachId: notACoach._id.toString(),
      dayOfWeek: 3,
      startTime: '16:00',
      endTime: '17:00',
    });

    expect(res.status).toBe(400);
  });

  // docs/plans/session-start-time-cutoff-plan.md D6 — stored startsAt/endsAt
  // must never drift from the schedule's own rule.
  describe('PUT /:id — keeping session instants in sync with the schedule (D6)', () => {
    async function seedScheduleViaRoute(adminAgent) {
      const groupClass = await seedClass();
      const coach = await User.create({
        role: 'coach',
        firstName: 'Coach',
        lastName: 'Put',
        email: 'test-coach-put@example.com',
        passwordHash: await hashPassword(TEST_PASSWORD),
      });

      const createRes = await adminAgent.post('/api/v1/group-class-schedules').send({
        classId: groupClass._id.toString(),
        coachId: coach._id.toString(),
        dayOfWeek: 3,
        startTime: '16:00',
        endTime: '17:00',
      });

      expect(createRes.status).toBe(201);
      return createRes.body.schedule._id;
    }

    it('re-resolves startsAt/endsAt for every not-yet-started session when startTime/endTime change, leaving a started session untouched', async () => {
      jest.useFakeTimers({ now: new Date('2026-08-25T12:00:00.000Z'), doNotFake: FAKE_TIMER_PASSTHROUGH }); // Tuesday

      await seedUser();
      const adminAgent = await loginAgent('test-admin@example.com');
      const scheduleId = await seedScheduleViaRoute(adminAgent);

      // Make the first session a genuinely started one, at fixed historical
      // instants, so "left untouched" is observable.
      const sessions = await GroupClassSession.find({ scheduleId }).sort({ date: 1 });
      const started = sessions[0];
      const startedInstants = {
        startsAt: new Date('2020-01-01T22:00:00.000Z'),
        endsAt: new Date('2020-01-01T23:00:00.000Z'),
      };
      await GroupClassSession.updateOne({ _id: started._id }, startedInstants);

      const res = await adminAgent.put(`/api/v1/group-class-schedules/${scheduleId}`).send({
        startTime: '18:30',
        endTime: '19:30',
      });

      expect(res.status).toBe(200);

      const after = await GroupClassSession.find({ scheduleId }).sort({ date: 1 });

      // Started session: unchanged.
      expect(after[0].startsAt.toISOString()).toBe(startedInstants.startsAt.toISOString());
      expect(after[0].endsAt.toISOString()).toBe(startedInstants.endsAt.toISOString());

      // Every other session: 18:30-19:30 Central. All eight sessions fall
      // between 2026-08-26 and 2026-10-14 (CDT, UTC-5), so 18:30 Central is
      // 23:30Z on the session's own day.
      after.slice(1).forEach((session) => {
        const day = session.date.toISOString().slice(0, 10);
        expect(session.startsAt.toISOString()).toBe(`${day}T23:30:00.000Z`);
        expect(session.endsAt.getTime() - session.startsAt.getTime()).toBe(60 * 60 * 1000);
      });
    });

    it('rejects a dayOfWeek change with 400 and changes nothing', async () => {
      await seedUser();
      const adminAgent = await loginAgent('test-admin@example.com');
      const scheduleId = await seedScheduleViaRoute(adminAgent);

      const res = await adminAgent.put(`/api/v1/group-class-schedules/${scheduleId}`).send({ dayOfWeek: 5 });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Changing a schedule's day is not supported — create a new schedule");
      expect((await GroupClassSchedule.findById(scheduleId)).dayOfWeek).toBe(3);
    });

    it('accepts a dayOfWeek that equals the current value (no-op, not a change)', async () => {
      await seedUser();
      const adminAgent = await loginAgent('test-admin@example.com');
      const scheduleId = await seedScheduleViaRoute(adminAgent);

      const res = await adminAgent.put(`/api/v1/group-class-schedules/${scheduleId}`).send({ dayOfWeek: 3 });

      expect(res.status).toBe(200);
    });
  });

  describe('GET /mine', () => {
    it('only returns schedules belonging to the authenticated coach', async () => {
      await seedUser();
      const adminAgent = await loginAgent('test-admin@example.com');

      const groupClass = await seedClass();

      const coachA = await User.create({
        role: 'coach',
        firstName: 'Coach',
        lastName: 'A',
        email: 'coach-a@example.com',
        passwordHash: await hashPassword(TEST_PASSWORD),
      });
      const coachB = await User.create({
        role: 'coach',
        firstName: 'Coach',
        lastName: 'B',
        email: 'coach-b@example.com',
        passwordHash: await hashPassword(TEST_PASSWORD),
      });

      const scheduleARes = await adminAgent.post('/api/v1/group-class-schedules').send({
        classId: groupClass._id.toString(),
        coachId: coachA._id.toString(),
        dayOfWeek: 1,
        startTime: '16:00',
        endTime: '17:00',
      });
      expect(scheduleARes.status).toBe(201);

      const scheduleBRes = await adminAgent.post('/api/v1/group-class-schedules').send({
        classId: groupClass._id.toString(),
        coachId: coachB._id.toString(),
        dayOfWeek: 2,
        startTime: '16:00',
        endTime: '17:00',
      });
      expect(scheduleBRes.status).toBe(201);

      const coachAAgent = await loginAgent('coach-a@example.com');
      const mineRes = await coachAAgent.get('/api/v1/group-class-schedules/mine');

      expect(mineRes.status).toBe(200);
      expect(mineRes.body.schedules).toHaveLength(1);
      expect(mineRes.body.schedules[0]._id).toBe(scheduleARes.body.schedule._id);
    });

    it('returns 403 for a non-coach role', async () => {
      await seedUser();
      const adminAgent = await loginAgent('test-admin@example.com');

      const res = await adminAgent.get('/api/v1/group-class-schedules/mine');

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/group-class-schedules/public', () => {
    async function seedFullAndOpenSchedules() {
      await seedUser();
      const adminAgent = await loginAgent('test-admin@example.com');

      const groupClass = await seedClass(); // capacity: 10
      const coach = await User.create({
        role: 'coach',
        firstName: 'Coach',
        lastName: 'Public',
        email: 'coach-public@example.com',
        passwordHash: await hashPassword(TEST_PASSWORD),
      });

      const students = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          User.create({ role: 'student', firstName: 'S', lastName: `Full${i}` })
        )
      );

      const fullScheduleRes = await adminAgent.post('/api/v1/group-class-schedules').send({
        classId: groupClass._id.toString(),
        coachId: coach._id.toString(),
        dayOfWeek: 3,
        startTime: '16:00',
        endTime: '17:00',
        students: students.map((s) => s._id.toString()),
      });
      expect(fullScheduleRes.status).toBe(201);

      const openScheduleRes = await adminAgent.post('/api/v1/group-class-schedules').send({
        classId: groupClass._id.toString(),
        coachId: coach._id.toString(),
        dayOfWeek: 4,
        startTime: '17:00',
        endTime: '18:00',
      });
      expect(openScheduleRes.status).toBe(201);
    }

    it('requires no auth and returns a thin projection with no availability field in premium mode (the live default)', async () => {
      await seedFullAndOpenSchedules();

      // No Authorization/cookie at all.
      const res = await request(app).get('/api/v1/group-class-schedules/public');

      expect(res.status).toBe(200);
      expect(res.body.schedules).toHaveLength(2);

      const full = res.body.schedules.find((s) => s.dayOfWeek === 3);
      const open = res.body.schedules.find((s) => s.dayOfWeek === 4);

      // A schedule at its roster capacity is still just a normal row —
      // premium students attend any session of the level, so one schedule
      // filling up doesn't mean the level has no room.
      expect(full).toEqual({
        className: 'Beginner Foil',
        levelName: 'Beginner',
        locationName: 'Frisco HQ',
        timezone: 'America/Chicago', // seedClass()'s Location doesn't set one — the schema default
        coachName: 'Coach Public',
        dayOfWeek: 3,
        startTime: '16:00',
        endTime: '17:00',
      });
      expect(open.availability).toBeUndefined();
      // No roster/capacity numbers leak — and no derived string either.
      expect(JSON.stringify(res.body)).not.toContain('capacity');
      expect(JSON.stringify(res.body)).not.toContain('students');
      expect(JSON.stringify(res.body)).not.toContain('availability');
    });

    it('returns a server-derived open/full availability in schedule-based mode', async () => {
      process.env.ENABLE_SCHEDULE_BASED_REGISTRATION = 'true';

      await seedFullAndOpenSchedules();

      const res = await request(app).get('/api/v1/group-class-schedules/public');

      expect(res.status).toBe(200);
      const full = res.body.schedules.find((s) => s.dayOfWeek === 3);
      const open = res.body.schedules.find((s) => s.dayOfWeek === 4);

      expect(full.availability).toBe('full');
      expect(open.availability).toBe('open');
    });

    // docs/plans/frontend-polish-plan.md PR 4, source-of-truth audit finding
    // B2 — the frontend used to guess a single timezone from "whichever
    // location loaded first" and apply it to every row; each row must carry
    // its OWN schedule's location's timezone instead.
    it("returns each schedule's own location's timezone, not one guessed from a different location", async () => {
      await seedUser();
      const adminAgent = await loginAgent('test-admin@example.com');

      const level = await Level.create({ name: 'Beginner', order: 1 });
      const chicagoLocation = await Location.create({
        name: 'Frisco HQ',
        address: '123 Main St',
        timezone: 'America/Chicago',
      });
      const denverLocation = await Location.create({
        name: 'Denver Salle',
        address: '1 Mountain Rd',
        timezone: 'America/Denver',
      });
      const chicagoClass = await GroupClass.create({
        name: 'Chicago Class',
        levelId: level._id,
        locationId: chicagoLocation._id,
        capacity: 10,
      });
      const denverClass = await GroupClass.create({
        name: 'Denver Class',
        levelId: level._id,
        locationId: denverLocation._id,
        capacity: 10,
      });
      const coach = await User.create({
        role: 'coach',
        firstName: 'Coach',
        lastName: 'MultiLocation',
        email: 'coach-multi-location@example.com',
        passwordHash: await hashPassword(TEST_PASSWORD),
      });

      await adminAgent.post('/api/v1/group-class-schedules').send({
        classId: chicagoClass._id.toString(),
        coachId: coach._id.toString(),
        dayOfWeek: 2,
        startTime: '16:00',
        endTime: '17:00',
      });
      await adminAgent.post('/api/v1/group-class-schedules').send({
        classId: denverClass._id.toString(),
        coachId: coach._id.toString(),
        dayOfWeek: 4,
        startTime: '17:00',
        endTime: '18:00',
      });

      const res = await request(app).get('/api/v1/group-class-schedules/public');

      expect(res.status).toBe(200);
      const chicagoRow = res.body.schedules.find((s) => s.className === 'Chicago Class');
      const denverRow = res.body.schedules.find((s) => s.className === 'Denver Class');

      expect(chicagoRow.timezone).toBe('America/Chicago');
      expect(denverRow.timezone).toBe('America/Denver');
    });

    it('excludes a schedule whose class/level/location/coach reference is missing — orphaned refs never surface as a half-populated row', async () => {
      await seedFullAndOpenSchedules();
      // The full schedule's dayOfWeek === 3 row's referenced GroupClass is
      // deleted out from under it, mirroring the existing orphaned-reference
      // guard already covered elsewhere in this suite's sibling routes.
      const groupClass = await GroupClass.findOne({ name: 'Beginner Foil' });
      await GroupClass.deleteOne({ _id: groupClass._id });

      const res = await request(app).get('/api/v1/group-class-schedules/public');

      expect(res.status).toBe(200);
      expect(res.body.schedules).toHaveLength(0);
    });
  });
});
