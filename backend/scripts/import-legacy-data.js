// CLI entry point for the legacy-data migration (docs: see the "Class
// schedule / student migration" planning conversation, 2026-08-24). All the
// real logic lives in scripts/lib/ — this file only handles argv, the DB
// connection guard, and printing the summary. Re-runnable: every write
// scripts/lib/runLegacyImport.js makes is a find-or-create, keyed by the
// CSV's own PIN (via User.legacyPin) for people and by name/email for
// coaches/levels/location — so running this again with a corrected export
// (the real data at go-live) upserts instead of duplicating.
//
// Usage:
//   node scripts/import-legacy-data.js --people=../Aug_23_2026_people.csv
//   node scripts/import-legacy-data.js --people=<path> --dry-run
//   node scripts/import-legacy-data.js --people=<path> --allow-production
//
// Requires MONGO_URI (backend/.env, or exported in the shell for a one-off
// run against staging — see docs/plans/deployment-launch-plan.md's env
// table for where the real friscofencing-staging URI lives).

require('dotenv/config');

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const config = require('./legacy-import.config');
const { runLegacyImport } = require('./lib/runLegacyImport');
const { parseCsv } = require('./lib/csv');
const { groupIntoFamilies } = require('./lib/familyGrouping');

function parseArgs(argv) {
  const args = { dryRun: false, allowProduction: false, peoplePath: null };

  argv.forEach((arg) => {
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--allow-production') {
      args.allowProduction = true;
    } else if (arg.startsWith('--people=')) {
      args.peoplePath = arg.slice('--people='.length);
    }
  });

  return args;
}

// Same spirit as audit-reset.js's assertStagingUri, generalized: this
// script is safe to run against local dev (no real people affected) or a
// URI that names the staging database, but writing ~160 real people's data
// into production by a typo'd/forgotten env var must never happen silently
// — --allow-production is the explicit, named escape hatch for the actual
// go-live run.
function assertSafeTarget(uri, allowProduction) {
  const looksLocal = uri.includes('localhost') || uri.includes('127.0.0.1');
  const looksStaging = uri.includes('friscofencing-staging');

  if (looksLocal || looksStaging || allowProduction) {
    return;
  }

  console.error(
    'MONGO_URI does not look like localhost or the staging cluster ("friscofencing-staging").\n' +
      'Refusing to run against what looks like production. Pass --allow-production if this is the intentional go-live run.'
  );
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.peoplePath) {
    console.error('Missing required --people=<path to legacy people CSV>.');
    process.exit(1);
  }

  const csvPath = path.resolve(process.cwd(), args.peoplePath);

  if (!fs.existsSync(csvPath)) {
    console.error(`CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  const csvText = fs.readFileSync(csvPath, 'utf8');

  if (args.dryRun) {
    const rows = parseCsv(csvText);
    const families = groupIntoFamilies(rows, config);
    const totalStudents = families.reduce((sum, family) => sum + family.students.length, 0);

    console.log(`Dry run — ${rows.length} CSV rows, ${families.length} families, ${totalStudents} students would be migrated.`);
    console.log('No database connection made, nothing written. Re-run without --dry-run to actually import.');
    process.exitCode = 0;
    return;
  }

  if (!process.env.MONGO_URI) {
    console.error('Missing MONGO_URI. Set it in backend/.env, or export it for a one-off staging run.');
    process.exit(1);
  }

  assertSafeTarget(process.env.MONGO_URI, args.allowProduction);

  try {
    await mongoose.connect(process.env.MONGO_URI);
  } catch (error) {
    console.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  }

  try {
    const summary = await runLegacyImport({ csvText, config });

    console.log('Legacy import complete:');
    console.log(`  CSV rows read:                ${summary.totalRows}`);
    console.log(`  Test/junk records filtered:   ${summary.testRecordsFiltered}`);
    console.log(`  Families processed:           ${summary.familiesProcessed}`);
    console.log(`  Parents created / existing:   ${summary.parentsCreated} / ${summary.parentsExisting}`);
    console.log(`  Students created / existing:  ${summary.studentsCreated} / ${summary.studentsExisting}`);
    console.log(`  Students enrolled in a level: ${summary.studentsEnrolledInLevel}`);
    console.log(`  Students with no program:     ${summary.studentsWithNoProgram}`);
    console.log(`  Students with unmapped program: ${summary.studentsWithUnmappedProgram}`);
    console.log(`  Private-class enrollments:    ${summary.privateClassEnrollmentsCreated}`);

    if (summary.warnings.length > 0) {
      console.log(`  Warnings (${summary.warnings.length}):`);
      summary.warnings.forEach((warning) => console.log(`    - ${warning}`));
    }

    console.log('  Safe to re-run — every write above is a find-or-create keyed by legacyPin.');
    process.exitCode = 0;
  } catch (error) {
    console.error('Legacy import failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
