process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

// mail.service is mocked — this suite asserts which emails fire, not their
// content (mail.service.test.js covers rendering).
jest.mock('../../src/services/mail.service');

const request = require('supertest');

const app = require('../../src/app');
const Visit = require('../../src/models/visit.model');
const Registration = require('../../src/models/registration.model');
const PrivateClassEnrollment = require('../../src/models/privateClassEnrollment.model');
const PrivateClassSession = require('../../src/models/privateClassSession.model');
const mailService = require('../../src/services/mail.service');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');
const { seedServices } = require('../../scripts/lib/seedServices');
const {
  freezeDate,
  seedCoachWithRules,
  seedParentWithStudent,
  seedActiveEnrollment,
  seedBooking,
} = require('../testUtils/privateLessons');

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

beforeEach(async () => {
  freezeDate();
  await seedServices();
});

afterEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  await clearTestDB();
});

// A coach (Tuesdays 16:30 + 17:00, 30 min) and a parent whose child already
// holds a paid purchase of `quantity` 30-minute credits.
async function seedCreditScene(suffix, { quantity = 10, sessionsUsed = 0 } = {}) {
  const coachScene = await seedCoachWithRules({ suffix });
  const parentScene = await seedParentWithStudent(suffix);
  const enrollment = await seedActiveEnrollment({
    parent: parentScene.parent,
    student: parentScene.student,
    coach: coachScene.coach,
    contract: coachScene.contract,
    quantity,
    sessionsUsed,
  });

  return { ...coachScene, ...parentScene, enrollment, slot: coachScene.schedules[0], lateSlot: coachScene.schedules[1] };
}

function book(parentAgent, { student, slot, day = '2026-10-06' }) {
  return parentAgent.post('/api/v1/private-class-sessions').send({
    studentId: student._id.toString(),
    scheduleId: String(slot._id),
    day,
  });
}

