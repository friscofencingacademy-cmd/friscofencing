const GroupClassSchedule = require('../models/groupClassSchedule.model');
const GroupClass = require('../models/groupClass.model');
const GroupClassSession = require('../models/groupClassSession.model');
const User = require('../models/user.model');
const { generateInitialSessions } = require('./groupClassSession.service');

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

async function update(id, data) {
  if (data.classId !== undefined) {
    await assertClassExists(data.classId);
  }

  if (data.coachId !== undefined) {
    await assertCoachValid(data.coachId);
  }

  const schedule = await GroupClassSchedule.findByIdAndUpdate(id, data, {
    new: true,
    runValidators: true,
  });

  if (!schedule) {
    throw notFoundError('Group class schedule not found');
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
async function listPublic() {
  const schedules = await GroupClassSchedule.find()
    .populate({
      path: 'classId',
      populate: [{ path: 'levelId' }, { path: 'locationId' }],
    })
    .populate('coachId', 'firstName lastName');

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
      coachName: `${schedule.coachId.firstName} ${schedule.coachId.lastName}`,
      dayOfWeek: schedule.dayOfWeek,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      availability: computeAvailability(schedule, schedule.classId),
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
