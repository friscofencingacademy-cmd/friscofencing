const User = require('../../src/models/user.model');
const Level = require('../../src/models/level.model');
const Location = require('../../src/models/location.model');
const GroupClass = require('../../src/models/groupClass.model');
const GroupClassSchedule = require('../../src/models/groupClassSchedule.model');
const Price = require('../../src/models/price.model');
const groupClassScheduleService = require('../../src/services/groupClassSchedule.service');
const { getServiceByCode } = require('../../src/services/serviceCatalog.service');
const { hashPassword, comparePassword } = require('../../src/utils/password');
const { extendGroupSessions } = require('./extendGroupSessions');

// The live registration audit's own fixtures (docs/plans/audit-system-plan.md
// D4; docs/plans/audit-and-health-refresh-plan.md D7): dedicated audit-only
// accounts and an audit-only level/class/schedule/price pair, so the audit
// never depends on real staging data drifting, selling out or being deleted.
//
// CONVERGENT, not just create-if-missing: every audit-owned record is brought
// to its declared state on every run — an account's password, a parent's
// phone, a child's date of birth, a price's fees — and both audit schedules
// are stocked with their next 8 sessions through the same extension the
// weekly cron runs. So a seed always leaves the audit runnable, whatever a
// staging refresh, a manual edit or the calendar did in between. Nothing
// outside the audit-owned records is ever touched: every lookup is keyed on
// an `audit-*@example.com` email, an `Audit …` name, or an audit parent's id.
//
// STAGING/LOCAL ONLY. Like wipeDatabase(), this function has no opinion on
// the environment itself — the callers (scripts/audit-seed.js,
// scripts/refresh-staging-data.js) guard it.
//
// Students have no email, so they are identified by role + name + parentId —
// never `findOne({ email: undefined })`, which Mongoose turns into an
// unfiltered query that matched the first user in the collection on the
// audit's first live run (2026-08-23).

// Trial booking requires a family phone and the child's date of birth
// (trialClass.service.js — docs/plans/trial-registration-required-fields-
// plan.md). A fixed, obviously fake number and a fixed birthday keep S1
// deterministic.
const AUDIT_PARENT_PHONE = '(555) 010-0000';
const AUDIT_STUDENT_DATE_OF_BIRTH = new Date('2015-06-15T00:00:00.000Z');

const AUDIT_COACH = { role: 'coach', firstName: 'Audit', lastName: 'Coach', email: 'audit-coach@example.com' };

// Each parent and its children, in the order the scenarios use them.
const AUDIT_FAMILIES = [
  { email: 'audit-parent-1@example.com', lastName: 'ParentOne', children: ['ChildOne'] }, // S1, S2
  { email: 'audit-sibling-parent@example.com', lastName: 'SiblingParent', children: ['FirstSibling', 'SecondSibling'] }, // S3
  { email: 'audit-decline-parent@example.com', lastName: 'DeclineParent', children: ['DeclineChild'] }, // S4
  { email: 'audit-bridge-parent@example.com', lastName: 'BridgeParent', children: ['BridgeFirst', 'BridgeSecond'] }, // S5
  { email: 'audit-retry-parent@example.com', lastName: 'RetryParent', children: ['RetryChild'] }, // S6
  // The trial-cancel-reschedule live gate's own family: no weekly scenario
  // uses it, so its child is never enrolled and the gate can always book,
  // move and cancel a trial (docs/live-gates/trial-cancel-reschedule.md).
  { email: 'audit-trial-parent@example.com', lastName: 'TrialParent', children: ['TrialChild'] }, // gate trial-cancel-reschedule
];

// Level A is the pricier plan, Level B the cheaper one (S3/S5 depend on the
// order). registrationFee is an explicit 0 — a level's own fee wins over the
// academy-wide Setting (per-level-registration-fee-plan), so the audit's
// charges never depend on whatever the academy fee is set to.
const AUDIT_LEVELS = [
  {
    level: { name: 'Audit Level A', order: 900 },
    groupClass: 'Audit Class A',
    price: { monthlyFee: 100, registrationFee: 0 },
    schedule: { dayOfWeek: 2, startTime: '16:00', endTime: '17:00' },
  },
  {
    level: { name: 'Audit Level B', order: 901 },
    groupClass: 'Audit Class B',
    price: { monthlyFee: 50, registrationFee: 0 },
    schedule: { dayOfWeek: 4, startTime: '17:00', endTime: '18:00' },
  },
];

const AUDIT_LOCATION = { name: 'Audit Test Location', address: '1 Audit Way' };
const AUDIT_CLASS_CAPACITY = 20;

