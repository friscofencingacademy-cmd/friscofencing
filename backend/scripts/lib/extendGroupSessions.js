const GroupClassSession = require('../../src/models/groupClassSession.model');
const GroupClassSchedule = require('../../src/models/groupClassSchedule.model');
const visitService = require('../../src/services/visit.service');
const { plannedSessionsFor } = require('../../src/services/groupClassSession.service');
const { todayDateOnly } = require('../../src/utils/billingDates');

const DUPLICATE_KEY_ERROR = 11000;

// Keeps every group-class schedule stocked with its sessions for the next
// SESSION_COUNT weekly occurrences (docs/plans/audit-and-health-refresh-plan.md
// PR 1). Sessions are only ever generated at schedule creation, so without
// this every schedule runs out of sessions 8 weeks after it was created and
// the trial picker, the register picker, the calendar and the kiosk all go
// empty.
//
// - Which dates a schedule should have comes from the SAME planner schedule
//   creation uses (plannedSessionsFor, plan D1), so the two never disagree.
// - Only MISSING dates are inserted; an existing session is never touched.
//   A past occurrence that was never generated is not back-filled: the plan
//   starts at `today`, so history is never fabricated.
// - Sessions are created on holiday dates too, exactly like schedule
//   creation (plan D2) — a holiday is an annotation plus an attendance guard,
//   not a missing session.
// - Every student on the schedule's roster (`schedule.students`, the same
//   authority roster.service.js uses) gets a scheduled Visit for each new
//   session that has not started yet (plan D3) — the same rule and the same
//   call as roster.service.js's addStudentToRoster.
// - Idempotent under the (scheduleId, date) unique index (plan D4): a session
//   inserted concurrently by another run is counted as existing, never an
//   error, and a second run is a no-op.
//
// Dry-run by default: `{ apply: true }` writes. Returns a report and prints
// nothing — the CLI (scripts/extend-group-sessions.js) does the printing.
async function extendGroupSessions({ apply = false, today = todayDateOnly(), now = new Date(), scheduleIds = null } = {}) {
  const filter = scheduleIds ? { _id: { $in: scheduleIds } } : {};
  const schedules = await GroupClassSchedule.find(filter).sort({ _id: 1 }).lean();

  const report = {
    today,
    applied: apply,
    schedules: [],
    totals: { schedules: schedules.length, planned: 0, created: 0, visitsUpserted: 0 },
  };

  for (const schedule of schedules) {
    // eslint-disable-next-line no-await-in-loop -- sequential by design: a
    // handful of schedules, and each one's writes must finish before its
    // Visits are created.
    const entry = await extendOneSchedule(schedule, { apply, today, now });

    report.schedules.push(entry);
    report.totals.planned += entry.missing.length;
    report.totals.created += entry.created.length;
    report.totals.visitsUpserted += entry.visitsUpserted;
  }

  return report;
}

async function extendOneSchedule(schedule, { apply, today, now }) {
  const planned = plannedSessionsFor(schedule, today);
  const plannedDates = planned.map((session) => session.date);

  const existing = await GroupClassSession.find(
    { scheduleId: schedule._id, date: { $in: plannedDates } },
    'date'
  ).lean();
  const existingTimes = new Set(existing.map((session) => session.date.getTime()));
  const missing = planned.filter((session) => !existingTimes.has(session.date.getTime()));

  const entry = {
    scheduleId: schedule._id,
    classId: schedule.classId,
    dayOfWeek: schedule.dayOfWeek,
    rosterSize: (schedule.students || []).length,
    existing: existing.length,
    missing: missing.map((session) => session.date),
    created: [],
    alreadyPresent: [],
    visitsUpserted: 0,
  };

  if (!apply || missing.length === 0) {
    return entry;
  }

  const createdSessions = [];

  for (const session of missing) {
    try {
      // eslint-disable-next-line no-await-in-loop -- one insert per date so a
      // duplicate (another run got there first) is isolated to that date.
      const doc = await GroupClassSession.create(session);
      createdSessions.push(doc);
      entry.created.push(doc.date);
    } catch (error) {
      if (error && error.code === DUPLICATE_KEY_ERROR) {
        entry.alreadyPresent.push(session.date);
      } else {
        throw error;
      }
    }
  }

  const upcoming = createdSessions.filter((session) => session.startsAt > now);

  if (upcoming.length > 0) {
    for (const studentId of schedule.students || []) {
      // eslint-disable-next-line no-await-in-loop -- one bulkWrite per student.
      await visitService.upsertScheduledVisits(
        studentId,
        upcoming.map((session) => ({ sessionId: session._id, scheduleId: schedule._id })),
        'regular'
      );
      entry.visitsUpserted += upcoming.length;
    }
  }

  return entry;
}

module.exports = { extendGroupSessions };
