const User = require('../models/user.model');
const GroupClassSchedule = require('../models/groupClassSchedule.model');
const GroupClassSession = require('../models/groupClassSession.model');
const GroupClass = require('../models/groupClass.model');
const Price = require('../models/price.model');
const Registration = require('../models/registration.model');
const Subscription = require('../models/subscription.model');
const stripe = require('../config/stripe');
const paymentMethodService = require('./paymentMethod.service');
const { ensureStripeCustomer } = require('./stripeCustomer.service');
const { calculateChargeAmount } = require('./billing/calculateChargeAmount.service');

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

// Same calendar month a month later, e.g. Jan 31 -> Mar 3 in a
// non-leap-year (JS Date's own setMonth rollover behavior) — acceptable for
// MVP; no custom day-clamping logic.
function addOneMonth(date) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + 1);
  return result;
}

function todayAtMidnight() {
  const result = new Date();
  result.setHours(0, 0, 0, 0);
  return result;
}

// Registers `studentId` for `scheduleId`: validates permission + pricing,
// charges the parent's saved card for the first period off-session via a
// Stripe PaymentIntent, and only then creates the Registration/Subscription
// docs and mutates rosters. No 3DS/requires_action handling for MVP — a
// non-'succeeded' PaymentIntent status is treated as a failed registration
// and nothing below step 11 is created.
async function create({ studentId, scheduleId }, requestingUser) {
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

  const price = await Price.findOne({ levelId: groupClass.levelId });

  if (!price) {
    throw notFoundError("Pricing not configured for this class's level");
  }

  const paymentMethod = await paymentMethodService.getMine(requestingUser._id);

  if (!paymentMethod) {
    throw badRequestError('Add a payment method before registering');
  }

  const stripeCustomerId = await ensureStripeCustomer(requestingUser);

  const chargeAmount = calculateChargeAmount(student, price.monthlyFee);

  const paymentIntent = await stripe.paymentIntents.create(
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
  });

  const alreadyOnRoster = schedule.students.some(
    (id) => String(id) === String(studentId)
  );

  if (!alreadyOnRoster) {
    schedule.students.push(studentId);
    await schedule.save();
  }

  const futureSessions = await GroupClassSession.find({
    scheduleId,
    date: { $gte: todayAtMidnight() },
  });

  await Promise.all(
    futureSessions.map((session) => {
      const onSessionRoster = session.students.some(
        (entry) => String(entry.studentId) === String(studentId)
      );

      if (onSessionRoster) {
        return null;
      }

      session.students.push({ studentId, isPresent: false });
      return session.save();
    })
  );

  return {
    registration,
    subscription,
    chargeAmount,
    paymentIntentStatus: paymentIntent.status,
  };
}

async function listMine(parentId) {
  const children = await User.find({ role: 'student', parentId }, '_id');
  const childIds = children.map((child) => child._id);

  return Subscription.find({ studentId: { $in: childIds } })
    .populate('studentId', 'firstName lastName')
    .populate('scheduleId');
}

module.exports = { create, listMine, addOneMonth };