function emptyCounts() {
  return { created: 0, updated: 0, unchanged: 0 };
}

// Creates the document, or $sets the declared fields on the existing one.
// Returns the up-to-date document and records what happened in `counts`.
async function converge(Model, lookup, declared, counts) {
  const existing = await Model.findOne(lookup);

  if (!existing) {
    counts.created += 1;
    return Model.create({ ...lookup, ...declared });
  }

  existing.set(declared);

  if (existing.isModified()) {
    counts.updated += 1;
    await existing.save();
  } else {
    counts.unchanged += 1;
  }

  return existing;
}

async function seedAuditFixtures({ testPassword } = {}) {
  if (typeof testPassword !== 'string' || testPassword.length === 0) {
    throw new Error('seedAuditFixtures: testPassword (AUDIT_TEST_PASSWORD) is required');
  }

  // The audit registers students into group classes, which writes ledger
  // rows; a registry with no group-classes Service would fail every scenario
  // at its first charge. Fail here, with the fix, instead.
  await getServiceByCode('group-classes', { requireActive: true });

  const passwordHash = await hashPassword(testPassword);
  const counts = { users: emptyCounts(), catalog: emptyCounts(), schedules: emptyCounts() };

  // A password is converged only when it no longer matches, so a re-run with
  // the same AUDIT_TEST_PASSWORD reports "unchanged" rather than rehashing.
  async function convergeLoginUser({ email, ...fields }) {
    const user = await converge(User, { email }, fields, counts.users);
    if (!user.passwordHash || !(await comparePassword(testPassword, user.passwordHash))) {
      user.passwordHash = passwordHash;
      await user.save();
    }

    return user;
  }

  const coach = await convergeLoginUser(AUDIT_COACH);
  const location = await converge(Location, { name: AUDIT_LOCATION.name }, { address: AUDIT_LOCATION.address }, counts.catalog);

  const levels = [];

  for (const definition of AUDIT_LEVELS) {
    // eslint-disable-next-line no-await-in-loop -- two levels, sequential.
    const level = await converge(Level, { name: definition.level.name }, { order: definition.level.order }, counts.catalog);
    // eslint-disable-next-line no-await-in-loop
    const groupClass = await converge(
      GroupClass,
      { name: definition.groupClass },
      { levelId: level._id, locationId: location._id, capacity: AUDIT_CLASS_CAPACITY },
      counts.catalog
    );
    // eslint-disable-next-line no-await-in-loop
    await converge(Price, { levelId: level._id }, definition.price, counts.catalog);

    // A schedule goes through the real service so its sessions are generated
    // exactly as production generates them. An existing one keeps its
    // identity (rosters and ledger rows point at it); its declared times are
    // not rewritten here — a dayOfWeek change is rejected by design
    // (groupClassSchedule.service.js update), so the audit's schedules are
    // fixed at creation.
    // eslint-disable-next-line no-await-in-loop
    let schedule = await GroupClassSchedule.findOne({ classId: groupClass._id });

    if (schedule) {
      counts.schedules.unchanged += 1;
    } else {
      // eslint-disable-next-line no-await-in-loop
      schedule = await groupClassScheduleService.create({
        classId: groupClass._id,
        coachId: coach._id,
        ...definition.schedule,
        students: [],
      });
      counts.schedules.created += 1;
    }

    levels.push({ level, groupClass, schedule });
  }

  const families = [];

  for (const family of AUDIT_FAMILIES) {
    // eslint-disable-next-line no-await-in-loop
    const parent = await convergeLoginUser({
      role: 'parent',
      firstName: 'Audit',
      lastName: family.lastName,
      email: family.email,
      phone: AUDIT_PARENT_PHONE,
    });

    const children = [];

    for (const lastName of family.children) {
      // eslint-disable-next-line no-await-in-loop
      const child = await converge(
        User,
        { role: 'student', firstName: 'Audit', lastName, parentId: parent._id },
        { dateOfBirth: AUDIT_STUDENT_DATE_OF_BIRTH },
        counts.users
      );
      children.push(child);
    }

    families.push({ parent, children });
  }

  // Stock both audit schedules with their next 8 sessions (plan D7) — the
  // same extension the weekly cron runs, so S1/S2 always have dates.
  const sessionExtension = await extendGroupSessions({
    apply: true,
    scheduleIds: levels.map(({ schedule }) => schedule._id),
  });

  return { counts, coach, location, levels, families, sessionExtension };
}

module.exports = {
  seedAuditFixtures,
  AUDIT_FAMILIES,
  AUDIT_LEVELS,
  AUDIT_PARENT_PHONE,
  AUDIT_STUDENT_DATE_OF_BIRTH,
};
