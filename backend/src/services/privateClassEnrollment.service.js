const User = require('../models/user.model');
const PrivateClassSchedule = require('../models/privateClassSchedule.model');
const PrivateClassEnrollment = require('../models/privateClassEnrollment.model');
const PrivateClassSession = require('../models/privateClassSession.model');
const { PerSessionRegistration } = require('../models/registration.model');
const coachContractService = require('./coachContract.service');
const paymentMethodService = require('./paymentMethod.service');
const { ensureStripeCustomer } = require('./stripeCustomer.service');
const { getServiceByCode, assertBillingShape } = require('./serviceCatalog.service');
const { chargeLedgerRow } = require('./billing/chargeFinalization.service');
const privateClassSessionService = require('./privateClassSession.service');
const { purchaseOptionsFor, purchaseBreakdown } = require('../utils/privateClassPricing');
const { badRequestError, forbiddenError, notFoundError, conflictError, httpError } = require('../utils/errors');

// Private-lesson PURCHASES (docs/decisions/011-private-per-session-booking.md).
// A PrivateClassEnrollment is one purchase of `quantity` credits with one
// coach for one lesson length, at a pinned price. Every purchase happens
// together with a first booking (purchaseAndBook) — the parent picks a date,
// then how many sessions to buy — so the charge is anchored to that booking
// on the Registration ledger (the only record of money).

function remainingOf(enrollment) {
  return enrollment.quantity - enrollment.sessionsUsed;
}

// The one place a purchase's price is resolved: the coach's ACTIVE contract,
// through purchaseOptionsFor — the single session at the contract's rate x
// the rule's lesson length, then that coach's packs of exactly that length
// (docs/plans/coach-pack-pricing-plan.md). Used by the quote endpoint AND
// the charge, so what the parent is shown is exactly what they are charged.
async function resolvePurchaseTerms(schedule) {
  const coachId = schedule.coachId._id || schedule.coachId;
  const contract = await coachContractService.getActiveForCoach(coachId);

  if (!contract) {
    throw conflictError('This coach is not currently accepting private students');
  }

  const options = purchaseOptionsFor(contract, schedule.durationMinutes);

  return { contract, unitPrice: options[0].unitPrice, options };
}

// Credits the student can still use for a rule (same coach, same length).
async function availableCreditsFor(studentId, parentId, schedule) {
  const enrollments = await PrivateClassEnrollment.find({
    studentId,
    parentId,
    coachId: schedule.coachId._id || schedule.coachId,
    sessionDurationMinutes: schedule.durationMinutes,
    status: 'active',
  });

  return enrollments.reduce((sum, enrollment) => sum + remainingOf(enrollment), 0);
}

// GET /private-class-enrollments/quote — everything the booking wizard shows
// before the parent confirms: each purchase option priced for this rule, and
// how many already-paid sessions the student could use instead. Every figure
// is computed here; the frontend only renders it.
async function quote({ studentId, scheduleId }, parent) {
  const student = await User.findById(studentId);

  if (!student || student.role !== 'student') {
    throw notFoundError('Student not found');
  }

  if (String(student.parentId) !== String(parent._id)) {
    throw forbiddenError('This student does not belong to you');
  }

  const schedule = await PrivateClassSchedule.findById(scheduleId);

  if (!schedule || !schedule.isActive) {
    throw notFoundError('Private class schedule not found');
  }

  const availableCredits = await availableCreditsFor(student._id, parent._id, schedule);

  // A coach who stopped taking new students still honors credits already
  // paid for — the quote then offers only the credit path.
  let terms = null;
  try {
    terms = await resolvePurchaseTerms(schedule);
  } catch (error) {
    if (error.status !== 409) throw error;
  }

  return {
    durationMinutes: schedule.durationMinutes,
    hourlyRate: terms ? terms.contract.studentBillingRate : null,
    options: terms ? terms.options : [],
    availableCredits,
    // The cancellation policy the parent agrees to — shown in the wizard's
    // consent line, from the same constant the cancel endpoint enforces.
    cancelCutoffHours: privateClassSessionService.PARENT_CANCEL_CUTOFF_HOURS,
  };
}

