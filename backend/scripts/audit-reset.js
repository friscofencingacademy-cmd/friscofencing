// Resets everything the live-registration audit creates on a run (docs/plans/
// audit-system-plan.md, D5) — trial bookings and registrations for the fixed
// audit students seeded by audit-seed.js, and their roster entries. Targets
// ONLY those known audit student ids, never anything else on staging, so it
// can never touch real manual-QA data.
//
// Never auto-invoked by the audit script itself — owner-triggered, same
// separation CKQ's /sync-preprod keeps from its own live audits. Must run
// before every audit re-run: a stale TrialClass blocks S1 via its
// unique-per-student index.

require('dotenv/config');

const mongoose = require('mongoose');

const User = require('../src/models/user.model');
const TrialClass = require('../src/models/trialClass.model');
const Registration = require('../src/models/registration.model');
const Subscription = require('../src/models/subscription.model');
const GroupClassSchedule = require('../src/models/groupClassSchedule.model');
const GroupClassSession = require('../src/models/groupClassSession.model');

const AUDIT_STUDENT_LAST_NAMES = ['ChildOne', 'FirstSibling', 'SecondSibling', 'DeclineChild'];

function assertStagingUri(uri) {
  if (!uri || !uri.includes('friscofencing-staging')) {
    console.error(
      'AUDIT_MONGO_URI does not look like the staging cluster (must contain "friscofencing-staging"). Refusing to run.'
    );
    process.exit(1);
  }
}

async function main() {
  if (!process.env.AUDIT_MONGO_URI) {
    console.error('Missing AUDIT_MONGO_URI. Set it in audit/.env.');
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
    // Only ever the 4 fixed audit students by their known firstName/lastName
    // pair — never a broader query. If audit-seed.js hasn't run yet, this is
    // legitimately an empty list, not an error.
    const students = await User.find({
      role: 'student',
      firstName: 'Audit',
      lastName: { $in: AUDIT_STUDENT_LAST_NAMES },
    });
    const studentIds = students.map((s) => s._id);

    if (studentIds.length === 0) {
      console.log('No audit students found (audit-seed.js has not run yet, or nothing to reset). Nothing to do.');
      process.exitCode = 0;
      return;
    }

    const trialResult = await TrialClass.deleteMany({ studentId: { $in: studentIds } });
    const registrationResult = await Registration.deleteMany({ studentId: { $in: studentIds } });
    const subscriptionResult = await Subscription.deleteMany({ studentId: { $in: studentIds } });

    const scheduleResult = await GroupClassSchedule.updateMany(
      { students: { $in: studentIds } },
      { $pull: { students: { $in: studentIds } } }
    );
    const sessionResult = await GroupClassSession.updateMany(
      { 'students.studentId': { $in: studentIds } },
      { $pull: { students: { studentId: { $in: studentIds } } } }
    );

    console.log('Audit reset complete:');
    console.log(`  Students targeted: ${studentIds.length}`);
    console.log(`  TrialClass deleted: ${trialResult.deletedCount}`);
    console.log(`  Registration deleted: ${registrationResult.deletedCount}`);
    console.log(`  Subscription deleted: ${subscriptionResult.deletedCount}`);
    console.log(`  Schedules cleaned: ${scheduleResult.modifiedCount}`);
    console.log(`  Sessions cleaned: ${sessionResult.modifiedCount}`);
    process.exitCode = 0;
  } catch (error) {
    console.error('Audit reset failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
