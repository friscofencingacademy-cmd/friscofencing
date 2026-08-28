// DB orchestration for the legacy-data migration. Pure family/program
// resolution lives in familyGrouping.js (no DB); this file is what actually
// finds-or-creates documents, using the REAL services where one exists
// (groupClassSchedule.service's create(), roster.service's
// addStudentToRoster, calculateChargeAmount) rather than raw model writes —
// same reasoning backend/scripts/audit-seed.js documents for its own
// findOrCreateSchedule: sessions get generated exactly the way production
// generates them.
//
// Registration/Subscription are created directly against Mongo, NOT via
// registration.service.js's create() — that function charges a real Stripe
// PaymentIntent, which is correct for a live parent registering today and
// wrong for backfilling students who were already enrolled before this
// system existed. No Stripe call happens anywhere in this file.

const User = require('../../src/models/user.model');
const Level = require('../../src/models/level.model');
const Location = require('../../src/models/location.model');
const GroupClass = require('../../src/models/groupClass.model');
const Price = require('../../src/models/price.model');
const GroupClassSchedule = require('../../src/models/groupClassSchedule.model');
const CoachContract = require('../../src/models/coachContract.model');
const PrivateClassEnrollment = require('../../src/models/privateClassEnrollment.model');
const { SubscriptionCycleRegistration } = require('../../src/models/registration.model');
const Subscription = require('../../src/models/subscription.model');

const groupClassScheduleService = require('../../src/services/groupClassSchedule.service');
const { addStudentToRoster } = require('../../src/services/roster.service');
const { calculateChargeAmount } = require('../../src/services/billing/calculateChargeAmount.service');
const { getServiceByCode } = require('../../src/services/serviceCatalog.service');
const { addOneMonth, todayAtMidnight } = require('../../src/utils/billingDates');
const { hashPassword } = require('../../src/utils/password');

const { parseCsv } = require('./csv');
const { groupIntoFamilies, isTestRecord } = require('./familyGrouping');

async function findOrCreateLocation(location) {
  const existing = await Location.findOne({ name: location.name });
  if (existing) return existing;
  return Location.create({ name: location.name, address: location.address });
}

async function findOrCreateLevel(name, order) {
  const existing = await Level.findOne({ name });
  if (existing) return existing;
  return Level.create({ name, order });
}

async function findOrCreatePrice(levelId, monthlyFee) {
  const existing = await Price.findOne({ levelId });
  if (existing) return existing;
  return Price.create({ levelId, monthlyFee });
}

async function findOrCreateCoach(coach) {
  const email = coach.email.toLowerCase();
  const existing = await User.findOne({ email });
  if (existing) return existing;

  const passwordHash = await hashPassword(coach.password);
  return User.create({
    role: 'coach',
    firstName: coach.firstName,
    lastName: coach.lastName,
    email,
    passwordHash,
  });
}

async function findOrCreateGroupClass(name, levelId, locationId, capacity) {
  const existing = await GroupClass.findOne({ name });
  if (existing) return existing;
  return GroupClass.create({ name, levelId, locationId, capacity });
}

async function findOrCreateSchedule(classId, coachId, dayOfWeek, startTime, endTime) {
  const existing = await GroupClassSchedule.findOne({ classId, coachId, dayOfWeek, startTime });
  if (existing) return existing;
  return groupClassScheduleService.create({ classId, coachId, dayOfWeek, startTime, endTime, students: [] });
}

async function findOrCreateCoachContract(coachId, terms) {
  const existing = await CoachContract.findOne({ coachId, isActive: true });
  if (existing) return existing;

  const privateLessonsService = await getServiceByCode('private-lessons');

  return CoachContract.create({
    serviceId: privateLessonsService._id,
    coachId,
    studentBillingRate: terms.studentBillingRate,
    coachCompensationRate: terms.coachCompensationRate,
    sessionDurationMinutes: terms.sessionDurationMinutes,
    notes: terms.notes,
  });
}

