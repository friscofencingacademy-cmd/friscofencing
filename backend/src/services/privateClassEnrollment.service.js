const User = require('../models/user.model');
const PrivateClassSchedule = require('../models/privateClassSchedule.model');
const PrivateClassEnrollment = require('../models/privateClassEnrollment.model');
const PrivateClassSession = require('../models/privateClassSession.model');
const { PerSessionRegistration } = require('../models/registration.model');
const coachContractService = require('./coachContract.service');
const paymentMethodService = require('./paymentMethod.service');
const { ensureStripeCustomer } = require('./stripeCustomer.service');
const { generateSessions } = require('./privateClassSession.service');
const { computeSessionPrice } = require('../utils/privateClassPricing');
const mailService = require('./mail.service');

function notFoundError(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function forbiddenError(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}

function badRequestError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function conflictError(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

function populateEnrollment(query) {
  return query
    .populate('studentId', 'firstName lastName')
    .populate('parentId', 'firstName lastName email')
    .populate('coachId', 'firstName lastName email');
}

// Self-registration (D4: born active, no admin-created-then-parent-accepts
// step — that's CKQ's model, this is the parent-self-registers model).
async function create({ studentId, scheduleId }, requestingUser) {
  const student = await User.findById(studentId);

  if (!student || student.role !== 'student') {
    throw notFoundError('Student not found');
  }

  if (String(student.parentId) !== String(requestingUser._id)) {
    throw forbiddenError('This student does not belong to you');
  }

  const schedule = await PrivateClassSchedule.findById(scheduleId).populate(
    'coachId',
    'firstName lastName email'
  );

  // schedule.coachId is null when the coach was deleted without a
  // delete-guard blocking it (orphaned-coach-reference-fix-plan D4) — a
  // stale bookmarked slot link must 404, not crash on a null populate.
  if (!schedule || !schedule.isActive || !schedule.coachId) {
    throw notFoundError('Private class schedule not found');
  }

  const contract = await coachContractService.getActiveForCoach(schedule.coachId._id);

  if (!contract) {
    throw conflictError('This coach is not currently accepting private students');
  }

  const paymentMethod = await paymentMethodService.getMine(requestingUser._id);

  if (!paymentMethod) {
    throw badRequestError('Add a payment method before registering');
  }

  await ensureStripeCustomer(requestingUser);

  const enrollment = await PrivateClassEnrollment.create({
    studentId,
    parentId: requestingUser._id,
    coachId: schedule.coachId._id,
    coachContractId: contract._id,
    agreedHourlyRate: contract.studentBillingRate,
    status: 'active',
  });

  // CKQ-BUG-FIX (atomic slot claim — CKQ's read-then-write races): claim
  // the slot with one atomic conditional update instead of a separate
  // read-then-write, so two parents racing the same slot can never both
  // "win." The loser's orphan enrollment is deleted immediately.
  const claimed = await PrivateClassSchedule.findOneAndUpdate(
    { _id: scheduleId, studentId: null, isActive: true },
    { $set: { studentId, enrollmentId: enrollment._id } },
    { new: true }
  ).populate('coachId', 'firstName lastName email');

  if (!claimed) {
    await PrivateClassEnrollment.deleteOne({ _id: enrollment._id });
    throw conflictError('This time slot was just taken — please pick another');
  }

  const { sessions, firstSessionDate } = await generateSessions({ enrollmentId: enrollment._id });

  const sessionPrice = sessions.length
    ? computeSessionPrice(contract.studentBillingRate, claimed.durationMinutes)
    : null;

  // Fire-and-forget confirmation email — never throws, never affects this
  // response (see mail.service.js's send-function contract).
  try {
    await mailService.sendPrivateClassConfirmationEmail({
      parent: requestingUser,
      student,
      coach: claimed.coachId,
      slotLabel: `${claimed.startTime} · ${claimed.durationMinutes} min`,
      rateLabel: `$${contract.studentBillingRate}/hr — $${sessionPrice} per session`,
      firstSessionDate,
      sessionPriceLabel: `$${sessionPrice}`,
    });
  } catch (error) {
    // eslint-disable-next-line no-console -- operational logging for a
    // fire-and-forget email side effect, not debug output.
    console.error('privateClassEnrollment.service: failed to send confirmation email:', error.message);
  }

  return {
    enrollment: await populateEnrollment(PrivateClassEnrollment.findById(enrollment._id)),
    schedule: claimed,
    sessionPrice,
    firstSessionDate,
  };
}

async function listMine(parentId) {
  const enrollments = await populateEnrollment(PrivateClassEnrollment.find({ parentId })).sort({
    createdAt: -1,
  });

  const withSlotsAndCharges = await Promise.all(
    enrollments.map(async (enrollment) => {
      const slot = await PrivateClassSchedule.findOne({ enrollmentId: enrollment._id });
      const charges = await PerSessionRegistration.find({ enrollmentId: enrollment._id })
        .sort({ createdAt: -1 })
        .limit(10);

      return { enrollment, slot, charges };
    })
  );

  return withSlotsAndCharges;
}

async function listAll({ status, coachId } = {}) {
  const filter = {};

  if (status) {
    filter.status = status;
  }

  if (coachId) {
    filter.coachId = coachId;
  }

  return populateEnrollment(PrivateClassEnrollment.find(filter)).sort({ createdAt: -1 });
}

// parent-own | admin. Frees every slot the enrollment claimed and deletes
// only FUTURE (money-free) sessions — charging requires attendance, and
// attendance requires startDate <= now, so a future session can never have
// been charged (keep this argument in the comment, per plan).
async function cancel(enrollmentId, requestingUser) {
  const enrollment = await PrivateClassEnrollment.findById(enrollmentId);

  if (!enrollment) {
    throw notFoundError('Private class enrollment not found');
  }

  const isAdmin = requestingUser.role === 'admin' || requestingUser.role === 'superadmin';
  const isOwningParent =
    requestingUser.role === 'parent' && String(enrollment.parentId) === String(requestingUser._id);

  if (!isAdmin && !isOwningParent) {
    throw forbiddenError('This enrollment does not belong to you');
  }

  if (enrollment.status !== 'active') {
    throw conflictError('This enrollment is already cancelled');
  }

  const now = new Date();

  // Captured BEFORE the roster-free write below clears studentId/
  // enrollmentId, so the cancellation email can still describe which slot
  // was released.
  const slot = await PrivateClassSchedule.findOne({ enrollmentId: enrollment._id });
  const slotLabel = slot ? `${slot.startTime} · ${slot.durationMinutes} min` : '';

  enrollment.status = 'cancelled';
  enrollment.endDate = now;
  await enrollment.save();

  await PrivateClassSchedule.updateMany(
    { enrollmentId: enrollment._id },
    { $set: { studentId: null, enrollmentId: null } }
  );

  await PrivateClassSession.deleteMany({
    enrollmentId: enrollment._id,
    startDate: { $gt: now },
  });

  try {
    const student = await User.findById(enrollment.studentId);
    const parent = await User.findById(enrollment.parentId);
    const coach = await User.findById(enrollment.coachId);

    await mailService.sendPrivateClassCancellationEmail({
      parent,
      student,
      coach,
      slotLabel,
    });
  } catch (error) {
    // eslint-disable-next-line no-console -- operational logging for a
    // fire-and-forget email side effect, not debug output.
    console.error('privateClassEnrollment.service: failed to send cancellation email:', error.message);
  }

  return enrollment;
}

module.exports = { create, listMine, listAll, cancel };