// docs/decisions/011-private-per-session-booking.md
describe('Private class session (booking) routes', () => {
  describe('POST / (book with an already-paid session)', () => {
    it('uses one credit, confirms the booking, creates the scheduled Visit, writes no ledger row, and emails parent + coach', async () => {
      const { parentAgent, student, slot, enrollment } = await seedCreditScene('credit');

      const res = await book(parentAgent, { student, slot });

      expect(res.status).toBe(201);
      expect(res.body.remaining).toBe(9);
      expect((await PrivateClassEnrollment.findById(enrollment._id)).sessionsUsed).toBe(1);

      const session = await PrivateClassSession.findById(res.body.session._id);
      expect(session.status).toBe('confirmed');
      expect(String(session.enrollmentId)).toBe(String(enrollment._id));
      expect(await Visit.findOne({ privateClassSessionId: session._id })).toMatchObject({ status: 'scheduled' });
      expect(await Registration.countDocuments({})).toBe(0);

      const confirmation = mailService.sendPrivateClassBookingConfirmationEmail.mock.calls[0][0];
      expect(confirmation.purchaseRow).toBeNull();
      expect(mailService.sendPrivateClassCoachBookingEmail).toHaveBeenCalledTimes(1);
    });

    it('draws from the oldest purchase that still has a credit, skipping an exhausted one', async () => {
      const scene = await seedCreditScene('oldest', { quantity: 2, sessionsUsed: 2 });
      const older = await seedActiveEnrollment({
        ...scene,
        quantity: 5,
        sessionsUsed: 1,
        createdAt: new Date('2026-01-01T12:00:00.000Z'),
      });
      const newer = await seedActiveEnrollment({ ...scene, quantity: 5 });

      const res = await book(scene.parentAgent, { student: scene.student, slot: scene.slot });

      expect(res.status).toBe(201);
      expect(res.body.session.enrollmentId).toBe(String(older._id));
      expect((await PrivateClassEnrollment.findById(older._id)).sessionsUsed).toBe(2);
      expect((await PrivateClassEnrollment.findById(newer._id)).sessionsUsed).toBe(0);
      expect((await PrivateClassEnrollment.findById(scene.enrollment._id)).sessionsUsed).toBe(2);
    });

    it('returns 409 with no usable credit (none left, or only credits of another length), writing nothing', async () => {
      const scene = await seedCreditScene('none', { quantity: 1, sessionsUsed: 1 });
      await seedActiveEnrollment({ ...scene, quantity: 5, sessionDurationMinutes: 60 });

      const res = await book(scene.parentAgent, { student: scene.student, slot: scene.slot });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/no 30-minute sessions left/);
      expect(await PrivateClassSession.countDocuments({})).toBe(0);
    });

    it('returns 409 when the slot is already held, and gives the credit straight back', async () => {
      const scene = await seedCreditScene('taken');
      const other = await seedCreditScene('taken-other');
      await seedBooking({ schedule: scene.slot, day: '2026-10-06', enrollment: other.enrollment });

      const res = await book(scene.parentAgent, { student: scene.student, slot: scene.slot });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/just taken/);
      expect((await PrivateClassEnrollment.findById(scene.enrollment._id)).sessionsUsed).toBe(0);
    });

    it('two bookings racing for the last credit: exactly one succeeds', async () => {
      const scene = await seedCreditScene('last', { quantity: 1 });

      const results = await Promise.all([
        book(scene.parentAgent, { student: scene.student, slot: scene.slot }),
        book(scene.parentAgent, { student: scene.student, slot: scene.lateSlot }),
      ]);

      expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
      expect((await PrivateClassEnrollment.findById(scene.enrollment._id)).sessionsUsed).toBe(1);
      expect(await PrivateClassSession.countDocuments({ status: 'confirmed' })).toBe(1);
    });

    it('honors paid credits even after the coach stops taking new students', async () => {
      const scene = await seedCreditScene('honor');
      scene.contract.isActive = false;
      await scene.contract.save();

      expect((await book(scene.parentAgent, { student: scene.student, slot: scene.slot })).status).toBe(201);
    });

    it('returns 400 for an unbookable day and 403 for a coach', async () => {
      const scene = await seedCreditScene('bad-day');

      expect((await book(scene.parentAgent, { student: scene.student, slot: scene.slot, day: '2026-10-07' })).status).toBe(400);
      expect((await book(scene.coachAgent, { student: scene.student, slot: scene.slot })).status).toBe(403);
      expect((await PrivateClassEnrollment.findById(scene.enrollment._id)).sessionsUsed).toBe(0);
    });
  });

  describe('PATCH /:id/attendance', () => {
    async function bookedAndStarted(suffix) {
      const scene = await seedCreditScene(suffix);
      const res = await book(scene.parentAgent, { student: scene.student, slot: scene.slot });
      freezeDate(new Date('2026-10-06T21:35:00.000Z')); // lesson started 4:30 PM CDT
      return { ...scene, sessionId: res.body.session._id };
    }

    it('records attended/missed on the Visit (coach, then a re-mark), and never moves money', async () => {
      const { coachAgent, coach, sessionId } = await bookedAndStarted('attend');

      const attended = await coachAgent.patch(`/api/v1/private-class-sessions/${sessionId}/attendance`).send({ status: 'attended' });

      expect(attended.status).toBe(200);
      expect(attended.body.session.attendance).toBe('attended');
      const visit = await Visit.findOne({ privateClassSessionId: sessionId });
      expect(visit).toMatchObject({ status: 'attended', markedVia: 'coach' });
      expect(String(visit.markedBy)).toBe(String(coach._id));

      const missed = await coachAgent.patch(`/api/v1/private-class-sessions/${sessionId}/attendance`).send({ status: 'missed' });
      expect(missed.body.visit.status).toBe('missed');
      expect(await Visit.countDocuments({ privateClassSessionId: sessionId })).toBe(1);
      expect(await Registration.countDocuments({})).toBe(0);
    });

    it("lets an admin mark (markedVia 'admin') and forbids another coach", async () => {
      const { adminAgent, sessionId } = await bookedAndStarted('attend-admin');
      const { coachAgent: otherCoach } = await seedCoachWithRules({ suffix: 'attend-other', rules: null });

      expect((await otherCoach.patch(`/api/v1/private-class-sessions/${sessionId}/attendance`).send({ status: 'attended' })).status).toBe(403);

      const res = await adminAgent.patch(`/api/v1/private-class-sessions/${sessionId}/attendance`).send({ status: 'attended' });
      expect(res.status).toBe(200);
      expect(res.body.visit.markedVia).toBe('admin');
    });

    it('returns 400 before the lesson starts and for an invalid status; 409 for a cancelled booking', async () => {
      const scene = await seedCreditScene('attend-early');
      const res = await book(scene.parentAgent, { student: scene.student, slot: scene.slot });
      const url = `/api/v1/private-class-sessions/${res.body.session._id}/attendance`;

      expect((await scene.coachAgent.patch(url).send({ status: 'attended' })).status).toBe(400);

      await scene.parentAgent.post(`/api/v1/private-class-sessions/${res.body.session._id}/cancel`);
      freezeDate(new Date('2026-10-06T21:35:00.000Z'));
      expect((await scene.coachAgent.patch(url).send({ status: 'attended' })).status).toBe(409);

      // The 5:00 PM slot the same day (kept within the 7-day login token).
      const booked = await book(scene.parentAgent, { student: scene.student, slot: scene.lateSlot, day: '2026-10-06' });
      freezeDate(new Date('2026-10-06T22:05:00.000Z'));
      const bad = await scene.coachAgent.patch(`/api/v1/private-class-sessions/${booked.body.session._id}/attendance`).send({ status: 'late' });
      expect(bad.status).toBe(400);
    });
  });

  describe('POST /:id/cancel', () => {
    async function bookedScene(suffix) {
      const scene = await seedCreditScene(suffix);
      const res = await book(scene.parentAgent, { student: scene.student, slot: scene.slot });
      return { ...scene, sessionId: res.body.session._id };
    }

    it('a parent more than 24h ahead: the credit comes back, the Visit is cancelled, the slot reopens, the email goes out', async () => {
      const { parentAgent, enrollment, sessionId, slot } = await bookedScene('cancel');

      const res = await parentAgent.post(`/api/v1/private-class-sessions/${sessionId}/cancel`);

      expect(res.status).toBe(200);
      expect(res.body.remaining).toBe(10);
      expect(res.body.session.status).toBe('cancelled');
      expect((await PrivateClassEnrollment.findById(enrollment._id)).sessionsUsed).toBe(0);
      expect((await Visit.findOne({ privateClassSessionId: sessionId })).status).toBe('cancelled');
      expect(mailService.sendPrivateClassBookingCancelledEmail).toHaveBeenCalledTimes(1);

      const dates = await request(app).get(`/api/v1/private-class-schedules/${slot._id}/available-dates?days=2`);
      expect(dates.body.dates.map((date) => date.day)).toEqual(['2026-10-06']);
    });

    it('a parent inside the 24h cutoff gets 409; the coach may still cancel until the lesson starts', async () => {
      const { parentAgent, coachAgent, sessionId } = await bookedScene('cutoff');
      freezeDate(new Date('2026-10-05T22:00:00.000Z')); // 23.5h before 4:30 PM Tuesday

      const parentTry = await parentAgent.post(`/api/v1/private-class-sessions/${sessionId}/cancel`);
      expect(parentTry.status).toBe(409);
      expect(parentTry.body.message).toMatch(/24 hours/);

      freezeDate(new Date('2026-10-06T21:00:00.000Z')); // 30 minutes before
      expect((await coachAgent.post(`/api/v1/private-class-sessions/${sessionId}/cancel`)).status).toBe(200);
    });

    it('nobody can cancel once the lesson started, a second cancel is a 409, and another parent gets 403', async () => {
      const scene = await bookedScene('cancel-late');
      const { parentAgent: stranger } = await seedParentWithStudent('cancel-stranger');

      expect((await stranger.post(`/api/v1/private-class-sessions/${scene.sessionId}/cancel`)).status).toBe(403);

      expect((await scene.adminAgent.post(`/api/v1/private-class-sessions/${scene.sessionId}/cancel`)).status).toBe(200);
      expect((await scene.adminAgent.post(`/api/v1/private-class-sessions/${scene.sessionId}/cancel`)).status).toBe(409);
      expect((await PrivateClassEnrollment.findById(scene.enrollment._id)).sessionsUsed).toBe(0);

      const again = await book(scene.parentAgent, { student: scene.student, slot: scene.slot });
      freezeDate(new Date('2026-10-06T21:31:00.000Z'));
      const started = await scene.adminAgent.post(`/api/v1/private-class-sessions/${again.body.session._id}/cancel`);
      expect(started.status).toBe(409);
      expect(started.body.message).toMatch(/already started/);
    });
  });

  describe('GET /mine (coach) and GET / (admin)', () => {
    it('splits a coach\'s bookings into upcoming, unmarked (started, not yet marked) and past, reading attendance from the Visit', async () => {
      const scene = await seedCreditScene('windows');
      const first = await book(scene.parentAgent, { student: scene.student, slot: scene.slot, day: '2026-10-06' });
      const second = await book(scene.parentAgent, { student: scene.student, slot: scene.lateSlot, day: '2026-10-06' });
      await book(scene.parentAgent, { student: scene.student, slot: scene.slot, day: '2026-10-20' });
      freezeDate(new Date('2026-10-07T14:00:00.000Z'));
      await scene.coachAgent.patch(`/api/v1/private-class-sessions/${first.body.session._id}/attendance`).send({ status: 'attended' });

      const upcoming = await scene.coachAgent.get('/api/v1/private-class-sessions/mine?window=upcoming');
      const unmarked = await scene.coachAgent.get('/api/v1/private-class-sessions/mine?window=unmarked');
      const past = await scene.coachAgent.get('/api/v1/private-class-sessions/mine?window=past');

      expect(upcoming.body.sessions.map((session) => session.startDate)).toEqual(['2026-10-20T21:30:00.000Z']);
      expect(unmarked.body.sessions.map((session) => session._id)).toEqual([second.body.session._id]);
      expect(past.body.sessions.map((session) => session.attendance).sort()).toEqual(['attended', 'scheduled']);
      expect(upcoming.body.sessions[0].studentId.firstName).toBe('Sam');
      expect((await scene.coachAgent.get('/api/v1/private-class-sessions/mine?window=bogus')).status).toBe(400);
    });

    it('lists every booking for an admin (confirmed + cancelled by default), filterable, and 400s an unknown status', async () => {
      const scene = await seedCreditScene('admin-list');
      const kept = await book(scene.parentAgent, { student: scene.student, slot: scene.slot });
      const dropped = await book(scene.parentAgent, { student: scene.student, slot: scene.lateSlot });
      await scene.parentAgent.post(`/api/v1/private-class-sessions/${dropped.body.session._id}/cancel`);

      const all = await scene.adminAgent.get('/api/v1/private-class-sessions');
      const cancelledOnly = await scene.adminAgent.get('/api/v1/private-class-sessions?status=cancelled');

      expect(all.body.sessions).toHaveLength(2);
      expect(cancelledOnly.body.sessions.map((session) => session._id)).toEqual([dropped.body.session._id]);
      expect(cancelledOnly.body.sessions[0].attendance).toBe('cancelled');
      expect(all.body.sessions.find((session) => session._id === kept.body.session._id).coachId.firstName).toBe('Dana');
      expect((await scene.adminAgent.get('/api/v1/private-class-sessions?status=bogus')).status).toBe(400);
    });
  });
});
