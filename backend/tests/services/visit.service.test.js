const mongoose = require('mongoose');

const Visit = require('../../src/models/visit.model');
const Service = require('../../src/models/service.model');
const { seedServices } = require('../../scripts/lib/seedServices');
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
  createScheduledPrivateVisit,
  findActivePrivateVisit,
  markPrivateAttendance,
  cancelPrivateVisit,
  getPrivateVisitStatusBySession,
} = require('../../src/services/visit.service');

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

// Every Visit write resolves its serviceId by Service code (ADR 010), so the
// registry must exist before any test writes one.
beforeEach(async () => {
  await seedServices();
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

  describe('serviceId stamping (ADR 010)', () => {
    it('stamps the group-classes Service on every group write path', async () => {
      const groupService = await Service.findOne({ code: 'group-classes' });
      const studentId = id();
      const scheduleId = id();
      const [scheduledSession, walkInSession] = [id(), id()];

      await createScheduledVisit(studentId, scheduledSession, scheduleId, 'regular');
      await markAttendance(studentId, walkInSession, scheduleId, 'regular', 'attended');

      const visits = await Visit.find({ studentId });
      expect(visits).toHaveLength(2);
      visits.forEach((visit) => expect(String(visit.serviceId)).toBe(String(groupService._id)));
    });

    it('fails closed (500-shaped) when the Service registry is not seeded', async () => {
      await Service.deleteMany({});

      await expect(createScheduledVisit(id(), id(), id(), 'regular')).rejects.toMatchObject({ status: 500 });
      expect(await Visit.countDocuments({})).toBe(0);
    });
  });

  describe('schema validator — exactly one session ref', () => {
    let groupServiceId;

    beforeEach(async () => {
      groupServiceId = (await Service.findOne({ code: 'group-classes' }))._id;
    });

    const base = () => ({ studentId: id(), serviceId: groupServiceId, status: 'scheduled' });

    it('rejects a Visit with no session ref', async () => {
      await expect(Visit.create({ ...base(), classType: 'regular' })).rejects.toThrow(/exactly one/);
    });

    it('rejects a Visit with both session refs', async () => {
      await expect(
        Visit.create({
          ...base(),
          classType: 'private',
          groupClassSessionId: id(),
          groupClassScheduleId: id(),
          privateClassSessionId: id(),
        })
      ).rejects.toThrow(/exactly one/);
    });

    it('rejects a group Visit without its schedule ref', async () => {
      await expect(Visit.create({ ...base(), classType: 'regular', groupClassSessionId: id() })).rejects.toThrow(
        /groupClassScheduleId/
      );
    });

    it("rejects a group Visit with classType 'private'", async () => {
      await expect(
        Visit.create({ ...base(), classType: 'private', groupClassSessionId: id(), groupClassScheduleId: id() })
      ).rejects.toThrow(/cannot have classType 'private'/);
    });

    it("rejects a private Visit whose classType is not 'private'", async () => {
      await expect(Visit.create({ ...base(), classType: 'regular', privateClassSessionId: id() })).rejects.toThrow(
        /must have classType 'private'/
      );
    });

    it('rejects a private Visit that carries a group schedule ref', async () => {
      await expect(
        Visit.create({ ...base(), classType: 'private', privateClassSessionId: id(), groupClassScheduleId: id() })
      ).rejects.toThrow(/cannot reference a group-class schedule/);
    });

    it('accepts a well-formed group Visit and a well-formed private Visit', async () => {
      await expect(
        Visit.create({ ...base(), classType: 'trial', groupClassSessionId: id(), groupClassScheduleId: id() })
      ).resolves.toBeTruthy();
      await expect(Visit.create({ ...base(), classType: 'private', privateClassSessionId: id() })).resolves.toBeTruthy();
    });
  });

  describe('private-lesson visits', () => {
    it("creates a scheduled 'private' Visit stamped with the private-lessons Service and no group refs", async () => {
      const privateService = await Service.findOne({ code: 'private-lessons' });
      const studentId = id();
      const sessionId = id();

      await createScheduledPrivateVisit(studentId, sessionId);

      const visit = await Visit.findOne({ privateClassSessionId: sessionId });
      expect(visit.status).toBe('scheduled');
      expect(visit.classType).toBe('private');
      expect(String(visit.serviceId)).toBe(String(privateService._id));
      expect(visit.groupClassSessionId).toBeNull();
      expect(visit.groupClassScheduleId).toBeNull();
      // The row an upsert stored must still satisfy the schema validator.
      await expect(visit.validate()).resolves.toBeUndefined();
    });

    it('is idempotent and never downgrades a marked Visit back to scheduled', async () => {
      const studentId = id();
      const sessionId = id();

      await createScheduledPrivateVisit(studentId, sessionId);
      await markPrivateAttendance(studentId, sessionId, 'attended', id(), 'coach');
      await createScheduledPrivateVisit(studentId, sessionId);

      expect(await Visit.countDocuments({ privateClassSessionId: sessionId })).toBe(1);
      expect((await Visit.findOne({ privateClassSessionId: sessionId })).status).toBe('attended');
    });

    it('marks attendance in place, recording who marked it and how', async () => {
      const studentId = id();
      const sessionId = id();
      const coachId = id();

      await createScheduledPrivateVisit(studentId, sessionId);
      await markPrivateAttendance(studentId, sessionId, 'missed', coachId, 'coach');

      const visit = await Visit.findOne({ privateClassSessionId: sessionId });
      expect(visit.status).toBe('missed');
      expect(String(visit.markedBy)).toBe(String(coachId));
      expect(visit.markedVia).toBe('coach');
    });

    it('markPrivateAttendance creates the Visit when the scheduled one is missing (safety net)', async () => {
      const studentId = id();
      const sessionId = id();

      await markPrivateAttendance(studentId, sessionId, 'attended', id(), 'admin');

      const visit = await Visit.findOne({ privateClassSessionId: sessionId });
      expect(visit.classType).toBe('private');
      expect(visit.status).toBe('attended');
      expect(visit.serviceId).toBeTruthy();
      await expect(visit.validate()).resolves.toBeUndefined();
    });

    it('cancel, then re-create, reactivates the same row', async () => {
      const studentId = id();
      const sessionId = id();

      await createScheduledPrivateVisit(studentId, sessionId);
      await cancelPrivateVisit(sessionId);
      expect(await findActivePrivateVisit(studentId, sessionId)).toBeNull();

      await createScheduledPrivateVisit(studentId, sessionId);

      expect(await Visit.countDocuments({ privateClassSessionId: sessionId })).toBe(1);
      expect((await findActivePrivateVisit(studentId, sessionId)).status).toBe('scheduled');
    });

    it('getPrivateVisitStatusBySession maps each session to its Visit status in one call', async () => {
      const [a, b, c] = [id(), id(), id()];
      const studentB = id();
      await createScheduledPrivateVisit(id(), a);
      await createScheduledPrivateVisit(studentB, b);
      await markPrivateAttendance(studentB, b, 'attended');

      const statuses = await getPrivateVisitStatusBySession([a, b, c]);

      expect(statuses.get(String(a))).toBe('scheduled');
      expect(statuses.get(String(b))).toBe('attended');
      expect(statuses.has(String(c))).toBe(false);
      expect((await getPrivateVisitStatusBySession([])).size).toBe(0);
    });

    it('a private visit never appears in a group session roster read', async () => {
      const sessionId = id();
      await createScheduledPrivateVisit(id(), sessionId);

      expect(await getActiveVisitsForSession(sessionId)).toHaveLength(0);
      expect(await findActiveVisit(id(), sessionId)).toBeNull();
    });
  });
});
