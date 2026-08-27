require('dotenv/config');

const mongoose = require('mongoose');

const { migrateRegistrationsToLedger } = require('./lib/migrateRegistrationsToLedger');

// One-time migration for docs/plans/registration-ledger-plan.md D8 —
// rewrites this repo's original 3-field Registration docs into the new
// payment-ledger shape. Safe to run more than once: a doc this script has
// already rewritten carries `eventType`, so it is never selected as a
// "legacy doc" again.
//
// Usage:
//   node scripts/migrate-registrations-to-ledger.js          (dry run — default, no writes)
//   node scripts/migrate-registrations-to-ledger.js --live   (applies the rewrite)
async function main() {
  const live = process.argv.includes('--live');

  try {
    await mongoose.connect(process.env.MONGO_URI);
  } catch (error) {
    console.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  }

  console.log(`Connected to database: ${mongoose.connection.name}`);
  console.log(live ? 'Mode: LIVE (will rewrite matching Registration docs)' : 'Mode: DRY RUN (no writes)');
  console.log('');

  try {
    const report = await migrateRegistrationsToLedger({ dryRun: !live });

    console.log(`Legacy Registration docs found: ${report.totalLegacyDocs}`);
    console.log(`Migrated: ${report.migrated.length}`);
    report.migrated.forEach((entry) =>
      console.log(`  - ${entry.registrationId} -> subscription ${entry.subscriptionId}, amount $${entry.amount}`)
    );
    console.log(`Orphaned (left untouched, needs manual review): ${report.orphaned.length}`);
    report.orphaned.forEach((entry) =>
      console.log(
        `  - ${entry.registrationId} (student ${entry.studentId}, schedule ${entry.scheduleId}): ${entry.reason}`
      )
    );

    if (report.dryRun) {
      console.log('\nNo writes made — re-run with --live to apply.');
    }

    process.exitCode = 0;
  } catch (error) {
    console.error('Migration run failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
