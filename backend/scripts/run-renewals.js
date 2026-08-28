require('dotenv/config');

const mongoose = require('mongoose');

const { runRenewals, runRetries } = require('../src/services/renewal.service');

// Two-phase daily job (docs/plans/registration-ledger-plan.md D6): phase 1
// renews everything due that isn't currently in dunning (retryCount: 0),
// phase 2 retries everything that is. Both phases run and print their own
// summary even if one of them encountered per-subscription failures —
// runRenewals()/runRetries() themselves never throw for an individual
// subscription's outcome, only for a genuine unexpected error, which this
// still lets propagate and fail the whole script (same "hard-fail on a
// real problem" posture as the Mongo-connect step below).
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
    const renewalSummary = await runRenewals();

    console.log(`Renewals processed: ${renewalSummary.total}`);
    console.log(JSON.stringify(renewalSummary.results, null, 2));

    const retrySummary = await runRetries();

    console.log(`Retries processed: ${retrySummary.total}`);
    console.log(JSON.stringify(retrySummary.results, null, 2));

    process.exitCode = 0;
  } catch (error) {
    console.error('Renewal run failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
