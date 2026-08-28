require('dotenv/config');

const mongoose = require('mongoose');

const { findDuplicateActiveSubscriptions } = require('./lib/findDuplicateActiveSubscriptions');

// Read-only pre-flight for docs/decisions/005-one-active-subscription-per-
// student.md — run this against staging/prod BEFORE the Guard A index swap
// ships. Never writes anything.
//
// Usage:
//   node scripts/find-duplicate-active-subscriptions.js <MONGO_URI>
async function main() {
  const uri = process.argv[2] || process.env.MONGO_URI;

  if (!uri) {
    console.error('Usage: node scripts/find-duplicate-active-subscriptions.js <MONGO_URI>');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
  } catch (error) {
    console.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  }

  console.log(`Connected to database: ${mongoose.connection.name}`);
  console.log('');

  try {
    const { scannedCount, duplicates } = await findDuplicateActiveSubscriptions();

    console.log(`Active subscriptions scanned: ${scannedCount}`);

    if (duplicates.length === 0) {
      console.log('No students with more than one active subscription — safe to ship the Guard A index swap.');
    } else {
      console.log(
        `${duplicates.length} student(s) with 2+ active subscriptions — the Guard A index swap will FAIL until these are resolved:`
      );
      duplicates.forEach((entry) => {
        console.log(
          `  - student ${entry.studentId}: ${entry.count} active subscriptions (${entry.subscriptionIds.join(', ')}) across schedules (${entry.scheduleIds.join(', ')})`
        );
      });
    }

    process.exitCode = 0;
  } catch (error) {
    console.error('Diagnostic run failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
