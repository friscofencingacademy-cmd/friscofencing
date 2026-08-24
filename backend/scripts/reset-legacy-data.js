// Wipes what import-legacy-data.js created — the PEOPLE data only
// (students/parents + their Registration/Subscription/PrivateClassEnrollment
// and roster/session entries). Deliberately leaves the foundational config
// (Location, Levels, Prices, Coaches, GroupClasses, GroupClassSchedules,
// CoachContract) alone — that's the reusable structure, re-created by
// import-legacy-data.js on the next run, not something a data reset should
// touch.
//
// This is exactly the "play with test data, then reload the real data at
// go-live" reset the owner asked for (2026-08-24 planning conversation):
// run this, then re-run import-legacy-data.js against the corrected export.
//
// Usage:
//   node scripts/reset-legacy-data.js
//   node scripts/reset-legacy-data.js --allow-production   (go-live only)

require('dotenv/config');

const mongoose = require('mongoose');

const User = require('../src/models/user.model');
const Registration = require('../src/models/registration.model');
const Subscription = require('../src/models/subscription.model');
const PrivateClassEnrollment = require('../src/models/privateClassEnrollment.model');
const GroupClassSchedule = require('../src/models/groupClassSchedule.model');
const Visit = require('../src/models/visit.model');

function assertSafeTarget(uri, allowProduction) {
  const looksLocal = uri.includes('localhost') || uri.includes('127.0.0.1');
  const looksStaging = uri.includes('friscofencing-staging');

  if (looksLocal || looksStaging || allowProduction) {
    return;
  }

  console.error(
    'MONGO_URI does not look like localhost or the staging cluster ("friscofencing-staging").\n' +
      'Refusing to run against what looks like production. Pass --allow-production if this is intentional.'
  );
  process.exit(1);
}

async function main() {
  const allowProduction = process.argv.includes('--allow-production');

  if (!process.env.MONGO_URI) {
    console.error('Missing MONGO_URI. Set it in backend/.env, or export it for a one-off staging run.');
    process.exit(1);
  }

  assertSafeTarget(process.env.MONGO_URI, allowProduction);

  try {
    await mongoose.connect(process.env.MONGO_URI);
  } catch (error) {
    console.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  }

  try {
    const students = await User.find({ role: 'student', legacyPin: { $exists: true } });
    const studentIds = students.map((student) => student._id);

    if (studentIds.length === 0) {
      console.log('No legacy-imported students found. Nothing to reset.');
      process.exitCode = 0;
      return;
    }

    const registrationResult = await Registration.deleteMany({ studentId: { $in: studentIds } });
    const subscriptionResult = await Subscription.deleteMany({ studentId: { $in: studentIds } });
    const privateEnrollmentResult = await PrivateClassEnrollment.deleteMany({ studentId: { $in: studentIds } });

    const scheduleResult = await GroupClassSchedule.updateMany(
      { students: { $in: studentIds } },
      { $pull: { students: { $in: studentIds } } }
    );
    // GroupClassSession no longer carries a roster — attendance lives in
    // Visit (docs/plans/premium-registration-and-attendance-plan.md §1).
    const visitResult = await Visit.deleteMany({ studentId: { $in: studentIds } });

    // Every legacy-imported PARENT that has one, since import-legacy-data.js
    // sets it for a parent record that maps onto a real CSV row (an adult
    // self-registering, or the real adult found in a mixed adult+minor
    // family) — a synthesized all-minors parent never gets one (see
    // familyGrouping.js's groupIntoFamilies), so it's identified below by
    // its remaining-children check instead.
    const parentIdsFromStudents = [...new Set(students.map((student) => String(student.parentId)))];
    const pinnedParents = await User.find({ role: 'parent', legacyPin: { $exists: true } });
    const parentIds = [...new Set([...parentIdsFromStudents, ...pinnedParents.map((parent) => String(parent._id))])];

    const studentDeleteResult = await User.deleteMany({ _id: { $in: studentIds } });

    let parentsDeleted = 0;
    for (const parentId of parentIds) {
      // eslint-disable-next-line no-await-in-loop -- sequential, one query
      // per parent to check they're safe to delete; not worth parallelizing
      // a one-off reset script.
      const remainingChildren = await User.countDocuments({ role: 'student', parentId });
      // eslint-disable-next-line no-await-in-loop
      const parent = await User.findById(parentId);

      // Never delete a parent that has logged in and set a real password —
      // that's no longer "just imported data," regardless of legacyPin.
      if (!parent || remainingChildren > 0 || parent.passwordHash) continue;

      // eslint-disable-next-line no-await-in-loop
      await parent.deleteOne();
      parentsDeleted += 1;
    }

    console.log('Legacy data reset complete:');
    console.log(`  Students deleted:              ${studentDeleteResult.deletedCount}`);
    console.log(`  Parents deleted:                ${parentsDeleted}`);
    console.log(`  Registrations deleted:          ${registrationResult.deletedCount}`);
    console.log(`  Subscriptions deleted:          ${subscriptionResult.deletedCount}`);
    console.log(`  Private-class enrollments deleted: ${privateEnrollmentResult.deletedCount}`);
    console.log(`  Schedules cleaned:              ${scheduleResult.modifiedCount}`);
    console.log(`  Visits deleted:                 ${visitResult.deletedCount}`);
    console.log('  Foundational data (levels/prices/location/coaches/classes/schedules) left untouched.');
    console.log('  Run import-legacy-data.js again to reload (test or corrected real) people data.');
    process.exitCode = 0;
  } catch (error) {
    console.error('Legacy data reset failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
