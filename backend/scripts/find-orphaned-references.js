require('dotenv/config');

const mongoose = require('mongoose');

const { findOrphanedReferences } = require('./lib/findOrphanedReferences');

// Read-only diagnostic for docs/plans/orphaned-coach-reference-fix-plan.md
// §8d — scans PrivateClassSchedule/CoachContract/PrivateClassEnrollment/
// PrivateClassSession for a coachId/studentId/parentId that no longer
// resolves to a User. Never writes anything; report only.
//
// Usage:
//   node scripts/find-orphaned-references.js <MONGO_URI>
async function main() {
  const uri = process.argv[2] || process.env.MONGO_URI;

  if (!uri) {
    console.error('Usage: node scripts/find-orphaned-references.js <MONGO_URI>');
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
    const { orphans, scannedCounts } = await findOrphanedReferences();

    console.log('Scanned:');
    Object.entries(scannedCounts).forEach(([collection, count]) =>
      console.log(`  ${collection}: ${count} doc(s)`)
    );
    console.log('');

    if (orphans.length === 0) {
      console.log('No orphaned references found.');
    } else {
      console.log(`Orphaned references found: ${orphans.length}`);
      orphans.forEach((orphan) =>
        console.log(
          `  - ${orphan.collection} ${orphan.documentId}: ${orphan.field} -> missing user ${orphan.missingUserId}`
        )
      );
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
