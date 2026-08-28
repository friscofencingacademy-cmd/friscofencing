const User = require('../models/user.model');
const GroupClassSchedule = require('../models/groupClassSchedule.model');
const GroupClassSession = require('../models/groupClassSession.model');
const GroupClass = require('../models/groupClass.model');
const Level = require('../models/level.model');
const Location = require('../models/location.model');
const Price = require('../models/price.model');
const { SubscriptionCycleRegistration } = require('../models/registration.model');
const Subscription = require('../models/subscription.model');
const stripe = require('../config/stripe');
const paymentMethodService = require('./paymentMethod.service');
const { ensureStripeCustomer } = require('./stripeCustomer.service');
const { calculateChargeAmount, resolveCurrentFee } = require('./billing/calculateChargeAmount.service');
const { resolveRegistrationFee } = require('./billing/registrationFee.service');
const { computeProration } = require('./billing/proration.service');
const { getServiceByCode, assertBillingShape } = require('./serviceCatalog.service');
const { todayAtMidnight, todayDateOnly } = require('../utils/billingDates');
const { addStudentToRoster } = require('./roster.service');
const { computeAvailability } = require('./groupClassSchedule.service');
const { isPremiumRegistrationEnabled } = require('../config/registrationMode');
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

// The parent's chosen start date (a real GroupClassSession's date, picked
// from the register wizard's upcoming-sessions list) — resolves proration's
// registrationDate and the Subscription's currentPeriodStart/End to the day
// the parent actually said they'd start, not the moment they happened to
// click Pay. Optional: omitting it (no other caller passes it today) falls
// back to `now`, byte-identical to this function's pre-existing behavior.
// Never trusts the client's date/schedule pairing — re-validates it against
// a real, currently-existing GroupClassSession every time.
async function resolveStartDate(scheduleId, startDate) {
  if (startDate === undefined || startDate === null || startDate === '') {
    return null;
  }

  const parsed = new Date(startDate);

  if (Number.isNaN(parsed.getTime())) {
    throw badRequestError('Invalid startDate');
  }

  if (parsed < todayAtMidnight()) {
    throw badRequestError('startDate cannot be in the past');
  }

  const session = await GroupClassSession.findOne({ scheduleId, date: parsed });

  if (!session) {
    throw badRequestError('startDate is not an upcoming session for this schedule');
  }

  return parsed;
}

