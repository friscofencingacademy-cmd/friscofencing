require('dotenv/config');

const mongoose = require('mongoose');

const { dropOldSubscriptionIndex, OLD_INDEX_NAME } = require('./lib/dropOldSubscriptionIndex');

// One-time cleanup for docs/decisions/005-one-active-subscription-per-
// student.md — drops the old {studentId, scheduleId} unique index once the
// new {studentId} index (Mongoose autoIndex) has already been created on
// deploy. Purely a cleanup: the old index is redundant, not harmful, if
// left in place, so this is not urgent, but it's a real write, so dry-run
// by default.
//
// Usage:
//   node scripts/drop-old-subscription-index.js          (dry run — default, no writes)
//   node scripts/drop-old-subscription-index.js --live   (drops the old index)
async function main() {
  const live = process.argv.includes('--live');

  try {
    await mongoose.connect(process.env.MONGO_URI);
  } catch (error) {
    console.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  }

  console.log(`Connected to database: ${mongoose.connection.name}`);
  console.log(live ? 'Mode: LIVE (will drop the index if present)' : 'Mode: DRY RUN (no writes)');
  console.log('');

  try {
    const { existed, dropped } = await dropOldSubscriptionIndex({ apply: live });

    if (!existed) {
      console.log(`Old index "${OLD_INDEX_NAME}" not present — nothing to do.`);
    } else if (dropped) {
      console.log(`Dropped old index "${OLD_INDEX_NAME}".`);
    } else {
      console.log(`Old index "${OLD_INDEX_NAME}" is present. Re-run with --live to drop it.`);
    }

    process.exitCode = 0;
  } catch (error) {
    console.error('Index cleanup run failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
