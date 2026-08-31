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
    'wires the Stripe scrub step into the sequence and leaves no Stripe field behind — pre-existing data is ' +
      'already gone by step 1 (the wipe), so this proves the post-condition invariant + result shape, not the ' +
      "scrub step's own logic in isolation (that's scrubStripeFields.test.js's job, seeding data WITHOUT a wipe " +
      'first). docs/plans/payment-airtight-plan.md, owner request 2026-08-31.',
    async () => {
      // Any pre-existing Stripe data (simulating what a future production-
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
        stripeCustomerId: 'cus_leftover123',
      });

      const result = await refreshStagingData({ csvText: CSV, config: TEST_CONFIG, superadmin: SUPERADMIN_FIELDS });

      expect(result.stripeScrubResult).toEqual({
        stripeCustomerIdsCleared: 0,
        paymentMethodsDeleted: 0,
        stripePaymentIntentIdsCleared: 0,
      });
      expect(await PaymentMethod.countDocuments({})).toBe(0);
      expect(await User.countDocuments({ stripeCustomerId: { $exists: true } })).toBe(0);
    }
  );

  // docs/plans/booking-and-private-class-fixes-plan.md §3 — a real staging
  // incident: pre-existing PrivateClassSchedule rows survived every refresh
  // (wipeDatabase()'s old model-registry enumeration never touched them,
  // this test file's own require graph never having loaded that model
  // either — the exact real-world condition), and the legacy import
  // recreated a fresh, slotless enrollment for the private-class-flagged
  // row on every run. This asserts the composed fix end-to-end: both are
  // gone after a refresh, using the real (undefined -> falsy -> skipped)
  // TEST_CONFIG, matching the real config's own default.
  it('wipes pre-existing private-class data and creates none from a private-class-flagged CSV row (IMPORT_PRIVATE_CLASS_ENROLLMENTS unset -> skipped)', async () => {
    await PrivateClassSchedule.create({
      coachId: new mongoose.Types.ObjectId(),
      dayOfWeek: 2,
      startTime: '16:00',
      durationMinutes: 60,
    });
    expect(await PrivateClassSchedule.countDocuments({})).toBe(1);

    const csvWithPrivateRow =
      'PIN,First Name,Last Name,Family Name,Phone Number,Age,Birthdate,Programs,Email Address(es),Guardian(s)\n' +
      '9002,Sana,Sarath,,,,,"Private Classes - Coach Chris, Advanced",,';

    const result = await refreshStagingData({ csvText: csvWithPrivateRow, config: TEST_CONFIG, superadmin: SUPERADMIN_FIELDS });

    expect(await PrivateClassSchedule.countDocuments({})).toBe(0);
    expect(result.importSummary.privateClassEnrollmentsCreated).toBe(0);
    expect(result.importSummary.privateClassEnrollmentsSkipped).toBe(1);
    expect(await PrivateClassEnrollment.countDocuments({})).toBe(0);
    // The rest of the row still imported normally — only the private-class
    // branch is gated, not the whole student/group-class enrollment.
    const student = await User.findOne({ firstName: 'Sana' });
    expect(student).not.toBeNull();
  });

  it('is safe to run twice in a row: the second run wipes the first run\'s own data and rebuilds it identically', async () => {
    await refreshStagingData({ csvText: CSV, config: TEST_CONFIG, superadmin: SUPERADMIN_FIELDS });
    const second = await refreshStagingData({ csvText: CSV, config: TEST_CONFIG, superadmin: SUPERADMIN_FIELDS });

    expect(second.importSummary.studentsCreated).toBe(1); // recreated fresh after the wipe, not "already existing"
    expect(await User.countDocuments({ role: 'student' })).toBe(1);
    expect(await User.countDocuments({ role: 'superadmin' })).toBe(1);
  });
});