// Sets up everything the CSV import needs to point at: location, levels +
// prices, coaches, classes + schedules, and Coach Chris's private-lesson
// contract. Entirely config-driven (legacy-import.config.js) — no CSV data
// involved yet. Idempotent: safe to call on every run.
async function setupFoundationalData(config) {
  const location = await findOrCreateLocation(config.LOCATION);

  const levelDocs = {};
  const priceDocs = {};
  const levelEntries = Object.entries(config.LEVELS);

  for (const [key, level] of levelEntries) {
    // eslint-disable-next-line no-await-in-loop -- sequential setup, small
    // fixed list (6 levels), no benefit to parallelizing.
    levelDocs[key] = await findOrCreateLevel(level.name, level.order);
    // eslint-disable-next-line no-await-in-loop
    priceDocs[key] = await findOrCreatePrice(levelDocs[key]._id, level.monthlyFee);
  }

  const coachDocs = {};
  for (const [key, coach] of Object.entries(config.COACHES)) {
    // eslint-disable-next-line no-await-in-loop
    coachDocs[key] = await findOrCreateCoach(coach);
  }

  const classResources = {};
  for (const [levelKey, scheduleList] of Object.entries(config.CLASS_SCHEDULES)) {
    const level = config.LEVELS[levelKey];
    // eslint-disable-next-line no-await-in-loop
    const groupClass = await findOrCreateGroupClass(level.name, levelDocs[levelKey]._id, location._id, level.capacity);

    const schedules = [];
    for (const slot of scheduleList) {
      // eslint-disable-next-line no-await-in-loop
      const doc = await findOrCreateSchedule(groupClass._id, coachDocs[slot.coach]._id, slot.day, slot.start, slot.end);
      schedules.push({ doc, primary: Boolean(slot.primary) });
    }

    classResources[levelKey] = { groupClass, schedules, price: priceDocs[levelKey] };
  }

  const privateCoachKey = config.PRIVATE_CLASS_CONTRACT.coach;
  const privateContract = await findOrCreateCoachContract(coachDocs[privateCoachKey]._id, config.PRIVATE_CLASS_CONTRACT);

  return { location, levelDocs, priceDocs, coachDocs, classResources, privateContract };
}

async function findOrCreateParentUser(parentPlan) {
  const lookups = [];
  if (parentPlan.legacyPin) lookups.push({ legacyPin: parentPlan.legacyPin });
  if (parentPlan.email) lookups.push({ email: parentPlan.email.toLowerCase() });
  if (!parentPlan.email) {
    lookups.push({
      role: 'parent',
      firstName: parentPlan.firstName,
      lastName: parentPlan.lastName,
      email: { $exists: false },
    });
  }

  for (const query of lookups) {
    // eslint-disable-next-line no-await-in-loop -- 1-3 fixed lookups per
    // family, sequential by design (first match wins).
    const found = await User.findOne(query);
    if (found) return { parent: found, created: false };
  }

  const payload = { role: 'parent', firstName: parentPlan.firstName, lastName: parentPlan.lastName };
  if (parentPlan.email) payload.email = parentPlan.email.toLowerCase();
  if (parentPlan.legacyPin) payload.legacyPin = parentPlan.legacyPin;
  // No passwordHash: a migrated parent can't log in until they set a
  // password via the real signup/reset flow — deliberate, not a gap this
  // script is meant to close (there is no source-of-truth password to
  // migrate from Kicksite).

  const parent = await User.create(payload);
  return { parent, created: true };
}

async function findOrCreateStudentUser(studentPlan, parentId) {
  const existing = await User.findOne({ legacyPin: studentPlan.legacyPin });
  if (existing) return { student: existing, created: false };

  const student = await User.create({
    role: 'student',
    firstName: studentPlan.firstName,
    lastName: studentPlan.lastName,
    parentId,
    legacyPin: studentPlan.legacyPin,
  });

  return { student, created: true };
}

