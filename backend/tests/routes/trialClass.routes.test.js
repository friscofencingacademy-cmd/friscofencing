process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

// Mocked so this suite never touches nodemailer/Ethereal — confirmation
// email is Phase 10's own concern (see mail.service.test.js), unrelated to
// what these routes tests exist to cover.
jest.mock('../../src/services/mail.service');

const request = require('supertest');
const mongoose = require('mongoose');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const Level = require('../../src/models/level.model');
const Location = require('../../src/models/location.model');
const GroupClass = require('../../src/models/groupClass.model');
const GroupClassSession = require('../../src/models/groupClassSession.model');
const Visit = require('../../src/models/visit.model');
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

async function seedUser(overrides = {}) {
  const passwordHash = await hashPassword(TEST_PASSWORD);

  return User.create({
    firstName: 'Test',
    lastName: 'User',
    passwordHash,
    ...overrides,
  });
}

async function loginAgent(email) {
  const agent = request.agent(app);

  await agent.post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD });

  return agent;
}

// Builds a real class/schedule (via the real create route, so sessions are
// generated the same way production does) and returns the first generated
// session's id, plus the scheduleId for building a second session off it.
async function seedSession() {
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
    firstName: 'Coach',
    lastName: 'Trial',
    email: 'coach-trial@example.com',
    passwordHash: await hashPassword(TEST_PASSWORD),
  });

  await seedUser({ role: 'admin', email: 'admin-trial-setup@example.com' });
  const adminAgent = await loginAgent('admin-trial-setup@example.com');

  const scheduleRes = await adminAgent.post('/api/v1/group-class-schedules').send({
    classId: groupClass._id.toString(),
    coachId: coach._id.toString(),
    dayOfWeek: 3,
    startTime: '16:00',
    endTime: '17:00',
  });

  expect(scheduleRes.status).toBe(201);

  const scheduleId = scheduleRes.body.schedule._id;
  const sessions = await GroupClassSession.find({ scheduleId }).sort({ date: 1 });

  return { sessionId: sessions[0]._id.toString(), scheduleId };
}

