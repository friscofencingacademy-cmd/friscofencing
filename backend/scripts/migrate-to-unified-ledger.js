require('dotenv/config');

const mongoose = require('mongoose');

const { migrateToUnifiedLedger } = require('./lib/migrateToUnifiedLedger');

// One-time migration for docs/plans/service-registry-unified-ledger-plan.md
// D6 — absorbs PrivateClassCharge into the unified Registration ledger and
// stamps pre-existing group rows with the fields the restructured schema
// now requires. Safe to re-run: idempotent (see the lib module's own
// header comment).
//
// Usage:
//   node scripts/migrate-to-unified-ledger.js          (dry run — default, no writes)
//   node scripts/migrate-to-unified-ledger.js --live   (applies the migration)
async function main() {
  const live = process.argv.includes('--live');

  try {
    await mongoose.connect(process.env.MONGO_URI);
  } catch (error) {
    console.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  }

  console.log(`Connected to database: ${mongoose.connection.name}`);
  console.log(live ? 'Mode: LIVE (will write + may drop privateclasscharges)' : 'Mode: DRY RUN (no writes)');
  console.log('');

  try {
    const report = await migrateToUnifiedLedger({ dryRun: !live });

    console.log(`Group Registration rows to stamp:     ${report.groupRowsToStamp}`);
    if (report.groupRowsNotYetLedgerShaped.length > 0) {
      console.log(
        `  - ${report.groupRowsNotYetLedgerShaped.length} SKIPPED (not yet ledger-shaped — run ` +
          `'node scripts/migrate-registrations-to-ledger.js --live' FIRST): ` +
          `${report.groupRowsNotYetLedgerShaped.join(', ')}`
      );
    }
    console.log(`Private charges found:                 ${report.privateChargesFound}`);
    console.log(`  - already present in Registration:   ${report.privateChargesAlreadyPresent}`);
    console.log(`  - copied:                             ${report.privateChargesCopied}`);
    console.log(`CoachContract docs to backfill:         ${report.coachContractsToBackfill}`);

    if (report.dryRun) {
      console.log('\nNo writes made — re-run with --live to apply.');
    } else if (report.aborted) {
      console.log(`\nABORTED — verification failed, nothing dropped.\n${report.abortReason}`);
      process.exitCode = 1;
    } else {
      console.log('\nVerified clean. privateclasscharges dropped (if it existed).');
    }

    if (!report.aborted) {
      process.exitCode = 0;
    }
  } catch (error) {
    console.error('Migration run failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
