process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

// Mocked so this suite never touches nodemailer/Ethereal — confirmation
// email is its own concern (see mail.service.test.js), unrelated to what
// this suite exists to cover.
jest.mock('../../src/services/mail.service');

const request = require('supertest');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const Level = require('../../src/models/level.model');
const Location = require('../../src/models/location.model');
const GroupClass = require('../../src/models/groupClass.model');
const GroupClassSession = require('../../src/models/groupClassSession.model');
const Evaluation = require('../../src/models/evaluation.model');
const visitService = require('../../src/services/visit.service');
const { hashPassword } = require('../../src/utils/password');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');
const mailService = require('../../src/services/mail.service');

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

async function loginAgent(email) {
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD });
  return agent;
}

// Builds a schedule (via the real create route), a coach assigned to it, a
// student, and a Visit for the student on the first generated session —
// classType is a parameter since coach-eligibility depends on it being
// 'trial'. Returns everything a test needs.
async function seedSessionWithVisit({ classType = 'trial', visitStatus = 'attended' } = {}) {
  const level = await Level.create({ name: 'Beginner', order: 1 });
  const location = await Location.create({ name: 'Frisco HQ', address: '123 Main St' });
  const groupClass = await GroupClass.create({
    name: 'Beginner Foil',
    levelId: level._id,
    locationId: location._id,
    capacity: 10,
  });

  const coach = await User.create({
    role: 'coach',
    firstName: 'Eval',
    lastName: 'Coach',
    email: 'eval-coach@example.com',
    passwordHash: await hashPassword(TEST_PASSWORD),
  });
  const otherCoach = await User.create({
    role: 'coach',
    firstName: 'Other',
    lastName: 'Coach',
    email: 'eval-other-coach@example.com',
    passwordHash: await hashPassword(TEST_PASSWORD),
  });

  await User.create({
    role: 'admin',
    firstName: 'Test',
    lastName: 'Admin',
    email: 'eval-admin@example.com',
    passwordHash: await hashPassword(TEST_PASSWORD),
  });
  const adminAgent = await loginAgent('eval-admin@example.com');

  const scheduleRes = await adminAgent.post('/api/v1/group-class-schedules').send({
    classId: groupClass._id.toString(),
    coachId: coach._id.toString(),
    dayOfWeek: 3,
    startTime: '16:00',
    endTime: '17:00',
  });

  const scheduleId = scheduleRes.body.schedule._id;
  const sessions = await GroupClassSession.find({ scheduleId }).sort({ date: 1 });
  const session = sessions[0];

  const parent = await User.create({
    role: 'parent',
    firstName: 'P',
    lastName: 'Rent',
    email: 'eval-parent@example.com',
    passwordHash: await hashPassword(TEST_PASSWORD),
  });
  const student = await User.create({
    role: 'student',
    firstName: 'Kid',
    lastName: 'Eval',
    parentId: parent._id,
  });

  await visitService.markAttendance(student._id, session._id, scheduleId, classType, visitStatus, coach._id, 'coach');

  return { level, coach, otherCoach, adminAgent, parent, student, sessionId: session._id.toString() };
}

