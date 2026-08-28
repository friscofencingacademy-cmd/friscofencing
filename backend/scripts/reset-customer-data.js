require('dotenv/config');

const mongoose = require('mongoose');

const User = require('../src/models/user.model');
const Registration = require('../src/models/registration.model');
const Subscription = require('../src/models/subscription.model');
const TrialClass = require('../src/models/trialClass.model');
const PaymentMethod = require('../src/models/paymentMethod.model');
const GroupClassSchedule = require('../src/models/groupClassSchedule.model');
const Visit = require('../src/models/visit.model');
const PrivateClassEnrollment = require('../src/models/privateClassEnrollment.model');
const PrivateClassSession = require('../src/models/privateClassSession.model');
const PrivateClassSchedule = require('../src/models/privateClassSchedule.model');
const CoachContract = require('../src/models/coachContract.model');
const Evaluation = require('../src/models/evaluation.model');

// Reusable cleanup tool: deletes every User NOT in --keep-roles (default
// superadmin,coach) plus their dependent Registration/Subscription/
// TrialClass/PaymentMethod records, pulls the deleted ids out of
// GroupClassSchedule rosters, and deletes their Visit records (attendance
// ledger — docs/plans/premium-registration-and-attendance-plan.md §1;
// GroupClassSession itself no longer carries a roster to prune). Structural
// data (GroupClass, GroupClassSchedule, GroupClassSession docs themselves,
// Level, Location, Price) is never deleted, only GroupClassSchedule's
// roster is pruned.
//
// orphaned-coach-reference-fix-plan §8c: private-class data referencing a
// deleted student/parent/coach is cleaned up too, so this script can never
// itself become the source of a future orphaned-reference outage.
// PrivateClassEnrollment/PrivateClassSession/Evaluation (student-, parent-,
// or coach-authored facts) are deleted outright wherever any of their
// refs match a deleted user. PrivateClassSchedule is coach-owned structural
// data: a schedule whose coach is being deleted is deleted outright (same
// treatment as the coach's own GroupClassSchedule rows would get if this
// script ever deleted coaches by default); a schedule whose occupant
// student is being deleted, but whose coach is NOT, is freed instead
// (studentId/enrollmentId cleared) so the slot stays bookable. CoachContract
// is deleted outright with its coach.
//
// Usage:
//   node scripts/reset-customer-data.js <MONGO_URI> [--keep-roles=superadmin,coach] [--execute]
//
// Defaults to a dry run (prints what would be deleted, writes nothing).
// Pass --execute to actually delete.

function parseArgs(argv) {
  const uri = argv[2];
  let keepRoles = ['superadmin', 'coach'];
  let execute = false;

  for (const arg of argv.slice(3)) {
    if (arg === '--execute') {
      execute = true;
    } else if (arg.startsWith('--keep-roles=')) {
      keepRoles = arg
        .slice('--keep-roles='.length)
        .split(',')
        .map((role) => role.trim())
        .filter(Boolean);
    }
  }

  return { uri, keepRoles, execute };
}

