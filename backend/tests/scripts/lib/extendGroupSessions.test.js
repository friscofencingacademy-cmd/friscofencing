const mongoose = require('mongoose');

const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');
const { createSession } = require('../../testUtils/sessions');
const GroupClassSession = require('../../../src/models/groupClassSession.model');
const GroupClassSchedule = require('../../../src/models/groupClassSchedule.model');
const Holiday = require('../../../src/models/holiday.model');
const Visit = require('../../../src/models/visit.model');
const { sessionInstantsFor } = require('../../../src/services/groupClassSession.service');
const { seedServices } = require('../../../scripts/lib/seedServices');

const { extendGroupSessions } = require('../../../scripts/lib/extendGroupSessions');

// docs/plans/audit-and-health-refresh-plan.md PR 1. "Today" and "now" are
// passed in as literals (the lib's own parameters), so no test here reads the
// real clock: Wednesday 2026-10-28, 10:00 Central.
const TODAY = new Date('2026-10-28T00:00:00.000Z');
const NOW = new Date('2026-10-28T15:00:00.000Z');

// The 8 Mondays on/after TODAY — what a Monday schedule should hold.
const MONDAYS = ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21'];

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

beforeEach(async () => {
  // upsertScheduledVisits resolves the group-classes Service id.
  await seedServices();
});

afterEach(async () => {
  await clearTestDB();
});

function day(iso) {
  return new Date(`${iso}T00:00:00.000Z`);
}

function seedSchedule(overrides = {}) {
  return GroupClassSchedule.create({
    classId: new mongoose.Types.ObjectId(),
    coachId: new mongoose.Types.ObjectId(),
    dayOfWeek: 1,
    startTime: '18:00',
    endTime: '19:00',
    students: [],
    ...overrides,
  });
}

async function sessionDays(scheduleId) {
  const sessions = await GroupClassSession.find({ scheduleId }).sort({ date: 1 }).lean();
  return sessions.map((session) => session.date.toISOString().slice(0, 10));
}

function run(options = {}) {
  return extendGroupSessions({ today: TODAY, now: NOW, ...options });
}

