process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

const request = require('supertest');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const Location = require('../../src/models/location.model');
const Level = require('../../src/models/level.model');
const GroupClass = require('../../src/models/groupClass.model');
const GroupClassSchedule = require('../../src/models/groupClassSchedule.model');
const Subscription = require('../../src/models/subscription.model');
const Visit = require('../../src/models/visit.model');
const visitService = require('../../src/services/visit.service');
const { hashPassword } = require('../../src/utils/password');
const { todayDateOnly } = require('../../src/utils/billingDates');
const { seedServices } = require('../../scripts/lib/seedServices');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');
const { createSession } = require('../testUtils/sessions');

// docs/plans/kiosk-signin-plan.md §4.6 / §4.8 — the two kiosk routes through
// the real app, logged in as the `kiosk` role, plus the K2 lock-down: that
// login must be refused by every admin area.

const TEST_PASSWORD = 'correct-password';

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

beforeEach(async () => {
  await seedServices();
});

afterEach(async () => {
  await clearTestDB();
});

async function loginAgent(role, email) {
  const passwordHash = await hashPassword(TEST_PASSWORD);
  await User.create({ role, firstName: 'Test', lastName: role, email, passwordHash });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD });
  return agent;
}

// A class with a session today that runs until 23:59 Central, so it is
// still open whenever this suite runs.
async function seedToday() {
  const location = await Location.create({ name: 'Frisco Main', address: '1 Main St' });
  const level = await Level.create({ name: 'Foundation', order: 1 });
  const groupClass = await GroupClass.create({ name: 'Foundation Foil', levelId: level._id, locationId: location._id, capacity: 20 });
  const coach = await User.create({ role: 'coach', firstName: 'Cora', lastName: 'Coach', email: 'cora@x.com' });
  const schedule = await GroupClassSchedule.create({
    classId: groupClass._id,
    coachId: coach._id,
    dayOfWeek: 1,
    startTime: '00:00',
    endTime: '23:59',
    students: [],
  });
  const session = await createSession(schedule, todayDateOnly());

  const student = await User.create({ role: 'student', firstName: 'Ava', lastName: 'Student' });
  const parent = await User.create({ role: 'parent', firstName: 'Pat', lastName: 'Parent', email: 'pat@x.com' });
  await Subscription.create({
    studentId: student._id,
    scheduleId: schedule._id,
    parentId: parent._id,
    status: 'active',
    currentPeriodStart: new Date('2026-09-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
    nextBillingDate: new Date('2026-10-01T00:00:00.000Z'),
    isPremium: true,
  });
  await visitService.createScheduledVisit(student._id, session._id, schedule._id, 'regular');

  return { location, session, student };
}

describe('Kiosk routes', () => {
  it('lets the kiosk login read the directory and confirmation setting', async () => {
    const { student } = await seedToday();
    const tablet = await loginAgent('kiosk', 'frontdesk@x.com');

    const res = await tablet.get('/api/v1/kiosk/state');

    expect(res.status).toBe(200);
    expect(res.body.confirmationRequired).toBe(true);
    expect(res.body.students).toEqual([
      { studentId: String(student._id), firstName: 'Ava', lastName: 'Student', levelName: 'Foundation' },
    ]);
  });

  it('signs a student in as the kiosk account, and the session read shows them present', async () => {
    const { session, student } = await seedToday();
    const tablet = await loginAgent('kiosk', 'frontdesk@x.com');
    const admin = await loginAgent('admin', 'kiosk-admin@x.com');

    const res = await tablet.post('/api/v1/kiosk/sign-in').send({ studentId: String(student._id) });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      student: { firstName: 'Ava', lastName: 'Student' },
      session: { className: 'Foundation Foil', startTime: '00:00', endTime: '23:59', coachName: 'Cora Coach' },
      alreadySignedIn: false,
    });

    const read = await admin.get(`/api/v1/group-class-sessions/${session._id}`);
    const row = read.body.session.students.find((s) => String(s.studentId._id) === String(student._id));
    expect(row.isPresent).toBe(true);

    const kioskUser = await User.findOne({ email: 'frontdesk@x.com' });
    const visit = await Visit.findOne({ studentId: student._id, groupClassSessionId: session._id }).lean();
    expect(visit.markedVia).toBe('kiosk');
    expect(String(visit.markedBy)).toBe(String(kioskUser._id));

    const again = await tablet.post('/api/v1/kiosk/sign-in').send({ studentId: String(student._id) });
    expect(again.body.alreadySignedIn).toBe(true);
  });

  it('lets an admin or superadmin use the kiosk routes too', async () => {
    await seedToday();
    const admin = await loginAgent('admin', 'kiosk-admin@x.com');
    const superadmin = await loginAgent('superadmin', 'kiosk-super@x.com');

    expect((await admin.get('/api/v1/kiosk/state')).status).toBe(200);
    expect((await superadmin.get('/api/v1/kiosk/state')).status).toBe(200);
  });

  it('401s without a login and 403s a parent or coach', async () => {
    const { student } = await seedToday();
    const coach = await loginAgent('coach', 'kiosk-coach@x.com');
    const parent = await loginAgent('parent', 'kiosk-parent@x.com');

    expect((await request(app).get('/api/v1/kiosk/state')).status).toBe(401);
    expect((await coach.get('/api/v1/kiosk/state')).status).toBe(403);
    expect((await parent.post('/api/v1/kiosk/sign-in').send({ studentId: String(student._id) })).status).toBe(403);
  });

  it('returns the 409 message for a student with no class today, and 400 for a malformed id', async () => {
    await seedToday();
    const tablet = await loginAgent('kiosk', 'frontdesk@x.com');
    const nia = await User.create({ role: 'student', firstName: 'Nia', lastName: 'None' });

    const noClass = await tablet.post('/api/v1/kiosk/sign-in').send({ studentId: String(nia._id) });
    expect(noClass.status).toBe(409);
    expect(noClass.body).toEqual({ message: 'Nia has no class today' });

    expect((await tablet.post('/api/v1/kiosk/sign-in').send({ studentId: 'nope' })).status).toBe(400);
  });

  // K2 — the security boundary: a kiosk login reaches nothing admin-side.
  it('refuses the kiosk login everywhere admin-side, and on coach attendance marking', async () => {
    const { session, student } = await seedToday();
    const tablet = await loginAgent('kiosk', 'frontdesk@x.com');
    const subscription = await Subscription.findOne({ studentId: student._id });

    const attempts = [
      ['GET /users', tablet.get('/api/v1/users')],
      ['POST /users', tablet.post('/api/v1/users').send({ role: 'admin', firstName: 'X', lastName: 'Y' })],
      ['GET /settings', tablet.get('/api/v1/settings')],
      ['PATCH /settings', tablet.patch('/api/v1/settings').send({ kioskConfirmationRequired: false })],
      ['POST /subscriptions/:id/charge', tablet.post(`/api/v1/subscriptions/${subscription._id}/charge`)],
      ['POST /holidays', tablet.post('/api/v1/holidays').send({ name: 'X', startDate: '2026-12-25', endDate: '2026-12-25' })],
      ['GET /audit-runs', tablet.get('/api/v1/audit-runs')],
      [
        'PATCH /group-class-sessions/:id/attendance',
        tablet
          .patch(`/api/v1/group-class-sessions/${session._id}/attendance`)
          .send({ students: [{ studentId: String(student._id), isPresent: true }] }),
      ],
    ];

    const results = await Promise.all(attempts.map(async ([label, req]) => [label, (await req).status]));

    expect(results).toEqual(attempts.map(([label]) => [label, 403]));
  });
});
