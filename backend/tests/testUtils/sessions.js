const GroupClassSession = require('../../src/models/groupClassSession.model');
const { sessionInstantsFor } = require('../../src/services/groupClassSession.service');

// Builds a GroupClassSession fixture whose startsAt/endsAt come from the SAME
// composition the production generator uses (sessionInstantsFor) — never
// hand-rolled instants (docs/TESTING_STRATEGY.md §Date rules). `schedule`
// needs only { _id?, startTime, endTime }.
function sessionFixture(schedule, date, overrides = {}) {
  return {
    scheduleId: schedule._id,
    date,
    ...sessionInstantsFor(date, schedule),
    ...overrides,
  };
}

function createSession(schedule, date, overrides = {}) {
  return GroupClassSession.create(sessionFixture(schedule, date, overrides));
}

// Attendance opens on a session's own calendar day (docs/plans/duplication-
// cleanup-plan.md A-D1), so a fixture session generated weeks ahead is closed
// for marking. This moves ONE existing session to a fixed past day — never
// the real clock — and recomputes `startsAt`/`endsAt` through the production
// sessionInstantsFor so `date` and the instants stay mutually consistent.
// Returns the reloaded session. The other sessions of that schedule stay in
// the future, so a test that needs a CLOSED session picks one of those.
const ATTENDABLE_PAST_DAY = new Date('2020-01-01T00:00:00.000Z');

async function makeSessionAttendable(session, schedule) {
  await GroupClassSession.updateOne(
    { _id: session._id },
    { date: ATTENDABLE_PAST_DAY, ...sessionInstantsFor(ATTENDABLE_PAST_DAY, schedule) }
  );

  return GroupClassSession.findById(session._id);
}

module.exports = { sessionFixture, createSession, makeSessionAttendable };
