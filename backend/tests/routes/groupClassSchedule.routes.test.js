process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

const request = require('supertest');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const Level = require('../../src/models/level.model');
const Location = require('../../src/models/location.model');
const GroupClass = require('../../src/models/groupClass.model');
const GroupClassSession = require('../../src/models/groupClassSession.model');
const { hashPassword } = require('../../src/utils/password');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');

const TEST_PASSWORD = 'correct-password';

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
  it('generates exactly 8 weekly sessions on creation, each on the requested day-of-week, snapshotting the roster', async () => {
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
    const student1 = await User.create({ role: 'student', firstName: 'S', lastName: 'One' });
    const student2 = await User.create({ role: 'student', firstName: 'S', lastName: 'Two' });

    const DAY_OF_WEEK = 3; // Wednesday

    const createRes = await adminAgent.post('/api/v1/group-class-schedules').send({
      classId: groupClass._id.toString(),
      coachId: coach._id.toString(),
      dayOfWeek: DAY_OF_WEEK,
      startTime: '16:00',
      endTime: '17:00',
      students: [student1._id.toString(), student2._id.toString()],
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

      const studentIds = session.students.map((s) => s.studentId.toString()).sort();
      expect(studentIds).toEqual(
        [student1._id.toString(), student2._id.toString()].sort()
      );
      session.students.forEach((s) => {
        expect(s.isPresent).toBe(false);
      });
    });

    const listRes = await adminAgent.get(
      `/api/v1/group-class-sessions/by-schedule/${scheduleId}`
    );
    expect(listRes.status).toBe(200);
    expect(listRes.body.sessions).toHaveLength(8);
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
    it('requires no auth and returns a thin projection with a server-derived open/full availability', async () => {
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

      // No Authorization/cookie at all.
      const res = await request(app).get('/api/v1/group-class-schedules/public');

      expect(res.status).toBe(200);
      expect(res.body.schedules).toHaveLength(2);

      const full = res.body.schedules.find((s) => s.dayOfWeek === 3);
      const open = res.body.schedules.find((s) => s.dayOfWeek === 4);

      expect(full).toEqual({
        className: 'Beginner Foil',
        levelName: 'Beginner',
        locationName: 'Frisco HQ',
        coachName: 'Coach Public',
        dayOfWeek: 3,
        startTime: '16:00',
        endTime: '17:00',
        availability: 'full',
      });
      expect(open.availability).toBe('open');
      // No roster/capacity numbers leak — only the derived string.
      expect(JSON.stringify(res.body)).not.toContain('capacity');
      expect(JSON.stringify(res.body)).not.toContain('students');
    });
  });
});
