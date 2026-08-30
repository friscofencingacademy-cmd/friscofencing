const User = require('../models/user.model');
const GroupClassSchedule = require('../models/groupClassSchedule.model');
const GroupClassSession = require('../models/groupClassSession.model');
const GroupClass = require('../models/groupClass.model');
const Level = require('../models/level.model');
const Location = require('../models/location.model');
const Price = require('../models/price.model');
const Registration = require('../models/registration.model');
const { SubscriptionCycleRegistration } = require('../models/registration.model');
const Subscription = require('../models/subscription.model');
const paymentMethodService = require('./paymentMethod.service');
const { ensureStripeCustomer } = require('./stripeCustomer.service');
const { calculateChargeAmount, resolveCurrentFee } = require('./billing/calculateChargeAmount.service');
const { resolveRegistrationFee } = require('./billing/registrationFee.service');
const { computeProration } = require('./billing/proration.service');
const { chargeAndFinalize } = require('./billing/chargeFinalization.service');
const { getServiceByCode, assertBillingShape } = require('./serviceCatalog.service');
const { todayDateOnly } = require('../utils/billingDates');
const { dateOnlyUTC } = require('../utils/dateShapes');
const { addStudentToRoster } = require('./roster.service');
const { computeAvailability } = require('./groupClassSchedule.service');
const { isPremiumRegistrationEnabled } = require('../config/registrationMode');
const mailService = require('./mail.service');
const invoiceService = require('./invoice.service');

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
//
// `GroupClassSession.date` is a calendar-day sentinel, not a real instant
// (docs/plans/utc-date-standard-plan.md) — the client-supplied ISO string is
// normalized through dateOnlyUTC() BEFORE the past-check and the exact-match
// lookup, so a stale/old-shape echo (e.g. a still-cached pre-migration
// instant) still resolves to the correct sentinel rather than silently
// missing the match or comparing an instant against a sentinel.
async function resolveStartDate(scheduleId, startDate) {
  if (startDate === undefined || startDate === null || startDate === '') {
    return null;
  }

  const raw = new Date(startDate);

  if (Number.isNaN(raw.getTime())) {
    throw badRequestError('Invalid startDate');
  }

  const parsed = dateOnlyUTC(raw);

  if (parsed < todayDateOnly()) {
    throw badRequestError('startDate cannot be in the past');
  }

  const session = await GroupClassSession.findOne({ scheduleId, date: parsed });

  if (!session) {
    throw badRequestError('startDate is not an upcoming session for this schedule');
  }

  return parsed;
}

