// Deletes EVERY document in every collection — no allowlist, nothing
// preserved, not even superadmin. Standalone tool for "start completely
// over"; scripts/refresh-staging-data.js is the usual entry point (wipe +
// re-import + re-seed superadmin in one command), this exists for wiping
// without immediately re-importing.
//
// Unlike import-legacy-data.js / reset-legacy-data.js, there is NO
// --allow-production escape hatch here, on purpose — a full wipe must never
// be runnable against production under any flag. The go-live re-import
// (bringing the real corrected data into production) uses
// import-legacy-data.js --allow-production directly, which only upserts —
// it never wipes anything.
//
// Usage: node scripts/wipe-staging-environment.js

require('dotenv/config');

const mongoose = require('mongoose');

const { wipeDatabase } = require('./lib/wipeDatabase');

function assertStagingOrLocal(uri) {
  const looksLocal = uri.includes('localhost') || uri.includes('127.0.0.1');
  const looksStaging = uri.includes('friscofencing-staging');

  if (looksLocal || looksStaging) {
    return;
  }

  console.error(
    'MONGO_URI does not look like localhost or the staging cluster ("friscofencing-staging").\n' +
      'A full wipe can NEVER run against anything else — there is no override flag for this script.'
  );
  process.exit(1);
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('Missing MONGO_URI. Set it in backend/.env, or export it for a one-off staging run.');
    process.exit(1);
  }

  assertStagingOrLocal(process.env.MONGO_URI);

  try {
    await mongoose.connect(process.env.MONGO_URI);
  } catch (error) {
    console.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  }

  try {
    const results = await wipeDatabase();

    console.log('Wipe complete:');
    Object.entries(results).forEach(([name, count]) => {
      if (count > 0) console.log(`  ${name}: ${count} deleted`);
    });
    console.log('  Database is now empty — including superadmin. Run seed:superadmin (or refresh:staging) next.');
    process.exitCode = 0;
  } catch (error) {
    console.error('Wipe failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