async function main() {
  const { uri, keepRoles, execute } = parseArgs(process.argv);

  if (!uri) {
    console.error(
      'Usage: node scripts/reset-customer-data.js <MONGO_URI> [--keep-roles=superadmin,coach] [--execute]'
    );
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
  } catch (error) {
    console.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  }

  console.log(`Connected to database: ${mongoose.connection.name}`);
  console.log(`Keeping roles: ${keepRoles.join(', ')}`);
  console.log(execute ? 'Mode: EXECUTE (will delete)' : 'Mode: DRY RUN (no writes)');
  console.log('');

  const usersToDelete = await User.find(
    { role: { $nin: keepRoles } },
    '_id role email firstName lastName'
  );
  const deleteIds = usersToDelete.map((user) => user._id);

  console.log(`Users to delete: ${usersToDelete.length}`);
  usersToDelete.forEach((user) => {
    console.log(`  - [${user.role}] ${user.firstName} ${user.lastName} <${user.email || 'no email'}>`);
  });

  const [
    registrationCount,
    subscriptionCount,
    trialCount,
    paymentMethodCount,
    scheduleRosterCount,
    visitCount,
    privateEnrollmentCount,
    privateSessionCount,
    privateScheduleDeleteCount,
    privateScheduleFreeCount,
    coachContractCount,
    evaluationCount,
  ] = await Promise.all([
    Registration.countDocuments({ studentId: { $in: deleteIds } }),
    Subscription.countDocuments({
      $or: [{ studentId: { $in: deleteIds } }, { parentId: { $in: deleteIds } }],
    }),
    TrialClass.countDocuments({ studentId: { $in: deleteIds } }),
    PaymentMethod.countDocuments({ parentId: { $in: deleteIds } }),
    GroupClassSchedule.countDocuments({ students: { $in: deleteIds } }),
    Visit.countDocuments({ studentId: { $in: deleteIds } }),
    PrivateClassEnrollment.countDocuments({
      $or: [
        { studentId: { $in: deleteIds } },
        { parentId: { $in: deleteIds } },
        { coachId: { $in: deleteIds } },
      ],
    }),
    PrivateClassSession.countDocuments({
      $or: [
        { studentId: { $in: deleteIds } },
        { parentId: { $in: deleteIds } },
        { coachId: { $in: deleteIds } },
      ],
    }),
    PrivateClassSchedule.countDocuments({ coachId: { $in: deleteIds } }),
    PrivateClassSchedule.countDocuments({
      studentId: { $in: deleteIds },
      coachId: { $nin: deleteIds },
    }),
    CoachContract.countDocuments({ coachId: { $in: deleteIds } }),
    Evaluation.countDocuments({
      $or: [{ studentId: { $in: deleteIds } }, { coachId: { $in: deleteIds } }],
    }),
  ]);

  console.log('');
  console.log('Dependent records affected:');
  console.log(`  Registration:                    ${registrationCount}`);
  console.log(`  Subscription:                    ${subscriptionCount}`);
  console.log(`  TrialClass:                      ${trialCount}`);
  console.log(`  PaymentMethod:                   ${paymentMethodCount}`);
  console.log(`  GroupClassSchedule rosters:      ${scheduleRosterCount} schedule(s) to prune`);
  console.log(`  Visit records:                   ${visitCount}`);
  console.log(`  PrivateClassEnrollment:          ${privateEnrollmentCount}`);
  console.log(`  PrivateClassSession:             ${privateSessionCount}`);
  console.log(`  PrivateClassSchedule (deleted):  ${privateScheduleDeleteCount} (coach deleted)`);
  console.log(`  PrivateClassSchedule (freed):    ${privateScheduleFreeCount} (occupant student deleted)`);
  console.log(`  CoachContract:                   ${coachContractCount}`);
  console.log(`  Evaluation:                      ${evaluationCount}`);

  if (!execute) {
    console.log('');
    console.log('Dry run only — no changes made. Re-run with --execute to apply.');
    await mongoose.disconnect();
    return;
  }

  await Registration.deleteMany({ studentId: { $in: deleteIds } });
  await Subscription.deleteMany({
    $or: [{ studentId: { $in: deleteIds } }, { parentId: { $in: deleteIds } }],
  });
  await TrialClass.deleteMany({ studentId: { $in: deleteIds } });
  await PaymentMethod.deleteMany({ parentId: { $in: deleteIds } });
  await GroupClassSchedule.updateMany({}, { $pull: { students: { $in: deleteIds } } });
  await Visit.deleteMany({ studentId: { $in: deleteIds } });
  await PrivateClassEnrollment.deleteMany({
    $or: [
      { studentId: { $in: deleteIds } },
      { parentId: { $in: deleteIds } },
      { coachId: { $in: deleteIds } },
    ],
  });
  await PrivateClassSession.deleteMany({
    $or: [
      { studentId: { $in: deleteIds } },
      { parentId: { $in: deleteIds } },
      { coachId: { $in: deleteIds } },
    ],
  });
  // Coach-owned schedules go with their coach; a freed slot never needs
  // this branch's freeing update run against it, so order (delete first)
  // doesn't matter here — the two queries are disjoint by construction.
  await PrivateClassSchedule.deleteMany({ coachId: { $in: deleteIds } });
  await PrivateClassSchedule.updateMany(
    { studentId: { $in: deleteIds } },
    { $set: { studentId: null, enrollmentId: null } }
  );
  await CoachContract.deleteMany({ coachId: { $in: deleteIds } });
  await Evaluation.deleteMany({
    $or: [{ studentId: { $in: deleteIds } }, { coachId: { $in: deleteIds } }],
  });
  await User.deleteMany({ role: { $nin: keepRoles } });

  console.log('');
  console.log('Done — deleted users and dependent records.');

  await mongoose.disconnect();
}

main();
