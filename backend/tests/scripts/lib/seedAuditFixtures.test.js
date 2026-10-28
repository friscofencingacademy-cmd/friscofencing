const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');
const { freezeAt } = require('../../testUtils/clock');
const User = require('../../../src/models/user.model');
const Level = require('../../../src/models/level.model');
const GroupClass = require('../../../src/models/groupClass.model');
const GroupClassSchedule = require('../../../src/models/groupClassSchedule.model');
const GroupClassSession = require('../../../src/models/groupClassSession.model');
const Price = require('../../../src/models/price.model');
const { comparePassword } = require('../../../src/utils/password');
const { seedServices } = require('../../../scripts/lib/seedServices');

const {
  seedAuditFixtures,
  AUDIT_FAMILIES,
  AUDIT_PARENT_PHONE,
  AUDIT_STUDENT_DATE_OF_BIRTH,
} = require('../../../scripts/lib/seedAuditFixtures');

// docs/plans/audit-and-health-refresh-plan.md PR 2 (D7). Clock pinned to a
// Wednesday so every generated session date is a literal.
const NOW = '2026-10-28T15:00:00.000Z';
const PASSWORD = 'audit-pw-123';

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

beforeEach(() => {
  freezeAt(NOW);
});

afterEach(async () => {
  jest.useRealTimers();
  await clearTestDB();
});

async function upcomingDays(groupClassName) {
  const groupClass = await GroupClass.findOne({ name: groupClassName });
  const schedule = await GroupClassSchedule.findOne({ classId: groupClass._id });
  const sessions = await GroupClassSession.find({ scheduleId: schedule._id, startsAt: { $gt: new Date() } })
    .sort({ date: 1 })
    .lean();
  return sessions.map((session) => session.date.toISOString().slice(0, 10));
}

