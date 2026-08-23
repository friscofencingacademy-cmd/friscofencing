const User = require('../models/user.model');
const GroupClassSchedule = require('../models/groupClassSchedule.model');
const GroupClass = require('../models/groupClass.model');
const Level = require('../models/level.model');
const Location = require('../models/location.model');
const Price = require('../models/price.model');
const Registration = require('../models/registration.model');
const Subscription = require('../models/subscription.model');
const stripe = require('../config/stripe');
const paymentMethodService = require('./paymentMethod.service');
const { ensureStripeCustomer } = require('./stripeCustomer.service');
const { calculateChargeAmount } = require('./billing/calculateChargeAmount.service');
const { addOneMonth, todayAtMidnight } = require('../utils/billingDates');
const { addStudentToRoster } = require('./roster.service');
const { computeAvailability } = require('./groupClassSchedule.service');
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

function paymentFailedError(message) {
  const error = new Error(message);
  error.status = 402;
  return error;
}

// Shared by create() and previewChargeAmount() — the auth-critical,
// order-sensitive first checks (does this student exist, does it belong to
// this parent, does the schedule exist) are identical in both, so this is
// the ONE place that logic lives. create()'s subsequent lookups
// (existingSubscription, groupClass+availability, price) keep their exact
// original order below, UNCHANGED — the preview path resolves groupClass/
// price itself since a read-only pricing estimate has no reason to run the
// existingSubscription/availability checks (the real POST below still
// enforces both at actual charge time regardless of what a preview showed).
async function resolveStudentForSchedule(studentId, scheduleId, requestingUser) {
  const student = await User.findById(studentId);

  if (!student || student.role !== 'student') {
    throw notFoundError('Student not found');
  }

  if (String(student.parentId) !== String(requestingUser._id)) {
    throw forbiddenError('This student does not belong to you');
  }

  const schedule = await GroupClassSchedule.findById(scheduleId);

  if (!schedule) {
    throw notFoundError('Group class schedule not found');
  }

  return { student, schedule };
}

