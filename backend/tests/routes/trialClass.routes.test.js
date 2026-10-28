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
const Holiday = require('../../src/models/holiday.model');
const Service = require('../../src/models/service.model');
const TrialClass = require('../../src/models/trialClass.model');
const { hashPassword } = require('../../src/utils/password');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');
const { seedServices } = require('../../scripts/lib/seedServices');
const { createSession } = require('../testUtils/sessions');
const mailService = require('../../src/services/mail.service');

const TEST_PASSWORD = 'correct-password';

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

// Visit writes resolve their serviceId by Service code (ADR 010), so the
// Service registry must be seeded before any test writes a Visit.
beforeEach(async () => {
  jest.clearAllMocks();
  await seedServices();
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

  // The LAST generated session — always weeks in the future. sessions[0] may
  // be today's occurrence, which (docs/plans/session-start-time-cutoff-
  // plan.md) is un-bookable once its start time has passed, so using it
  // would make this suite depend on what time of day it runs.
  return {
    sessionId: sessions[sessions.length - 1]._id.toString(),
    // The second-to-last generated session — also always weeks ahead; the
    // reschedule tests move a trial between these two.
    otherSessionId: sessions[sessions.length - 2]._id.toString(),
    thirdSessionId: sessions[sessions.length - 3]._id.toString(),
    scheduleId,
  };
}

// docs/plans/trial-cancel-reschedule-plan.md — a parent with a trial booked
// through the real POST route, so the TrialClass row and its roster Visit are
// exactly what production writes.
async function seedBookedTrial(suffix) {
  const { sessionId, otherSessionId, thirdSessionId, scheduleId } = await seedSession();

  const parent = await seedUser({
    role: 'parent',
    email: `trial-${suffix}@example.com`,
    phone: '555-123-4567',
  });
  const student = await User.create({
    role: 'student',
    firstName: 'Kid',
    lastName: suffix,
    parentId: parent._id,
    dateOfBirth: new Date('2018-01-01'),
  });
  const parentAgent = await loginAgent(`trial-${suffix}@example.com`);

  const bookRes = await parentAgent.post('/api/v1/trial-classes').send({ studentId: student._id.toString(), sessionId });
  expect(bookRes.status).toBe(201);
  jest.clearAllMocks();

  return {
    parent,
    student,
    parentAgent,
    trialId: bookRes.body.trialClass._id,
    sessionId,
    otherSessionId,
    thirdSessionId,
    scheduleId,
  };
}

function findTrialVisit(studentId, sessionId) {
  return Visit.findOne({ studentId, groupClassSessionId: sessionId });
}

// A fixed past instant (docs/plans/session-start-time-cutoff-plan.md): the
// class has started, whatever the real clock reads.
function moveSessionIntoThePast(sessionId) {
  return GroupClassSession.updateOne(
    { _id: sessionId },
    {
      date: new Date('2020-01-01T00:00:00.000Z'),
      startsAt: new Date('2020-01-01T22:00:00.000Z'),
      endsAt: new Date('2020-01-01T23:00:00.000Z'),
    }
  );
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

      const secondSession = await createSession(
        { _id: scheduleId, startTime: '16:00', endTime: '17:00' },
        new Date('2030-01-01')
      );

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

    it('returns 400 booking a trial for a session that falls on an academy holiday (docs/plans/holiday-blocking-plan.md D7)', async () => {
      const { sessionId } = await seedSession();

      const session = await GroupClassSession.findById(sessionId);
      await Holiday.create({ name: 'Holiday', startDate: session.date, endDate: session.date });

      const parent = await seedUser({
        role: 'parent',
        email: 'trial-holiday@example.com',
        phone: '555-123-4567',
      });
      const student = await User.create({
        role: 'student',
        firstName: 'Kid',
        lastName: 'Holiday',
        parentId: parent._id,
        dateOfBirth: new Date('2018-01-01'),
      });
      const parentAgent = await loginAgent('trial-holiday@example.com');

      const res = await parentAgent.post('/api/v1/trial-classes').send({
        studentId: student._id.toString(),
        sessionId,
      });

      expect(res.status).toBe(400);
      expect(await Visit.findOne({ studentId: student._id, groupClassSessionId: sessionId })).toBeNull();
    });

    // docs/plans/session-start-time-cutoff-plan.md — a session whose start
    // instant has passed is not bookable, whether it began earlier today or
    // ran on a past day. Fixed historical instants, no clock dependence.
    it('returns 400 booking a trial into a session that has already started', async () => {
      const { sessionId } = await seedSession();

      await GroupClassSession.updateOne(
        { _id: sessionId },
        {
          date: new Date('2020-01-01T00:00:00.000Z'),
          startsAt: new Date('2020-01-01T22:00:00.000Z'),
          endsAt: new Date('2020-01-01T23:00:00.000Z'),
        }
      );

      const parent = await seedUser({
        role: 'parent',
        email: 'trial-started@example.com',
        phone: '555-123-4567',
      });
      const student = await User.create({
        role: 'student',
        firstName: 'Kid',
        lastName: 'Started',
        parentId: parent._id,
        dateOfBirth: new Date('2018-01-01'),
      });
      const parentAgent = await loginAgent('trial-started@example.com');

      const res = await parentAgent.post('/api/v1/trial-classes').send({
        studentId: student._id.toString(),
        sessionId,
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('This session has already started — choose a later date');
      expect(await Visit.findOne({ studentId: student._id, groupClassSessionId: sessionId })).toBeNull();
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
      // The confirmation goes to the FAMILY, not to the admin who booked it.
      expect(mailService.sendTrialConfirmationEmail).toHaveBeenCalledWith(
        expect.objectContaining({ parent: expect.objectContaining({ email: 'trial-gated-parent2@example.com' }) })
      );
    });
  });

  describe('DELETE /api/v1/trial-classes/:id (cancel)', () => {
    it("cancels a parent's own upcoming trial: the row is gone, the roster Visit is cancelled, and the child can book again", async () => {
      const { student, parentAgent, trialId, sessionId, otherSessionId } = await seedBookedTrial('cancel-ok');

      const res = await parentAgent.delete(`/api/v1/trial-classes/${trialId}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(await TrialClass.findById(trialId)).toBeNull();
      expect((await findTrialVisit(student._id, sessionId)).status).toBe('cancelled');
      // No cancellation email (plan D5).
      expect(mailService.sendTrialConfirmationEmail).not.toHaveBeenCalled();
      expect(mailService.sendTrialRescheduledEmail).not.toHaveBeenCalled();

      // Back to square one: the portal offers "Book a trial" again, and a
      // new booking succeeds.
      const mine = await parentAgent.get('/api/v1/students/mine');
      expect(mine.body.students[0].enrollment).toEqual({ status: 'not_enrolled', canBookTrial: true, schedule: null, trial: null });

      const rebook = await parentAgent
        .post('/api/v1/trial-classes')
        .send({ studentId: student._id.toString(), sessionId: otherSessionId });
      expect(rebook.status).toBe(201);
    });

    it("lets an admin cancel any family's upcoming trial", async () => {
      const { student, trialId, sessionId } = await seedBookedTrial('cancel-admin');
      await seedUser({ role: 'admin', email: 'admin-cancels-trial@example.com' });
      const adminAgent = await loginAgent('admin-cancels-trial@example.com');

      const res = await adminAgent.delete(`/api/v1/trial-classes/${trialId}`);

      expect(res.status).toBe(200);
      expect(await TrialClass.findById(trialId)).toBeNull();
      expect((await findTrialVisit(student._id, sessionId)).status).toBe('cancelled');
    });

    it('returns 400 once the trial class has started, and changes nothing', async () => {
      const { student, parentAgent, trialId, sessionId } = await seedBookedTrial('cancel-started');
      await moveSessionIntoThePast(sessionId);

      const res = await parentAgent.delete(`/api/v1/trial-classes/${trialId}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('This trial class has already started — it can no longer be changed');
      expect(await TrialClass.findById(trialId)).not.toBeNull();
      expect((await findTrialVisit(student._id, sessionId)).status).toBe('scheduled');
    });

    // Attendance opens on the class's own day and the kiosk signs students in
    // early, so a trial can be marked before its start instant.
    it.each(['attended', 'missed'])('returns 409 when the trial was already marked %s before it started, and changes nothing', async (status) => {
      const { student, parentAgent, trialId, sessionId } = await seedBookedTrial(`cancel-${status}`);
      await Visit.updateOne({ studentId: student._id, groupClassSessionId: sessionId }, { $set: { status } });

      const res = await parentAgent.delete(`/api/v1/trial-classes/${trialId}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Attendance has already been taken for this trial class — it can no longer be changed');
      expect(await TrialClass.findById(trialId)).not.toBeNull();
      expect((await findTrialVisit(student._id, sessionId)).status).toBe(status);
    });

    it("returns 400 when the trial's session was deleted, and keeps the trial row", async () => {
      const { parentAgent, trialId, sessionId } = await seedBookedTrial('cancel-orphan');
      await GroupClassSession.deleteOne({ _id: sessionId });

      const res = await parentAgent.delete(`/api/v1/trial-classes/${trialId}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('This trial class can no longer be changed');
      expect(await TrialClass.findById(trialId)).not.toBeNull();
    });

    it("returns 403 for another family's trial, and changes nothing", async () => {
      const { student, trialId, sessionId } = await seedBookedTrial('cancel-owner');
      await seedUser({ role: 'parent', email: 'trial-cancel-stranger@example.com' });
      const strangerAgent = await loginAgent('trial-cancel-stranger@example.com');

      const res = await strangerAgent.delete(`/api/v1/trial-classes/${trialId}`);

      expect(res.status).toBe(403);
      expect(await TrialClass.findById(trialId)).not.toBeNull();
      expect((await findTrialVisit(student._id, sessionId)).status).toBe('scheduled');
    });

    it.each(['coach', 'student', 'kiosk'])('returns 403 for a %s, and changes nothing', async (role) => {
      const { trialId } = await seedBookedTrial(`cancel-role-${role}`);
      await seedUser({ role, email: `trial-cancel-${role}@example.com` });
      const agent = await loginAgent(`trial-cancel-${role}@example.com`);

      const res = await agent.delete(`/api/v1/trial-classes/${trialId}`);

      expect(res.status).toBe(403);
      expect(await TrialClass.findById(trialId)).not.toBeNull();
    });

    it('returns 401 without a session, and changes nothing', async () => {
      const { trialId } = await seedBookedTrial('cancel-anon');

      const res = await request(app).delete(`/api/v1/trial-classes/${trialId}`);

      expect(res.status).toBe(401);
      expect(await TrialClass.findById(trialId)).not.toBeNull();
    });

    it('returns 404 for an unknown trial id', async () => {
      const { parentAgent } = await seedBookedTrial('cancel-unknown');

      const res = await parentAgent.delete(`/api/v1/trial-classes/${new mongoose.Types.ObjectId()}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Trial class not found');
    });

    it('returns 400 for a malformed trial id', async () => {
      const { parentAgent, trialId } = await seedBookedTrial('cancel-malformed');

      const res = await parentAgent.delete('/api/v1/trial-classes/not-an-id');

      expect(res.status).toBe(400);
      expect(await TrialClass.findById(trialId)).not.toBeNull();
    });
  });

  describe('PATCH /api/v1/trial-classes/:id (reschedule)', () => {
    it('moves the trial to the new session: old Visit cancelled, new Visit scheduled as a trial, family emailed', async () => {
      const { parent, student, parentAgent, trialId, sessionId, otherSessionId } = await seedBookedTrial('move-ok');

      const res = await parentAgent.patch(`/api/v1/trial-classes/${trialId}`).send({ sessionId: otherSessionId });

      expect(res.status).toBe(200);
      expect(res.body.trialClass._id).toBe(trialId);
      expect(res.body.trialClass.sessionId._id).toBe(otherSessionId);
      expect(String((await TrialClass.findById(trialId)).sessionId)).toBe(otherSessionId);

      expect((await findTrialVisit(student._id, sessionId)).status).toBe('cancelled');
      const newVisit = await findTrialVisit(student._id, otherSessionId);
      expect(newVisit.status).toBe('scheduled');
      expect(newVisit.classType).toBe('trial');

      expect(mailService.sendTrialRescheduledEmail).toHaveBeenCalledTimes(1);
      const emailArgs = mailService.sendTrialRescheduledEmail.mock.calls[0][0];
      expect(emailArgs.parent.email).toBe(parent.email);
      expect(String(emailArgs.session._id)).toBe(otherSessionId);
      expect(String(emailArgs.previousSession._id)).toBe(sessionId);
      expect(mailService.sendTrialConfirmationEmail).not.toHaveBeenCalled();
    });

    it('can move a trial back to its original session (the cancelled Visit is reactivated, not duplicated)', async () => {
      const { student, parentAgent, trialId, sessionId, otherSessionId } = await seedBookedTrial('move-back');

      const first = await parentAgent.patch(`/api/v1/trial-classes/${trialId}`).send({ sessionId: otherSessionId });
      expect(first.status).toBe(200);
      const res = await parentAgent.patch(`/api/v1/trial-classes/${trialId}`).send({ sessionId });

      expect(res.status).toBe(200);
      const originalVisits = await Visit.find({ studentId: student._id, groupClassSessionId: sessionId });
      expect(originalVisits).toHaveLength(1);
      expect(originalVisits[0].status).toBe('scheduled');
      expect((await findTrialVisit(student._id, otherSessionId)).status).toBe('cancelled');
    });

    it("lets an admin reschedule any family's trial, and emails the family, not the admin", async () => {
      const { parent, trialId, otherSessionId } = await seedBookedTrial('move-admin');
      await seedUser({ role: 'admin', email: 'admin-moves-trial@example.com' });
      const adminAgent = await loginAgent('admin-moves-trial@example.com');

      const res = await adminAgent.patch(`/api/v1/trial-classes/${trialId}`).send({ sessionId: otherSessionId });

      expect(res.status).toBe(200);
      expect(mailService.sendTrialRescheduledEmail.mock.calls[0][0].parent.email).toBe(parent.email);
    });

    describe('refusals — the original trial is left exactly as it was', () => {
      async function expectTrialUnchanged({ student, trialId, sessionId, otherSessionId }) {
        expect(String((await TrialClass.findById(trialId)).sessionId)).toBe(sessionId);
        expect(await findTrialVisit(student._id, otherSessionId)).toBeNull();
        expect(mailService.sendTrialRescheduledEmail).not.toHaveBeenCalled();
      }

      function patchTrial(agent, trialId, body) {
        return agent.patch(`/api/v1/trial-classes/${trialId}`).send(body);
      }

      it('returns 400 once the current trial class has started', async () => {
        const seeded = await seedBookedTrial('move-started');
        await moveSessionIntoThePast(seeded.sessionId);

        const res = await patchTrial(seeded.parentAgent, seeded.trialId, { sessionId: seeded.otherSessionId });

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('This trial class has already started — it can no longer be changed');
        await expectTrialUnchanged(seeded);
        expect((await findTrialVisit(seeded.student._id, seeded.sessionId)).status).toBe('scheduled');
      });

      it('returns 409 when the current trial was already marked attended', async () => {
        const seeded = await seedBookedTrial('move-attended');
        await Visit.updateOne({ studentId: seeded.student._id, groupClassSessionId: seeded.sessionId }, { $set: { status: 'attended' } });

        const res = await patchTrial(seeded.parentAgent, seeded.trialId, { sessionId: seeded.otherSessionId });

        expect(res.status).toBe(409);
        await expectTrialUnchanged(seeded);
        expect((await findTrialVisit(seeded.student._id, seeded.sessionId)).status).toBe('attended');
      });

      it('returns 400 when the new session has already started', async () => {
        const seeded = await seedBookedTrial('move-new-started');
        await moveSessionIntoThePast(seeded.otherSessionId);

        const res = await patchTrial(seeded.parentAgent, seeded.trialId, { sessionId: seeded.otherSessionId });

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('This session has already started — choose a later date');
        await expectTrialUnchanged(seeded);
        expect((await findTrialVisit(seeded.student._id, seeded.sessionId)).status).toBe('scheduled');
      });

      it('returns 400 when the new session falls on an academy holiday', async () => {
        const seeded = await seedBookedTrial('move-holiday');
        const newSession = await GroupClassSession.findById(seeded.otherSessionId);
        await Holiday.create({ name: 'Holiday', startDate: newSession.date, endDate: newSession.date });

        const res = await patchTrial(seeded.parentAgent, seeded.trialId, { sessionId: seeded.otherSessionId });

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('This session falls on an academy holiday');
        await expectTrialUnchanged(seeded);
      });

      it('returns 400 when the new session is the one already booked', async () => {
        const seeded = await seedBookedTrial('move-same');

        const res = await patchTrial(seeded.parentAgent, seeded.trialId, { sessionId: seeded.sessionId });

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('The trial is already booked for this class — choose a different date');
        await expectTrialUnchanged(seeded);
        expect((await findTrialVisit(seeded.student._id, seeded.sessionId)).status).toBe('scheduled');
      });

      it('returns 404 for an unknown new session', async () => {
        const seeded = await seedBookedTrial('move-no-session');

        const res = await patchTrial(seeded.parentAgent, seeded.trialId, { sessionId: new mongoose.Types.ObjectId().toString() });

        expect(res.status).toBe(404);
        expect(res.body.message).toBe('Group class session not found');
        await expectTrialUnchanged(seeded);
      });

      it('returns 400 when sessionId is missing', async () => {
        const seeded = await seedBookedTrial('move-no-body');

        const res = await patchTrial(seeded.parentAgent, seeded.trialId, {});

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('sessionId is required');
        await expectTrialUnchanged(seeded);
      });

      it("returns 403 for another family's trial", async () => {
        const seeded = await seedBookedTrial('move-owner');
        await seedUser({ role: 'parent', email: 'trial-move-stranger@example.com' });
        const strangerAgent = await loginAgent('trial-move-stranger@example.com');

        const res = await patchTrial(strangerAgent, seeded.trialId, { sessionId: seeded.otherSessionId });

        expect(res.status).toBe(403);
        await expectTrialUnchanged(seeded);
      });

      it.each(['coach', 'student', 'kiosk'])('returns 403 for a %s', async (role) => {
        const seeded = await seedBookedTrial(`move-role-${role}`);
        await seedUser({ role, email: `trial-move-${role}@example.com` });
        const agent = await loginAgent(`trial-move-${role}@example.com`);

        const res = await patchTrial(agent, seeded.trialId, { sessionId: seeded.otherSessionId });

        expect(res.status).toBe(403);
        await expectTrialUnchanged(seeded);
      });

      it('returns 401 without a session', async () => {
        const seeded = await seedBookedTrial('move-anon');

        const res = await patchTrial(request(app), seeded.trialId, { sessionId: seeded.otherSessionId });

        expect(res.status).toBe(401);
        await expectTrialUnchanged(seeded);
      });

      it('returns 404 for an unknown trial id', async () => {
        const seeded = await seedBookedTrial('move-unknown');

        const res = await patchTrial(seeded.parentAgent, new mongoose.Types.ObjectId().toString(), { sessionId: seeded.otherSessionId });

        expect(res.status).toBe(404);
        expect(res.body.message).toBe('Trial class not found');
        await expectTrialUnchanged(seeded);
      });
    });

    // A failure after the old Visit was released must put the original
    // booking back, so the parent never ends up with no trial at all. A
    // missing Service registry is a real way for the new Visit's write to
    // fail (visit.service.js resolves serviceId by code); the rollback
    // deliberately does not depend on it.
    it('rolls back to the original trial when writing the new roster Visit fails', async () => {
      const seeded = await seedBookedTrial('move-rollback');
      await Service.deleteMany({});
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      try {
        const res = await seeded.parentAgent.patch(`/api/v1/trial-classes/${seeded.trialId}`).send({ sessionId: seeded.otherSessionId });

        expect(res.status).toBe(500);
        expect(res.body).toEqual({ message: 'Something went wrong' });
        expect(String((await TrialClass.findById(seeded.trialId)).sessionId)).toBe(seeded.sessionId);
        expect((await findTrialVisit(seeded.student._id, seeded.sessionId)).status).toBe('scheduled');
        expect(await findTrialVisit(seeded.student._id, seeded.otherSessionId)).toBeNull();
        expect(mailService.sendTrialRescheduledEmail).not.toHaveBeenCalled();
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });
  });

  // A coach (or the kiosk) marking the trial in the instant between the
  // change's checks and its claim. The spy calls through to the REAL model
  // write; it only lands the attendance mark first, so the exact interleaving
  // runs deterministically instead of hoping a Promise.all hits it.
  describe('attendance taken between the checks and the claim (race)', () => {
    function markAttendedJustBefore(method, { student, sessionId }) {
      const original = TrialClass[method].bind(TrialClass);
      return jest.spyOn(TrialClass, method).mockImplementationOnce(async (...args) => {
        await Visit.updateOne({ studentId: student._id, groupClassSessionId: sessionId }, { $set: { status: 'attended' } });
        return original(...args);
      });
    }

    it('cancel: refuses with 409 and puts the trial row back as it was', async () => {
      const seeded = await seedBookedTrial('race-attend-cancel');
      const original = (await TrialClass.findById(seeded.trialId)).toObject();
      const spy = markAttendedJustBefore('findOneAndDelete', seeded);

      try {
        const res = await seeded.parentAgent.delete(`/api/v1/trial-classes/${seeded.trialId}`);

        expect(res.status).toBe(409);
        expect(res.body.message).toBe('Attendance has already been taken for this trial class — it can no longer be changed');
        // The very row that was deleted, timestamps included.
        expect((await TrialClass.findById(seeded.trialId)).toObject()).toEqual(original);
        expect((await findTrialVisit(seeded.student._id, seeded.sessionId)).status).toBe('attended');
      } finally {
        spy.mockRestore();
      }
    });

    it('reschedule: refuses with 409, keeps the trial on its session, and adds no Visit on the new one', async () => {
      const seeded = await seedBookedTrial('race-attend-move');
      const spy = markAttendedJustBefore('findOneAndUpdate', seeded);

      try {
        const res = await seeded.parentAgent.patch(`/api/v1/trial-classes/${seeded.trialId}`).send({ sessionId: seeded.otherSessionId });

        expect(res.status).toBe(409);
        expect(String((await TrialClass.findById(seeded.trialId)).sessionId)).toBe(seeded.sessionId);
        expect((await findTrialVisit(seeded.student._id, seeded.sessionId)).status).toBe('attended');
        expect(await findTrialVisit(seeded.student._id, seeded.otherSessionId)).toBeNull();
        expect(mailService.sendTrialRescheduledEmail).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  });

  // Another tab moving the trial in the instant between this change's checks
  // and its claim — same call-through spy technique as above.
  describe('trial moved elsewhere between the checks and the claim (race)', () => {
    function moveTrialJustBefore(method, { trialId, thirdSessionId }) {
      const original = TrialClass[method].bind(TrialClass);
      return jest.spyOn(TrialClass, method).mockImplementationOnce(async (...args) => {
        await TrialClass.updateOne({ _id: trialId }, { $set: { sessionId: thirdSessionId } });
        return original(...args);
      });
    }

    it('cancel: refuses with 409 and deletes nothing', async () => {
      const seeded = await seedBookedTrial('race-moved-cancel');
      const spy = moveTrialJustBefore('findOneAndDelete', seeded);

      try {
        const res = await seeded.parentAgent.delete(`/api/v1/trial-classes/${seeded.trialId}`);

        expect(res.status).toBe(409);
        expect(res.body.message).toBe('This trial was just changed somewhere else — reload the page and try again');
        expect(String((await TrialClass.findById(seeded.trialId)).sessionId)).toBe(seeded.thirdSessionId);
      } finally {
        spy.mockRestore();
      }
    });

    it('reschedule: refuses with 409 and writes no Visit on the requested session', async () => {
      const seeded = await seedBookedTrial('race-moved-move');
      const spy = moveTrialJustBefore('findOneAndUpdate', seeded);

      try {
        const res = await seeded.parentAgent.patch(`/api/v1/trial-classes/${seeded.trialId}`).send({ sessionId: seeded.otherSessionId });

        expect(res.status).toBe(409);
        expect(res.body.message).toBe('This trial was just changed somewhere else — reload the page and try again');
        expect(String((await TrialClass.findById(seeded.trialId)).sessionId)).toBe(seeded.thirdSessionId);
        expect(await findTrialVisit(seeded.student._id, seeded.otherSessionId)).toBeNull();
        expect(mailService.sendTrialRescheduledEmail).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  });

  // Simultaneity IS the thing under test (docs/TESTING_STRATEGY.md isolation
  // rule 4): two tabs changing the same trial at once. Whichever wins, the
  // trial must end up consistent: the roster holds exactly one active Visit,
  // on the trial's own session, or none when the trial is gone.
  describe('concurrent changes to the same trial', () => {
    async function expectRosterMatchesTrial(studentId) {
      const trial = await TrialClass.findOne({ studentId });
      const activeVisits = await Visit.find({ studentId, status: { $ne: 'cancelled' } });

      if (trial) {
        expect(activeVisits).toHaveLength(1);
        expect(String(activeVisits[0].groupClassSessionId)).toBe(String(trial.sessionId));
      } else {
        expect(activeVisits).toHaveLength(0);
      }
    }

    function expectOneWinner(responses) {
      const statuses = responses.map((res) => res.status);
      expect(statuses).toContain(200);
      statuses.forEach((status) => expect([200, 404, 409]).toContain(status));
    }

    it('a cancel and a reschedule: the roster matches the trial whichever wins', async () => {
      const { student, parentAgent, trialId, otherSessionId } = await seedBookedTrial('race-cancel-move');

      const responses = await Promise.all([
        parentAgent.delete(`/api/v1/trial-classes/${trialId}`),
        parentAgent.patch(`/api/v1/trial-classes/${trialId}`).send({ sessionId: otherSessionId }),
      ]);

      expectOneWinner(responses);
      await expectRosterMatchesTrial(student._id);
    });

    it('two reschedules to different classes: the roster matches the trial whichever wins', async () => {
      const { student, parentAgent, trialId, otherSessionId, thirdSessionId } = await seedBookedTrial('race-move-move');

      const responses = await Promise.all([
        parentAgent.patch(`/api/v1/trial-classes/${trialId}`).send({ sessionId: otherSessionId }),
        parentAgent.patch(`/api/v1/trial-classes/${trialId}`).send({ sessionId: thirdSessionId }),
      ]);

      expectOneWinner(responses);
      await expectRosterMatchesTrial(student._id);
    });
  });
});