// Registers `studentId` for `scheduleId`: validates permission + pricing,
// then RESERVES the Subscription (docs/decisions/008-registration-create-
// pending-first.md) before ever calling Stripe — Guard A's unique index
// (subscription.model.js, docs/decisions/005-one-active-subscription-per-
// student.md) fires atomically right there, so a racing duplicate request
// for the same student (any schedule) never reaches Stripe at all. Only
// then is a `pending` ledger row created and charged via the same shared
// chargeFinalization module renewals use. A failed first charge is NOT
// rejected outright — it enters the identical retry/dunning cycle a failed
// renewal already goes through (runRetries/retryOne/cancelAfterExhaustion,
// unchanged), and no roster access is granted until a charge actually
// succeeds.
async function create({ studentId, scheduleId, startDate }, requestingUser) {
  const { student, schedule } = await resolveStudentForSchedule(studentId, scheduleId, requestingUser);
  const requestedStartDate = await resolveStartDate(scheduleId, startDate);

  // Not scoped to this scheduleId — a student may hold at most ONE active
  // group-class subscription at all, on any schedule (docs/decisions/005-
  // one-active-subscription-per-student.md). This friendly 409 is the UX
  // layer in front of Guard A's DB-level backstop below, which is what
  // actually closes the TOCTOU race between this check and the write.
  const existingSubscription = await Subscription.findOne({
    studentId,
    status: 'active',
  });

  if (existingSubscription) {
    throw conflictError('This student already has an active class registration');
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

  // Resolved BEFORE any write (docs/plans/service-registry-unified-ledger-
  // plan.md D4) — a misconfigured/inactive service must never let a
  // reservation happen for a ledger row that can't then be written.
  const groupClassesService = await getServiceByCode('group-classes', { requireActive: true });
  assertBillingShape(groupClassesService, 'subscription_cycle');

  const paymentMethod = await paymentMethodService.getMine(requestingUser._id);

  if (!paymentMethod) {
    throw badRequestError('Add a payment method before registering');
  }

  const stripeCustomerId = await ensureStripeCustomer(requestingUser);

  // anchorDate is the parent's chosen start date when one was given,
  // otherwise today's Central calendar date — a date-only value (same
  // UTC-midnight-sentinel shape as requestedStartDate itself, matching
  // GroupClassSession.date's own convention), NOT the exact current
  // instant. See docs/plans/timezone-consistency-plan.md D10.
  const anchorDate = requestedStartDate ?? todayDateOnly();

  // Prorate the RAW list price FIRST (owner-directed sequencing, docs/plans/
  // prorated-first-month-billing-plan.md), unconditionally — every
  // registration's first charge/period is calendar-month-anchored now
  // (docs/decisions/007-calendar-month-billing.md). The RESULT feeds into
  // calculateChargeAmount() below, unmodified. Sibling-discount eligibility
  // therefore compares "what this student actually owes this cycle"
  // (possibly prorated) against siblings' own current standard rates, never
  // the raw unprorated list price.
  const prorationInfo = await computeProration({
    levelId: groupClass.levelId,
    monthlyFee: price.monthlyFee,
    registrationDate: anchorDate,
  });
  const feeForDiscountCalc = prorationInfo.proratedAmount;

  const { amount: chargeAmount, siblingDiscountApplied, siblingDiscountAmount, reason: siblingDiscountReason } =
    await calculateChargeAmount(student, feeForDiscountCalc, { mode: 'registration' });

  // One-time fee, on top of the monthly charge above — never discounted by
  // the sibling rule (a flat enrollment fee, not recurring tuition) and
  // never prorated (it's not tied to days of access). $0 for most
  // registrations today, since no admin has configured a fee yet.
  const {
    amount: registrationFeeCharged,
    waived: registrationFeeWaived,
    reason: registrationFeeReason,
    standardAmount: registrationFeeStandardAmount,
  } = await resolveRegistrationFee(studentId, groupClass.levelId);

  const totalChargeAmount = chargeAmount + registrationFeeCharged;

  // Always the calendar-month boundary (ADR 007) — computeProration() is
  // the single source of this period math too, not just the amount (see
  // its own docblock), so this can never structurally disagree with what
  // it returned. Anchors off anchorDate (the parent's chosen start date),
  // not the moment they paid — these fields don't depend on whether the
  // charge below succeeds.
  const currentPeriodEnd = prorationInfo.periodEnd;

  // RESERVE the Subscription BEFORE any Stripe call — this is the actual
  // hard block (docs/decisions/008-registration-create-pending-first.md):
  // Guard A's partial unique index rejects a duplicate for ANY schedule
  // combination right here, so a racing request never gets far enough to
  // charge a card that would otherwise have nothing to attach to.
  // lastChargeAmount stays null until a charge actually succeeds — the
  // correct "never successfully charged yet" signal distinct from a
  // renewal's dunning (where it reflects the last SUCCESSFUL period).
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
      lastChargeAmount: null,
      lastSiblingDiscountApplied: false,
      isPremium: isPremiumRegistrationEnabled(),
      registrationFeeCharged,
      firstChargeProrated: prorationInfo.prorated,
    });
  } catch (error) {
    if (error.code === 11000) {
      throw conflictError('This student already has an active class registration');
    }

    throw error;
  }

  // Pending ledger row BEFORE charging — the same shape renewOne() already
  // creates for a renewal's pending row (registration-ledger plan D4).
  const registration = await SubscriptionCycleRegistration.create({
    serviceId: groupClassesService._id,
    subscriptionId: subscription._id,
    studentId,
    scheduleId,
    parentId: requestingUser._id,
    eventType: 'initial',
    status: 'pending',
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
  });

  const result = await chargeAndFinalize({
    row: registration,
    subscription,
    paymentMethod,
    stripeCustomerId,
    // The recurring monthly-only amount, NOT totalChargeAmount — the
    // ledger row's own `amount` includes the one-time registration fee for
    // an 'initial' row (registration.model.js's breakdown doc), but
    // Subscription.lastChargeAmount must stay fee-free (see
    // chargeFinalization.service.js's finalizeSuccessfulCharge comment).
    chargeAmount,
    siblingDiscountApplied,
    attemptNumber: 1,
  });

  // chargeAndFinalize() updated both documents in the DB via their own
  // findByIdAndUpdate calls — it does NOT mutate these in-memory Mongoose
  // objects. Re-fetch so the response (and every field read below) reflects
  // the real, current state (status/stripePaymentIntentId/paidAt on the
  // ledger row; retryCount/nextRetryAt/lastChargeAmount on the
  // subscription) rather than what they looked like before charging.
  const [updatedRegistration, updatedSubscription] = await Promise.all([
    SubscriptionCycleRegistration.findById(registration._id),
    Subscription.findById(subscription._id),
  ]);

  if (result.outcome === 'charged') {
    // A calendar-day sentinel, matching GroupClassSession.date's own shape
    // (docs/plans/utc-date-standard-plan.md bug 5) — addStudentToRoster's
    // `today` param filters session dates via $gte, so it must be a
    // sentinel, never todayAtMidnight()'s real-instant shape (which would
    // silently exclude a session dated exactly today from the new Visits
    // this creates).
    await addStudentToRoster(schedule, studentId, todayDateOnly());

    // Fire-and-forget confirmation email — never throws, never affects this
    // response (see mail.service.js's send-function contract). The extra
    // level/location/coach lookups for the richer email are deliberately
    // kept inside this try/catch, alongside the send itself, so a populate
    // failure here can never fail an otherwise-successful (and
    // already-charged!) registration.
    try {
      const level = await Level.findById(groupClass.levelId);
      const location = await Location.findById(groupClass.locationId);
      const coach = await User.findById(schedule.coachId);

      // PDF invoice attachment (docs/plans/manual-charge-and-pdf-invoice-
      // plan.md PR 2) — its OWN try/catch so a generation failure drops only
      // the attachment, never the confirmation email itself (invoiceNumber/
      // invoicePdf stay undefined, which sendRegistrationConfirmationEmail's
      // invoiceAttachment() helper already treats as "no attachment").
      let invoiceNumber;
      let invoicePdf;

      try {
        const invoiceData = await invoiceService.buildInvoiceData(updatedRegistration);
        invoiceNumber = invoiceData.invoiceNumber;
        invoicePdf = await invoiceService.renderInvoicePdf(invoiceData);
      } catch (invoiceError) {
        // eslint-disable-next-line no-console -- operational logging for a
        // fire-and-forget PDF-generation side effect, not debug output.
        console.error('registration.service: failed to generate invoice PDF:', invoiceError.message);
      }

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
        invoiceNumber,
        invoicePdf,
      });
    } catch (error) {
      // eslint-disable-next-line no-console -- operational logging for a
      // fire-and-forget email side effect, not debug output.
      console.error('registration.service: failed to assemble confirmation email:', error.message);
    }
  } else {
    // Failed first charge — accepted, not rejected. No roster access is
    // granted; runRetries()/retryOne() (unchanged) pick this subscription
    // up daily exactly like a renewal's dunning, and cancelAfterExhaustion
    // cancels it if all attempts fail.
    try {
      await mailService.sendPaymentFailureEmail({
        parent: requestingUser,
        student,
        schedule,
        groupClass,
        amountDue: totalChargeAmount,
        attemptNumber: 1,
        isFinal: false,
        nextRetryDate: result.nextRetryAt,
      });
    } catch (error) {
      // eslint-disable-next-line no-console -- operational logging for a
      // fire-and-forget email side effect, not debug output.
      console.error('registration.service: failed to assemble payment-failure email:', error.message);
    }
  }

  // Same display-only breakdown previewChargeAmount() returns (Family
  // Scorecard checkout quote panel, docs/plans/wordpress-ui-alignment-plan
  // .md, Phase 3), computed identically here so the post-payment
  // confirmation screen can show the same "you saved $X" line the preview
  // did — never affects chargeAmount/totalChargeAmount/what Stripe charges.
  const registrationFeeWaivedSavings = registrationFeeWaived ? registrationFeeStandardAmount : 0;
  const savings = {
    siblingDiscount: siblingDiscountAmount,
    registrationFeeWaived: registrationFeeWaivedSavings,
    total: siblingDiscountAmount + registrationFeeWaivedSavings,
  };

  return {
    registration: updatedRegistration,
    subscription: updatedSubscription,
    chargeAmount,
    totalChargeAmount,
    // 'completed' | 'pending' (docs/decisions/008-registration-create-
    // pending-first.md D3d) — a 201 no longer means "your card was
    // charged" unconditionally; the frontend must branch on this field.
    paymentStatus: result.outcome === 'charged' ? 'completed' : 'pending',
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
    savings,
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
    await calculateChargeAmount(student, feeForDiscountCalc, { mode: 'registration' });

  const {
    amount: registrationFeeCharged,
    waived: registrationFeeWaived,
    reason: registrationFeeReason,
    standardAmount: registrationFeeStandardAmount,
  } = await resolveRegistrationFee(studentId, groupClass.levelId);

  // Display-only breakdown for the Family Scorecard checkout quote panel
  // (docs/plans/wordpress-ui-alignment-plan.md, Phase 3) — computed HERE,
  // server-side, so the frontend never does this arithmetic itself (Hard
  // Rule 7). Does not affect chargeAmount/totalChargeAmount or anything
  // create() does; preview-only. registrationFeeWaived's dollar value isn't
  // otherwise in this response — registrationFeeCharged is 0 when waived.
  const registrationFeeWaivedSavings = registrationFeeWaived ? registrationFeeStandardAmount : 0;
  const savings = {
    siblingDiscount: siblingDiscountAmount,
    registrationFeeWaived: registrationFeeWaivedSavings,
    total: siblingDiscountAmount + registrationFeeWaivedSavings,
  };

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
    savings,
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
      // 'renewal' mode — this displays what the NEXT renewal will charge
      // (docs/decisions/006-sibling-discount-family-rule.md's top-payer-
      // excluded rule), using this subscription's own createdAt for the
      // tiebreak if it's tied with a sibling at the family's top fee.
      const { amount, siblingDiscountApplied, siblingDiscountAmount, reason } =
        await calculateChargeAmount(student, currentFee, { mode: 'renewal', subscription });

      return {
        ...subscription,
        currentCharge: { amount, siblingDiscountApplied, siblingDiscountAmount, reason },
      };
    })
  );
}

