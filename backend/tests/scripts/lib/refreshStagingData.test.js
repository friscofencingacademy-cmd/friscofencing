const mongoose = require('mongoose');

const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');
const User = require('../../../src/models/user.model');
const Level = require('../../../src/models/level.model');
const GroupClass = require('../../../src/models/groupClass.model');
const Service = require('../../../src/models/service.model');
const PaymentMethod = require('../../../src/models/paymentMethod.model');
const PrivateClassEnrollment = require('../../../src/models/privateClassEnrollment.model');
const PrivateClassSchedule = require('../../../src/models/privateClassSchedule.model');
const { comparePassword } = require('../../../src/utils/password');
const { STAGING_TEST_PASSWORD } = require('../../../scripts/lib/setStagingTestPasswords');

const { refreshStagingData } = require('../../../scripts/lib/refreshStagingData');
const { AUDIT_FAMILIES } = require('../../../scripts/lib/seedAuditFixtures');
const { freezeAt } = require('../../testUtils/clock');
const GroupClassSession = require('../../../src/models/groupClassSession.model');
const GroupClassSchedule = require('../../../src/models/groupClassSchedule.model');

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

// The refresh now ends by seeding the audit fixtures, which generates
// sessions from "today" — pinned so every run sees the same calendar.
beforeEach(() => {
  freezeAt('2026-10-28T15:00:00.000Z');
});

afterEach(async () => {
  jest.useRealTimers();
  await clearTestDB();
});

