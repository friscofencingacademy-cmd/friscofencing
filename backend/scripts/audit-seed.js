// Idempotent seed for the live-registration audit (docs/plans/audit-system-plan.md,
// D4). Creates dedicated audit-only accounts and a dedicated audit-only
// class/schedule/price pair per level, so the audit never depends on real
// staging data drifting, selling out, or getting deleted. Safe to re-run —
// every write is check-then-create.
//
// Reuses the REAL Mongoose models and the REAL groupClassSchedule.service's
// create() (not a raw GroupClassSchedule.create()) so sessions are generated
// exactly the way production generates them — same reasoning
// registration.routes.test.js's own seedSchedule() helper documents for
// going through the real service/route instead of the bare model.

require('dotenv/config');

const mongoose = require('mongoose');

const User = require('../src/models/user.model');
const Level = require('../src/models/level.model');
const Location = require('../src/models/location.model');
const GroupClass = require('../src/models/groupClass.model');
const GroupClassSchedule = require('../src/models/groupClassSchedule.model');
const Price = require('../src/models/price.model');
const groupClassScheduleService = require('../src/services/groupClassSchedule.service');
const { hashPassword } = require('../src/utils/password');

const REQUIRED_ENV_VARS = ['AUDIT_MONGO_URI', 'AUDIT_TEST_PASSWORD'];

// Hard fail on anything but the known staging cluster — this script writes
// real documents and must never be pointed at production by a typo'd env var.
function assertStagingUri(uri) {
  if (!uri || !uri.includes('friscofencing-staging')) {
    console.error(
      'AUDIT_MONGO_URI does not look like the staging cluster (must contain "friscofencing-staging"). Refusing to run.'
    );
    process.exit(1);
  }
}

async function findOrCreateUser(fields, passwordHash) {
  const existing = await User.findOne({ email: fields.email });
  if (existing) return existing;
  return User.create({ ...fields, passwordHash });
}

async function findOrCreateLevel(name, order) {
  const existing = await Level.findOne({ name });
  if (existing) return existing;
  return Level.create({ name, order });
}

async function findOrCreateLocation(name, address) {
  const existing = await Location.findOne({ name });
  if (existing) return existing;
  return Location.create({ name, address });
}

async function findOrCreateGroupClass(name, levelId, locationId, capacity) {
  const existing = await GroupClass.findOne({ name });
  if (existing) return existing;
  return GroupClass.create({ name, levelId, locationId, capacity });
}

async function findOrCreatePrice(levelId, monthlyFee) {
  const existing = await Price.findOne({ levelId });
  if (existing) return existing;
  return Price.create({ levelId, monthlyFee });
}

async function findOrCreateSchedule(classId, coachId, dayOfWeek, startTime, endTime) {
  const existing = await GroupClassSchedule.findOne({ classId });
  if (existing) return existing;
  return groupClassScheduleService.create({ classId, coachId, dayOfWeek, startTime, endTime, students: [] });
}

async function main() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Missing required env vars: ${missing.join(', ')}. Set them in audit/.env.`);
    process.exit(1);
  }

  assertStagingUri(process.env.AUDIT_MONGO_URI);

  try {
    await mongoose.connect(process.env.AUDIT_MONGO_URI);
  } catch (error) {
    console.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  }

  try {
    const passwordHash = await hashPassword(process.env.AUDIT_TEST_PASSWORD);

    const coach = await findOrCreateUser(
      { role: 'coach', firstName: 'Audit', lastName: 'Coach', email: 'audit-coach@example.com' },
      passwordHash
    );

    const levelA = await findOrCreateLevel('Audit Level A', 900);
    const levelB = await findOrCreateLevel('Audit Level B', 901);
    const location = await findOrCreateLocation('Audit Test Location', '1 Audit Way');

    const classA = await findOrCreateGroupClass('Audit Class A', levelA._id, location._id, 20);
    const classB = await findOrCreateGroupClass('Audit Class B', levelB._id, location._id, 20);

    await findOrCreatePrice(levelA._id, 100); // pricier — used by S2/S3's first-registered sibling
    await findOrCreatePrice(levelB._id, 50); // cheaper — S3's discount-winning sibling

    const scheduleA = await findOrCreateSchedule(classA._id, coach._id, 2, '16:00', '17:00');
    const scheduleB = await findOrCreateSchedule(classB._id, coach._id, 4, '17:00', '18:00');

    const parent1 = await findOrCreateUser(
      { role: 'parent', firstName: 'Audit', lastName: 'ParentOne', email: 'audit-parent-1@example.com' },
      passwordHash
    );
    await findOrCreateUser(
      { role: 'student', firstName: 'Audit', lastName: 'ChildOne', parentId: parent1._id },
      passwordHash
    );

    const siblingParent = await findOrCreateUser(
      { role: 'parent', firstName: 'Audit', lastName: 'SiblingParent', email: 'audit-sibling-parent@example.com' },
      passwordHash
    );
    await findOrCreateUser(
      { role: 'student', firstName: 'Audit', lastName: 'FirstSibling', parentId: siblingParent._id },
      passwordHash
    );
    await findOrCreateUser(
      { role: 'student', firstName: 'Audit', lastName: 'SecondSibling', parentId: siblingParent._id },
      passwordHash
    );

    const declineParent = await findOrCreateUser(
      { role: 'parent', firstName: 'Audit', lastName: 'DeclineParent', email: 'audit-decline-parent@example.com' },
      passwordHash
    );
    await findOrCreateUser(
      { role: 'student', firstName: 'Audit', lastName: 'DeclineChild', parentId: declineParent._id },
      passwordHash
    );

    console.log('Audit seed complete:');
    console.log(`  Audit Class A ($100/mo): ${classA._id}, schedule ${scheduleA._id}`);
    console.log(`  Audit Class B ($50/mo):  ${classB._id}, schedule ${scheduleB._id}`);
    console.log('  Accounts: audit-parent-1@example.com, audit-sibling-parent@example.com, audit-decline-parent@example.com');
    console.log('  (all idempotent — re-running this script is safe)');
    process.exitCode = 0;
  } catch (error) {
    console.error('Audit seed failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
