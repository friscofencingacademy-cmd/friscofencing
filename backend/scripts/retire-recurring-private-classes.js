require('dotenv/config');

const mongoose = require('mongoose');

const { retireRecurringPrivateClasses } = require('./lib/retireRecurringPrivateClasses');

// One-time cutover from recurring private-class enrollments to per-session
// bookings (docs/plans/private-class-per-session-booking-plan.md §2.11).
// Run on staging, then production, BEFORE deploying the booking backend.
// Refuses to write anything if the old model ever moved money — see
// scripts/lib/retireRecurringPrivateClasses.js.
//
// Usage:
//   node scripts/retire-recurring-private-classes.js          (dry run — default, no writes)
//   node scripts/retire-recurring-private-classes.js --live   (applies the cutover)
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
    const report = await retireRecurringPrivateClasses({ apply: live });

    console.log(`Schedules with a student claim:        ${report.claimedSchedules}`);
    console.log(`Schedules without a date range:        ${report.rangelessScheduleIds.length}`);
    report.rangelessScheduleIds.forEach((id) => console.log(`  - ${id} (will get today + 89 days — adjust in the admin UI)`));
    console.log(`Recurring enrollments to delete:       ${report.oldEnrollments}`);
    console.log(`Generated sessions to delete:          ${report.oldSessions}`);
    console.log(`Failed old ledger rows to delete:      ${report.oldFailedLedgerRows}`);
    console.log(`Old ledger rows with money (the gate): ${report.oldMoneyLedgerRows}`);
    console.log(`Session index needs replacing:         ${report.indexNeedsReplacing ? 'yes' : 'no'}`);

    if (report.aborted) {
      console.error('\nABORT: the old model has pending/completed charges. NOTHING was written.');
      console.error('Decide with the academy what those charges bought before cutting over.');
      process.exitCode = 1;
      return;
    }

    console.log(live ? '\nApplied.' : '\nNo writes made — re-run with --live to apply.');
    process.exitCode = 0;
  } catch (error) {
    console.error('Cutover failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
