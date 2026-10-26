// Resets everything the live-registration audit creates on a run (docs/plans/
// audit-system-plan.md, D5) — trial bookings, registrations, and roster
// entries for the fixed audit students seeded by audit-seed.js. Targets
// ONLY those known audit student ids, never anything else on staging, so it
// can never touch real manual-QA data.
//
// Never auto-invoked by the audit script itself — owner-triggered, same
// separation CKQ's /sync-preprod keeps from its own live audits. Must run
// before every audit re-run: a stale TrialClass blocks S1 via its
// unique-per-student index.
//
// Does NOT delete the student documents (it used to — see
// docs/plans/audit-skills-refresh-plan.md D1/F1 for why that changed). The
// old justification was that registration.service.js's Stripe idempotency
// key was `initial-registration-${studentId}-${scheduleId}`, so reusing the
// same studentId+scheduleId pair after a reset would collide with Stripe's
// 24h idempotency cache. That key format no longer exists: PR 2
// (docs/decisions/008-registration-create-pending-first.md) replaced it
// with `payment_${row._id}` (chargeFinalization.service.js), generated
// fresh from a brand-new SubscriptionCycleRegistration row created every
// time create() runs. Since this script already deletes the Registration/
// Subscription docs below, the next registration attempt creates a fresh
// ledger row with a fresh _id — there is no possible collision with an old
// Stripe key tied to a deleted row. Deleting-and-recreating the student was
// solving a problem that no longer exists, and cost the owner an
// `audit:seed` re-run after every reset. The student accounts now persist
// across resets; `audit:seed`'s findOrCreateUser check just confirms they
// still exist.

require('dotenv/config');

const mongoose = require('mongoose');

const User = require('../src/models/user.model');
const TrialClass = require('../src/models/trialClass.model');
const Registration = require('../src/models/registration.model');
const Subscription = require('../src/models/subscription.model');
const GroupClassSchedule = require('../src/models/groupClassSchedule.model');
const Visit = require('../src/models/visit.model');
const PaymentMethod = require('../src/models/paymentMethod.model');
const { getPaymentProvider } = require('../src/payments');

const { AUDIT_FAMILIES } = require('./lib/seedAuditFixtures');

// The fixed audit accounts come from the seed's own definition — one home, so
// the reset can never miss an account the seed creates (docs/plans/audit-and-
// health-refresh-plan.md PR 2). PaymentMethod is cleared for the PARENTS too:
// S4/S6 need a guaranteed-unsaved card every run, and S2/S3/S5 re-saving a
// fresh card each run is a cheap thing to re-exercise (found on the first
// real run).
const AUDIT_STUDENT_LAST_NAMES = AUDIT_FAMILIES.flatMap((family) => family.children);
const AUDIT_PARENT_EMAILS = AUDIT_FAMILIES.map((family) => family.email);

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
    // Only ever the fixed audit students by their known firstName/lastName
    // pair — never a broader query. If audit-seed.js hasn't run yet, this is
    // legitimately an empty list, not an error.
    // Scoped to the audit parents' own children, so a real student who
    // happens to share a name can never be reset.
    const parents = await User.find({ role: 'parent', email: { $in: AUDIT_PARENT_EMAILS } });
    const students = await User.find({
      role: 'student',
      parentId: { $in: parents.map((parent) => parent._id) },
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
    // GroupClassSession no longer carries a roster — attendance lives in
    // Visit (docs/plans/premium-registration-and-attendance-plan.md §1). The
    // students persist, but every Visit they have is an audit artifact, so
    // their Visit docs are deleted outright, not just cancelled.
    const visitResult = await Visit.deleteMany({ studentId: { $in: studentIds } });

    let paymentMethodsCleared = 0;
    for (const parent of parents) {
      // eslint-disable-next-line no-await-in-loop -- sequential by design,
      // a handful of fixed parents, no benefit to parallelizing.
      const paymentMethod = await PaymentMethod.findOne({ parentId: parent._id });
      if (!paymentMethod) continue;

      try {
        // Only the active provider can be told to detach; a card saved with
        // another provider is unusable here and just has its doc deleted.
        if (paymentMethod.provider === getPaymentProvider().name) {
          // eslint-disable-next-line no-await-in-loop
          await getPaymentProvider().detachPaymentMethod({ paymentMethodId: paymentMethod.providerPaymentMethodId });
        }
      } catch (error) {
        // Already detached / never attached — not fatal, the doc deletion
        // below is what actually matters for a clean re-run.
        console.warn(`  (Provider card detach for ${parent.email} skipped: ${error.message})`);
      }

      // eslint-disable-next-line no-await-in-loop
      await paymentMethod.deleteOne();
      paymentMethodsCleared += 1;
    }

    console.log('Audit reset complete:');
    console.log(`  Students targeted: ${studentIds.length}`);
    console.log(`  TrialClass deleted: ${trialResult.deletedCount}`);
    console.log(`  Registration deleted: ${registrationResult.deletedCount}`);
    console.log(`  Subscription deleted: ${subscriptionResult.deletedCount}`);
    console.log(`  Schedules cleaned: ${scheduleResult.modifiedCount}`);
    console.log(`  Visits deleted: ${visitResult.deletedCount}`);
    console.log(`  PaymentMethods cleared: ${paymentMethodsCleared}`);
    console.log('  Student accounts were NOT deleted — they persist across resets. No need to re-run `npm run audit:seed`.');
    process.exitCode = 0;
  } catch (error) {
    console.error('Audit reset failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
