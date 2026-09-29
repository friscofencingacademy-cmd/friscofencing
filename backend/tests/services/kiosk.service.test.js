const mongoose = require('mongoose');

const Location = require('../../src/models/location.model');
const Level = require('../../src/models/level.model');
const GroupClass = require('../../src/models/groupClass.model');
const GroupClassSchedule = require('../../src/models/groupClassSchedule.model');
const GroupClassSession = require('../../src/models/groupClassSession.model');
const Subscription = require('../../src/models/subscription.model');
const Setting = require('../../src/models/setting.model');
const Holiday = require('../../src/models/holiday.model');
const Visit = require('../../src/models/visit.model');
const User = require('../../src/models/user.model');
const kioskService = require('../../src/services/kiosk.service');
const visitService = require('../../src/services/visit.service');
const { addStudentToSession } = require('../../src/services/groupClassSession.service');
const { todayDateOnly } = require('../../src/utils/billingDates');
const { addDaysToDateOnly } = require('../../src/utils/dateShapes');
const { seedServices } = require('../../scripts/lib/seedServices');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');
const { createSession } = require('../testUtils/sessions');

// docs/plans/kiosk-signin-plan.md §4.5 / §4.8. Sessions are dated with the
// real todayDateOnly() (the service reads the real "today"), and every
// time-of-day question passes `now` explicitly — computed from the session's
// own generator-built startsAt/endsAt, never a hand-rolled instant.

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

// Every Visit write resolves its serviceId by Service code (ADR 010).
beforeEach(async () => {
  await seedServices();
});

afterEach(async () => {
  await clearTestDB();
});

let counter = 0;
const next = () => {
  counter += 1;
  return counter;
};

const ms = (date, delta) => new Date(date.getTime() + delta);

async function seedAdmin() {
  return User.create({ role: 'admin', firstName: 'Ada', lastName: 'Admin', email: `admin-${next()}@x.com` });
}

async function seedLocation(name = `Location ${next()}`) {
  return Location.create({ name, address: '1 Main St' });
}

async function seedClass(location, level, name = 'Foundation Foil') {
  return GroupClass.create({ name, levelId: level._id, locationId: location._id, capacity: 20 });
}

async function seedSchedule(groupClass, { startTime = '16:00', endTime = '17:00' } = {}) {
  const coach = await User.create({ role: 'coach', firstName: 'Cora', lastName: `Coach${next()}`, email: `coach-${next()}@x.com` });
  return GroupClassSchedule.create({ classId: groupClass._id, coachId: coach._id, dayOfWeek: 1, startTime, endTime, students: [] });
}

async function seedStudent(firstName, lastName = 'Student') {
  return User.create({ role: 'student', firstName, lastName });
}

