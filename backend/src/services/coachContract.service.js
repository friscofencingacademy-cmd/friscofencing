const CoachContract = require('../models/coachContract.model');
const User = require('../models/user.model');
const { getServiceByCode } = require('./serviceCatalog.service');

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

// Creates a new contract for `coachId`, deactivating any previous active
// one first — one active contract per coach, enforced here (service layer),
// not the schema.
async function create({ coachId, studentBillingRate, coachCompensationRate, sessionDurationMinutes, notes }) {
  const coach = await User.findById(coachId);

  if (!coach || coach.role !== 'coach') {
    throw badRequestError('coachId must refer to a user with role "coach"');
  }

  await CoachContract.updateMany({ coachId, isActive: true }, { $set: { isActive: false } });

  // CoachContract has exactly one consumer today — private lessons — so
  // this is set internally, never accepted from the request body (see the
  // model's own field comment for when that would change).
  const privateLessonsService = await getServiceByCode('private-lessons');

  return CoachContract.create({
    serviceId: privateLessonsService._id,
    coachId,
    studentBillingRate,
    coachCompensationRate,
    sessionDurationMinutes,
    notes,
  });
}

async function list({ coachId } = {}) {
  const filter = {};

  if (coachId) {
    filter.coachId = coachId;
  }

  return CoachContract.find(filter)
    .populate('coachId', 'firstName lastName email')
    .sort({ createdAt: -1 });
}

async function deactivate(id) {
  const contract = await CoachContract.findById(id);

  if (!contract) {
    throw notFoundError('Coach contract not found');
  }

  contract.isActive = false;
  await contract.save();

  return contract;
}

async function getActiveForCoach(coachId) {
  return CoachContract.findOne({ coachId, isActive: true });
}

module.exports = { create, list, deactivate, getActiveForCoach };
