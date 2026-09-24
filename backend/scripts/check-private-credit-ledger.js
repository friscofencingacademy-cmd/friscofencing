require('dotenv/config');

const mongoose = require('mongoose');

const { checkPrivateCreditLedger } = require('./lib/checkPrivateCreditLedger');

// Read-only: reconciles private-lesson purchases (PrivateClassEnrollment)
// against the Registration ledger and reports stranded in-flight bookings.
// Never writes. See scripts/lib/checkPrivateCreditLedger.js for each finding.
//
// Usage:
//   node scripts/check-private-credit-ledger.js
async function main() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
  } catch (error) {
    console.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  }

  console.log(`Connected to database: ${mongoose.connection.name}`);

  try {
    const { findings, scannedActiveEnrollments } = await checkPrivateCreditLedger();

    console.log(`Active purchases scanned: ${scannedActiveEnrollments}`);

    if (findings.length === 0) {
      console.log('Clean — every purchase matches the ledger.');
    } else {
      console.log(`Findings (${findings.length}):`);
      findings.forEach((finding) => console.log(`  - ${JSON.stringify(finding)}`));
    }

    process.exitCode = findings.length === 0 ? 0 : 1;
  } catch (error) {
    console.error('Check failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