describe('Evaluation routes', () => {
  describe('POST /api/v1/evaluations', () => {
    it('lets the assigned coach evaluate a trial student they attended-marked', async () => {
      const { level, coach, student, sessionId } = await seedSessionWithVisit({ classType: 'trial' });
      const coachAgent = await loginAgent(coach.email);

      const res = await coachAgent.post('/api/v1/evaluations').send({
        studentId: student._id.toString(),
        groupClassSessionId: sessionId,
        assignedLevelId: level._id.toString(),
        notes: 'Great footwork, ready for regular classes.',
      });

      expect(res.status).toBe(201);
      expect(res.body.evaluation.coachId._id).toBe(coach._id.toString());
      expect(res.body.evaluation.assignedLevelId._id).toBe(level._id.toString());

      expect(mailService.sendTrialEvaluationEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: expect.objectContaining({ email: 'eval-parent@example.com' }),
          notes: 'Great footwork, ready for regular classes.',
        })
      );
    });

    it('always records coachId as the requesting user, even if a different coachId is sent in the body', async () => {
      const { level, coach, otherCoach, student, sessionId } = await seedSessionWithVisit({ classType: 'trial' });
      const coachAgent = await loginAgent(coach.email);

      const res = await coachAgent.post('/api/v1/evaluations').send({
        studentId: student._id.toString(),
        coachId: otherCoach._id.toString(), // attempted override — must be ignored
        groupClassSessionId: sessionId,
        assignedLevelId: level._id.toString(),
        notes: 'Notes.',
      });

      expect(res.status).toBe(201);
      expect(res.body.evaluation.coachId._id).toBe(coach._id.toString());
    });

    it('returns 403 for a coach not assigned to this session', async () => {
      const { level, otherCoach, student, sessionId } = await seedSessionWithVisit({ classType: 'trial' });
      const otherCoachAgent = await loginAgent(otherCoach.email);

      const res = await otherCoachAgent.post('/api/v1/evaluations').send({
        studentId: student._id.toString(),
        groupClassSessionId: sessionId,
        assignedLevelId: level._id.toString(),
        notes: 'Notes.',
      });

      expect(res.status).toBe(403);
    });

    it('returns 403 for a coach evaluating a non-trial (regular) attended Visit', async () => {
      const { level, coach, student, sessionId } = await seedSessionWithVisit({ classType: 'regular' });
      const coachAgent = await loginAgent(coach.email);

      const res = await coachAgent.post('/api/v1/evaluations').send({
        studentId: student._id.toString(),
        groupClassSessionId: sessionId,
        assignedLevelId: level._id.toString(),
        notes: 'Notes.',
      });

      expect(res.status).toBe(403);
    });

    it('lets an admin evaluate a regular (non-trial) attended Visit — unrestricted, unlike a coach', async () => {
      const { level, adminAgent, student, sessionId } = await seedSessionWithVisit({ classType: 'regular' });

      const res = await adminAgent.post('/api/v1/evaluations').send({
        studentId: student._id.toString(),
        groupClassSessionId: sessionId,
        assignedLevelId: level._id.toString(),
        notes: 'Admin note.',
      });

      expect(res.status).toBe(201);
    });

    it('returns 400 when the student was not present (no attended Visit)', async () => {
      const { level, coach, student, sessionId } = await seedSessionWithVisit({
        classType: 'trial',
        visitStatus: 'scheduled',
      });
      const coachAgent = await loginAgent(coach.email);

      const res = await coachAgent.post('/api/v1/evaluations').send({
        studentId: student._id.toString(),
        groupClassSessionId: sessionId,
        assignedLevelId: level._id.toString(),
        notes: 'Notes.',
      });

      expect(res.status).toBe(400);
    });

    it('returns 409 for a duplicate evaluation of the same student+session', async () => {
      const { level, coach, student, sessionId } = await seedSessionWithVisit({ classType: 'trial' });
      const coachAgent = await loginAgent(coach.email);

      await coachAgent.post('/api/v1/evaluations').send({
        studentId: student._id.toString(),
        groupClassSessionId: sessionId,
        assignedLevelId: level._id.toString(),
        notes: 'First.',
      });

      const res = await coachAgent.post('/api/v1/evaluations').send({
        studentId: student._id.toString(),
        groupClassSessionId: sessionId,
        assignedLevelId: level._id.toString(),
        notes: 'Second.',
      });

      expect(res.status).toBe(409);
    });

    it('returns 403 for a parent (not admin/coach/superadmin)', async () => {
      const { level, student, sessionId, parent } = await seedSessionWithVisit({ classType: 'trial' });
      const parentAgent = await loginAgent(parent.email);

      const res = await parentAgent.post('/api/v1/evaluations').send({
        studentId: student._id.toString(),
        groupClassSessionId: sessionId,
        assignedLevelId: level._id.toString(),
        notes: 'Notes.',
      });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/evaluations/student/:studentId', () => {
    it("lists a student's evaluations, most recent first", async () => {
      const { level, coach, student, sessionId } = await seedSessionWithVisit({ classType: 'trial' });
      const coachAgent = await loginAgent(coach.email);

      await coachAgent.post('/api/v1/evaluations').send({
        studentId: student._id.toString(),
        groupClassSessionId: sessionId,
        assignedLevelId: level._id.toString(),
        notes: 'Notes.',
      });

      const res = await coachAgent.get(`/api/v1/evaluations/student/${student._id}`);

      expect(res.status).toBe(200);
      expect(res.body.evaluations).toHaveLength(1);
    });
  });

  describe('PUT /api/v1/evaluations/:id', () => {
    it("lets the evaluating coach edit their own evaluation's level/notes", async () => {
      const { level, coach, student, sessionId } = await seedSessionWithVisit({ classType: 'trial' });
      const coachAgent = await loginAgent(coach.email);

      const createRes = await coachAgent.post('/api/v1/evaluations').send({
        studentId: student._id.toString(),
        groupClassSessionId: sessionId,
        assignedLevelId: level._id.toString(),
        notes: 'Original.',
      });

      const res = await coachAgent
        .put(`/api/v1/evaluations/${createRes.body.evaluation._id}`)
        .send({ notes: 'Updated notes.' });

      expect(res.status).toBe(200);
      expect(res.body.evaluation.notes).toBe('Updated notes.');
    });

    it("returns 403 when a different coach tries to edit someone else's evaluation", async () => {
      const { level, coach, otherCoach, student, sessionId } = await seedSessionWithVisit({ classType: 'trial' });
      const coachAgent = await loginAgent(coach.email);
      const otherCoachAgent = await loginAgent(otherCoach.email);

      const createRes = await coachAgent.post('/api/v1/evaluations').send({
        studentId: student._id.toString(),
        groupClassSessionId: sessionId,
        assignedLevelId: level._id.toString(),
        notes: 'Original.',
      });

      const res = await otherCoachAgent
        .put(`/api/v1/evaluations/${createRes.body.evaluation._id}`)
        .send({ notes: 'Hijacked.' });

      expect(res.status).toBe(403);

      const persisted = await Evaluation.findById(createRes.body.evaluation._id);
      expect(persisted.notes).toBe('Original.');
    });
  });
});
