require('dotenv/config');

const mongoose = require('mongoose');

const { realignBillingAnchors } = require('./lib/realignBillingAnchors');

// One-time migration for docs/decisions/007-calendar-month-billing.md —
// realigns every ACTIVE subscription's currentPeriodEnd/nextBillingDate
// from a rolling anniversary date onto the calendar-month boundary (the
// 1st). Extends periods forward only, never shortens (ADR 007 sign-off
// item 2) — no family ever loses paid-for access. Never touches cancelled
// subscriptions.
//
// Usage:
//   node scripts/realign-billing-anchors.js          (dry run — default, no writes)
//   node scripts/realign-billing-anchors.js --live   (applies the realignment)
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
    const report = await realignBillingAnchors({ apply: live });

    console.log(`Active subscriptions scanned: ${report.scannedCount}`);
    console.log(`Already on a month boundary:  ${report.scannedCount - report.changes.length}`);
    console.log(`Realigned:                    ${report.changes.length}`);

    report.changes.forEach((change) => {
      console.log(
        `  - ${change.subscriptionId}: ${change.oldPeriodEnd.toISOString()} -> ${change.newPeriodEnd.toISOString()}`
      );
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
