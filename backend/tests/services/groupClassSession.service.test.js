const GroupClassSession = require('../../src/models/groupClassSession.model');
const GroupClassSchedule = require('../../src/models/groupClassSchedule.model');
const GroupClass = require('../../src/models/groupClass.model');
const Level = require('../../src/models/level.model');
const Location = require('../../src/models/location.model');
const User = require('../../src/models/user.model');
const Holiday = require('../../src/models/holiday.model');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');

const {
  generateInitialSessions,
  listUpcomingByClass,
  listBySchedule,
} = require('../../src/services/groupClassSession.service');

// Fakes ONLY Date (via `now`) and explicitly leaves every timer function
// real — faking setTimeout/setImmediate/nextTick here would hang the real
// mongodb-memory-server driver this suite's tests all use (same pattern as
// tests/routes/groupClassSession.routes.test.js's own "today-inclusive"
// test).
function freezeAt(iso) {
  jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick'],
  });
}

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

async function seedClass() {
  const level = await Level.create({ name: 'Beginner', order: 1 });
  const location = await Location.create({ name: 'Frisco HQ', address: '123 Main St' });
  return GroupClass.create({ name: 'Beginner Foil', levelId: level._id, locationId: location._id, capacity: 10 });
}

async function seedSchedule(classId, dayOfWeek) {
  const coach = await User.create({
    role: 'coach',
    firstName: 'A',
    lastName: 'Coach',
    email: `coach-${classId}-${dayOfWeek}@example.com`,
    passwordHash: 'x',
  });

  // Bypasses groupClassSchedule.service.js's create() (which itself calls
  // generateInitialSessions) — this suite exercises generateInitialSessions
  // directly against a bare schedule doc, so sessions are only ever created
  // exactly once per test, not doubled.
  return GroupClassSchedule.create({
    classId,
    coachId: coach._id,
    dayOfWeek,
    startTime: '16:00',
    endTime: '17:00',
    students: [],
  });
}

describe('groupClassSession.service — generateInitialSessions', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('produces UTC-midnight sentinels, not Central-midnight instants (docs/plans/utc-date-standard-plan.md)', async () => {
    freezeAt('2026-08-25T12:00:00.000Z'); // Tuesday, midday UTC

    const groupClass = await seedClass();
    const schedule = await seedSchedule(groupClass._id, 2); // Tuesday — same as "today"

    const sessions = generateInitialSessions(schedule);

    expect(sessions).toHaveLength(8);
    // The first session IS today, at true UTC midnight — not the
    // superseded Central-midnight-instant shape (05:00Z in CDT) this
    // generator used to produce.
    expect(sessions[0].date.toISOString()).toBe('2026-08-25T00:00:00.000Z');
    sessions.forEach((session) => {
      expect(session.date.getUTCHours()).toBe(0);
      expect(session.date.getUTCMinutes()).toBe(0);
    });
  });

  it('generates 8 sessions exactly 7 calendar days apart, on the schedule\'s own weekday', async () => {
    freezeAt('2026-08-25T12:00:00.000Z');

    const groupClass = await seedClass();
    const schedule = await seedSchedule(groupClass._id, 5); // Friday

    const sessions = generateInitialSessions(schedule);

    expect(sessions).toHaveLength(8);
    sessions.forEach((session) => expect(session.date.getUTCDay()).toBe(5));

    for (let i = 1; i < sessions.length; i += 1) {
      const diffDays = (sessions[i].date.getTime() - sessions[i - 1].date.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBe(7);
    }
  });

  it('"on or after" semantics: when today already falls on the schedule\'s weekday, the first session is today, not next week', async () => {
    freezeAt('2026-08-26T12:00:00.000Z'); // Wednesday

    const groupClass = await seedClass();
    const schedule = await seedSchedule(groupClass._id, 3); // Wednesday

    const sessions = generateInitialSessions(schedule);

    expect(sessions[0].date.toISOString()).toBe('2026-08-26T00:00:00.000Z');
  });
});

