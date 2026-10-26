// Seeds the live registration audit's fixtures on STAGING
// (docs/plans/audit-system-plan.md D4; docs/plans/audit-and-health-refresh-
// plan.md D7). Convergent and idempotent — safe to re-run any time; every run
// leaves the audit runnable (accounts, phone/date-of-birth, prices, both
// schedules stocked with 8 upcoming sessions). All logic lives in
// scripts/lib/seedAuditFixtures.js; this file only checks env and guards.
//
// Usage (from backend/):  npm run audit:seed
// Requires AUDIT_MONGO_URI (the staging cluster) and AUDIT_TEST_PASSWORD in
// backend/.env.

require('dotenv/config');

const mongoose = require('mongoose');

const { seedAuditFixtures } = require('./lib/seedAuditFixtures');

const REQUIRED_ENV_VARS = ['AUDIT_MONGO_URI', 'AUDIT_TEST_PASSWORD'];

// Hard fail on anything but the known staging cluster — this script writes
// real documents and must never be pointed at production by a typo'd env var.
function assertStagingUri(uri) {
  if (!uri || !uri.includes('friscofencing-staging')) {
    console.error(
      'AUDIT_MONGO_URI does not look like the staging cluster (must contain "friscofencing-staging"). Refusing to run.'
    );
    process.exit(1);
  }
}

function describeCounts(counts) {
  return `${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged`;
}

async function main() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Missing required env vars: ${missing.join(', ')}. Set them in backend/.env.`);
    process.exit(1);
  }

  assertStagingUri(process.env.AUDIT_MONGO_URI);

  try {
    await mongoose.connect(process.env.AUDIT_MONGO_URI);
  } catch (error) {
    console.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  }

  try {
    const result = await seedAuditFixtures({ testPassword: process.env.AUDIT_TEST_PASSWORD });

    console.log('Audit seed complete:');
    console.log(`  Accounts:  ${describeCounts(result.counts.users)}`);
    console.log(`  Catalog:   ${describeCounts(result.counts.catalog)}`);
    console.log(`  Schedules: ${result.counts.schedules.created} created, ${result.counts.schedules.unchanged} already present`);
    result.levels.forEach(({ groupClass, schedule }) => {
      console.log(`  ${groupClass.name}: class ${groupClass._id}, schedule ${schedule._id}`);
    });
    console.log(`  Sessions created by the extension: ${result.sessionExtension.totals.created}`);
    console.log(`  Parents: ${result.families.map(({ parent }) => parent.email).join(', ')}`);
    process.exitCode = 0;
  } catch (error) {
    console.error('Audit seed failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
