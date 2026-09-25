const CoachContract = require('../models/coachContract.model');
const User = require('../models/user.model');
const { getServiceByCode } = require('./serviceCatalog.service');
const { validatePacks, describePack } = require('../utils/privateClassPricing');
const { badRequestError, notFoundError, conflictError } = require('../utils/errors');

// Pack rules live only in utils/privateClassPricing.js (docs/plans/coach-
// pack-pricing-plan.md D14). The util throws plain Errors; a pack a rule
// refuses is the admin's input, so it becomes a 400 here.
function validatePacksOrBadRequest(packs, hourlyRate) {
  try {
    return validatePacks(packs, hourlyRate);
  } catch (error) {
    throw badRequestError(error.message);
  }
}

function assertBillingRate(studentBillingRate) {
  if (typeof studentBillingRate !== 'number' || !Number.isFinite(studentBillingRate) || studentBillingRate < 0) {
    throw badRequestError('studentBillingRate must be a number >= 0');
  }
}

// A pack's terms without its id — carried-over packs become new
// subdocuments on the new contract (new ids), plan 1.2.
function packTerms({ sessionDurationMinutes, quantity, price }) {
  return { sessionDurationMinutes, quantity, price };
}

// Creates a new contract for `coachId`, deactivating any previous active
// one first — one active contract per coach, enforced here (service layer),
// not the schema.
//
// Packs (plan D9): when `privateLessonPacks` is sent (the admin dialog always
// sends it, prefilled from the current contract) it is validated against the
// NEW rate. When it is omitted, the previous active contract's packs carry
// over and are validated against the new rate too — a rate change that pushes
// a pack outside the band is refused, and nothing is written.
async function create({
  coachId,
  studentBillingRate,
  coachCompensationRate,
  sessionDurationMinutes,
  notes,
  privateLessonPacks,
}) {
  const coach = await User.findById(coachId);

  if (!coach || coach.role !== 'coach') {
    throw badRequestError('coachId must refer to a user with role "coach"');
  }

  assertBillingRate(studentBillingRate);

  const previous = await CoachContract.findOne({ coachId, isActive: true });
  const requestedPacks =
    privateLessonPacks !== undefined
      ? privateLessonPacks
      : ((previous && previous.privateLessonPacks) || []).map(packTerms);

  // Validated BEFORE deactivating the old contract, so a refused pack leaves
  // the coach's current contract untouched.
  const packs = validatePacksOrBadRequest(requestedPacks, studentBillingRate).map(packTerms);

  // CoachContract has exactly one consumer today — private lessons — so
  // this is set internally, never accepted from the request body (see the
  // model's own field comment for when that would change).
  const privateLessonsService = await getServiceByCode('private-lessons');

  await CoachContract.updateMany({ coachId, isActive: true }, { $set: { isActive: false } });

  return CoachContract.create({
    serviceId: privateLessonsService._id,
    coachId,
    studentBillingRate,
    coachCompensationRate,
    sessionDurationMinutes,
    notes,
    privateLessonPacks: packs,
  });
}

// PUT /coach-contracts/:id/packs — replaces the active contract's pack list
// (plan D7). The rate is unchanged, so the band is the contract's own.
//
// The id rule: an incoming pack keeps its `_id` only when the stored pack
// with that id has the same length, quantity and price. Any edited pack gets
// a new id, so a parent holding a quote for the old price gets a 409 at
// purchase (D11) instead of being charged a price they were never shown.
async function updatePacks(contractId, packs) {
  const contract = await CoachContract.findById(contractId);

  if (!contract) {
    throw notFoundError('Coach contract not found');
  }

  if (!contract.isActive) {
    throw conflictError('Packs can only be changed on the active contract');
  }

  const validated = validatePacksOrBadRequest(packs, contract.studentBillingRate);
  const storedById = new Map(contract.privateLessonPacks.map((pack) => [String(pack._id), pack]));

  contract.privateLessonPacks = validated.map((pack) => {
    const stored = pack._id ? storedById.get(String(pack._id)) : null;
    const unchanged =
      stored &&
      stored.sessionDurationMinutes === pack.sessionDurationMinutes &&
      stored.quantity === pack.quantity &&
      stored.price === pack.price;

    return unchanged ? { _id: stored._id, ...packTerms(pack) } : packTerms(pack);
  });

  await contract.save();

  return contract;
}

// POST /coach-contracts/pack-quotes — the pack editor's live preview (plan
// D9a). Writes nothing. One describePack per pack, which is the same check
// saving runs, so the preview's `error` is exactly the message a save would
// return. The rate comes from the form, so it also previews a contract that
// is still being created.
function quotePacks({ studentBillingRate, packs }) {
  assertBillingRate(studentBillingRate);

  if (!Array.isArray(packs)) {
    throw badRequestError('packs must be a list');
  }

  return packs.map((pack) => describePack(studentBillingRate, pack));
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

module.exports = { create, updatePacks, quotePacks, list, deactivate, getActiveForCoach };