// Download endpoint backing (docs/plans/manual-charge-and-pdf-invoice-plan
// .md PR 2, §2.4) — admin/superadmin may fetch any row; a parent only a row
// whose parentId matches their own (mirrors subscription.service.js's
// isOwningParent pattern exactly); any other role never reaches this
// service function at all (route-level requireRole already excludes them).
// Regenerated on demand every call (D8 — no PDF storage); a `completed` row
// always renders the same PDF, so this is safe to call repeatedly.
async function getInvoice(registrationId, requestingUser) {
  const row = await Registration.findById(registrationId);

  if (!row) {
    throw notFoundError('Registration not found');
  }

  const isAdmin = requestingUser.role === 'admin' || requestingUser.role === 'superadmin';
  const isOwningParent =
    requestingUser.role === 'parent' && String(row.parentId) === String(requestingUser._id);

  if (!isAdmin && !isOwningParent) {
    throw forbiddenError('This invoice does not belong to you');
  }

  // buildInvoiceData itself throws a 409 for a non-'completed' row — no
  // duplicate check needed here.
  const invoiceData = await invoiceService.buildInvoiceData(row);
  const pdf = await invoiceService.renderInvoicePdf(invoiceData);

  return { pdf, invoiceNumber: invoiceData.invoiceNumber };
}

module.exports = { create, previewChargeAmount, listMine, getInvoice };