describe('scripts/lib/extendGroupSessions', () => {
  it('dry run plans the 8 missing sessions of an empty schedule and writes nothing', async () => {
    const schedule = await seedSchedule();

    const report = await run();

    expect(report.applied).toBe(false);
    expect(report.totals).toEqual({ schedules: 1, planned: 8, created: 0, visitsUpserted: 0 });
    expect(report.schedules[0].missing.map((date) => date.toISOString().slice(0, 10))).toEqual(MONDAYS);
    expect(await GroupClassSession.countDocuments({ scheduleId: schedule._id })).toBe(0);
  });

  it('a live run creates the 8 sessions with the production start/end instants', async () => {
    const schedule = await seedSchedule();

    const report = await run({ apply: true });

    expect(report.totals.created).toBe(8);
    expect(await sessionDays(schedule._id)).toEqual(MONDAYS);

    const sessions = await GroupClassSession.find({ scheduleId: schedule._id }).lean();
    sessions.forEach((session) => {
      const expected = sessionInstantsFor(session.date, schedule);
      expect(session.startsAt.getTime()).toBe(expected.startsAt.getTime());
      expect(session.endsAt.getTime()).toBe(expected.endsAt.getTime());
    });
    // 2026-11-02 is after the 2026-11-01 DST end: 18:00 CST is 00:00Z next day.
    expect(sessions.find((s) => s.date.toISOString().startsWith('2026-11-02')).startsAt.toISOString()).toBe(
      '2026-11-03T00:00:00.000Z'
    );
  });

  it('tops a partly stocked schedule up to 8 without touching existing or past sessions', async () => {
    const schedule = await seedSchedule();
    const past = await createSession(schedule, day('2026-10-26'));
    const kept = await Promise.all(['2026-11-02', '2026-11-09', '2026-11-16'].map((iso) => createSession(schedule, day(iso))));
    const before = await GroupClassSession.find({ _id: { $in: [past._id, ...kept.map((s) => s._id)] } }).lean();

    const report = await run({ apply: true });

    expect(report.schedules[0].existing).toBe(3);
    expect(report.schedules[0].created.map((date) => date.toISOString().slice(0, 10))).toEqual(MONDAYS.slice(3));
    expect(await sessionDays(schedule._id)).toEqual(['2026-10-26', ...MONDAYS]);

    const after = await GroupClassSession.find({ _id: { $in: before.map((s) => s._id) } }).lean();
    expect(after).toEqual(before);
  });

  it('is a no-op on a fully stocked schedule, and a second live run changes nothing', async () => {
    const schedule = await seedSchedule();

    await run({ apply: true });
    const second = await run({ apply: true });

    expect(second.totals.planned).toBe(0);
    expect(second.totals.created).toBe(0);
    expect(await GroupClassSession.countDocuments({ scheduleId: schedule._id })).toBe(8);
  });

  it('counts a session inserted concurrently by another run as already present, never as an error', async () => {
    const schedule = await seedSchedule();
    const realCreate = GroupClassSession.create.bind(GroupClassSession);
    const spy = jest.spyOn(GroupClassSession, 'create').mockImplementationOnce(async (doc) => {
      // Another run wins the race for the first date between our read and our insert.
      await realCreate(doc);
      return realCreate(doc);
    });

    try {
      const report = await run({ apply: true });

      expect(report.schedules[0].alreadyPresent.map((date) => date.toISOString().slice(0, 10))).toEqual([MONDAYS[0]]);
      expect(report.schedules[0].created).toHaveLength(7);
      expect(await sessionDays(schedule._id)).toEqual(MONDAYS);
    } finally {
      spy.mockRestore();
    }
  });

  it('propagates any insert error other than a duplicate key — a real failure is never reported as success', async () => {
    await seedSchedule();
    const spy = jest.spyOn(GroupClassSession, 'create').mockRejectedValueOnce(new Error('connection reset'));

    try {
      await expect(run({ apply: true })).rejects.toThrow('connection reset');
    } finally {
      spy.mockRestore();
    }
  });

  it('gives every rostered student a scheduled Visit for each new upcoming session, and none to an empty roster', async () => {
    const studentA = new mongoose.Types.ObjectId();
    const studentB = new mongoose.Types.ObjectId();
    const rostered = await seedSchedule({ students: [studentA, studentB] });
    const empty = await seedSchedule({ dayOfWeek: 3 });

    const report = await run({ apply: true });

    const rosteredEntry = report.schedules.find((entry) => String(entry.scheduleId) === String(rostered._id));
    expect(rosteredEntry.visitsUpserted).toBe(16);
    expect(await Visit.countDocuments({ groupClassScheduleId: rostered._id, status: 'scheduled' })).toBe(16);
    expect(await Visit.countDocuments({ studentId: studentA, status: 'scheduled' })).toBe(8);
    expect(await Visit.countDocuments({ groupClassScheduleId: empty._id })).toBe(0);
  });

  it("creates today's missing occurrence but gives it no Visit once it has started", async () => {
    const student = new mongoose.Types.ObjectId();
    // Wednesday 09:00 Central — already started at NOW (10:00 Central).
    const schedule = await seedSchedule({ dayOfWeek: 3, startTime: '09:00', endTime: '10:30', students: [student] });

    await run({ apply: true });

    const today = await GroupClassSession.findOne({ scheduleId: schedule._id, date: TODAY });
    expect(today).not.toBeNull();
    expect(await Visit.countDocuments({ groupClassSessionId: today._id })).toBe(0);
    expect(await Visit.countDocuments({ studentId: student })).toBe(7);
  });

  it('leaves an existing Visit untouched', async () => {
    const student = new mongoose.Types.ObjectId();
    const schedule = await seedSchedule({ students: [student] });
    const existing = await createSession(schedule, day(MONDAYS[0]));
    await Visit.create({
      studentId: student,
      serviceId: new mongoose.Types.ObjectId(),
      groupClassSessionId: existing._id,
      groupClassScheduleId: schedule._id,
      classType: 'regular',
      status: 'attended',
    });

    await run({ apply: true });

    const visit = await Visit.findOne({ groupClassSessionId: existing._id }).lean();
    expect(visit.status).toBe('attended');
    expect(await Visit.countDocuments({ studentId: student })).toBe(8);
  });

  it('only touches the schedules it is asked to', async () => {
    const chosen = await seedSchedule();
    const other = await seedSchedule({ dayOfWeek: 4 });

    const report = await run({ apply: true, scheduleIds: [chosen._id] });

    expect(report.totals.schedules).toBe(1);
    expect(await GroupClassSession.countDocuments({ scheduleId: chosen._id })).toBe(8);
    expect(await GroupClassSession.countDocuments({ scheduleId: other._id })).toBe(0);
  });

  it('still creates a session on a holiday date (a holiday is an annotation, not a missing session)', async () => {
    const schedule = await seedSchedule();
    await Holiday.create({ name: 'Thanksgiving week', startDate: day('2026-11-23'), endDate: day('2026-11-27') });

    await run({ apply: true });

    expect(await sessionDays(schedule._id)).toContain('2026-11-23');
  });
});
