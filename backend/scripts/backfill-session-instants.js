require('dotenv/config');

const mongoose = require('mongoose');

const { backfillSessionInstants } = require('./lib/backfillSessionInstants');

// One-time migration for docs/plans/session-start-time-cutoff-plan.md §2.9 —
// fills GroupClassSession.startsAt/endsAt from each session's date + its
// schedule's start/end time. See scripts/lib/backfillSessionInstants.js.
//
// Usage:
//   node scripts/backfill-session-instants.js          (dry run — default, no writes)
//   node scripts/backfill-session-instants.js --live   (applies the backfill)
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
    const report = await backfillSessionInstants({ apply: live });

    console.log(`Scanned (missing startsAt/endsAt): ${report.scannedCount} session(s)`);

    if (report.aborted) {
      console.error(`ABORT: session ${report.abortReason.docId} — ${report.abortReason.reason}`);
      console.error('NOTHING was written.');
      process.exitCode = 1;
      return;
    }

    console.log(`Total changes: ${report.changes.length}`);
    report.changes.forEach((change) => {
      console.log(
        `  - ${change.docId} (${change.date.toISOString().slice(0, 10)}): ${change.startsAt.toISOString()} -> ${change.endsAt.toISOString()}`
      );
    });

    console.log(live ? '\nApplied.' : '\nNo writes made — re-run with --live to apply.');
    process.exitCode = 0;
  } catch (error) {
    console.error('Backfill failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
