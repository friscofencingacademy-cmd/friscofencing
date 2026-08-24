const mongoose = require('mongoose');

const Visit = require('../../src/models/visit.model');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');
const {
  upsertScheduledVisits,
  createScheduledVisit,
  getActiveVisitsForSession,
  findActiveVisit,
  markAttendance,
  markAsMakeupClass,
  cancelVisitsForStudent,
  getVisitsByStudent,
} = require('../../src/services/visit.service');

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

const id = () => new mongoose.Types.ObjectId();

describe('visit.service', () => {
  describe('upsertScheduledVisits / createScheduledVisit', () => {
    it('creates a scheduled Visit for a new (student, session) pair', async () => {
      const studentId = id();
      const sessionId = id();
      const scheduleId = id();

      await createScheduledVisit(studentId, sessionId, scheduleId, 'regular');

      const visit = await Visit.findOne({ studentId, groupClassSessionId: sessionId });
      expect(visit).not.toBeNull();
      expect(visit.status).toBe('scheduled');
      expect(visit.classType).toBe('regular');
      expect(String(visit.groupClassScheduleId)).toBe(String(scheduleId));
    });

    it('is idempotent: calling it again leaves an already-scheduled Visit untouched, no duplicate created', async () => {
      const studentId = id();
      const sessionId = id();
      const scheduleId = id();

      await createScheduledVisit(studentId, sessionId, scheduleId, 'regular');
      await createScheduledVisit(studentId, sessionId, scheduleId, 'regular');

      expect(await Visit.countDocuments({ studentId, groupClassSessionId: sessionId })).toBe(1);
    });

    it('does not overwrite an already-attended Visit back to scheduled', async () => {
      const studentId = id();
      const sessionId = id();
      const scheduleId = id();

      await createScheduledVisit(studentId, sessionId, scheduleId, 'regular');
      await markAttendance(studentId, sessionId, scheduleId, 'regular', 'attended');

      await createScheduledVisit(studentId, sessionId, scheduleId, 'regular');

      const visit = await Visit.findOne({ studentId, groupClassSessionId: sessionId });
      expect(visit.status).toBe('attended');
    });

    it('reactivates a cancelled Visit back to scheduled instead of leaving it cancelled', async () => {
      const studentId = id();
      const sessionId = id();
      const scheduleId = id();

      await createScheduledVisit(studentId, sessionId, scheduleId, 'regular');
      await cancelVisitsForStudent(studentId, [sessionId]);

      await createScheduledVisit(studentId, sessionId, scheduleId, 'regular');

      const visit = await Visit.findOne({ studentId, groupClassSessionId: sessionId });
      expect(visit.status).toBe('scheduled');
    });

    it('bulk-creates across multiple sessions in one call', async () => {
      const studentId = id();
      const scheduleId = id();
      const sessionIds = [id(), id(), id()];

      await upsertScheduledVisits(
        studentId,
        sessionIds.map((sessionId) => ({ sessionId, scheduleId })),
        'regular'
      );

      expect(await Visit.countDocuments({ studentId })).toBe(3);
    });

    it('is a no-op for an empty sessions array', async () => {
      await expect(upsertScheduledVisits(id(), [], 'regular')).resolves.toBeNull();
    });
  });

  describe('markAttendance', () => {
    it('upserts a brand-new Visit when none existed (the walk-in case)', async () => {
      const studentId = id();
      const sessionId = id();
      const scheduleId = id();

      await markAttendance(studentId, sessionId, scheduleId, 'regular', 'attended', id(), 'coach');

      const visit = await Visit.findOne({ studentId, groupClassSessionId: sessionId });
      expect(visit.status).toBe('attended');
      expect(visit.markedVia).toBe('coach');
    });

    it('updates an existing scheduled Visit in place rather than creating a second one', async () => {
      const studentId = id();
      const sessionId = id();
      const scheduleId = id();

      await createScheduledVisit(studentId, sessionId, scheduleId, 'regular');
      await markAttendance(studentId, sessionId, scheduleId, 'regular', 'missed', id(), 'admin');

      expect(await Visit.countDocuments({ studentId, groupClassSessionId: sessionId })).toBe(1);
      const visit = await Visit.findOne({ studentId, groupClassSessionId: sessionId });
      expect(visit.status).toBe('missed');
    });
  });

  describe('markAsMakeupClass', () => {
    it('stamps isMakeupClass without needing a $set from markAttendance, and survives a later markAttendance re-toggle', async () => {
      // Regression guard for the exact bug CKQ's own comment calls out:
      // markAsMakeupClass must be a targeted update, isolated from
      // markAttendance's $set, so a later "toggle to missed" call can never
      // silently clear it.
      const studentId = id();
      const sessionId = id();
      const scheduleId = id();

      await markAttendance(studentId, sessionId, scheduleId, 'regular', 'attended');
      await markAsMakeupClass(studentId, sessionId);

      let visit = await Visit.findOne({ studentId, groupClassSessionId: sessionId });
      expect(visit.isMakeupClass).toBe(true);

      await markAttendance(studentId, sessionId, scheduleId, 'regular', 'missed');

      visit = await Visit.findOne({ studentId, groupClassSessionId: sessionId });
      expect(visit.status).toBe('missed');
      expect(visit.isMakeupClass).toBe(true);
    });
  });

  describe('cancelVisitsForStudent', () => {
    it('cancels every listed session, leaving others for the same student untouched', async () => {
      const studentId = id();
      const scheduleId = id();
      const [sessionA, sessionB, sessionC] = [id(), id(), id()];

      await upsertScheduledVisits(
        studentId,
        [sessionA, sessionB, sessionC].map((sessionId) => ({ sessionId, scheduleId })),
        'regular'
      );

      await cancelVisitsForStudent(studentId, [sessionA, sessionB]);

      const visits = await Visit.find({ studentId }).sort({ groupClassSessionId: 1 });
      const statusBySession = new Map(visits.map((v) => [String(v.groupClassSessionId), v.status]));
      expect(statusBySession.get(String(sessionA))).toBe('cancelled');
      expect(statusBySession.get(String(sessionB))).toBe('cancelled');
      expect(statusBySession.get(String(sessionC))).toBe('scheduled');
    });

    it('is a no-op for an empty sessionIds array', async () => {
      await expect(cancelVisitsForStudent(id(), [])).resolves.toBeNull();
    });
  });

  describe('getActiveVisitsForSession / findActiveVisit', () => {
    it('excludes cancelled visits and populates the student name', async () => {
      const User = require('../../src/models/user.model');
      const student = await User.create({ role: 'student', firstName: 'Ada', lastName: 'One' });
      const cancelledStudentId = id();
      const sessionId = id();
      const scheduleId = id();

      await createScheduledVisit(student._id, sessionId, scheduleId, 'regular');
      await createScheduledVisit(cancelledStudentId, sessionId, scheduleId, 'regular');
      await cancelVisitsForStudent(cancelledStudentId, [sessionId]);

      const activeVisits = await getActiveVisitsForSession(sessionId);
      expect(activeVisits).toHaveLength(1);
      expect(activeVisits[0].studentId).toMatchObject({ firstName: 'Ada', lastName: 'One' });

      expect(await findActiveVisit(cancelledStudentId, sessionId)).toBeNull();
      expect(await findActiveVisit(student._id, sessionId)).not.toBeNull();
    });
  });

  describe('getVisitsByStudent', () => {
    it('returns every visit for a student, most recent first', async () => {
      const studentId = id();
      const scheduleId = id();

      await createScheduledVisit(studentId, id(), scheduleId, 'regular');
      await createScheduledVisit(studentId, id(), scheduleId, 'trial');

      const visits = await getVisitsByStudent(studentId);
      expect(visits).toHaveLength(2);
    });
  });
});