// Enrolls a student in every schedule under a level: a real Registration +
// Subscription against the level's `primary` schedule (what actually bills
// and renews), and a roster-only add on every other schedule under that
// level — the "one flat monthly fee, attend any scheduled session" model
// (owner clarification, 2026-08-24) expressed within the CURRENT schema's
// per-schedule Subscription shape. See legacy-import.config.js's
// CLASS_SCHEDULES comment for the full reasoning and Track 2 pointer.
//
// No Stripe call, no capacity/availability check: this is a historical
// backfill of students already enrolled before this system existed, not a
// new self-service registration — those checks exist to protect a live
// parent-facing flow, not a one-time migration of already-real enrollments.
async function enrollStudentInLevel({ studentId, parentId, levelKey, classResources }) {
  const resources = classResources[levelKey];

  if (!resources) {
    return { enrolled: false, reason: `No schedules configured for level "${levelKey}"` };
  }

  const primaryEntry = resources.schedules.find((entry) => entry.primary);
  const student = await User.findById(studentId);

  let subscription = await Subscription.findOne({
    studentId,
    scheduleId: primaryEntry.doc._id,
    status: 'active',
  });
  const alreadySubscribed = Boolean(subscription);

  if (!subscription) {
    const { amount, siblingDiscountApplied } = await calculateChargeAmount(student, resources.price.monthlyFee);
    const now = new Date();
    const currentPeriodEnd = addOneMonth(now);

    // Subscription created BEFORE the Registration ledger row — a ledger row
    // requires a real subscriptionId (docs/plans/registration-ledger-plan.md
    // D1), so this is the same ordering registration.service.js's create()
    // uses for a live registration, just without a Stripe charge (see this
    // function's own module comment for why: historical backfill, not a new
    // self-service registration).
    subscription = await Subscription.create({
      studentId,
      scheduleId: primaryEntry.doc._id,
      parentId,
      status: 'active',
      cancelAtPeriodEnd: false,
      currentPeriodStart: now,
      currentPeriodEnd,
      nextBillingDate: currentPeriodEnd,
      lastChargeAmount: amount,
      lastSiblingDiscountApplied: siblingDiscountApplied,
    });

    // Idempotency check kept from before the ledger rework — guards a re-run
    // after a process crash landed the Subscription create above but never
    // reached this write (subscriptionId-scoped, not the pre-ledger
    // studentId+scheduleId scoping, since a schedule can now have more than
    // one historical subscriptionId over time).
    const existingRegistration = await SubscriptionCycleRegistration.findOne({ subscriptionId: subscription._id });
    if (!existingRegistration) {
      // status: 'completed' — this represents a REAL historical charge that
      // already happened in the legacy system being imported, not a fresh
      // Stripe PaymentIntent (there is none; see this function's own module
      // comment). paidAt is deliberately left null: unlike a live charge,
      // the true historical charge date isn't known here, only that it
      // happened before this import ran.
      const groupClassesService = await getServiceByCode('group-classes');

      await SubscriptionCycleRegistration.create({
        serviceId: groupClassesService._id,
        subscriptionId: subscription._id,
        studentId,
        scheduleId: primaryEntry.doc._id,
        parentId,
        eventType: 'initial',
        status: 'completed',
        amount,
        breakdown: {
          monthlyFee: resources.price.monthlyFee,
          siblingDiscountApplied,
          siblingDiscountAmount: siblingDiscountApplied ? resources.price.monthlyFee - amount : 0,
        },
        periodStart: now,
        periodEnd: currentPeriodEnd,
      });
    }
  }

  const today = todayAtMidnight();
  for (const entry of resources.schedules) {
    // eslint-disable-next-line no-await-in-loop -- sequential by design, a
    // handful of schedules per level, each roster add already awaits its
    // own DB round trips internally.
    await addStudentToRoster(entry.doc, studentId, today);
  }

  return { enrolled: true, alreadySubscribed, subscriptionId: subscription._id };
}

