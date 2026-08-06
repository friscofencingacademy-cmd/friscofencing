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
// the same way production does) with an assigned coach and two enrolled
// students, and returns everything a test needs to exercise attendance
// marking against the first generated session.
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
    students: [student1._id.toString(), student2._id.toString()],
  });

  expect(createRes.status).toBe(201);
  const scheduleId = createRes.body.schedule._id;

  const sessions = await GroupClassSession.find({ scheduleId }).sort({ date: 1 });
  const session = sessions[0];

  return { coach, otherCoach, student1, student2, scheduleId, sessionId: session._id.toString() };
}

describe('GroupClassSession routes', () => {
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

      const persisted = await GroupClassSession.findById(sessionId);
      const persistedByStudent = new Map(
        persisted.students.map((s) => [String(s.studentId), s.isPresent])
      );
      expect(persistedByStudent.get(student1._id.toString())).toBe(true);
      expect(persistedByStudent.get(student2._id.toString())).toBe(false);
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

      const persisted = await GroupClassSession.findById(sessionId);
      const entry = persisted.students.find((s) => String(s.studentId) === student1._id.toString());
      expect(entry.isPresent).toBe(true);
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
    });
  });
});
