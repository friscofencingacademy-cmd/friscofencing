const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');
const User = require('../../../src/models/user.model');
const GroupClass = require('../../../src/models/groupClass.model');
const GroupClassSchedule = require('../../../src/models/groupClassSchedule.model');
const Subscription = require('../../../src/models/subscription.model');
const Registration = require('../../../src/models/registration.model');
const PrivateClassEnrollment = require('../../../src/models/privateClassEnrollment.model');
const CoachContract = require('../../../src/models/coachContract.model');
const { seedServices } = require('../../../scripts/lib/seedServices');

const { runLegacyImport } = require('../../../scripts/lib/runLegacyImport');

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

beforeEach(async () => {
  // The import resolves both group-classes and private-lessons Services
  // internally now (docs/plans/service-registry-unified-ledger-plan.md).
  await seedServices();
});

afterEach(async () => {
  await clearTestDB();
});

// A small but structurally real config — same shape as
// scripts/legacy-import.config.js, scaled down to 2 levels/2 coaches so the
// integration test stays fast and easy to reason about.
const TEST_CONFIG = {
  LOCATION: { name: 'Test Academy', address: '1 Test Way' },
  COACHES: {
    chris: { firstName: 'Chris', lastName: 'Coachlast', email: 'coach-chris@test.local', password: 'pw123456' },
    keith: { firstName: 'Keith', lastName: 'Coachlast', email: 'coach-keith@test.local', password: 'pw123456' },
  },
  LEVELS: {
    intermediate: { name: 'Intermediate', order: 1, monthlyFee: 100, capacity: 20, aliases: ['intermediate'] },
    advanced: { name: 'Advanced', order: 2, monthlyFee: 200, capacity: 20, aliases: ['advanced'] },
  },
  CLASS_SCHEDULES: {
    intermediate: [
      { coach: 'chris', day: 2, start: '18:00', end: '19:00', primary: true },
      { coach: 'keith', day: 1, start: '17:30', end: '18:30' },
    ],
    advanced: [{ coach: 'chris', day: 2, start: '19:00', end: '20:30', primary: true }],
  },
  PRIVATE_CLASS_CONTRACT: {
    coach: 'chris',
    studentBillingRate: 60,
    coachCompensationRate: 30,
    sessionDurationMinutes: 60,
    notes: 'test contract',
  },
  TEST_RECORD_FILTERS: { emailDomains: ['kicksite.net'], firstNamePrefixes: ['test'] },
};

const CSV_HEADER =
  'PIN,First Name,Last Name,Family Name,Phone Number,Age,Birthdate,Programs,Email Address(es),Guardian(s)';

function csvRow({ pin, first, last, family = '', phone = '', age = '10', birthdate = '', programs = '', email = '', guardian = '' }) {
  return `${pin},${first},${last},${family},${phone},${age},${birthdate},"${programs}",${email},${guardian}`;
}