async function enrollStudentInPrivateClass({ studentId, parentId, coachId, coachContract }) {
  const existing = await PrivateClassEnrollment.findOne({ studentId, coachId, status: 'active' });
  if (existing) return { created: false, enrollmentId: existing._id };

  const enrollment = await PrivateClassEnrollment.create({
    studentId,
    parentId,
    coachId,
    coachContractId: coachContract._id,
    agreedHourlyRate: coachContract.studentBillingRate,
    status: 'active',
  });

  return { created: true, enrollmentId: enrollment._id };
}

// The whole pipeline, in one call: reads the CSV text (already loaded by
// the caller — kept out of this function so tests can pass a fixture string
// directly instead of touching the filesystem), builds the import plan, and
// writes every document. Assumes mongoose is already connected (same
// contract every other script in this repo follows — see
// scripts/import-legacy-data.js).
async function runLegacyImport({ csvText, config }) {
  const rows = parseCsv(csvText);
  const setup = await setupFoundationalData(config);
  const families = groupIntoFamilies(rows, config);

  const summary = {
    totalRows: rows.length,
    testRecordsFiltered: rows.filter((row) => isTestRecord(row, config)).length,
    familiesProcessed: families.length,
    parentsCreated: 0,
    parentsExisting: 0,
    studentsCreated: 0,
    studentsExisting: 0,
    studentsEnrolledInLevel: 0,
    studentsWithNoProgram: 0,
    studentsWithUnmappedProgram: 0,
    privateClassEnrollmentsCreated: 0,
    warnings: [],
  };

  for (const family of families) {
    // eslint-disable-next-line no-await-in-loop -- families/students must
    // be processed sequentially: the sibling-discount calculation
    // (calculateChargeAmount) reads the PREVIOUSLY-created sibling's real
    // Subscription document, so a later sibling in the same family
    // correctly sees an earlier one's subscription already exist.
    const { parent: parentUser, created: parentCreated } = await findOrCreateParentUser(family.parent);
    summary[parentCreated ? 'parentsCreated' : 'parentsExisting'] += 1;

    for (const studentPlan of family.students) {
      // eslint-disable-next-line no-await-in-loop
      const { student, created: studentCreated } = await findOrCreateStudentUser(studentPlan, parentUser._id);
      summary[studentCreated ? 'studentsCreated' : 'studentsExisting'] += 1;

      if (studentPlan.levelKey) {
        // eslint-disable-next-line no-await-in-loop
        await enrollStudentInLevel({
          studentId: student._id,
          parentId: parentUser._id,
          levelKey: studentPlan.levelKey,
          classResources: setup.classResources,
        });
        summary.studentsEnrolledInLevel += 1;
      } else if (studentPlan.programsRaw) {
        summary.studentsWithUnmappedProgram += 1;
        summary.warnings.push(
          `Unmapped Programs value "${studentPlan.programsRaw}" for legacyPin ${studentPlan.legacyPin} — migrated with no class assigned.`
        );
      } else {
        summary.studentsWithNoProgram += 1;
      }

      if (studentPlan.hasPrivateClass) {
        if (studentPlan.privateCoachKey) {
          // eslint-disable-next-line no-await-in-loop
          const result = await enrollStudentInPrivateClass({
            studentId: student._id,
            parentId: parentUser._id,
            coachId: setup.coachDocs[studentPlan.privateCoachKey]._id,
            coachContract: setup.privateContract,
          });
          if (result.created) summary.privateClassEnrollmentsCreated += 1;
        } else {
          summary.warnings.push(
            `Private class flagged for legacyPin ${studentPlan.legacyPin} but the coach name could not be resolved — no PrivateClassEnrollment created.`
          );
        }
      }
    }
  }

  return summary;
}

module.exports = {
  setupFoundationalData,
  findOrCreateParentUser,
  findOrCreateStudentUser,
  enrollStudentInLevel,
  enrollStudentInPrivateClass,
  runLegacyImport,
};
