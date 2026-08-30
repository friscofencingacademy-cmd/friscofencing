require('dotenv/config');

const mongoose = require('mongoose');

const { normalizeDateSentinels } = require('./lib/normalizeDateSentinels');

// One-time migration for docs/plans/utc-date-standard-plan.md §4.4 —
// normalizes every calendar-day sentinel field (GroupClassSession.date,
// Subscription's period fields, SubscriptionCycleRegistration's period
// fields) to true UTC midnight of its own UTC calendar day. See
// scripts/lib/normalizeDateSentinels.js for the full design/safety notes.
//
// Usage:
//   node scripts/normalize-date-sentinels.js          (dry run — default, no writes)
//   node scripts/normalize-date-sentinels.js --live   (applies the normalization)
async function main() {
  const live = process.argv.includes('--live');

  try {
    await mongoose.connect(process.env.MONGO_URI);
  } catch (error) {
    console.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  }

  console.log(`Connected to database: ${mongoose.connection.name}`);
  console.log(live ? 'Mode: LIVE (will write)' : 'Mode: DRY RUN (no writes)');
  console.log('');

  try {
    const report = await normalizeDateSentinels({ apply: live });

    report.targets.forEach((target) => {
      console.log(`${target.label}:`);
      console.log(`  Scanned: ${target.scannedCount} doc(s)`);

      const hours = Object.keys(target.distribution).sort((a, b) => Number(a) - Number(b));
      console.log(
        `  UTC-hour distribution: ${
          hours.length === 0 ? '(none)' : hours.map((h) => `${h}:00=${target.distribution[h]}`).join(', ')
        }`
      );

      if (target.abortReason) {
        console.log(`  ABORT: doc ${target.abortReason.docId}, field "${target.abortReason.field}" — ${target.abortReason.reason}`);
      } else {
        console.log(`  Would change: ${target.changeCount}`);
      }

      console.log('');
    });

    if (report.aborted) {
      console.error('Aborted — a value failed the safety check above. NOTHING was written, for any target.');
      process.exitCode = 1;
      return;
    }

    if (report.skippedCollisions.length > 0) {
      console.log(`Skipped (would collide with another row after truncation): ${report.skippedCollisions.length}`);
      report.skippedCollisions.forEach((change) => {
        console.log(`  - ${change.collection} ${change.docId}.${change.field}: ${change.oldValue.toISOString()} -> ${change.newValue.toISOString()} (SKIPPED)`);
      });
      console.log('');
    }

    console.log(`Total changes: ${report.changes.length}`);
    report.changes.forEach((change) => {
      console.log(`  - ${change.collection} ${change.docId}.${change.field}: ${change.oldValue.toISOString()} -> ${change.newValue.toISOString()}`);
    });

    if (!live) {
      console.log('\nNo writes made — re-run with --live to apply.');
    } else {
      console.log('\nApplied.');
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