// POST /private-class-enrollments — buy a single session (no `packId`) or
// one of the coach's packs (`packId`), and book the first lesson, in the order ADR 011 fixes (reserve before charging, ADR 008's
// lesson):
//   1. validate everything (no writes)
//   2. create the purchase `pending`
//   3. claim the slot with a `pending` booking (the atomic insert)
//   4. create the `pending` ledger row
//   5. charge the card (chargeLedgerRow — the one Stripe charge path)
//   6. success: ledger completed, purchase active with 1 credit used,
//      booking confirmed, Visit + emails (invoice attached)
//      decline:  ledger failed, purchase failed, booking released (the slot
//      reopens) -> 402
// An unexpected Stripe error (not a decline) propagates with the ledger row
// still `pending`, so the slot stays held and is never silently released
// while money may have moved; check-private-credit-ledger.js reports it.
async function purchaseAndBook({ studentId, scheduleId, day, packId }, parent) {
  const { student, schedule, coach, startDate, endDate } = await privateClassSessionService.loadBookingContext(
    { studentId, scheduleId, day },
    parent
  );

  const { contract, unitPrice, options } = await resolvePurchaseTerms(schedule);
  // The request names a CHOICE, never a price (Hard Rule 7, plan D4). A
  // pack that no longer exists on the coach's active contract, was edited
  // (an edited pack gets a new id, plan D7), or is for another lesson length
  // is not in `options` — the parent was shown a price that is no longer
  // offered, so nothing is charged (D11).
  const wantedPackId = packId === undefined || packId === null || packId === '' ? null : String(packId);
  const option = options.find((candidate) => candidate.packId === wantedPackId);

  if (!option) {
    throw conflictError('This pack is no longer offered — please review the prices');
  }

  if (!(option.total > 0)) {
    throw conflictError('This coach has no price set for private lessons');
  }

  const paymentMethod = await paymentMethodService.getMine(parent._id);

  if (!paymentMethod) {
    throw badRequestError('Add a payment method before booking');
  }

  // Resolved before any write — a misconfigured Service must never leave a
  // booking without a resolvable serviceId (ADR 004).
  const privateLessonsService = await getServiceByCode('private-lessons', { requireActive: true });
  assertBillingShape(privateLessonsService, 'per_session');

  const stripeCustomerId = await ensureStripeCustomer(parent);

  const enrollment = await PrivateClassEnrollment.create({
    studentId: student._id,
    parentId: parent._id,
    coachId: coach._id,
    coachContractId: contract._id,
    agreedHourlyRate: contract.studentBillingRate,
    sessionDurationMinutes: schedule.durationMinutes,
    quantity: option.quantity,
    sessionsUsed: 0,
    status: 'pending',
  });

  let session;

  try {
    session = await privateClassSessionService.reserveSlot({
      scheduleId: schedule._id,
      enrollmentId: enrollment._id,
      coachId: coach._id,
      studentId: student._id,
      parentId: parent._id,
      startDate,
      endDate,
      status: 'pending',
    });
  } catch (error) {
    // Nothing references the purchase yet — remove it rather than leave an
    // empty failed record behind.
    await PrivateClassEnrollment.deleteOne({ _id: enrollment._id });
    throw error;
  }

  const row = await PerSessionRegistration.create({
    serviceId: privateLessonsService._id,
    sessionId: session._id,
    enrollmentId: enrollment._id,
    parentId: parent._id,
    studentId: student._id,
    quantity: option.quantity,
    unitPrice,
    amount: option.total,
    status: 'pending',
    attempt: 1,
  });

  const charge = await chargeLedgerRow({ row, paymentMethod, stripeCustomerId });

  if (charge.outcome !== 'succeeded') {
    await PerSessionRegistration.updateOne(
      { _id: row._id },
      {
        $set: {
          status: 'failed',
          failureMessage: charge.failureMessage,
          stripePaymentIntentId: charge.paymentIntentId,
        },
      }
    );
    await PrivateClassEnrollment.updateOne({ _id: enrollment._id }, { $set: { status: 'failed' } });
    await PrivateClassSession.updateOne(
      { _id: session._id },
      { $set: { status: 'released', releaseReason: 'payment_failed' } }
    );

    throw httpError(402, charge.failureMessage);
  }

  const completedRow = await PerSessionRegistration.findByIdAndUpdate(
    row._id,
    { $set: { status: 'completed', stripePaymentIntentId: charge.paymentIntentId, paidAt: new Date() } },
    { new: true }
  );
  const activeEnrollment = await PrivateClassEnrollment.findByIdAndUpdate(
    enrollment._id,
    { $set: { status: 'active', sessionsUsed: 1 } },
    { new: true }
  );
  const confirmedSession = await PrivateClassSession.findByIdAndUpdate(
    session._id,
    { $set: { status: 'confirmed' } },
    { new: true }
  );

  await privateClassSessionService.onBookingConfirmed({
    session: confirmedSession,
    enrollment: activeEnrollment,
    parent,
    student,
    coach,
    purchaseRow: completedRow,
  });

  return {
    enrollment: activeEnrollment,
    session: confirmedSession,
    registration: completedRow,
    remaining: remainingOf(activeEnrollment),
  };
}