describe('TrialClass routes', () => {
  describe('POST /api/v1/trial-classes', () => {
    it("lets a parent book a trial for their own child, adding them to the session's roster", async () => {
      const { sessionId } = await seedSession();

      const parent = await seedUser({
        role: 'parent',
        email: 'trial-parent@example.com',
        phone: '555-123-4567',
      });
      const student = await User.create({
        role: 'student',
        firstName: 'Kid',
        lastName: 'Trial',
        parentId: parent._id,
        dateOfBirth: new Date('2018-01-01'),
      });
      const parentAgent = await loginAgent('trial-parent@example.com');

      const res = await parentAgent.post('/api/v1/trial-classes').send({
        studentId: student._id.toString(),
        sessionId,
      });

      expect(res.status).toBe(201);

      // Confirms a scheduled Visit was created (trialClass.service.js's
      // replacement for the old session.students roster push — docs/plans/
      // premium-registration-and-attendance-plan.md §3.7).
      const visit = await Visit.findOne({ studentId: student._id, groupClassSessionId: sessionId });
      expect(visit).not.toBeNull();
      expect(visit.status).toBe('scheduled');
      expect(visit.classType).toBe('trial');

      // Confirms the mail wiring actually fires with the right participants
      // (not just that mocking it doesn't break the route). Compared by
      // email/name rather than _id — asymmetric matchers don't reliably
      // deep-equal raw ObjectId instances.
      expect(mailService.sendTrialConfirmationEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: expect.objectContaining({ email: parent.email }),
          student: expect.objectContaining({ firstName: student.firstName }),
        })
      );
    });

    it('returns 403 when booking for a child belonging to a different parent', async () => {
      const { sessionId } = await seedSession();

      await seedUser({ role: 'parent', email: 'trial-parent2@example.com' });
      const otherParent = await seedUser({ role: 'parent', email: 'trial-other-parent@example.com' });
      const student = await User.create({
        role: 'student',
        firstName: 'Kid',
        lastName: 'NotMine',
        parentId: otherParent._id,
      });
      const parentAgent = await loginAgent('trial-parent2@example.com');

      const res = await parentAgent.post('/api/v1/trial-classes').send({
        studentId: student._id.toString(),
        sessionId,
      });

      expect(res.status).toBe(403);
    });

    it('returns 409 when booking a second trial for the same student, even for a different session', async () => {
      const { sessionId, scheduleId } = await seedSession();

      const secondSession = await GroupClassSession.create({
        scheduleId,
        date: new Date('2030-01-01'),
        students: [],
      });

      const parent = await seedUser({
        role: 'parent',
        email: 'trial-parent3@example.com',
        phone: '555-123-4567',
      });
      const student = await User.create({
        role: 'student',
        firstName: 'Kid',
        lastName: 'Dup',
        parentId: parent._id,
        dateOfBirth: new Date('2018-01-01'),
      });
      const parentAgent = await loginAgent('trial-parent3@example.com');

      const firstRes = await parentAgent.post('/api/v1/trial-classes').send({
        studentId: student._id.toString(),
        sessionId,
      });
      expect(firstRes.status).toBe(201);

      const secondRes = await parentAgent.post('/api/v1/trial-classes').send({
        studentId: student._id.toString(),
        sessionId: secondSession._id.toString(),
      });

      expect(secondRes.status).toBe(409);
    });

    it('returns 404 for a nonexistent sessionId', async () => {
      const parent = await seedUser({
        role: 'parent',
        email: 'trial-parent4@example.com',
        phone: '555-123-4567',
      });
      const student = await User.create({
        role: 'student',
        firstName: 'Kid',
        lastName: 'NoSession',
        parentId: parent._id,
        dateOfBirth: new Date('2018-01-01'),
      });
      const parentAgent = await loginAgent('trial-parent4@example.com');

      const fakeSessionId = new mongoose.Types.ObjectId().toString();

      const res = await parentAgent.post('/api/v1/trial-classes').send({
        studentId: student._id.toString(),
        sessionId: fakeSessionId,
      });

      expect(res.status).toBe(404);
    });

    // docs/plans/trial-registration-required-fields-plan.md §1.4 — the
    // actual backstop for phone/date-of-birth being "mandatory for trial
    // class registration," including for an account/child that existed
    // before these fields did.
    it('returns 400 when the requesting parent has no phone on file', async () => {
      const { sessionId } = await seedSession();

      const parent = await seedUser({ role: 'parent', email: 'trial-no-phone@example.com' });
      const student = await User.create({
        role: 'student',
        firstName: 'Kid',
        lastName: 'NoPhoneParent',
        parentId: parent._id,
        dateOfBirth: new Date('2018-01-01'),
      });
      const parentAgent = await loginAgent('trial-no-phone@example.com');

      const res = await parentAgent.post('/api/v1/trial-classes').send({
        studentId: student._id.toString(),
        sessionId,
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/phone number/i);
    });

    it('returns 400 when the student has no date of birth on file', async () => {
      const { sessionId } = await seedSession();

      const parent = await seedUser({
        role: 'parent',
        email: 'trial-no-dob@example.com',
        phone: '555-123-4567',
      });
      const student = await User.create({
        role: 'student',
        firstName: 'NoBirthdayKid',
        lastName: 'Trial',
        parentId: parent._id,
      });
      const parentAgent = await loginAgent('trial-no-dob@example.com');

      const res = await parentAgent.post('/api/v1/trial-classes').send({
        studentId: student._id.toString(),
        sessionId,
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/date of birth/i);
    });

    it("checks the FAMILY's phone, not the admin's own, for an admin-initiated booking", async () => {
      const { sessionId } = await seedSession();

      // Deliberately no `phone` on the admin — admins never have one in
      // practice (the admin dialog doesn't even collect it). If the gate
      // checked requestingUser.phone unconditionally, every admin-initiated
      // booking would fail here regardless of the family's real data.
      await seedUser({ role: 'admin', email: 'trial-admin-gate@example.com' });
      const parent = await seedUser({ role: 'parent', email: 'trial-gated-parent@example.com' });
      const student = await User.create({
        role: 'student',
        firstName: 'Kid',
        lastName: 'AdminBooked',
        parentId: parent._id,
        dateOfBirth: new Date('2018-01-01'),
      });
      const adminAgent = await loginAgent('trial-admin-gate@example.com');

      const res = await adminAgent.post('/api/v1/trial-classes').send({
        studentId: student._id.toString(),
        sessionId,
      });

      // The family (the student's own parent) has no phone either, so this
      // still 400s — but on the FAMILY's missing phone, not a false
      // "admin's own phone is missing" reason. Proven by the second case
      // below, where giving the family a phone lets the booking succeed.
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/phone number/i);
    });

    it('lets an admin-initiated booking succeed once the FAMILY (not the admin) has both fields on file', async () => {
      const { sessionId } = await seedSession();

      await seedUser({ role: 'admin', email: 'trial-admin-gate2@example.com' });
      const parent = await seedUser({
        role: 'parent',
        email: 'trial-gated-parent2@example.com',
        phone: '555-123-4567',
      });
      const student = await User.create({
        role: 'student',
        firstName: 'Kid',
        lastName: 'AdminBookedOk',
        parentId: parent._id,
        dateOfBirth: new Date('2018-01-01'),
      });
      const adminAgent = await loginAgent('trial-admin-gate2@example.com');

      const res = await adminAgent.post('/api/v1/trial-classes').send({
        studentId: student._id.toString(),
        sessionId,
      });

      expect(res.status).toBe(201);
    });
  });
});
