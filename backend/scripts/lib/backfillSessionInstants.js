const GroupClassSession = require('../../src/models/groupClassSession.model');
const GroupClassSchedule = require('../../src/models/groupClassSchedule.model');
const { sessionInstantsFor } = require('../../src/services/groupClassSession.service');

// One-time migration for docs/plans/session-start-time-cutoff-plan.md §2.9 —
// fills `startsAt`/`endsAt` on every GroupClassSession that predates those
// fields, from the session's own `date` sentinel + its schedule's "HH:mm"
// times, via the exact same composition the generator uses
// (sessionInstantsFor).
//
// Dry-run by default: returns the report without writing anything. Pass
// `{ apply: true }` to persist — same contract as normalizeDateSentinels.js.
//
// Idempotent: a row that already has both fields is left alone. A row whose
// schedule no longer exists aborts the WHOLE run with nothing written — its
// start time is unknowable, and guessing one would silently mis-time it.
async function backfillSessionInstants({ apply = false } = {}) {
  const sessions = await GroupClassSession.find({
    $or: [{ startsAt: { $exists: false } }, { endsAt: { $exists: false } }],
  }).lean();

  const report = { scannedCount: sessions.length, changes: [], aborted: false, abortReason: null };

  if (sessions.length === 0) {
    return report;
  }

  const scheduleIds = [...new Set(sessions.map((session) => String(session.scheduleId)))];
  const schedules = await GroupClassSchedule.find({ _id: { $in: scheduleIds } }).lean();
  const scheduleById = new Map(schedules.map((schedule) => [String(schedule._id), schedule]));

  for (const session of sessions) {
    const schedule = scheduleById.get(String(session.scheduleId));

    if (!schedule) {
      report.aborted = true;
      report.abortReason = {
        docId: session._id,
        reason: `schedule ${session.scheduleId} no longer exists — cannot resolve a start time`,
      };
      report.changes = [];
      return report;
    }

    const { startsAt, endsAt } = sessionInstantsFor(session.date, schedule);

    report.changes.push({
      docId: session._id,
      scheduleId: session.scheduleId,
      date: session.date,
      startsAt,
      endsAt,
    });
  }

  if (apply) {
    await GroupClassSession.collection.bulkWrite(
      report.changes.map((change) => ({
        updateOne: {
          filter: { _id: change.docId },
          update: { $set: { startsAt: change.startsAt, endsAt: change.endsAt } },
        },
      }))
    );
  }

  return report;
}

module.exports = { backfillSessionInstants };
