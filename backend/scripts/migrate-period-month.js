require('dotenv/config');

const mongoose = require('mongoose');

const { migratePeriodMonth } = require('./lib/migratePeriodMonth');

// One-time migration for docs/plans/payment-airtight-plan.md D7 — backfills
// SubscriptionCycleRegistration.periodMonth on every existing row, then
// swaps Guard B's unique index from (subscriptionId, periodStart) to
// (subscriptionId, periodMonth). Run on staging first, then production, per
// the plan. See scripts/lib/migratePeriodMonth.js for the full design/
// safety notes.
//
// Usage:
//   node scripts/migrate-period-month.js          (dry run — default, no writes)
//   node scripts/migrate-period-month.js --live   (backfills + swaps the index)
async function main() {
  const live = process.argv.includes('--live');

  try {
    await mongoose.connect(process.env.MONGO_URI);
  } catch (error) {
    console.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  }

  console.log(`Connected to database: ${mongoose.connection.name}`);
  console.log(live ? 'Mode: LIVE (will write and swap the index)' : 'Mode: DRY RUN (no writes)');
  console.log('');

  try {
    const report = await migratePeriodMonth({ apply: live });

    console.log(`Scanned: ${report.scannedCount} row(s)`);
    console.log(`Would change / changed: ${report.changeCount}`);
    console.log('');

    if (report.aborted) {
      console.error(`ABORTED — ${report.collisions.length} periodMonth collision(s) found. NOTHING was written, index untouched.`);
      report.collisions.forEach((collision) => {
        console.error(`  - subscription ${collision.subscriptionId}, month ${collision.periodMonth}: rows ${collision.rowIds.join(', ')}`);
      });
      process.exitCode = 1;
      return;
    }

    report.changes.forEach((change) => {
      console.log(`  - row ${change._id}: periodMonth ${change.oldPeriodMonth ?? '(none)'} -> ${change.newPeriodMonth}`);
    });

    if (!live) {
      console.log('\nNo writes made — re-run with --live to apply.');
    } else {
      console.log(`\nApplied. Index swapped: ${report.indexSwapped}.`);
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