function populateEnrollment(query) {
  return query
    .populate('studentId', 'firstName lastName')
    .populate('parentId', 'firstName lastName email')
    .populate('coachId', 'firstName lastName email');
}

// Each purchase with its remaining credits, its ledger row (what was paid),
// and its bookings (with attendance from the Visit ledger).
async function withPaymentsAndBookings(enrollments) {
  if (enrollments.length === 0) return [];

  const enrollmentIds = enrollments.map((enrollment) => enrollment._id);
  const [payments, sessions] = await Promise.all([
    PerSessionRegistration.find({ enrollmentId: { $in: enrollmentIds }, status: 'completed' }).lean(),
    privateClassSessionService.listForEnrollments(enrollmentIds),
  ]);

  const paymentByEnrollment = new Map(payments.map((payment) => [String(payment.enrollmentId), payment]));
  const sessionsByEnrollment = new Map();
  sessions.forEach((session) => {
    const key = String(session.enrollmentId);
    if (!sessionsByEnrollment.has(key)) sessionsByEnrollment.set(key, []);
    sessionsByEnrollment.get(key).push(session);
  });

  return enrollments.map((enrollment) => {
    const payment = paymentByEnrollment.get(String(enrollment._id)) || null;

    return {
      enrollment,
      remaining: remainingOf(enrollment),
      payment: payment && {
        _id: payment._id,
        amount: payment.amount,
        quantity: payment.quantity,
        unitPrice: payment.unitPrice,
        // Derived from the immutable ledger fields, never stored (plan D6).
        savings: purchaseBreakdown(payment).savings,
        paidAt: payment.paidAt,
      },
      sessions: sessionsByEnrollment.get(String(enrollment._id)) || [],
    };
  });
}

// A parent's paid purchases, newest first. Failed purchases are not credit
// balances — they appear only in payment history.
async function listMine(parentId) {
  const enrollments = await populateEnrollment(PrivateClassEnrollment.find({ parentId, status: 'active' })).sort({
    createdAt: -1,
  });

  return withPaymentsAndBookings(enrollments);
}

async function listAll({ status, coachId } = {}) {
  const filter = { status: status || 'active' };

  if (!PrivateClassEnrollment.PRIVATE_CLASS_ENROLLMENT_STATUSES.includes(filter.status)) {
    throw badRequestError(
      `status must be one of: ${PrivateClassEnrollment.PRIVATE_CLASS_ENROLLMENT_STATUSES.join(', ')}`
    );
  }

  if (coachId) {
    filter.coachId = coachId;
  }

  const enrollments = await populateEnrollment(PrivateClassEnrollment.find(filter)).sort({ createdAt: -1 });

  return withPaymentsAndBookings(enrollments);
}

module.exports = { quote, purchaseAndBook, listMine, listAll };
