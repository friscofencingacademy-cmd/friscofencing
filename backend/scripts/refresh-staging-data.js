// The full "bring new data in cleanly" sequence (owner request, 2026-08-24,
// grown 2026-08-31 with the index migration + Stripe scrub + test-password
// steps):
// 1. Wipe every collection (no exceptions — see wipe-staging-environment.js)
// 2. periodMonth/Guard B index migration (docs/plans/payment-airtight-plan
//    .md D7) — always a no-op on the DATA side right after a wipe, but
//    still ensures the current index exists and the stale one is dropped
// 3. Seed the Service registry
// 4. Run the legacy import (scripts/import-legacy-data.js's same logic)
// 5. Re-seed superadmin
// 6. Scrub any Stripe fields (defense-in-depth — see scrubStripeFields.js)
// 7. Set one known password (Test@123) on every login-capable user, for
//    staging testing convenience — see setStagingTestPasswords.js
//
// This is the ONE command to re-run every time you want to reset staging
// back to "just the real legacy data, nothing else" — including after
// playing with test data, per the owner's stated workflow. Requires
// MONGO_URI plus the same SUPERADMIN_* env vars seed-superadmin.js needs.
//
// No --allow-production flag exists here, ever — see
// wipe-staging-environment.js's comment for why. The go-live re-import
// (bringing the real corrected export into production) uses
// import-legacy-data.js --allow-production directly instead, which only
// upserts and never wipes.
//
// Usage:
//   node scripts/refresh-staging-data.js --people=../Aug_23_2026_people.csv

require('dotenv/config');

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const config = require('./legacy-import.config');
const { refreshStagingData } = require('./lib/refreshStagingData');

const REQUIRED_SUPERADMIN_ENV_VARS = [
  'SUPERADMIN_EMAIL',
  'SUPERADMIN_PASSWORD',
  'SUPERADMIN_FIRST_NAME',
  'SUPERADMIN_LAST_NAME',
];

function parseArgs(argv) {
  const args = { peoplePath: null };

  argv.forEach((arg) => {
    if (arg.startsWith('--people=')) {
      args.peoplePath = arg.slice('--people='.length);
    }
  });

  return args;
}

function assertStagingOrLocal(uri) {
  const looksLocal = uri.includes('localhost') || uri.includes('127.0.0.1');
  const looksStaging = uri.includes('friscofencing-staging');

  if (looksLocal || looksStaging) {
    return;
  }

  console.error(
    'MONGO_URI does not look like localhost or the staging cluster ("friscofencing-staging").\n' +
      'This script wipes the entire database first — there is no override flag. Use import-legacy-data.js --allow-production for the real go-live import instead.'
  );
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.peoplePath) {
    console.error('Missing required --people=<path to legacy people CSV>.');
    process.exit(1);
  }

  const missingEnvVars = REQUIRED_SUPERADMIN_ENV_VARS.filter((key) => !process.env[key]);
  if (missingEnvVars.length > 0) {
    console.error(`Missing required env vars: ${missingEnvVars.join(', ')}. Set them in backend/.env.`);
    process.exit(1);
  }

  if (!process.env.MONGO_URI) {
    console.error('Missing MONGO_URI. Set it in backend/.env, or export it for a one-off staging run.');
    process.exit(1);
  }

  assertStagingOrLocal(process.env.MONGO_URI);

  const csvPath = path.resolve(process.cwd(), args.peoplePath);
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV file not found: ${csvPath}`);
    process.exit(1);
  }
  const csvText = fs.readFileSync(csvPath, 'utf8');

  try {
    await mongoose.connect(process.env.MONGO_URI);
  } catch (error) {
    console.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  }

  try {
    const result = await refreshStagingData({
      csvText,
      config,
      superadmin: {
        email: process.env.SUPERADMIN_EMAIL,
        password: process.env.SUPERADMIN_PASSWORD,
        firstName: process.env.SUPERADMIN_FIRST_NAME,
        lastName: process.env.SUPERADMIN_LAST_NAME,
      },
    });

    console.log('Step 1/7 — Wipe:');
    Object.entries(result.wipeResult).forEach(([name, count]) => {
      if (count > 0) console.log(`  ${name}: ${count} deleted`);
    });

    console.log('Step 2/7 — periodMonth/Guard B index migration:');
    if (result.periodMonthMigration.aborted) {
      console.log(
        `  ABORTED — ${result.periodMonthMigration.collisions.length} collision(s) found. This should never happen ` +
          'right after a wipe; investigate before re-running.'
      );
    } else {
      console.log(`  Rows backfilled: ${result.periodMonthMigration.changeCount} (expected 0 on a fresh wipe)`);
      console.log(`  Index swapped: ${result.periodMonthMigration.indexSwapped}`);
    }

    console.log('Step 3/7 — Service registry:');
    result.serviceSeedResults.results.forEach((service) => {
      console.log(`  ${service.code}: ${service.action}`);
    });

    const { importSummary } = result;
    console.log('Step 4/7 — Legacy import:');
    console.log(`  CSV rows read:                ${importSummary.totalRows}`);
    console.log(`  Test/junk records filtered:   ${importSummary.testRecordsFiltered}`);
    console.log(`  Families processed:           ${importSummary.familiesProcessed}`);
    console.log(`  Parents created / existing:   ${importSummary.parentsCreated} / ${importSummary.parentsExisting}`);
    console.log(`  Students created / existing:  ${importSummary.studentsCreated} / ${importSummary.studentsExisting}`);
    console.log(`  Students enrolled in a level: ${importSummary.studentsEnrolledInLevel}`);
    console.log(`  Students with no program:     ${importSummary.studentsWithNoProgram}`);
    console.log(`  Private-class enrollments:    ${importSummary.privateClassEnrollmentsCreated}`);
    if (importSummary.warnings.length > 0) {
      console.log(`  Warnings (${importSummary.warnings.length}):`);
      importSummary.warnings.forEach((warning) => console.log(`    - ${warning}`));
    }

    console.log('Step 5/7 — Superadmin:');
    console.log(`  ${result.superadminEmail} — ${result.superadminCreated ? 'created' : 'already existed'}`);

    console.log('Step 6/7 — Stripe scrub:');
    console.log(`  stripeCustomerId cleared:      ${result.stripeScrubResult.stripeCustomerIdsCleared}`);
    console.log(`  PaymentMethod docs deleted:    ${result.stripeScrubResult.paymentMethodsDeleted}`);
    console.log(`  stripePaymentIntentId cleared: ${result.stripeScrubResult.stripePaymentIntentIdsCleared}`);

    console.log('Step 7/7 — Staging test passwords:');
    console.log(
      `  ${result.testPasswordResult.usersUpdated} login-capable user(s) set to "${result.testPasswordResult.password}"`
    );

    console.log('Refresh complete.');
    process.exitCode = 0;
  } catch (error) {
    console.error('Refresh failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