// Registers `studentId` for `scheduleId`: validates permission + pricing,
// charges the parent's saved card for the first period off-session via a
// Stripe PaymentIntent, and only then creates the Registration/Subscription
// docs and mutates rosters. No 3DS/requires_action handling for MVP — a
// non-'succeeded' PaymentIntent status is treated as a failed registration
// and nothing below step 11 is created.
async function create({ studentId, scheduleId }, requestingUser) {
  const { student, schedule } = await resolveStudentForSchedule(studentId, scheduleId, requestingUser);

  const existingSubscription = await Subscription.findOne({
    studentId,
    scheduleId,
    status: 'active',
  });

  if (existingSubscription) {
    throw conflictError('This student is already registered for this schedule');
  }

  const groupClass = await GroupClass.findById(schedule.classId);

  if (!groupClass) {
    throw notFoundError('Group class not found');
  }

  // Enforced here, not just displayed publicly (`GET
  // /group-class-schedules/public`'s `availability` field) — without this,
  // a schedule shown as "full" could still be charged into.
  if (computeAvailability(schedule, groupClass) === 'full') {
    throw conflictError('This class is full');
  }

  const price = await Price.findOne({ levelId: groupClass.levelId });

  if (!price) {
    throw notFoundError("Pricing not configured for this class's level");
  }

  const paymentMethod = await paymentMethodService.getMine(requestingUser._id);

  if (!paymentMethod) {
    throw badRequestError('Add a payment method before registering');
  }

  const stripeCustomerId = await ensureStripeCustomer(requestingUser);

  const { amount: chargeAmount, siblingDiscountApplied, siblingDiscountAmount } =
    await calculateChargeAmount(student, price.monthlyFee);

  let paymentIntent;

  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: Math.round(chargeAmount * 100),
        currency: 'usd',
        customer: stripeCustomerId,
        payment_method: paymentMethod.stripePaymentMethodId,
        off_session: true,
        confirm: true,
      },
      { idempotencyKey: `initial-registration-${studentId}-${scheduleId}` }
    );
  } catch (error) {
    // A hard decline (e.g. card_declined) is a synchronous throw from the
    // Stripe SDK, not a resolved PaymentIntent with a non-'succeeded'
    // status — same distinction renewal.service.js's renewOne makes. Without
    // this catch, a declined card here would surface as a 500 instead of the
    // 402 used for every other payment-failure case in this function.
    if (error.type === 'StripeCardError') {
      throw paymentFailedError(error.message);
    }

    throw error;
  }

  if (paymentIntent.status !== 'succeeded') {
    throw paymentFailedError('Payment failed');
  }

  const registration = await Registration.create({
    studentId,
    scheduleId,
    status: 'active',
  });

  const now = new Date();
  const currentPeriodEnd = addOneMonth(now);

  const subscription = await Subscription.create({
    studentId,
    scheduleId,
    parentId: requestingUser._id,
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodStart: now,
    currentPeriodEnd,
    nextBillingDate: currentPeriodEnd,
    lastChargeAmount: chargeAmount,
    lastSiblingDiscountApplied: siblingDiscountApplied,
  });

  await addStudentToRoster(schedule, studentId, todayAtMidnight());

  // Fire-and-forget confirmation email — never throws, never affects this
  // response (see mail.service.js's send-function contract). The extra
  // level/location/coach lookups for the richer email are deliberately kept
  // inside this try/catch, alongside the send itself, so a populate failure
  // here can never fail an otherwise-successful (and already-charged!)
  // registration.
  try {
    const level = await Level.findById(groupClass.levelId);
    const location = await Location.findById(groupClass.locationId);
    const coach = await User.findById(schedule.coachId);

    await mailService.sendRegistrationConfirmationEmail({
      parent: requestingUser,
      student,
      schedule,
      groupClass,
      level,
      location,
      coach,
      chargeAmount,
      monthlyFee: price.monthlyFee,
      siblingDiscountAmount,
    });
  } catch (error) {
    // eslint-disable-next-line no-console -- operational logging for a
    // fire-and-forget email side effect, not debug output.
    console.error('registration.service: failed to assemble confirmation email:', error.message);
  }

  return {
    registration,
    subscription,
    chargeAmount,
    paymentIntentStatus: paymentIntent.status,
    siblingDiscountApplied,
    siblingDiscountAmount,
  };
}

// Read-only pricing/discount estimate for the register wizard's summary —
// never creates a Registration/Subscription, never touches Stripe, and
// deliberately doesn't require a saved payment method (showing a price
// BEFORE the friction of adding a card is the point). Reuses the exact same
// calculateChargeAmount() the real charge uses, so a preview can never
// structurally disagree with what actually gets charged — the only way the
// two could differ is a real state change between preview and submit (e.g.
// a sibling's subscription changing), which is expected and correct per
// ADR 001's "re-verified every time" philosophy, not a bug.
async function previewChargeAmount({ studentId, scheduleId }, requestingUser) {
  if (!studentId || !scheduleId) {
    throw badRequestError('studentId and scheduleId are required');
  }

  const { student, schedule } = await resolveStudentForSchedule(studentId, scheduleId, requestingUser);

  const groupClass = await GroupClass.findById(schedule.classId);

  if (!groupClass) {
    throw notFoundError('Group class not found');
  }

  const price = await Price.findOne({ levelId: groupClass.levelId });

  if (!price) {
    throw notFoundError("Pricing not configured for this class's level");
  }

  const { amount: chargeAmount, siblingDiscountApplied, siblingDiscountAmount } =
    await calculateChargeAmount(student, price.monthlyFee);

  return {
    monthlyFee: price.monthlyFee,
    chargeAmount,
    siblingDiscountApplied,
    siblingDiscountAmount,
  };
}

async function listMine(parentId) {
  const children = await User.find({ role: 'student', parentId }, '_id');
  const childIds = children.map((child) => child._id);

  return Subscription.find({ studentId: { $in: childIds } })
    .populate('studentId', 'firstName lastName')
    .populate('scheduleId');
}

module.exports = { create, previewChargeAmount, listMine, addOneMonth };
