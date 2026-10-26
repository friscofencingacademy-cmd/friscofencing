require('dotenv/config');

const mongoose = require('mongoose');

const { migrateProviderFields } = require('./lib/migrateProviderFields');

// One-time migration for docs/plans/payment-provider-port-plan.md PR 2 (D6):
// renames every Stripe-named persisted field to its provider-neutral name and
// records the provider. Run on staging, then production, as the PR's rollout
// step — see scripts/lib/migrateProviderFields.js for the full design and
// safety notes. Connects to MONGO_URI.
//
// Usage:
//   node scripts/migrate-provider-fields.js          (dry run — default, no writes)
//   node scripts/migrate-provider-fields.js --live   (renames, swaps the indexes, verifies)
async function main() {
  const live = process.argv.includes('--live');

  try {
    await mongoose.connect(process.env.MONGO_URI);
  } catch (error) {
    console.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  }

  console.log(`Connected to database: ${mongoose.connection.name}`);
  console.log(live ? 'Mode: LIVE (will write and swap indexes)' : 'Mode: DRY RUN (no writes)');
  console.log('');

  try {
    const report = await migrateProviderFields({ apply: live });

    report.steps.forEach((step) => {
      console.log(`  ${step.label}: ${step.matched} matched${live ? `, ${step.modified} modified` : ''}`);
    });
    console.log('');
    console.log(`Old indexes ${live ? 'dropped' : 'to drop'}: ${(live ? report.indexesDropped : report.indexesToDrop).join(', ') || 'none'}`);

    if (!live) {
      console.log('\nNo writes made — re-run with --live to apply.');
      process.exitCode = 0;
      return;
    }

    console.log('\nVerification:');
    report.verification.forEach((item) => console.log(`  ${item.label}: ${item.count}`));

    if (!report.verified) {
      console.error('\nVERIFICATION FAILED — documents above still carry an old field or lack a provider.');
      process.exitCode = 1;
      return;
    }

    console.log('\nverification: 0 documents still carry an old field name');
    process.exitCode = 0;
  } catch (error) {
    console.error('Migration run failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
