const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');
const User = require('../../../src/models/user.model');
const Level = require('../../../src/models/level.model');
const GroupClass = require('../../../src/models/groupClass.model');
const Service = require('../../../src/models/service.model');

const { refreshStagingData } = require('../../../scripts/lib/refreshStagingData');

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

const TEST_CONFIG = {
  LOCATION: { name: 'Test Academy', address: '1 Test Way' },
  COACHES: { chris: { firstName: 'Chris', lastName: 'Coachlast', email: 'coach-chris@test.local', password: 'pw123456' } },
  LEVELS: { advanced: { name: 'Advanced', order: 1, monthlyFee: 200, capacity: 20, aliases: ['advanced'] } },
  CLASS_SCHEDULES: { advanced: [{ coach: 'chris', day: 2, start: '19:00', end: '20:30', primary: true }] },
  PRIVATE_CLASS_CONTRACT: { coach: 'chris', studentBillingRate: 60, coachCompensationRate: 30, sessionDurationMinutes: 60, notes: 'test' },
  TEST_RECORD_FILTERS: { emailDomains: ['kicksite.net'], firstNamePrefixes: ['test'] },
};

const CSV =
  'PIN,First Name,Last Name,Family Name,Phone Number,Age,Birthdate,Programs,Email Address(es),Guardian(s)\n' +
  '9001,Real,Student,,,,,Advanced,,';

const SUPERADMIN_FIELDS = { email: 'admin@friscofencing.local', password: 'pw123456', firstName: 'Frisco', lastName: 'Admin' };

describe('scripts/lib/refreshStagingData', () => {
  it('wipes pre-existing (stale/manual test) data, imports the real data, then ensures superadmin exists — in that order', async () => {
    // Simulate exactly the kind of stale manual test data found on staging:
    // a plain-named "Beginner" Level/GroupClass, no legacyPin.
    const staleLevel = await Level.create({ name: 'Beginner', order: 1 });
    await GroupClass.create({ name: 'Beginner 1 - Test', levelId: staleLevel._id, locationId: staleLevel._id, capacity: 10 });
    await User.create({ role: 'coach', firstName: 'Old', lastName: 'TestCoach', email: 'coach1@friscofencing.test' });

    const result = await refreshStagingData({ csvText: CSV, config: TEST_CONFIG, superadmin: SUPERADMIN_FIELDS });

    // Stale data is gone.
    expect(await Level.countDocuments({ name: 'Beginner' })).toBe(0);
    expect(await GroupClass.countDocuments({ name: 'Beginner 1 - Test' })).toBe(0);
    expect(await User.countDocuments({ email: 'coach1@friscofencing.test' })).toBe(0);

    // The real import ran and produced the new data.
    expect(result.importSummary.studentsCreated).toBe(1);
    expect(await Level.countDocuments({ name: 'Advanced' })).toBe(1);
    const student = await User.findOne({ role: 'student', firstName: 'Real' });
    expect(student).not.toBeNull();

    // Superadmin exists afterward.
    expect(result.superadminCreated).toBe(true);
    const superadmin = await User.findOne({ role: 'superadmin' });
    expect(superadmin.email).toBe('admin@friscofencing.local');

    // Services seeded as part of the refresh (docs/plans/service-registry-
    // unified-ledger-plan.md) — the source's own ordering comment documents
    // WHY seeding runs before the import (a future PR's ledger writes will
    // depend on it); this test proves the observable PR A behavior, that a
    // refresh always leaves a fully-seeded registry.
    expect(await Service.countDocuments()).toBe(4);
    expect(result.serviceSeedResults.results.every((r) => r.action === 'created')).toBe(true);
  });

  it('is safe to run twice in a row: the second run wipes the first run\'s own data and rebuilds it identically', async () => {
    await refreshStagingData({ csvText: CSV, config: TEST_CONFIG, superadmin: SUPERADMIN_FIELDS });
    const second = await refreshStagingData({ csvText: CSV, config: TEST_CONFIG, superadmin: SUPERADMIN_FIELDS });

    expect(second.importSummary.studentsCreated).toBe(1); // recreated fresh after the wipe, not "already existing"
    expect(await User.countDocuments({ role: 'student' })).toBe(1);
    expect(await User.countDocuments({ role: 'superadmin' })).toBe(1);
  });
});
