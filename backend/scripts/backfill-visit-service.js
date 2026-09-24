require('dotenv/config');

const mongoose = require('mongoose');

const { backfillVisitService } = require('./lib/backfillVisitService');

// One-time migration for docs/plans/private-class-per-session-booking-plan.md
// §1.3 — stamps Visit.serviceId ('group-classes') on every Visit that
// predates the field. Run on staging, then production, BEFORE deploying the
// universal-Visit change (serviceId is required). Requires the Service
// registry to be seeded (npm run seed:services). See
// scripts/lib/backfillVisitService.js.
//
// Usage:
//   node scripts/backfill-visit-service.js          (dry run — default, no writes)
//   node scripts/backfill-visit-service.js --live   (applies the backfill)
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
    const report = await backfillVisitService({ apply: live });

    console.log(`Scanned (missing serviceId): ${report.scannedCount} visit(s)`);

    if (report.aborted) {
      console.error(`ABORT: visit ${report.abortReason.docId} — ${report.abortReason.reason}`);
      console.error('NOTHING was written.');
      process.exitCode = 1;
      return;
    }

    console.log(live ? `Updated: ${report.updatedCount}\n\nApplied.` : '\nNo writes made — re-run with --live to apply.');
    process.exitCode = 0;
  } catch (error) {
    console.error('Backfill failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