describe('groupClassSession.service — listUpcomingByClass', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("includes a session dated exactly today (today-inclusive) — the exact bug a real-instant range start used to exclude", async () => {
    freezeAt('2026-08-25T12:00:00.000Z'); // Tuesday, midday UTC

    const groupClass = await seedClass();
    const schedule = await seedSchedule(groupClass._id, 2); // Tuesday — today
    await GroupClassSession.insertMany(generateInitialSessions(schedule));

    const sessions = await listUpcomingByClass(groupClass._id, 30);

    const dates = sessions.map((s) => s.date.toISOString());
    expect(dates).toContain('2026-08-25T00:00:00.000Z');
  });

  it('excludes yesterday\'s session', async () => {
    freezeAt('2026-08-25T12:00:00.000Z');

    const groupClass = await seedClass();
    const schedule = await seedSchedule(groupClass._id, 1); // Monday — yesterday relative to today
    await GroupClassSession.create({ scheduleId: schedule._id, date: new Date('2026-08-24T00:00:00.000Z') });

    const sessions = await listUpcomingByClass(groupClass._id, 30);

    expect(sessions).toHaveLength(0);
  });

  it('excludes a session more than `days` out', async () => {
    freezeAt('2026-08-25T12:00:00.000Z');

    const groupClass = await seedClass();
    const schedule = await seedSchedule(groupClass._id, 2);
    await GroupClassSession.create({ scheduleId: schedule._id, date: new Date('2026-09-25T00:00:00.000Z') }); // 31 days out

    const sessions = await listUpcomingByClass(groupClass._id, 30);

    expect(sessions).toHaveLength(0);
  });

  // Legacy-data compatibility — the range query must still catch a
  // not-yet-migrated contaminated sentinel (docs/plans/utc-date-standard-
  // plan.md's migration hasn't necessarily run yet in every environment).
  it('still includes a legacy contaminated (non-midnight) sentinel dated today', async () => {
    freezeAt('2026-08-25T12:00:00.000Z');

    const groupClass = await seedClass();
    const schedule = await seedSchedule(groupClass._id, 2);
    // Eastern-midnight-shaped, matching the owner's real staging data.
    await GroupClassSession.create({ scheduleId: schedule._id, date: new Date('2026-08-25T04:00:00.000Z') });

    const sessions = await listUpcomingByClass(groupClass._id, 30);

    expect(sessions).toHaveLength(1);
  });

  // docs/plans/holiday-blocking-plan.md D5 — a single filter here covers
  // both the trial picker AND the register wizard's start-date picker,
  // since both consume this exact function via fetchSessionsByClass.
  describe('holiday filtering (docs/plans/holiday-blocking-plan.md D5)', () => {
    it('drops a session that falls inside a holiday range, keeping its neighbors', async () => {
      freezeAt('2026-08-25T12:00:00.000Z'); // Tuesday

      const groupClass = await seedClass();
      const schedule = await seedSchedule(groupClass._id, 2); // Tuesday
      await GroupClassSession.insertMany(generateInitialSessions(schedule));

      // Second generated session (2026-09-01) sits inside the holiday.
      await Holiday.create({
        name: 'Labor Day',
        startDate: new Date('2026-09-01T00:00:00.000Z'),
        endDate: new Date('2026-09-01T00:00:00.000Z'),
      });

      const sessions = await listUpcomingByClass(groupClass._id, 30);

      const dates = sessions.map((s) => s.date.toISOString());
      expect(dates).not.toContain('2026-09-01T00:00:00.000Z');
      expect(dates).toContain('2026-08-25T00:00:00.000Z');
      expect(dates).toContain('2026-09-08T00:00:00.000Z');
    });

    it('a session reappears once its covering holiday is deleted', async () => {
      freezeAt('2026-08-25T12:00:00.000Z');

      const groupClass = await seedClass();
      const schedule = await seedSchedule(groupClass._id, 2);
      await GroupClassSession.insertMany(generateInitialSessions(schedule));

      const holiday = await Holiday.create({
        name: 'Labor Day',
        startDate: new Date('2026-09-01T00:00:00.000Z'),
        endDate: new Date('2026-09-01T00:00:00.000Z'),
      });

      const beforeDelete = await listUpcomingByClass(groupClass._id, 30);
      expect(beforeDelete.map((s) => s.date.toISOString())).not.toContain('2026-09-01T00:00:00.000Z');

      await Holiday.deleteOne({ _id: holiday._id });

      const afterDelete = await listUpcomingByClass(groupClass._id, 30);
      expect(afterDelete.map((s) => s.date.toISOString())).toContain('2026-09-01T00:00:00.000Z');
    });
  });
});

describe('groupClassSession.service — listBySchedule holiday annotation (D6)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('annotates the holiday-covered session with isHoliday/holidayName, leaving neighbors unannotated', async () => {
    freezeAt('2026-08-25T12:00:00.000Z');

    const groupClass = await seedClass();
    const schedule = await seedSchedule(groupClass._id, 2);
    await GroupClassSession.insertMany(generateInitialSessions(schedule));

    await Holiday.create({
      name: 'Labor Day',
      startDate: new Date('2026-09-01T00:00:00.000Z'),
      endDate: new Date('2026-09-01T00:00:00.000Z'),
    });

    const sessions = await listBySchedule(schedule._id);
    const byDate = new Map(sessions.map((s) => [s.date.toISOString(), s]));

    expect(byDate.get('2026-09-01T00:00:00.000Z').isHoliday).toBe(true);
    expect(byDate.get('2026-09-01T00:00:00.000Z').holidayName).toBe('Labor Day');
    expect(byDate.get('2026-08-25T00:00:00.000Z').isHoliday).toBe(false);
    expect(byDate.get('2026-08-25T00:00:00.000Z').holidayName).toBeNull();
  });
});
