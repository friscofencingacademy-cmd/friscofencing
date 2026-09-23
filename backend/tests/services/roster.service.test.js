const mongoose = require('mongoose');

const GroupClassSchedule = require('../../src/models/groupClassSchedule.model');
const GroupClassSession = require('../../src/models/groupClassSession.model');
const Visit = require('../../src/models/visit.model');
const { addStudentToRoster, removeStudentFromRoster } = require('../../src/services/roster.service');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');
const { createSession } = require('../testUtils/sessions');

// docs/plans/session-start-time-cutoff-plan.md D8 — the roster helpers act
// only on sessions whose START INSTANT is still ahead of now. August 2026 is
// CDT (UTC-5): a 16:00 Central class starts at 21:00Z.
const DO_NOT_FAKE = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick'];

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

afterEach(async () => {
  jest.useRealTimers();
  await clearTestDB();
});

async function seedScheduleWithSessions() {
  const schedule = await GroupClassSchedule.create({
    classId: new mongoose.Types.ObjectId(),
    coachId: new mongoose.Types.ObjectId(),
    dayOfWeek: 2,
    startTime: '16:00',
    endTime: '17:00',
    students: [],
  });

  const today = await createSession(schedule, new Date('2026-08-25T00:00:00.000Z')); // Tuesday
  const nextWeek = await createSession(schedule, new Date('2026-09-01T00:00:00.000Z'));

  return { schedule, today, nextWeek };
}

async function visitFor(studentId, session) {
  return Visit.findOne({ studentId, groupClassSessionId: session._id });
}

describe('roster.service — addStudentToRoster', () => {
  it('creates a Visit for a session that has not started yet, including one later today', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-25T17:00:00.000Z'), doNotFake: DO_NOT_FAKE }); // 12:00 Central
    const { schedule, today, nextWeek } = await seedScheduleWithSessions();
    const studentId = new mongoose.Types.ObjectId();

    await addStudentToRoster(schedule, studentId);

    expect(await visitFor(studentId, today)).not.toBeNull();
    expect(await visitFor(studentId, nextWeek)).not.toBeNull();
  });

  it('creates NO Visit for a session whose start time has already passed (20:00 Central, class at 16:00)', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-26T01:00:00.000Z'), doNotFake: DO_NOT_FAKE });
    const { schedule, today, nextWeek } = await seedScheduleWithSessions();
    const studentId = new mongoose.Types.ObjectId();

    await addStudentToRoster(schedule, studentId);

    expect(await visitFor(studentId, today)).toBeNull();
    expect(await visitFor(studentId, nextWeek)).not.toBeNull();
  });

  it('adds the student to the schedule roster regardless of session timing', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-26T01:00:00.000Z'), doNotFake: DO_NOT_FAKE });
    const { schedule } = await seedScheduleWithSessions();
    const studentId = new mongoose.Types.ObjectId();

    await addStudentToRoster(schedule, studentId);

    const reloaded = await GroupClassSchedule.findById(schedule._id);
    expect(reloaded.students.map(String)).toContain(String(studentId));
  });
});

describe('roster.service — removeStudentFromRoster', () => {
  it('cancels Visits for not-yet-started sessions but leaves an already-started session\'s Visit (real attendance history) alone', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-25T17:00:00.000Z'), doNotFake: DO_NOT_FAKE }); // 12:00 Central
    const { schedule, today, nextWeek } = await seedScheduleWithSessions();
    const studentId = new mongoose.Types.ObjectId();
    await addStudentToRoster(schedule, studentId);

    // Time passes: it is now 20:00 Central, today's class has happened.
    jest.setSystemTime(new Date('2026-08-26T01:00:00.000Z'));
    const reloaded = await GroupClassSchedule.findById(schedule._id);
    await removeStudentFromRoster(reloaded, studentId);

    expect((await visitFor(studentId, today)).status).toBe('scheduled'); // untouched
    expect((await visitFor(studentId, nextWeek)).status).toBe('cancelled');
    expect(await GroupClassSession.countDocuments({ scheduleId: schedule._id })).toBe(2);
  });
});
