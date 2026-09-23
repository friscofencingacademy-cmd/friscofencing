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

module.exports = { sessionFixture, createSession };