describe('scripts/lib/runLegacyImport', () => {
  it('migrates two siblings into one synthesized family, enrolls the Intermediate sibling in every Intermediate schedule, and applies the sibling discount to the second one in', async () => {
    const csvText = [
      CSV_HEADER,
      csvRow({ pin: '2001', first: 'Alice', last: 'Sib', phone: '+15550001', programs: 'Intermediate' }),
      csvRow({ pin: '2002', first: 'Bob', last: 'Sib', phone: '+15550001', programs: 'Intermediate' }),
    ].join('\n');

    const summary = await runLegacyImport({ csvText, config: TEST_CONFIG });

    expect(summary.totalRows).toBe(2);
    expect(summary.parentsCreated).toBe(1);
    expect(summary.studentsCreated).toBe(2);
    expect(summary.studentsEnrolledInLevel).toBe(2);

    const parent = await User.findOne({ role: 'parent', lastName: 'Sib' });
    expect(parent).not.toBeNull();

    const students = await User.find({ role: 'student', parentId: parent._id }).sort({ firstName: 1 });
    expect(students.map((s) => s.firstName)).toEqual(['Alice', 'Bob']);

    const groupClass = await GroupClass.findOne({ name: 'Intermediate' });
    const schedules = await GroupClassSchedule.find({ classId: groupClass._id });
    expect(schedules).toHaveLength(2);

    // Both siblings end up on BOTH of Intermediate's schedules (fencing +
    // fitness) — the "flat fee, attend any scheduled session" model — but
    // only ONE Subscription each, against the primary schedule.
    schedules.forEach((schedule) => {
      const rosterIds = schedule.students.map(String);
      students.forEach((student) => expect(rosterIds).toContain(String(student._id)));
    });

    const primarySchedule = schedules.find((s) => s.startTime === '18:00');
    const subscriptions = await Subscription.find({ scheduleId: primarySchedule._id });
    expect(subscriptions).toHaveLength(2);

    const registrations = await Registration.find({ scheduleId: primarySchedule._id });
    expect(registrations).toHaveLength(2);
    // Real ledger rows (docs/plans/registration-ledger-plan.md), not the old
    // 3-field enrollment stub — 'completed' because this backfill represents
    // a REAL historical charge in the legacy system, just with no Stripe
    // PaymentIntent of our own to attach.
    registrations.forEach((registration) => {
      expect(registration.eventType).toBe('initial');
      expect(registration.status).toBe('completed');
      expect(registration.stripePaymentIntentId).toBeNull();
      expect(typeof registration.amount).toBe('number');
      expect(String(registration.subscriptionId)).not.toBe('undefined');
    });

    // Alice (processed first) has no sibling with an active Subscription
    // yet at the instant hers is created (Bob's doesn't exist yet), so
    // calculateChargeAmount correctly finds zero siblings for her, same as
    // if she were genuinely an only child at that instant — identical to
    // how the live app's own first-sibling-to-register already behaves
    // (calculateChargeAmount.service.js's "Known, accepted MVP limitation"
    // comment), not something this migration introduces.
    //
    // Bob (processed second, same Intermediate fee as Alice — an EXACT
    // tie) DOES get the discount: docs/decisions/006-sibling-discount-
    // family-rule.md's registration-mode rule always applies the family
    // discount the moment a family qualifies, with no tiebreak needed for
    // an exact tie (base = min(newFee, existingFee) is just that fee
    // either way). This replaced the old rule, where an exact tie fell to
    // a studentId comparison — Bob's later-created (numerically larger)
    // ObjectId happened to lose that tie, so this exact scenario used to
    // assert zero discounts; that was an accident of tiebreak mechanics,
    // not an intentional guarantee, and the new rule is more correct for
    // exactly this case, not a regression.
    const aliceSub = subscriptions.find((sub) => String(sub.studentId) === String(students[0]._id));
    const bobSub = subscriptions.find((sub) => String(sub.studentId) === String(students[1]._id));
    expect(aliceSub.lastSiblingDiscountApplied).toBe(false);
    expect(bobSub.lastSiblingDiscountApplied).toBe(true);
    expect(bobSub.lastChargeAmount).toBe(90);
  });

  it('migrates a student with no Programs value with no enrollment at all', async () => {
    const csvText = [CSV_HEADER, csvRow({ pin: '3001', first: 'Nora', last: 'Noprogram' })].join('\n');

    const summary = await runLegacyImport({ csvText, config: TEST_CONFIG });

    expect(summary.studentsCreated).toBe(1);
    expect(summary.studentsEnrolledInLevel).toBe(0);
    expect(summary.studentsWithNoProgram).toBe(1);

    const student = await User.findOne({ firstName: 'Nora' });
    expect(student).not.toBeNull();

    const subscriptions = await Subscription.find({ studentId: student._id });
    expect(subscriptions).toHaveLength(0);
  });

  it('creates a CoachContract and a PrivateClassEnrollment for a combined private+group Programs value', async () => {
    const csvText = [
      CSV_HEADER,
      csvRow({ pin: '4001', first: 'Sana', last: 'Private', programs: 'Pricate Classes - Coach Chris, Advanced' }),
    ].join('\n');

    const summary = await runLegacyImport({ csvText, config: TEST_CONFIG });

    expect(summary.studentsEnrolledInLevel).toBe(1);
    expect(summary.privateClassEnrollmentsCreated).toBe(1);

    const student = await User.findOne({ firstName: 'Sana' });
    const contract = await CoachContract.findOne({});
    expect(contract.studentBillingRate).toBe(60);

    const enrollment = await PrivateClassEnrollment.findOne({ studentId: student._id });
    expect(enrollment.agreedHourlyRate).toBe(60);
    expect(enrollment.coachContractId.toString()).toBe(contract._id.toString());
  });

  it('excludes a Kicksite-junk row entirely — no user, no family created for it', async () => {
    const csvText = [
      CSV_HEADER,
      csvRow({ pin: '5001', first: 'Kicksite', last: 'Test', email: 'swanson@kicksite.net' }),
    ].join('\n');

    const summary = await runLegacyImport({ csvText, config: TEST_CONFIG });

    expect(summary.testRecordsFiltered).toBe(1);
    expect(summary.familiesProcessed).toBe(0);
    expect(await User.countDocuments({})).toBe(2); // just the 2 coaches
  });

  it('is idempotent: running twice with the same CSV creates no duplicates', async () => {
    const csvText = [csvRow({ pin: '6001', first: 'Once', last: 'Only', programs: 'Advanced' })];
    const fullCsv = [CSV_HEADER, ...csvText].join('\n');

    await runLegacyImport({ csvText: fullCsv, config: TEST_CONFIG });
    const secondRun = await runLegacyImport({ csvText: fullCsv, config: TEST_CONFIG });

    expect(secondRun.studentsCreated).toBe(0);
    expect(secondRun.studentsExisting).toBe(1);
    expect(await User.countDocuments({ role: 'student' })).toBe(1);
    expect(await Subscription.countDocuments({})).toBe(1);
    expect(await GroupClass.countDocuments({})).toBe(2); // Intermediate + Advanced, not duplicated
  });
});
