require('dotenv/config');

const mongoose = require('mongoose');

const { runRenewals } = require('../src/services/renewal.service');

async function main() {
  // Same as seed-superadmin.js: this script must hard-fail (non-zero exit)
  // if it can't reach MongoDB — a renewal run that "succeeds" without a DB
  // connection is worse than useless.
  try {
    await mongoose.connect(process.env.MONGO_URI);
  } catch (error) {
    console.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  }

  try {
    const summary = await runRenewals();

    console.log(`Renewals processed: ${summary.total}`);
    console.log(JSON.stringify(summary.results, null, 2));

    process.exitCode = 0;
  } catch (error) {
    console.error('Renewal run failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
