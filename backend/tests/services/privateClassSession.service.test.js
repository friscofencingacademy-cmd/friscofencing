const mongoose = require('mongoose');

const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');
const PrivateClassSchedule = require('../../src/models/privateClassSchedule.model');
const PrivateClassEnrollment = require('../../src/models/privateClassEnrollment.model');
const PrivateClassSession = require('../../src/models/privateClassSession.model');
const User = require('../../src/models/user.model');

const { generateSessions } = require('../../src/services/privateClassSession.service');

// Fakes ONLY Date (via `now`) and explicitly leaves every timer function
// real — faking setTimeout/setImmediate/nextTick here would hang the real
// mongodb-memory-server driver this suite's tests all use (same pattern as
// tests/services/groupClassSession.service.test.js and
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
  jest.useRealTimers();
});

async function seedClaimedSlot({ dayOfWeek, startTime, durationMinutes = 60 }) {
  const coach = await User.create({
    role: 'coach',
    firstName: 'Dana',
    lastName: 'Coach',
    email: `coach-${dayOfWeek}-${startTime}-${Math.random()}@example.com`,
    passwordHash: 'x',
  });
  const parent = await User.create({
    role: 'parent',
    firstName: 'Pat',
    lastName: 'Parent',
    email: `parent-${dayOfWeek}-${startTime}-${Math.random()}@example.com`,
    passwordHash: 'x',
  });
  const student = await User.create({ role: 'student', firstName: 'Kid', lastName: 'One', parentId: parent._id });

  const enrollment = await PrivateClassEnrollment.create({
    studentId: student._id,
    parentId: parent._id,
    coachId: coach._id,
    coachContractId: new mongoose.Types.ObjectId(),
    agreedHourlyRate: 65,
    status: 'active',
  });

  const schedule = await PrivateClassSchedule.create({
    coachId: coach._id,
    dayOfWeek,
    startTime,
    durationMinutes,
    studentId: student._id,
    enrollmentId: enrollment._id,
    isActive: true,
  });

  return { coach, parent, student, enrollment, schedule };
}

describe('privateClassSession.service — generateSessions', () => {
  // The regression this fix closes (docs/plans/utc-date-standard-plan.md) —
  // confirmed against real staging data before writing this fix: every
  // stored PrivateClassSession.startDate was off by exactly the Central/UTC
  // offset, because the OLD combineDateAndTime() wrote a Central wall-clock
  // time's raw numbers directly into the UTC field on a UTC production
  // server. A "16:45 Central" slot must resolve to the true UTC instant —
  // 21:45Z in CDT — never the old broken 16:45Z.
  it('resolves a Central wall-clock startTime to the true UTC instant, not the raw clock numbers (CDT)', async () => {
    freezeAt('2026-08-24T12:00:00.000Z'); // Monday, midday UTC

    const { enrollment } = await seedClaimedSlot({ dayOfWeek: 2, startTime: '16:45' }); // Tuesday

    const { sessions } = await generateSessions({ enrollmentId: enrollment._id });

    expect(sessions[0].startDate.toISOString()).toBe('2026-08-25T21:45:00.000Z');
    // NOT the old bug's result — the raw clock numbers written straight
    // into the UTC field.
    expect(sessions[0].startDate.toISOString()).not.toBe('2026-08-25T16:45:00.000Z');
  });

  it('resolves a Central wall-clock startTime to the true UTC instant in winter (CST)', async () => {
    freezeAt('2026-01-12T12:00:00.000Z'); // Monday, midday UTC

    const { enrollment } = await seedClaimedSlot({ dayOfWeek: 2, startTime: '15:33' }); // exact staging shape

    const { sessions } = await generateSessions({ enrollmentId: enrollment._id });

    expect(sessions[0].startDate.toISOString()).toBe('2026-01-13T21:33:00.000Z'); // CST, UTC-6
    expect(sessions[0].startDate.toISOString()).not.toBe('2026-01-13T15:33:00.000Z');
  });

  it('derives endDate from the schedule\'s own durationMinutes, off the corrected startDate', async () => {
    freezeAt('2026-08-24T12:00:00.000Z');

    const { enrollment } = await seedClaimedSlot({ dayOfWeek: 2, startTime: '16:45', durationMinutes: 90 });

    const { sessions } = await generateSessions({ enrollmentId: enrollment._id });

    expect(sessions[0].endDate.getTime() - sessions[0].startDate.getTime()).toBe(90 * 60000);
  });

  // "Prove the fix" pattern (docs/TESTING_STRATEGY.md's Timezone section) —
  // stepping happens INSIDE the tz-anchored moment chain (never setDate()
  // on an already-resolved instant), so an 8-week run stays genuinely 7
  // Central calendar days apart even across the real 2026-11-01 US
  // fall-back transition — contrasted against what naive "+7*24h" instant
  // stepping would have produced (a 1-hour-early Nov 3rd session).
  it('generates 8 sessions exactly 7 Central calendar days apart, with the UTC offset correctly shifting across the Nov 1 2026 fall-back transition', async () => {
    freezeAt('2026-10-06T12:00:00.000Z'); // a Tuesday, midday UTC — 3 weeks before the transition

    const { enrollment } = await seedClaimedSlot({ dayOfWeek: 2, startTime: '16:45' }); // Tuesday

    const { sessions } = await generateSessions({ enrollmentId: enrollment._id });
    const isoDates = sessions.map((s) => s.startDate.toISOString());

    expect(isoDates).toEqual([
      '2026-10-13T21:45:00.000Z', // CDT (UTC-5)
      '2026-10-20T21:45:00.000Z',
      '2026-10-27T21:45:00.000Z',
      '2026-11-03T22:45:00.000Z', // CST (UTC-6) — the transition: 1 hour later in UTC for the SAME 16:45 Central
      '2026-11-10T22:45:00.000Z',
      '2026-11-17T22:45:00.000Z',
      '2026-11-24T22:45:00.000Z',
      '2026-12-01T22:45:00.000Z',
    ]);

    // Naive "+7 days of real time" stepping (what the old setDate()-on-an-
    // instant approach effectively did) would have produced Nov 3rd at
    // 21:45Z, not 22:45Z — a real, provable 1-hour drift this fix avoids.
    expect(isoDates[3]).not.toBe('2026-11-03T21:45:00.000Z');
  });

  it('is idempotent — re-running against the same claimed slot creates no duplicates', async () => {
    freezeAt('2026-08-24T12:00:00.000Z');

    const { enrollment } = await seedClaimedSlot({ dayOfWeek: 2, startTime: '16:45' });

    const first = await generateSessions({ enrollmentId: enrollment._id });
    expect(first.sessions).toHaveLength(8);

    const second = await generateSessions({ enrollmentId: enrollment._id });
    expect(second.sessions).toHaveLength(0);

    const allSessions = await PrivateClassSession.find({ enrollmentId: enrollment._id });
    expect(allSessions).toHaveLength(8);
  });

  it('returns firstSessionDate matching the first generated session\'s real startDate instant', async () => {
    freezeAt('2026-08-24T12:00:00.000Z');

    const { enrollment } = await seedClaimedSlot({ dayOfWeek: 2, startTime: '16:45' });

    const { sessions, firstSessionDate } = await generateSessions({ enrollmentId: enrollment._id });

    expect(firstSessionDate.toISOString()).toBe(sessions[0].startDate.toISOString());
  });

  it('returns an empty result for an unknown enrollment id, without throwing', async () => {
    const result = await generateSessions({ enrollmentId: new mongoose.Types.ObjectId() });
    expect(result).toEqual({ sessions: [], firstSessionDate: null });
  });
});
