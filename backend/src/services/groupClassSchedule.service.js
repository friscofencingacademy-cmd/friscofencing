const GroupClassSchedule = require('../models/groupClassSchedule.model');
const GroupClass = require('../models/groupClass.model');
const GroupClassSession = require('../models/groupClassSession.model');
const User = require('../models/user.model');
const { generateInitialSessions, sessionInstantsFor } = require('./groupClassSession.service');
const { isPremiumRegistrationEnabled } = require('../config/registrationMode');

function notFoundError(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function badRequestError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

async function assertClassExists(classId) {
  const groupClass = await GroupClass.findById(classId);

  if (!groupClass) {
    throw notFoundError('Group class not found');
  }
}

async function assertCoachValid(coachId) {
  const coach = await User.findById(coachId);

  if (!coach || coach.role !== 'coach') {
    throw badRequestError('coachId must refer to a user with role "coach"');
  }
}

// Single source of truth for "is this schedule full" — shared by the public
// listing below and by subscription.service.js's changeSchedule /
// registration.service.js's create, so a capacity rule change never has to
// be made in more than one place.
function computeAvailability(schedule, groupClass) {
  return schedule.students.length >= groupClass.capacity ? 'full' : 'open';
}

async function create(data) {
  await assertClassExists(data.classId);
  await assertCoachValid(data.coachId);

  const schedule = await GroupClassSchedule.create(data);

  const sessions = generateInitialSessions(schedule);
  await GroupClassSession.insertMany(sessions);

  return schedule;
}

async function list() {
  return GroupClassSchedule.find();
}

async function listByCoach(coachId) {
  return GroupClassSchedule.find({ coachId });
}

async function getById(id) {
  const schedule = await GroupClassSchedule.findById(id);

  if (!schedule) {
    throw notFoundError('Group class schedule not found');
  }

  return schedule;
}

// A schedule's `dayOfWeek` cannot change (plan D6): it decides which calendar
// days its sessions exist on, so changing it is a regenerate-and-re-roster
// operation docs/features/admin.md defers. A `startTime`/`endTime` change
// re-resolves `startsAt`/`endsAt` for every not-yet-started session so the
// stored instants never drift from the rule; started sessions are history
// and are left as they were.
async function update(id, data) {
  if (data.classId !== undefined) {
    await assertClassExists(data.classId);
  }

  if (data.coachId !== undefined) {
    await assertCoachValid(data.coachId);
  }

  if (data.dayOfWeek !== undefined) {
    const existing = await GroupClassSchedule.findById(id);

    if (existing && existing.dayOfWeek !== Number(data.dayOfWeek)) {
      throw badRequestError("Changing a schedule's day is not supported — create a new schedule");
    }
  }

  const schedule = await GroupClassSchedule.findByIdAndUpdate(id, data, {
    new: true,
    runValidators: true,
  });

  if (!schedule) {
    throw notFoundError('Group class schedule not found');
  }

  if (data.startTime !== undefined || data.endTime !== undefined) {
    const upcoming = await GroupClassSession.find({ scheduleId: schedule._id, startsAt: { $gt: new Date() } }, 'date');

    if (upcoming.length > 0) {
      await GroupClassSession.bulkWrite(
        upcoming.map((session) => ({
          updateOne: {
            filter: { _id: session._id },
            update: { $set: sessionInstantsFor(session.date, schedule) },
          },
        }))
      );
    }
  }

  return schedule;
}

async function remove(id) {
  const schedule = await GroupClassSchedule.findByIdAndDelete(id);

  if (!schedule) {
    throw notFoundError('Group class schedule not found');
  }

  return schedule;
}

// Unauthenticated public schedule listing — a thin projection (no ids, no
// roster) over classId/coachId, excluding any schedule whose class, level,
// location, or coach reference is missing so a broken reference never
// surfaces as a half-populated row.
//
// `availability` is only included in schedule-based mode. Premium students
// (the live default — docs/plans/premium-registration-and-attendance-plan.md
// §0/§4) attend any session of their level once registered, so one
// schedule's roster filling up doesn't mean that level has no room —
// advertising a per-slot 'full' state here would be misleading, and
// registration.service.js's create() no longer enforces it either in this
// mode.
async function listPublic() {
  const schedules = await GroupClassSchedule.find()
    .populate({
      path: 'classId',
      populate: [{ path: 'levelId' }, { path: 'locationId' }],
    })
    .populate('coachId', 'firstName lastName');

  const showAvailability = !isPremiumRegistrationEnabled();

  return schedules
    .filter(
      (schedule) =>
        schedule.classId &&
        schedule.classId.levelId &&
        schedule.classId.locationId &&
        schedule.coachId
    )
    .map((schedule) => ({
      className: schedule.classId.name,
      levelName: schedule.classId.levelId.name,
      locationName: schedule.classId.locationId.name,
      // First real consumer of Location.timezone (docs/plans/timezone-
      // consistency-plan.md D8, docs/plans/frontend-polish-plan.md PR 4) —
      // the location is already populated above, so this is a zero-extra-
      // query field. Per-schedule, sourced from THAT schedule's own
      // location, never guessed from an unrelated "first location in the
      // list" the way the frontend used to.
      timezone: schedule.classId.locationId.timezone,
      coachName: `${schedule.coachId.firstName} ${schedule.coachId.lastName}`,
      dayOfWeek: schedule.dayOfWeek,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      ...(showAvailability && { availability: computeAvailability(schedule, schedule.classId) }),
    }));
}

module.exports = {
  create,
  list,
  listByCoach,
  getById,
  update,
  remove,
  listPublic,
  computeAvailability,
};