// Registers `studentId` for `scheduleId`: validates permission + pricing,
// charges the parent's saved card for the first period off-session via a
// Stripe PaymentIntent, and only then creates the Registration/Subscription
// docs and mutates rosters. No 3DS/requires_action handling for MVP — a
// non-'succeeded' PaymentIntent status is treated as a failed registration
// and nothing below step 11 is created.
async function create({ studentId, scheduleId, startDate }, requestingUser) {
  const { student, schedule } = await resolveStudentForSchedule(studentId, scheduleId, requestingUser);
  const requestedStartDate = await resolveStartDate(scheduleId, startDate);

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

  // Capacity is only a real constraint in schedule-based mode, where a
  // student's home schedule is the only session they ever attend. Premium
  // students (the live default) attend any session of their level once
  // registered, so one schedule's roster filling up doesn't mean they have
  // nowhere to go — GET /group-class-schedules/public no longer advertises
  // a 'full' state for this reason either (see groupClassSchedule.service.js's
  // listPublic()).
  if (!isPremiumRegistrationEnabled() && computeAvailability(schedule, groupClass) === 'full') {
    throw conflictError('This class is full');
  }

  const price = await Price.findOne({ levelId: groupClass.levelId });

  if (!price) {
    throw notFoundError("Pricing not configured for this class's level");
  }

  // Resolved BEFORE the Stripe charge (docs/plans/service-registry-unified-
  // ledger-plan.md D4) — a misconfigured/inactive service must never let a
  // card get charged for a ledger row that can't then be written.
  const groupClassesService = await getServiceByCode('group-classes', { requireActive: true });
  assertBillingShape(groupClassesService, 'subscription_cycle');

  const paymentMethod = await paymentMethodService.getMine(requestingUser._id);

  if (!paymentMethod) {
    throw badRequestError('Add a payment method before registering');
  }

  const stripeCustomerId = await ensureStripeCustomer(requestingUser);

  // Defined here (not later, at Subscription-creation time as before) so
  // both the proration calc below and currentPeriodStart/End further down
  // use the exact same value. anchorDate is the parent's chosen start date
  // when one was given, otherwise today's Central calendar date — a
  // date-only value (same UTC-midnight-sentinel shape as requestedStartDate
  // itself, matching GroupClassSession.date's own convention), NOT the
  // exact current instant. Using todayAtMidnight() here instead would make
  // anchorDate inconsistently shaped depending on which branch ran, and
  // would resolve "today" via a raw instant rather than the intended
  // Central calendar day for an immediate registration — see
  // docs/plans/timezone-consistency-plan.md D10 for both worked out.
  const anchorDate = requestedStartDate ?? todayDateOnly();

  // Prorate the RAW list price FIRST (owner-directed sequencing, docs/plans/
  // prorated-first-month-billing-plan.md), unconditionally — every
  // registration's first charge/period is calendar-month-anchored now
  // (docs/decisions/007-calendar-month-billing.md; the old prorationEnabled
  // toggle is retired, since a full-month charge for a partial calendar
  // month would be an overcharge under calendar billing). The RESULT feeds
  // into calculateChargeAmount() below, unmodified. Sibling-discount
  // eligibility therefore compares "what this student actually owes this
  // cycle" (possibly prorated) against siblings' own current standard
  // rates, never the raw unprorated list price.
  const prorationInfo = await computeProration({
    levelId: groupClass.levelId,
    monthlyFee: price.monthlyFee,
    registrationDate: anchorDate,
  });
  const feeForDiscountCalc = prorationInfo.proratedAmount;

  const { amount: chargeAmount, siblingDiscountApplied, siblingDiscountAmount, reason: siblingDiscountReason } =
    await calculateChargeAmount(student, feeForDiscountCalc);

  // One-time fee, on top of the monthly charge above — never discounted by
  // the sibling rule (a flat enrollment fee, not recurring tuition) and
  // never prorated (it's not tied to days of access). $0 for most
  // registrations today, since no admin has configured a fee yet.
  const {
    amount: registrationFeeCharged,
    waived: registrationFeeWaived,
    reason: registrationFeeReason,
  } = await resolveRegistrationFee(studentId);

  const totalChargeAmount = chargeAmount + registrationFeeCharged;

  let paymentIntent;

  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: Math.round(totalChargeAmount * 100),
        currency: 'usd',
        customer: stripeCustomerId,
        payment_method: paymentMethod.stripePaymentMethodId,
        off_session: true,
        confirm: true,
      },
      // Keyed on anchorDate (not just studentId+scheduleId) — a retry that
      // resolves to a genuinely different start date (e.g. the parent's
      // first-picked date is no longer valid and they pick another) must be
      // treated as a new attempt, not collide with an unrelated one.
      { idempotencyKey: `initial-registration-${studentId}-${scheduleId}-${anchorDate.toISOString().slice(0, 10)}` }
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

  // Always the calendar-month boundary (ADR 007) — computeProration() is
  // the single source of this period math too, not just the amount (see
  // its own docblock), so this can never structurally disagree with what
  // it returned. Anchors off anchorDate (the parent's chosen start date),
  // not the moment they paid.
  const currentPeriodEnd = prorationInfo.periodEnd;

  // Subscription created BEFORE the Registration ledger row (reverse of this
  // function's pre-ledger order) so Guard A's unique index — the DB-level
  // backstop behind the existingSubscription pre-check above — is the very
  // next write after a real, already-succeeded Stripe charge. See the catch
  // below for what happens when this write loses that race.
  let subscription;

  try {
    subscription = await Subscription.create({
      studentId,
      scheduleId,
      parentId: requestingUser._id,
      status: 'active',
      cancelAtPeriodEnd: false,
      currentPeriodStart: anchorDate,
      currentPeriodEnd,
      nextBillingDate: currentPeriodEnd,
      lastChargeAmount: chargeAmount,
      lastSiblingDiscountApplied: siblingDiscountApplied,
      isPremium: isPremiumRegistrationEnabled(),
      registrationFeeCharged,
      firstChargeProrated: prorationInfo.prorated,
    });
  } catch (error) {
    // Guard A's partial unique index (subscription.model.js) caught a race
    // the pre-check above couldn't: two near-simultaneous requests for the
    // same student+schedule. The parent's card was already charged ONCE —
    // the Stripe idempotency key on the PaymentIntent above means a racing
    // duplicate request shares that same charge, it never charges twice —
    // but this request loses the race to create the Subscription doc. No
    // Registration ledger row is written for the loser; the winning request
    // already wrote the one true ledger row for this charge.
    if (error.code === 11000) {
      throw conflictError('This student is already registered for this schedule');
    }

    throw error;
  }

  const registration = await SubscriptionCycleRegistration.create({
    serviceId: groupClassesService._id,
    subscriptionId: subscription._id,
    studentId,
    scheduleId,
    parentId: requestingUser._id,
    eventType: 'initial',
    status: 'completed',
    amount: totalChargeAmount,
    breakdown: {
      monthlyFee: price.monthlyFee,
      prorated: prorationInfo.prorated,
      proratedAmount: prorationInfo.prorated ? prorationInfo.proratedAmount : null,
      siblingDiscountApplied,
      siblingDiscountAmount,
      registrationFeeCharged,
    },
    periodStart: anchorDate,
    periodEnd: currentPeriodEnd,
    stripePaymentIntentId: paymentIntent.id,
    paidAt: new Date(),
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
      chargeAmount: totalChargeAmount,
      monthlyFee: price.monthlyFee,
      siblingDiscountAmount,
      registrationFeeCharged,
      prorated: prorationInfo.prorated,
      totalClassDays: prorationInfo.totalClassDays,
      remainingClassDays: prorationInfo.remainingClassDays,
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
    totalChargeAmount,
    paymentIntentStatus: paymentIntent.status,
    siblingDiscountApplied,
    siblingDiscountAmount,
    siblingDiscountReason,
    registrationFeeCharged,
    registrationFeeWaived,
    registrationFeeReason,
    prorated: prorationInfo.prorated,
    totalClassDays: prorationInfo.totalClassDays,
    remainingClassDays: prorationInfo.remainingClassDays,
    dailyRate: prorationInfo.dailyRate,
    periodEnd: currentPeriodEnd,
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
async function previewChargeAmount({ studentId, scheduleId, startDate }, requestingUser) {
  if (!studentId || !scheduleId) {
    throw badRequestError('studentId and scheduleId are required');
  }

  const { student, schedule } = await resolveStudentForSchedule(studentId, scheduleId, requestingUser);
  const requestedStartDate = await resolveStartDate(scheduleId, startDate);

  const groupClass = await GroupClass.findById(schedule.classId);

  if (!groupClass) {
    throw notFoundError('Group class not found');
  }

  const price = await Price.findOne({ levelId: groupClass.levelId });

  if (!price) {
    throw notFoundError("Pricing not configured for this class's level");
  }

  // Same anchorDate resolution as create() — see its comment (and
  // docs/plans/timezone-consistency-plan.md D10) for why this is
  // todayDateOnly(), not `new Date()`.
  const anchorDate = requestedStartDate ?? todayDateOnly();

  // Mirrors create() exactly (docs/plans/prorated-first-month-billing-plan
  // .md, D3; unconditional per docs/decisions/007-calendar-month-billing.md)
  // — same function, same sequencing, same anchorDate role — so this
  // preview can never structurally disagree with the real charge.
  const prorationInfo = await computeProration({
    levelId: groupClass.levelId,
    monthlyFee: price.monthlyFee,
    registrationDate: anchorDate,
  });
  const feeForDiscountCalc = prorationInfo.proratedAmount;

  const { amount: chargeAmount, siblingDiscountApplied, siblingDiscountAmount, reason: siblingDiscountReason } =
    await calculateChargeAmount(student, feeForDiscountCalc);

  const {
    amount: registrationFeeCharged,
    waived: registrationFeeWaived,
    reason: registrationFeeReason,
  } = await resolveRegistrationFee(studentId);

  return {
    monthlyFee: price.monthlyFee,
    chargeAmount,
    totalChargeAmount: chargeAmount + registrationFeeCharged,
    siblingDiscountApplied,
    siblingDiscountAmount,
    siblingDiscountReason,
    registrationFeeCharged,
    registrationFeeWaived,
    registrationFeeReason,
    prorated: prorationInfo.prorated,
    totalClassDays: prorationInfo.totalClassDays,
    remainingClassDays: prorationInfo.remainingClassDays,
    dailyRate: prorationInfo.dailyRate,
    periodEnd: prorationInfo.periodEnd,
  };
}

// Enriches every ACTIVE subscription with a LIVE current-discount snapshot —
// the same calculateChargeAmount() the actual charge (create()) and the
// pre-registration preview (previewChargeAmount()) use, called fresh here
// too rather than reading back lastChargeAmount/lastSiblingDiscountApplied
// (a record of what happened at that subscription's own last charge, which
// goes stale the moment a sibling's situation changes and is never
// retroactively corrected — see registration.service.js's module doc and
// ADR 001's "re-verified every time" principle). This mirrors CKQ's
// calculateUpcomingPayment()->upcoming-payments-preview pattern: one
// function is the source of truth for both what a subscriber WILL be
// charged and what the list page DISPLAYS, so the two can never disagree.
// `currentCharge` is display-only, additive, and never written back to the
// Subscription document — the real charge is still computed independently,
// live, at actual renewal time.
async function listMine(parentId) {
  const children = await User.find({ role: 'student', parentId }, '_id');
  const childIds = children.map((child) => child._id);

  const subscriptions = await Subscription.find({ studentId: { $in: childIds } })
    .populate('studentId', 'firstName lastName')
    .populate('scheduleId')
    .lean();

  return Promise.all(
    subscriptions.map(async (subscription) => {
      if (subscription.status !== 'active' || !subscription.scheduleId) {
        return subscription;
      }

      const currentFee = await resolveCurrentFee({ scheduleId: subscription.scheduleId._id });

      if (currentFee === null) {
        return subscription;
      }

      const student = { _id: subscription.studentId._id, parentId };
      const { amount, siblingDiscountApplied, siblingDiscountAmount, reason } =
        await calculateChargeAmount(student, currentFee);

      return {
        ...subscription,
        currentCharge: { amount, siblingDiscountApplied, siblingDiscountAmount, reason },
      };
    })
  );
}

module.exports = { create, previewChargeAmount, listMine };
