require('dotenv/config');

const mongoose = require('mongoose');

const { extendGroupSessions } = require('./lib/extendGroupSessions');
const { assertExplicitDatabase } = require('./lib/mongoTarget');

// Tops every group-class schedule back up to its next 8 weekly sessions
// (docs/plans/audit-and-health-refresh-plan.md PR 1). Safe to run any time and
// as often as wanted: it only inserts missing dates. Run weekly — by
// .github/workflows/extend-sessions.yml, or by hand. See
// scripts/lib/extendGroupSessions.js for the rules.
//
// Usage:
//   node scripts/extend-group-sessions.js                       (dry run — default, no writes)
//   node scripts/extend-group-sessions.js --live                (applies)
//   node scripts/extend-group-sessions.js --schedule=<id> ...   (only those schedules; repeatable)
//   node scripts/extend-group-sessions.js --expect-db=<name>    (refuse any other database)
//
// Connects to MONGO_URI (backend/.env, or the environment). The URI must name
// its database — one that names none would silently use "test"
// (scripts/lib/mongoTarget.js). The weekly workflow always passes
// --expect-db, so a secret pointing at the wrong database fails loudly.

function dayString(date) {
  return date.toISOString().slice(0, 10);
}

async function main() {
  const live = process.argv.includes('--live');
  const expectedDbArg = process.argv.find((arg) => arg.startsWith('--expect-db='));
  const expected = expectedDbArg ? expectedDbArg.slice('--expect-db='.length) : undefined;
  const scheduleIds = process.argv
    .filter((arg) => arg.startsWith('--schedule='))
    .map((arg) => arg.slice('--schedule='.length))
    .filter(Boolean);

  if (!process.env.MONGO_URI) {
    console.error('Missing MONGO_URI. Set it in backend/.env or the environment.');
    process.exit(1);
  }

  try {
    assertExplicitDatabase(process.env.MONGO_URI, { expected });
  } catch (error) {
    console.error(`Refusing to run: ${error.message}`);
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGO_URI);
  } catch (error) {
    console.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  }

  console.log(`Connected to database: ${mongoose.connection.name}`);
  console.log(live ? 'Mode: LIVE (will write)' : 'Mode: DRY RUN (no writes)');

  try {
    const report = await extendGroupSessions({
      apply: live,
      scheduleIds: scheduleIds.length > 0 ? scheduleIds : null,
    });

    console.log(`Today (academy timezone): ${dayString(report.today)}`);
    console.log('');

    report.schedules.forEach((entry) => {
      const dates = (live ? entry.created : entry.missing).map(dayString).join(', ') || '—';
      console.log(
        `  schedule ${entry.scheduleId} (day ${entry.dayOfWeek}, roster ${entry.rosterSize}): ` +
          `${entry.existing} already present, ${entry.missing.length} missing` +
          (live ? `, ${entry.created.length} created, ${entry.visitsUpserted} visit(s)` : '') +
          ` — ${dates}`
      );
      if (entry.alreadyPresent.length > 0) {
        console.log(`    (created concurrently by another run: ${entry.alreadyPresent.map(dayString).join(', ')})`);
      }
    });

    console.log('');
    console.log(
      `Schedules: ${report.totals.schedules}. Missing sessions: ${report.totals.planned}.` +
        (live ? ` Created: ${report.totals.created}. Visits upserted: ${report.totals.visitsUpserted}.` : '')
    );
    console.log(live ? 'Applied.' : 'No writes made — re-run with --live to apply.');
    process.exitCode = 0;
  } catch (error) {
    console.error('Session extension failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