describe('scripts/lib/seedAuditFixtures', () => {
  it('creates every audit account, the catalog, and both schedules stocked with 8 upcoming sessions', async () => {
    await seedServices();

    const result = await seedAuditFixtures({ testPassword: PASSWORD });

    expect(await User.countDocuments({ role: 'parent', email: /^audit-/ })).toBe(6);
    expect(await User.countDocuments({ role: 'student', firstName: 'Audit' })).toBe(8);
    expect(await User.countDocuments({ role: 'coach', email: 'audit-coach@example.com' })).toBe(1);

    for (const family of AUDIT_FAMILIES) {
      // eslint-disable-next-line no-await-in-loop
      const parent = await User.findOne({ email: family.email });
      expect(parent.phone).toBe(AUDIT_PARENT_PHONE);
      // eslint-disable-next-line no-await-in-loop
      expect(await comparePassword(PASSWORD, parent.passwordHash)).toBe(true);
      // eslint-disable-next-line no-await-in-loop
      const children = await User.find({ role: 'student', parentId: parent._id }).sort({ lastName: 1 });
      expect(children.map((child) => child.lastName).sort()).toEqual([...family.children].sort());
      children.forEach((child) => expect(child.dateOfBirth.toISOString()).toBe(AUDIT_STUDENT_DATE_OF_BIRTH.toISOString()));
    }

    const levelA = await Level.findOne({ name: 'Audit Level A' });
    const levelB = await Level.findOne({ name: 'Audit Level B' });
    expect(await Price.findOne({ levelId: levelA._id }).lean()).toMatchObject({ monthlyFee: 100, registrationFee: 0 });
    expect(await Price.findOne({ levelId: levelB._id }).lean()).toMatchObject({ monthlyFee: 50, registrationFee: 0 });

    // Class A meets Tuesdays, Class B Thursdays.
    expect(await upcomingDays('Audit Class A')).toEqual([
      '2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24', '2026-12-01', '2026-12-08', '2026-12-15', '2026-12-22',
    ]);
    expect(await upcomingDays('Audit Class B')).toEqual([
      '2026-10-29', '2026-11-05', '2026-11-12', '2026-11-19', '2026-11-26', '2026-12-03', '2026-12-10', '2026-12-17',
    ]);

    expect(result.counts.schedules).toEqual({ created: 2, updated: 0, unchanged: 0 });
  });

  it('is idempotent: a second run creates nothing and keeps every id', async () => {
    await seedServices();
    const first = await seedAuditFixtures({ testPassword: PASSWORD });
    const usersBefore = await User.countDocuments();
    const sessionsBefore = await GroupClassSession.countDocuments();

    const second = await seedAuditFixtures({ testPassword: PASSWORD });

    expect(second.counts.users.created).toBe(0);
    expect(second.counts.users.updated).toBe(0);
    expect(second.counts.catalog.created).toBe(0);
    expect(second.counts.schedules).toEqual({ created: 0, updated: 0, unchanged: 2 });
    expect(second.sessionExtension.totals.created).toBe(0);
    expect(await User.countDocuments()).toBe(usersBefore);
    expect(await GroupClassSession.countDocuments()).toBe(sessionsBefore);
    expect(String(second.families[0].parent._id)).toBe(String(first.families[0].parent._id));
  });

  it('converges drifted audit records back to their declared state', async () => {
    await seedServices();
    await seedAuditFixtures({ testPassword: PASSWORD });

    await User.updateOne({ email: 'audit-parent-1@example.com' }, { $unset: { phone: '' } });
    await User.updateOne({ role: 'student', lastName: 'ChildOne' }, { $unset: { dateOfBirth: '' } });
    const levelA = await Level.findOne({ name: 'Audit Level A' });
    await Price.updateOne({ levelId: levelA._id }, { registrationFee: 145 });

    const result = await seedAuditFixtures({ testPassword: 'a-new-password' });

    expect((await User.findOne({ email: 'audit-parent-1@example.com' })).phone).toBe(AUDIT_PARENT_PHONE);
    expect((await User.findOne({ role: 'student', lastName: 'ChildOne' })).dateOfBirth).not.toBeUndefined();
    expect((await Price.findOne({ levelId: levelA._id })).registrationFee).toBe(0);
    const parent = await User.findOne({ email: 'audit-retry-parent@example.com' });
    expect(await comparePassword('a-new-password', parent.passwordHash)).toBe(true);
    expect(result.counts.users.updated).toBeGreaterThanOrEqual(2);
  });

  it('restocks an audit schedule whose sessions ran out', async () => {
    await seedServices();
    await seedAuditFixtures({ testPassword: PASSWORD });
    await GroupClassSession.deleteMany({});

    const result = await seedAuditFixtures({ testPassword: PASSWORD });

    expect(result.sessionExtension.totals.created).toBe(16);
    expect(await upcomingDays('Audit Class A')).toHaveLength(8);
  });

  it('never adopts a non-audit student who shares a name, and never matches the coach as a student', async () => {
    await seedServices();
    const outsider = await User.create({ role: 'parent', firstName: 'Real', lastName: 'Parent', email: 'real@example.com' });
    const lookalike = await User.create({ role: 'student', firstName: 'Audit', lastName: 'ChildOne', parentId: outsider._id });

    await seedAuditFixtures({ testPassword: PASSWORD });

    expect((await User.findById(lookalike._id)).dateOfBirth).toBeUndefined();
    expect(await User.countDocuments({ role: 'student', firstName: 'Audit', lastName: 'ChildOne' })).toBe(2);
    expect(await User.countDocuments({ role: 'coach' })).toBe(1);
  });

  it('refuses to run without the group-classes Service, writing nothing', async () => {
    await expect(seedAuditFixtures({ testPassword: PASSWORD })).rejects.toThrow('npm run seed:services');
    expect(await User.countDocuments()).toBe(0);
  });

  it('refuses to run without a password', async () => {
    await seedServices();
    await expect(seedAuditFixtures({})).rejects.toThrow('testPassword (AUDIT_TEST_PASSWORD) is required');
    expect(await User.countDocuments()).toBe(0);
  });

  it('touches nothing outside the audit-owned records', async () => {
    await seedServices();
    const realLevel = await Level.create({ name: 'Beginner', order: 1 });
    const realPrice = await Price.create({ levelId: realLevel._id, monthlyFee: 175, registrationFee: 145 });
    const realParent = await User.create({ role: 'parent', firstName: 'Pat', lastName: 'Real', email: 'pat@example.com', phone: '214-555-0100' });

    await seedAuditFixtures({ testPassword: PASSWORD });

    expect(await Price.findById(realPrice._id).lean()).toMatchObject({ monthlyFee: 175, registrationFee: 145 });
    expect((await User.findById(realParent._id)).passwordHash).toBeUndefined();
  });
});
