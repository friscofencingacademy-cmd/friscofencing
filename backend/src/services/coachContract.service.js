const CoachContract = require('../models/coachContract.model');
const User = require('../models/user.model');
const { getServiceByCode } = require('./serviceCatalog.service');
const { validatePacks, describePack, sessionPricesFor } = require('../utils/privateClassPricing');
const { badRequestError, notFoundError, conflictError } = require('../utils/errors');

// Coach contracts are VERSIONED (docs/plans/coach-pack-pricing-plan.md §8):
// Add starts a coach's first current version, Edit (revise) ends the current
// version and starts a new one, Deactivate ends it with no successor. A
// version is never changed in place, so every purchase's coachContractId
// points at the exact terms it was bought under.
//
// Pack rules live only in utils/privateClassPricing.js (plan D14). The util
// throws plain Errors; a pack a rule refuses is the admin's input, so it
// becomes a 400 here.
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

// A pack's terms without its id — a new version's packs are new subdocuments.
function packTerms({ sessionDurationMinutes, quantity, price }) {
  return { sessionDurationMinutes, quantity, price };
}

// Builds and fully validates a version's fields BEFORE any write, so a
// refused edit or create never leaves a coach without a current contract.
async function buildVersion({ serviceId, coachId, studentBillingRate, coachCompensationRate, sessionDurationMinutes, notes, packs }) {
  assertBillingRate(studentBillingRate);
  const privateLessonPacks = validatePacksOrBadRequest(packs, studentBillingRate).map(packTerms);

  const draft = new CoachContract({
    serviceId,
    coachId,
    studentBillingRate,
    coachCompensationRate,
    sessionDurationMinutes,
    notes,
    privateLessonPacks,
  });
  // Throws a Mongoose ValidationError (-> 400) for any other bad field.
  await draft.validate();

  return draft;
}

function normalizedNotes(notes) {
  return typeof notes === 'string' && notes.trim() !== '' ? notes.trim() : undefined;
}

function sameTerms(current, next) {
  const packKey = (packs) =>
    JSON.stringify(
      packs
        .map(packTerms)
        .sort((a, b) => a.sessionDurationMinutes - b.sessionDurationMinutes || a.quantity - b.quantity)
    );

  return (
    current.studentBillingRate === next.studentBillingRate &&
    current.coachCompensationRate === next.coachCompensationRate &&
    current.sessionDurationMinutes === next.sessionDurationMinutes &&
    normalizedNotes(current.notes) === normalizedNotes(next.notes) &&
    packKey(current.privateLessonPacks) === packKey(next.privateLessonPacks)
  );
}

// POST /coach-contracts — a coach's first current contract (plan §8 V4).
// A coach who already has one is edited instead.
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

  if (await CoachContract.exists({ coachId, isActive: true })) {
    throw conflictError('This coach already has a contract — edit it instead');
  }

  // CoachContract has exactly one consumer today — private lessons — so
  // this is set internally, never accepted from the request body (see the
  // model's own field comment for when that would change).
  const privateLessonsService = await getServiceByCode('private-lessons');

  const draft = await buildVersion({
    serviceId: privateLessonsService._id,
    coachId,
    studentBillingRate,
    coachCompensationRate,
    sessionDurationMinutes,
    notes: normalizedNotes(notes),
    packs: privateLessonPacks === undefined ? [] : privateLessonPacks,
  });

  return draft.save();
}

// POST /coach-contracts/:id/revisions — Edit (plan §8 V2). Ends the current
// version (effectiveTo = now, endReason 'revised') and starts a new one with
// the edited terms from the same instant. A field left out keeps its current
// value. A save that changes nothing is refused (V3).
async function revise(contractId, changes = {}) {
  const current = await CoachContract.findById(contractId);

  if (!current) {
    throw notFoundError('Coach contract not found');
  }

  if (!current.isActive) {
    throw conflictError('Only the current contract can be edited');
  }

  const pick = (key) => (changes[key] === undefined ? current[key] : changes[key]);
  const draft = await buildVersion({
    serviceId: current.serviceId,
    coachId: current.coachId,
    studentBillingRate: pick('studentBillingRate'),
    coachCompensationRate: pick('coachCompensationRate'),
    sessionDurationMinutes: pick('sessionDurationMinutes'),
    notes: normalizedNotes(changes.notes === undefined ? current.notes : changes.notes),
    packs: changes.privateLessonPacks === undefined ? current.privateLessonPacks.map(packTerms) : changes.privateLessonPacks,
  });

  if (sameTerms(current, draft)) {
    throw badRequestError('Nothing changed');
  }

  const now = new Date();
  draft.effectiveFrom = now;

  // Guarded on isActive, so two simultaneous edits cannot both succeed.
  const ended = await CoachContract.updateOne(
    { _id: current._id, isActive: true },
    { $set: { isActive: false, effectiveTo: now, endReason: 'revised' } }
  );

  if (ended.modifiedCount !== 1) {
    throw conflictError('This contract was changed by someone else — reload and try again');
  }

  try {
    const created = await draft.save();
    return { contract: created, previous: await CoachContract.findById(current._id) };
  } catch (error) {
    // Put the current version back rather than leave the coach with none.
    await CoachContract.updateOne(
      { _id: current._id },
      { $set: { isActive: true }, $unset: { effectiveTo: '', endReason: '' } }
    );
    throw error;
  }
}

// POST /coach-contracts/preview — the contract editor's live preview (plan
// D9a, §8 V6). Writes nothing. Lesson prices for the default length, every
// pack length and (with coachId) every length the coach currently publishes;
// then one describePack per pack — the same check saving runs, so each
// pack's `error` is exactly the message a save would return.
async function preview({ studentBillingRate, sessionDurationMinutes, packs, coachId }) {
  assertBillingRate(studentBillingRate);

  if (!Array.isArray(packs)) {
    throw badRequestError('packs must be a list');
  }

  // Required lazily: privateClassSchedule.service already requires this file.
  const publishedLengths = coachId
    ? await require('./privateClassSchedule.service').currentLengthsForCoach(coachId)
    : [];
  const lengths = [
    sessionDurationMinutes,
    ...packs.map((pack) => pack && pack.sessionDurationMinutes),
    ...publishedLengths,
  ];

  return {
    sessionPrices: sessionPricesFor(studentBillingRate, lengths),
    packs: packs.map((pack) => describePack(studentBillingRate, pack)),
  };
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

// Ends the current version with no successor (plan §8 V2). Deactivating an
// already-ended version changes nothing.
async function deactivate(id) {
  const contract = await CoachContract.findById(id);

  if (!contract) {
    throw notFoundError('Coach contract not found');
  }

  if (contract.isActive) {
    contract.isActive = false;
    contract.effectiveTo = new Date();
    contract.endReason = 'deactivated';
    await contract.save();
  }

  return contract;
}

async function getActiveForCoach(coachId) {
  return CoachContract.findOne({ coachId, isActive: true });
}

module.exports = { create, revise, preview, list, deactivate, getActiveForCoach };