async function subscribe(student, schedule, overrides = {}) {
  const parent = await User.create({ role: 'parent', firstName: 'Pat', lastName: 'Parent', email: `p-${next()}@x.com` });
  return Subscription.create({
    studentId: student._id,
    scheduleId: schedule._id,
    parentId: parent._id,
    status: 'active',
    currentPeriodStart: new Date('2026-09-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
    nextBillingDate: new Date('2026-10-01T00:00:00.000Z'),
    isPremium: true,
    ...overrides,
  });
}

// The tablet's login (docs/plans/kiosk-signin-plan.md K1).
async function seedKioskUser() {
  return User.create({ role: 'kiosk', firstName: 'Front', lastName: 'Desk', email: `kiosk-${next()}@x.com` });
}

// One location, one level, one class with two schedules (16:00 and 18:00),
// each with a session today. Plus a third schedule of the same class that has
// NO session today (a premium student "homed" there is a walk-in today).
async function seedWorld() {
  const location = await seedLocation('Frisco Main');
  const level = await Level.create({ name: 'Foundation', order: 1 });
  const groupClass = await seedClass(location, level);
  const early = await seedSchedule(groupClass, { startTime: '16:00', endTime: '17:00' });
  const late = await seedSchedule(groupClass, { startTime: '18:00', endTime: '19:00' });
  const otherDay = await seedSchedule(groupClass, { startTime: '10:00', endTime: '11:00' });
  const today = todayDateOnly();
  const earlySession = await createSession(early, today);
  const lateSession = await createSession(late, today);
  const kiosk = await seedKioskUser();
  return { location, level, groupClass, early, late, otherDay, earlySession, lateSession, kiosk, today };
}

// A student on the 16:00 schedule with their scheduled Visit for today.
async function seedRosterStudent(world, firstName = 'Ava') {
  const student = await seedStudent(firstName);
  await subscribe(student, world.early);
  await visitService.createScheduledVisit(student._id, world.earlySession._id, world.early._id, 'regular');
  return student;
}

describe('kiosk.service — getDirectory (who the tablet lists, K3 — academy-wide)', () => {
  it('lists active subscribers with their level, sorted by name', async () => {
    const world = await seedWorld();
    const zed = await seedStudent('Zed');
    const ava = await seedStudent('Ava');
    await subscribe(zed, world.early);
    await subscribe(ava, world.otherDay);

    const directory = await kioskService.getDirectory();

    expect(directory).toEqual([
      { studentId: String(ava._id), firstName: 'Ava', lastName: 'Student', levelName: 'Foundation' },
      { studentId: String(zed._id), firstName: 'Zed', lastName: 'Student', levelName: 'Foundation' },
    ]);
  });

  it('includes a student whose cancellation is pending (still active), excludes a cancelled one', async () => {
    const world = await seedWorld();
    const pending = await seedStudent('Pending');
    const cancelled = await seedStudent('Cancelled');
    await subscribe(pending, world.early, { cancelAtPeriodEnd: true });
    await subscribe(cancelled, world.early, { status: 'cancelled' });

    const names = (await kioskService.getDirectory()).map((s) => s.firstName);

    expect(names).toEqual(['Pending']);
  });

  it('lists a subscriber at a second location too (academy-wide, K3)', async () => {
    const world = await seedWorld();
    const elsewhere = await seedLocation('Plano');
    const otherClass = await seedClass(elsewhere, world.level, 'Plano Foil');
    const otherSchedule = await seedSchedule(otherClass);
    await subscribe(await seedStudent('Far'), otherSchedule);

    expect((await kioskService.getDirectory()).map((s) => s.firstName)).toEqual(['Far']);
  });

  it("includes a trial student on their trial day (a Visit today, no subscription) with levelName null, but not yesterday's", async () => {
    const world = await seedWorld();
    const trial = await seedStudent('Tia', 'Trial');
    await visitService.createScheduledVisit(trial._id, world.earlySession._id, world.early._id, 'trial');

    const yesterday = await createSession(world.late, addDaysToDateOnly(world.today, -1));
    const past = await seedStudent('Pam', 'Past');
    await visitService.createScheduledVisit(past._id, yesterday._id, world.late._id, 'trial');

    const directory = await kioskService.getDirectory();

    expect(directory).toEqual([{ studentId: String(trial._id), firstName: 'Tia', lastName: 'Trial', levelName: null }]);
  });

  it('lists a student with both a subscription and a Visit today once, with the level', async () => {
    const world = await seedWorld();
    await seedRosterStudent(world, 'Ava');

    const directory = await kioskService.getDirectory();

    expect(directory).toHaveLength(1);
    expect(directory[0].levelName).toBe('Foundation');
  });
});

describe('kiosk.service — getKioskState', () => {
  it('returns the directory and confirmationRequired (default true, then the saved value)', async () => {
    const world = await seedWorld();
    await seedRosterStudent(world);

    const state = await kioskService.getKioskState();

    expect(state.students).toHaveLength(1);
    expect(state.confirmationRequired).toBe(true);
    expect(state.serverTime).toBeInstanceOf(Date);

    await Setting.create({ kioskConfirmationRequired: false });
    expect((await kioskService.getKioskState()).confirmationRequired).toBe(false);
  });
});

describe('kiosk.service — signIn (K4/K5)', () => {
  it("marks a roster student attended on their own session, via 'kiosk', by the tablet's account", async () => {
    const world = await seedWorld();
    const ava = await seedRosterStudent(world);

    const result = await kioskService.signIn(world.kiosk, { studentId: String(ava._id) }, world.earlySession.startsAt);

    expect(result.alreadySignedIn).toBe(false);
    expect(result.student).toEqual({ _id: ava._id, firstName: 'Ava', lastName: 'Student' });
    expect(result.session).toMatchObject({
      _id: world.earlySession._id,
      className: 'Foundation Foil',
      startTime: '16:00',
      endTime: '17:00',
    });
    expect(result.session.coachName).toMatch(/^Cora Coach/);

    const visit = await Visit.findOne({ studentId: ava._id, groupClassSessionId: world.earlySession._id }).lean();
    expect(visit).toMatchObject({ status: 'attended', markedVia: 'kiosk', isMakeupClass: false, classType: 'regular' });
    expect(String(visit.markedBy)).toBe(String(world.kiosk._id));
  });

  it("keeps a trial student's Visit classType as 'trial'", async () => {
    const world = await seedWorld();
    const trial = await seedStudent('Tia');
    await visitService.createScheduledVisit(trial._id, world.earlySession._id, world.early._id, 'trial');

    await kioskService.signIn(world.kiosk, { studentId: String(trial._id) }, world.earlySession.startsAt);

    const visit = await Visit.findOne({ studentId: trial._id, groupClassSessionId: world.earlySession._id }).lean();
    expect(visit).toMatchObject({ status: 'attended', classType: 'trial', isMakeupClass: false });
  });

  it('marks a premium student with no home session today as a walk-in, exactly as a coach would', async () => {
    const world = await seedWorld();
    const kioskWalkIn = await seedStudent('Kip');
    const coachWalkIn = await seedStudent('Cal');
    await subscribe(kioskWalkIn, world.otherDay);
    await subscribe(coachWalkIn, world.otherDay);

    await kioskService.signIn(world.kiosk, { studentId: String(kioskWalkIn._id) }, world.earlySession.startsAt);

    // The same walk-in, added by the session's coach (the session is today,
    // so attendance is open without moving any dates).
    const coach = await User.findById(world.early.coachId);
    await addStudentToSession(String(world.earlySession._id), String(coachWalkIn._id), coach);

    const shape = (visit) => ({
      status: visit.status,
      classType: visit.classType,
      isMakeupClass: visit.isMakeupClass,
      groupClassScheduleId: String(visit.groupClassScheduleId),
      serviceId: String(visit.serviceId),
    });
    const byKiosk = await Visit.findOne({ studentId: kioskWalkIn._id }).lean();
    const byCoach = await Visit.findOne({ studentId: coachWalkIn._id }).lean();

    expect(shape(byKiosk)).toEqual(shape(byCoach));
    expect(byKiosk).toMatchObject({ isMakeupClass: true, markedVia: 'kiosk' });
  });

  it('allows an early arrival (before the class starts) and a sign-in exactly at endsAt', async () => {
    const world = await seedWorld();
    const early = await seedRosterStudent(world, 'Early');
    const onTheBell = await seedRosterStudent(world, 'Bell');

    const earlyResult = await kioskService.signIn(
      world.kiosk,
      { studentId: String(early._id) },
      ms(world.earlySession.startsAt, -2 * 60 * 60 * 1000)
    );
    const bellResult = await kioskService.signIn(world.kiosk, { studentId: String(onTheBell._id) }, world.earlySession.endsAt);

    // Both land on their OWN 16:00 session — not the 18:00 one as a walk-in,
    // which is where an off-by-one "ended" boundary would silently send them.
    expect(String(earlyResult.session._id)).toBe(String(world.earlySession._id));
    expect(String(bellResult.session._id)).toBe(String(world.earlySession._id));
    const bellVisit = await Visit.findOne({ studentId: onTheBell._id, groupClassSessionId: world.earlySession._id }).lean();
    expect(bellVisit).toMatchObject({ status: 'attended', isMakeupClass: false });
  });

  it("409s 'class today has already ended' once the student's only class is over, and writes nothing", async () => {
    const world = await seedWorld();
    // A trial student (no subscription, so never a walk-in anywhere) is
    // eligible for the 18:00 session only — once it ends, nothing is open.
    const onlyLate = await seedStudent('Lou');
    await visitService.createScheduledVisit(onlyLate._id, world.lateSession._id, world.late._id, 'trial');
    const before = await Visit.findOne({ studentId: onlyLate._id }).lean();

    await expect(
      kioskService.signIn(world.kiosk, { studentId: String(onlyLate._id) }, ms(world.lateSession.endsAt, 1))
    ).rejects.toMatchObject({ status: 409, message: "Lou's class today has already ended" });

    const after = await Visit.findOne({ studentId: onlyLate._id }).lean();
    expect(after.status).toBe('scheduled');
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it("signs a student whose own class has ended into a later session of the same class, as a walk-in", async () => {
    const world = await seedWorld();
    const ava = await seedRosterStudent(world);

    const result = await kioskService.signIn(world.kiosk, { studentId: String(ava._id) }, ms(world.earlySession.endsAt, 1));

    expect(String(result.session._id)).toBe(String(world.lateSession._id));
    const visit = await Visit.findOne({ studentId: ava._id, groupClassSessionId: world.lateSession._id }).lean();
    expect(visit).toMatchObject({ status: 'attended', isMakeupClass: true });
  });

  it("prefers the student's own session over a nearer walk-in session", async () => {
    const world = await seedWorld();
    const lateRoster = await seedStudent('Lee');
    await subscribe(lateRoster, world.late);
    await visitService.createScheduledVisit(lateRoster._id, world.lateSession._id, world.late._id, 'regular');

    // `now` = the 16:00 start: the 16:00 session is nearer, but it is a walk-in for Lee.
    const result = await kioskService.signIn(world.kiosk, { studentId: String(lateRoster._id) }, world.earlySession.startsAt);

    expect(String(result.session._id)).toBe(String(world.lateSession._id));
  });

  it('picks the walk-in session starting nearest to now when there is no own session', async () => {
    const world = await seedWorld();
    const kip = await seedStudent('Kip');
    await subscribe(kip, world.otherDay);

    const nearLate = await kioskService.signIn(world.kiosk, { studentId: String(kip._id) }, ms(world.lateSession.startsAt, -10 * 60 * 1000));

    expect(String(nearLate.session._id)).toBe(String(world.lateSession._id));
  });

  it("returns alreadySignedIn and writes nothing on a second sign-in", async () => {
    const world = await seedWorld();
    const ava = await seedRosterStudent(world);
    await kioskService.signIn(world.kiosk, { studentId: String(ava._id) }, world.earlySession.startsAt);
    const first = await Visit.findOne({ studentId: ava._id }).lean();

    const again = await kioskService.signIn(world.kiosk, { studentId: String(ava._id) }, world.earlySession.startsAt);

    expect(again.alreadySignedIn).toBe(true);
    const second = await Visit.findOne({ studentId: ava._id }).lean();
    expect(second.updatedAt.getTime()).toBe(first.updatedAt.getTime());
    expect(await Visit.countDocuments({ studentId: ava._id })).toBe(1);
  });

  it("409s 'has no class today' when nothing today fits the student", async () => {
    const world = await seedWorld();
    const loner = await seedStudent('Nia');

    await expect(
      kioskService.signIn(world.kiosk, { studentId: String(loner._id) }, world.earlySession.startsAt)
    ).rejects.toMatchObject({ status: 409, message: 'Nia has no class today' });
  });

  it('signs in a student whose class today is at a second location (academy-wide, K3)', async () => {
    const world = await seedWorld();
    const elsewhere = await seedLocation('Plano');
    const otherClass = await seedClass(elsewhere, world.level, 'Plano Foil');
    const otherSchedule = await seedSchedule(otherClass);
    const otherSession = await createSession(otherSchedule, world.today);
    const far = await seedStudent('Far');
    await subscribe(far, otherSchedule);
    await visitService.createScheduledVisit(far._id, otherSession._id, otherSchedule._id, 'regular');

    const result = await kioskService.signIn(world.kiosk, { studentId: String(far._id) }, otherSession.startsAt);

    expect(String(result.session._id)).toBe(String(otherSession._id));
    expect(result.session.className).toBe('Plano Foil');
  });

  it("409s 'has no class today' on an academy holiday (never the 400 the attendance guard would give)", async () => {
    const world = await seedWorld();
    const ava = await seedRosterStudent(world);
    await Holiday.create({ name: 'Closure', startDate: world.today, endDate: world.today });

    await expect(
      kioskService.signIn(world.kiosk, { studentId: String(ava._id) }, world.earlySession.startsAt)
    ).rejects.toMatchObject({ status: 409, message: 'Ava has no class today' });
  });

  it('404s an unknown student or a non-student id, and 400s a malformed id', async () => {
    const world = await seedWorld();
    const parent = await User.create({ role: 'parent', firstName: 'Pat', lastName: 'Parent', email: 'pp@x.com' });

    await expect(
      kioskService.signIn(world.kiosk, { studentId: String(new mongoose.Types.ObjectId()) })
    ).rejects.toMatchObject({ status: 404 });
    await expect(kioskService.signIn(world.kiosk, { studentId: String(parent._id) })).rejects.toMatchObject({ status: 404 });
    await expect(kioskService.signIn(world.kiosk, { studentId: 'abc' })).rejects.toMatchObject({ status: 400 });
    expect(await Visit.countDocuments()).toBe(0);
  });
});