const AUDIT_PASSWORD = 'audit-pw-123';

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

    const result = await refreshStagingData({ csvText: CSV, config: TEST_CONFIG, superadmin: SUPERADMIN_FIELDS, auditTestPassword: AUDIT_PASSWORD });

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

    // periodMonth/Guard B index migration (docs/plans/payment-airtight-
    // plan.md D7) ran, cleanly, against the just-wiped (empty) ledger.
    expect(result.periodMonthMigration.aborted).toBe(false);
    expect(result.periodMonthMigration.changeCount).toBe(0);

    // Every login-capable user this refresh just created (the real
    // students' migrated parent gets none, coaches do, superadmin does) is
    // logged in with the same known staging password — including the coach
    // account, which the legacy import itself gave a real, distinct
    // password (`pw123456` in TEST_CONFIG above) before this step
    // overwrote it (docs/plans/payment-airtight-plan.md, owner request
    // 2026-08-31).
    const coach = await User.findOne({ email: 'coach-chris@test.local' });
    expect(await comparePassword(STAGING_TEST_PASSWORD, coach.passwordHash)).toBe(true);
    const superadminUser = await User.findOne({ role: 'superadmin' });
    expect(await comparePassword(STAGING_TEST_PASSWORD, superadminUser.passwordHash)).toBe(true);
  });

  it(
    'wires the provider scrub step into the sequence and leaves no provider field behind — pre-existing data is ' +
      'already gone by step 1 (the wipe), so this proves the post-condition invariant + result shape, not the ' +
      "scrub step's own logic in isolation (that's scrubProviderFields.test.js's job, seeding data WITHOUT a wipe " +
      'first). docs/plans/payment-airtight-plan.md, owner request 2026-08-31.',
    async () => {
      // Any pre-existing payment-provider data (simulating what a future production-
      // to-staging clone could carry in) is wiped by step 1 regardless of
      // whether the scrub step exists at all — that's expected, not a gap
      // in this test: the scrub step exists as a standing guarantee for
      // whatever import path runs AFTER the wipe, not to catch data from
      // before it.
      await User.create({
        role: 'parent',
        firstName: 'Old',
        lastName: 'Family',
        email: 'old-family@example.com',
        paymentProvider: 'stripe',
        providerCustomerId: 'cus_leftover123',
      });

      const result = await refreshStagingData({ csvText: CSV, config: TEST_CONFIG, superadmin: SUPERADMIN_FIELDS, auditTestPassword: AUDIT_PASSWORD });

      expect(result.providerScrubResult).toEqual({
        providerCustomerIdsCleared: 0,
        paymentMethodsDeleted: 0,
        providerPaymentIdsCleared: 0,
      });
      expect(await PaymentMethod.countDocuments({})).toBe(0);
      expect(await User.countDocuments({ providerCustomerId: { $exists: true } })).toBe(0);
    }
  );

  // docs/plans/booking-and-private-class-fixes-plan.md §3 — a real staging
  // incident: pre-existing PrivateClassSchedule rows survived every refresh
  // (wipeDatabase()'s old model-registry enumeration never touched them,
  // this test file's own require graph never having loaded that model
  // either — the exact real-world condition), and the legacy import
  // recreated a fresh, slotless enrollment for the private-class-flagged
  // row on every run. This asserts the composed fix end-to-end: both are
  // gone after a refresh. The import never creates a private-lesson purchase
  // (ADR 011 — an enrollment is paid credit), it only flags the student.
  it('wipes pre-existing private-class data and creates no purchase from a private-class-flagged CSV row', async () => {
    await PrivateClassSchedule.create({
      coachId: new mongoose.Types.ObjectId(),
      dayOfWeek: 2,
      startTime: '16:00',
      durationMinutes: 60,
      startDate: new Date('2026-09-01'),
      endDate: new Date('2026-12-31'),
    });
    expect(await PrivateClassSchedule.countDocuments({})).toBe(1);

    const csvWithPrivateRow =
      'PIN,First Name,Last Name,Family Name,Phone Number,Age,Birthdate,Programs,Email Address(es),Guardian(s)\n' +
      '9002,Sana,Sarath,,,,,"Private Classes - Coach Chris, Advanced",,';

    const result = await refreshStagingData({ csvText: csvWithPrivateRow, config: TEST_CONFIG, superadmin: SUPERADMIN_FIELDS, auditTestPassword: AUDIT_PASSWORD });

    expect(await PrivateClassSchedule.countDocuments({})).toBe(0);
    expect(result.importSummary.privateClassStudentsFlagged).toBe(1);
    expect(await PrivateClassEnrollment.countDocuments({})).toBe(0);
    // The rest of the row still imported normally.
    const student = await User.findOne({ firstName: 'Sana' });
    expect(student).not.toBeNull();
  });

  it('is safe to run twice in a row: the second run wipes the first run\'s own data and rebuilds it identically', async () => {
    await refreshStagingData({ csvText: CSV, config: TEST_CONFIG, superadmin: SUPERADMIN_FIELDS, auditTestPassword: AUDIT_PASSWORD });
    const second = await refreshStagingData({ csvText: CSV, config: TEST_CONFIG, superadmin: SUPERADMIN_FIELDS, auditTestPassword: AUDIT_PASSWORD });

    expect(second.importSummary.studentsCreated).toBe(1); // recreated fresh after the wipe, not "already existing"
    expect(await User.countDocuments({ role: 'student', firstName: 'Real' })).toBe(1);
    expect(await User.countDocuments({ role: 'student', firstName: 'Audit' })).toBe(7);
    expect(await User.countDocuments({ role: 'superadmin' })).toBe(1);
  });

  // docs/plans/audit-and-health-refresh-plan.md D7 — the wipe used to remove
  // the live audit's fixtures and nothing put them back (found 2026-10-26).
  it('ends with the live-audit fixtures present, on the audit password, with sessions to book', async () => {
    const result = await refreshStagingData({ csvText: CSV, config: TEST_CONFIG, superadmin: SUPERADMIN_FIELDS, auditTestPassword: AUDIT_PASSWORD });

    const parentEmails = AUDIT_FAMILIES.map((family) => family.email);
    const parents = await User.find({ email: { $in: parentEmails } });
    expect(parents).toHaveLength(AUDIT_FAMILIES.length);
    // Seeded AFTER the shared staging password step, so the audit accounts
    // log in with AUDIT_TEST_PASSWORD, not Test@123.
    expect(await comparePassword(AUDIT_PASSWORD, parents[0].passwordHash)).toBe(true);
    expect(await comparePassword(STAGING_TEST_PASSWORD, parents[0].passwordHash)).toBe(false);

    // A fresh schedule is stocked by its own creation, so the extension has
    // nothing left to add; either way each audit schedule has 8 upcoming.
    expect(result.auditFixtures.sessionsCreated).toBe(0);
    const auditClasses = await GroupClass.find({ name: { $in: ['Audit Class A', 'Audit Class B'] } });
    expect(auditClasses).toHaveLength(2);
    const auditSchedules = await GroupClassSchedule.find({ classId: { $in: auditClasses.map((c) => c._id) } });
    for (const schedule of auditSchedules) {
      // eslint-disable-next-line no-await-in-loop
      expect(await GroupClassSession.countDocuments({ scheduleId: schedule._id, startsAt: { $gt: new Date() } })).toBe(8);
    }
  });

  it('refuses to start without the audit password, before wiping anything', async () => {
    await Level.create({ name: 'Keep Me', order: 1 });

    await expect(refreshStagingData({ csvText: CSV, config: TEST_CONFIG, superadmin: SUPERADMIN_FIELDS })).rejects.toThrow(
      'auditTestPassword (AUDIT_TEST_PASSWORD) is required'
    );
    expect(await Level.countDocuments({ name: 'Keep Me' })).toBe(1);
  });
});
