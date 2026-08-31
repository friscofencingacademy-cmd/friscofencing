const Subscription = require('../models/subscription.model');
const User = require('../models/user.model');
const GroupClassSchedule = require('../models/groupClassSchedule.model');
const GroupClass = require('../models/groupClass.model');
const Price = require('../models/price.model');
const { SubscriptionCycleRegistration, periodMonthOf } = require('../models/registration.model');
const { monthLabel: formatMonthLabel } = require('../email/dates');
const stripe = require('../config/stripe');
const paymentMethodService = require('./paymentMethod.service');
const { ensureStripeCustomer } = require('./stripeCustomer.service');
const { calculateChargeAmount } = require('./billing/calculateChargeAmount.service');
const { computeProration } = require('./billing/proration.service');
const {
  chargeAndFinalize,
  finalizeSuccessfulCharge,
  advanceSubscriptionPeriod,
} = require('./billing/chargeFinalization.service');
const { getServiceByCode, assertBillingShape } = require('./serviceCatalog.service');
const { addOneMonth, firstOfNextMonth, todayAtMidnight, todayDateOnly } = require('../utils/billingDates');
const { MAX_PAYMENT_RETRIES } = require('../config/billing');
const { removeStudentFromRoster } = require('./roster.service');
const mailService = require('./mail.service');
const invoiceService = require('./invoice.service');

// Resolves a subscription's schedule -> class -> level -> Price chain, the
// same walk registration.service.js does for the initial charge. Returns
// null if any link is missing (deleted schedule/class, or no Price
// configured for the level) so the caller can fail this one subscription
// without crashing the whole run.
async function resolveMonthlyFee(subscription) {
  const schedule = await GroupClassSchedule.findById(subscription.scheduleId);

  if (!schedule) {
    return null;
  }

  const groupClass = await GroupClass.findById(schedule.classId);

  if (!groupClass) {
    return null;
  }

  const price = await Price.findOne({ levelId: groupClass.levelId });

  if (!price) {
    return null;
  }

  return price.monthlyFee;
}

// Resolves a subscription's schedule -> class -> LEVEL chain, mirroring
// resolveMonthlyFee's exact same walk — used by the admin Charge dialog's
// "prorated from today" preview/charge (docs/plans/payment-airtight-plan.md
// D4), which needs computeProration()'s own levelId param. Kept as a
// separate function rather than changing resolveMonthlyFee's return shape,
// to avoid touching that already-tested function's contract. null on any
// broken link, same discipline.
async function resolveLevelId(subscription) {
  const schedule = await GroupClassSchedule.findById(subscription.scheduleId);

  if (!schedule) {
    return null;
  }

  const groupClass = await GroupClass.findById(schedule.classId);

  if (!groupClass) {
    return null;
  }

  return groupClass.levelId;
}

// Shared by every charge pathway that writes a subscription_cycle ledger
// row (renewOne, chargeProratedNow, recordManualPayment) — the ledger-level
// half of "one payment per subscription per calendar month" (Guard B,
// docs/plans/payment-airtight-plan.md D7). Finds any pending/completed row
// already targeting `periodMonthValue`, regardless of which day within
// that month its own periodStart happens to be. This pre-check exists so
// each caller can return a friendly outcome instead of a raw duplicate-key
// error — the schema's own unique index on (subscriptionId, periodMonth)
// is the actual, race-proof backstop, not a substitute for it.
async function findExistingRowForMonth(subscriptionId, periodMonthValue) {
  return SubscriptionCycleRegistration.findOne({
    subscriptionId,
    periodMonth: periodMonthValue,
    status: { $in: ['pending', 'completed'] },
  });
}

// Fire-and-forget receipt email — never throws, never affects the outcome
// (mail.service.js's send-function contract). Populate failures are
// deliberately kept inside this try/catch, alongside the send itself, so a
// lookup failure here can never undo an already-successful (and
// already-charged!) renewal.
// `siblingDiscountAmount` is the ACTUAL rounded amount calculateChargeAmount
// returned, threaded through the ledger row's own breakdown — never
// recomputed here as monthlyFee * 0.1 (the old F4 bug: could disagree with
// the real, rounded, possibly-tiebroken discount actually applied).
// `monthlyFee` falls back to 0 for display only if the level's Price was
// deleted between runs (resolveMonthlyFee returning null) — the real
// charged amount is unaffected either way, this only guards the email
// template against a null producing "$NaN".
//
// `registrationId` (docs/plans/manual-charge-and-pdf-invoice-plan.md PR 2)
// is the ledger row's OWN id, not the (possibly stale, still-'pending'-in-
// memory) `row` object every caller already holds — finalizeSuccessfulCharge/
// chargeAndFinalize update the DB row via findByIdAndUpdate without mutating
// the in-memory doc, so re-fetching by id here (inside buildInvoiceData) is
// what actually sees the just-written 'completed' status.
// `paymentMethodLabel` (docs/plans/payment-airtight-plan.md D9) defaults to
// the card-charge line every existing call site still means — only
// recordManualPayment passes a different one.
async function sendReceiptEmail(
  subscription,
  parent,
  student,
  chargeAmount,
  siblingDiscountAmount,
  monthlyFee,
  newPeriodStart,
  registrationId,
  paymentMethodLabel = 'Charged to your saved card.'
) {
  try {
    const schedule = await GroupClassSchedule.findById(subscription.scheduleId);
    const groupClass = schedule ? await GroupClass.findById(schedule.classId) : null;

    // PDF invoice attachment — its OWN try/catch so a generation failure
    // drops only the attachment, never the receipt email itself (same
    // containment pattern as registration.service.js's confirmation email).
    let invoiceNumber;
    let invoicePdf;

    try {
      const invoiceData = await invoiceService.buildInvoiceData(registrationId);
      invoiceNumber = invoiceData.invoiceNumber;
      invoicePdf = await invoiceService.renderInvoicePdf(invoiceData);
    } catch (invoiceError) {
      // eslint-disable-next-line no-console -- operational logging for a
      // fire-and-forget PDF-generation side effect, not debug output.
      console.error('renewal.service: failed to generate invoice PDF:', invoiceError.message);
    }

    await mailService.sendRenewalReceiptEmail({
      parent,
      student,
      schedule,
      groupClass,
      monthLabel: formatMonthLabel(newPeriodStart),
      chargeAmount,
      monthlyFee: monthlyFee ?? 0,
      siblingDiscountAmount: siblingDiscountAmount || 0,
      paymentMethodLabel,
      invoiceNumber,
      invoicePdf,
    });
  } catch (error) {
    // eslint-disable-next-line no-console -- operational logging for a
    // fire-and-forget email side effect, not debug output.
    console.error('renewal.service: failed to assemble receipt email:', error.message);
  }
}

// Day-0 payment-failure email — same fire-and-forget contract as the
// receipt email above.
async function sendFailureEmail(subscription, parent, student, amountDue, nextRetryDate, attemptNumber, isFinal) {
  try {
    const schedule = await GroupClassSchedule.findById(subscription.scheduleId);
    const groupClass = schedule ? await GroupClass.findById(schedule.classId) : null;

    await mailService.sendPaymentFailureEmail({
      parent,
      student,
      schedule,
      groupClass,
      amountDue,
      attemptNumber,
      isFinal,
      nextRetryDate,
    });
  } catch (error) {
    // eslint-disable-next-line no-console -- operational logging for a
    // fire-and-forget email side effect, not debug output.
    console.error('renewal.service: failed to assemble payment-failure email:', error.message);
  }
}

// Charges `row` via the shared chargeFinalization module (docs/decisions/
// 008-registration-create-pending-first.md — the same charge/ledger/period
// mechanics registration.service.js's create() now uses for the initial
// charge), then sends the RENEWAL-specific email for whichever outcome
// resulted. Kept as its own function so every renewal call site (fresh
// charge, retry, stale-pending re-drive) sends its email the same way.
async function chargeAndEmail({
  row,
  subscription,
  student,
  parent,
  paymentMethod,
  stripeCustomerId,
  monthlyFee,
  siblingDiscountApplied,
  siblingDiscountAmount,
  attemptNumber = 1,
}) {
  const result = await chargeAndFinalize({
    row,
    subscription,
    paymentMethod,
    stripeCustomerId,
    siblingDiscountApplied,
    attemptNumber,
  });

  if (result.outcome === 'charged') {
    await sendReceiptEmail(subscription, parent, student, result.chargeAmount, siblingDiscountAmount, monthlyFee, row.periodStart, row._id);
  } else {
    // Never the final email here — exhaustion (retryCount >= MAX) is checked
    // at the START of the NEXT retryOne call, not inline with the failure
    // that pushed retryCount up to MAX. This attempt's own failure is
    // always a Day-N "we'll retry again" notice.
    await sendFailureEmail(subscription, parent, student, row.amount, result.nextRetryAt, result.attemptNumber, false);
  }

  return result;
}

// Stale-pending recovery — a `pending` row means a previous run died
// between insert and charge-resolution. Search Stripe for a PaymentIntent
// carrying this row's id in its metadata BEFORE ever charging again:
//   - a succeeded PI found -> adopt it (row completed, period rolled,
//     retry state reset) — NO new charge.
//   - none found, or only a terminal-failed one -> re-drive the charge
//     under the SAME idempotency key via chargeAndEmail.
async function recoverStalePending({ row, subscription, student, parent, paymentMethod, stripeCustomerId, monthlyFee }) {
  const searchResult = await stripe.paymentIntents.search({
    query: `metadata['registrationId']:'${row._id}'`,
  });

  const succeededPI = searchResult.data.find((pi) => pi.status === 'succeeded');

  if (succeededPI) {
    const result = await finalizeSuccessfulCharge({
      row,
      subscription,
      paymentIntentId: succeededPI.id,
      siblingDiscountApplied: row.breakdown.siblingDiscountApplied,
    });

    await sendReceiptEmail(subscription, parent, student, result.chargeAmount, row.breakdown.siblingDiscountAmount, monthlyFee, row.periodStart, row._id);

    return result;
  }

  return chargeAndEmail({
    row,
    subscription,
    student,
    parent,
    paymentMethod,
    stripeCustomerId,
    monthlyFee,
    siblingDiscountApplied: row.breakdown.siblingDiscountApplied,
    siblingDiscountAmount: row.breakdown.siblingDiscountAmount,
  });
}

// Read-only preview for the superadmin-only manual Charge button
// (docs/plans/manual-charge-and-pdf-invoice-plan.md D1) — NEVER writes
// anything, never calls Stripe. Computes the exact same numbers renewOne/
// retryOne would actually charge, via the SAME functions (resolveMonthlyFee
// + calculateChargeAmount, or the locked failed-row amount in dunning) so
// this can never structurally disagree with the real charge (the standing
// preview rule, docs/decisions/001-in-house-subscription-billing.md's
// 2026-08-23 addendum, applied to this new read path too).
async function previewRenewal(subscriptionId) {
  const subscription = await Subscription.findById(subscriptionId);

  if (!subscription) {
    return { outcome: 'not_found' };
  }

  if (subscription.status !== 'active') {
    return { outcome: 'inactive' };
  }

  const today = todayAtMidnight();
  const due = subscription.nextBillingDate <= today;
  const willFinalizeCancellation = subscription.cancelAtPeriodEnd === true && due;

  const paymentMethod = await paymentMethodService.getMine(subscription.parentId);
  const paymentMethodSummary = paymentMethod
    ? { cardBrand: paymentMethod.cardBrand, cardLast4: paymentMethod.cardLast4 }
    : null;

  const periodStart = subscription.currentPeriodEnd;
  const periodEnd = addOneMonth(periodStart);

  const base = {
    outcome: 'previewable',
    due,
    nextBillingDate: subscription.nextBillingDate,
    willFinalizeCancellation,
    periodStart,
    periodEnd,
    paymentMethod: paymentMethodSummary,
  };

  if (willFinalizeCancellation) {
    // Nothing will be charged — the button finalizes the cancellation
    // instead (mirrors renewOne's own cancelAtPeriodEnd branch). No amount
    // to compute or show.
    return base;
  }

  // Dunning — the retry path charges the LOCKED amount from the most
  // recent failed row, never a live recalculation (registration-ledger-
  // plan.md's dunning policy: the emailed amount is the charged amount).
  if (subscription.retryCount > 0) {
    const failedRow = await SubscriptionCycleRegistration.findOne({
      subscriptionId,
      status: 'failed',
    }).sort({ createdAt: -1 });

    if (!failedRow) {
      return { ...base, outcome: 'no_failed_row' };
    }

    return {
      ...base,
      inDunning: true,
      retryCount: subscription.retryCount,
      attemptsRemaining: MAX_PAYMENT_RETRIES - subscription.retryCount,
      amount: failedRow.amount,
      breakdown: failedRow.breakdown,
    };
  }

  const monthlyFee = await resolveMonthlyFee(subscription);

  if (monthlyFee === null) {
    return { ...base, outcome: 'no_price' };
  }

  const student = await User.findById(subscription.studentId);
  const fullMonthCharge = await calculateChargeAmount(student, monthlyFee, { mode: 'renewal', subscription });

  // "Prorated from today" (docs/plans/payment-airtight-plan.md D4) — the
  // SAME computeProration() the registration flow uses, anchored at TODAY
  // rather than this subscription's own currentPeriodEnd. A broken
  // schedule/class chain (levelId unresolvable) degrades to omitting this
  // option rather than failing the whole preview — the full-month option
  // still works either way.
  const levelId = await resolveLevelId(subscription);
  let proratedOption = null;

  if (levelId !== null) {
    const today = todayDateOnly();
    const proration = await computeProration({ levelId, monthlyFee, registrationDate: today });
    const proratedCharge = await calculateChargeAmount(student, proration.proratedAmount, {
      mode: 'renewal',
      subscription,
    });

    proratedOption = {
      amount: proratedCharge.amount,
      breakdown: {
        monthlyFee,
        prorated: proration.prorated,
        proratedAmount: proration.proratedAmount,
        siblingDiscountApplied: proratedCharge.siblingDiscountApplied,
        siblingDiscountAmount: proratedCharge.siblingDiscountAmount,
      },
      periodStart: today,
      periodEnd: proration.periodEnd,
    };
  }

  // The current Central month's own ledger row, if this subscription has
  // ALREADY been paid for it via ANY pathway — cron, Charge button (either
  // period), or a manual recording (D8). The full-month option is already
  // independently gated by `due`/`willFinalizeCancellation` above (which
  // self-corrects after any successful charge, since advanceSubscription-
  // Period always rolls currentPeriodEnd/nextBillingDate forward from
  // whatever period actually got paid); this is the ledger-sourced check
  // the "prorated from today" and manual-recording paths need, since
  // neither one gates on nextBillingDate.
  const monthAlreadyPaidRow = await SubscriptionCycleRegistration.findOne({
    subscriptionId,
    periodMonth: periodMonthOf(todayDateOnly()),
    status: 'completed',
  });
  const monthAlreadyPaid = monthAlreadyPaidRow
    ? {
        amount: monthAlreadyPaidRow.amount,
        paidAt: monthAlreadyPaidRow.paidAt,
        chargeMethod: monthAlreadyPaidRow.chargeMethod || 'card',
      }
    : null;

  return {
    ...base,
    inDunning: false,
    amount: fullMonthCharge.amount,
    breakdown: {
      monthlyFee,
      siblingDiscountApplied: fullMonthCharge.siblingDiscountApplied,
      siblingDiscountAmount: fullMonthCharge.siblingDiscountAmount,
    },
    options: {
      fullMonth: {
        amount: fullMonthCharge.amount,
        breakdown: {
          monthlyFee,
          siblingDiscountApplied: fullMonthCharge.siblingDiscountApplied,
          siblingDiscountAmount: fullMonthCharge.siblingDiscountAmount,
        },
        periodStart,
        periodEnd,
      },
      prorated: proratedOption,
    },
    monthAlreadyPaid,
  };
}

// Processes exactly ONE subscription, by id, with its OWN fresh fetch —
// never trusts a status/date snapshot taken earlier by the caller (e.g. the
// candidate list in runRenewals). This is what makes "a subscription
// cancelled between being listed as a candidate and being processed here
// must not be charged" a directly testable property of this function alone,
// not something only provable by racing real concurrency.
// `recordedBy` (docs/plans/payment-airtight-plan.md D5) is null for every
// cron-driven call (runRenewals never passes it) and the admin's own user
// id when this was triggered via the Charge dialog's "Full month" + "Charge
// card on file" combination (chargeNow threads it through) — set once at
// the new ledger row's creation below, for audit only, never read back by
// any charge-decision logic.
async function renewOne(subscriptionId, { recordedBy = null } = {}) {
  const subscription = await Subscription.findById(subscriptionId);

  if (!subscription) {
    return { subscriptionId, outcome: 'not_found' };
  }

  // The re-verification step: status is re-checked here, live, never from a
  // snapshot taken by the caller. A subscription cancelled (status flipped
  // to 'cancelled' by some other path) between being listed and being
  // processed is caught right here, not upstream.
  if (subscription.status !== 'active') {
    return { subscriptionId, outcome: 'skipped_inactive' };
  }

  const today = todayAtMidnight();

  // Defensive — the caller (runRenewals) should already filter on this, but
  // this function must be safe to call directly with any subscription id.
  if (subscription.nextBillingDate > today) {
    return { subscriptionId, outcome: 'skipped_not_due' };
  }

  if (subscription.cancelAtPeriodEnd === true) {
    // Finalize the cancellation. Do NOT charge. The `status: 'active'`
    // filter here is defense-in-depth, not the primary guard — the primary
    // guard already happened above.
    await Subscription.findOneAndUpdate(
      { _id: subscriptionId, status: 'active' },
      { $set: { status: 'cancelled' } }
    );

    const schedule = await GroupClassSchedule.findById(subscription.scheduleId);

    if (schedule) {
      // A calendar-day sentinel, NOT the billing-instant `today` above
      // (docs/plans/utc-date-standard-plan.md bug 5) — removeStudentFromRoster
      // filters session dates via $gte, which must stay sentinel-shaped;
      // `today` (todayAtMidnight()) is deliberately kept as-is for this
      // function's own due-check earlier.
      await removeStudentFromRoster(schedule, subscription.studentId, todayDateOnly());
    }

    return { subscriptionId, outcome: 'cancelled_finalized' };
  }

  // Ledger dedup check (registration-ledger-plan.md D4 step 2), BEFORE
  // computing anything — a prior run may have already written a row for
  // this calendar month. Keyed on periodMonth, not the exact periodStart
  // (docs/plans/payment-airtight-plan.md D7) — a month can now also have
  // been paid via a mid-month-anchored row (the Charge dialog's "prorated
  // from today" option, or a manual recording), which this must still
  // recognize even though its own periodStart differs from
  // currentPeriodEnd.
  const existingRow = await findExistingRowForMonth(subscriptionId, periodMonthOf(subscription.currentPeriodEnd));

  const groupClassesService = await getServiceByCode('group-classes', { requireActive: true });
  assertBillingShape(groupClassesService, 'subscription_cycle');

  const student = await User.findById(subscription.studentId);
  const parent = await User.findById(subscription.parentId);

  if (existingRow) {
    if (existingRow.status === 'completed') {
      // This period was already paid — e.g. a prior run died after
      // charging but before the Subscription's period rolled. Un-stick the
      // subscription by rolling forward from the row's own truth, without
      // charging again.
      await advanceSubscriptionPeriod(
        subscriptionId,
        existingRow.periodStart,
        existingRow.periodEnd,
        existingRow.amount,
        existingRow.breakdown.siblingDiscountApplied
      );

      return { subscriptionId, outcome: 'skipped_already_charged' };
    }

    // 'pending' — a previous run died between insert and charge-resolution.
    const paymentMethod = await paymentMethodService.getMine(subscription.parentId);

    if (!paymentMethod) {
      return { subscriptionId, outcome: 'failed_no_payment_method' };
    }

    const stripeCustomerId = await ensureStripeCustomer(parent);
    const monthlyFee = await resolveMonthlyFee(subscription);

    return recoverStalePending({
      row: existingRow,
      subscription,
      student,
      parent,
      paymentMethod,
      stripeCustomerId,
      monthlyFee,
    });
  }

  const monthlyFee = await resolveMonthlyFee(subscription);

  if (monthlyFee === null) {
    // eslint-disable-next-line no-console -- operational logging for a
    // billing job, not debug output: a subscription that can no longer
    // resolve a price is a data-integrity condition worth surfacing.
    console.error(
      `Renewal failed for subscription ${subscriptionId}: no resolvable price (deleted schedule/class or no Price configured for the level).`
    );
    return { subscriptionId, outcome: 'failed_no_price' };
  }

  const { amount, siblingDiscountApplied, siblingDiscountAmount } = await calculateChargeAmount(student, monthlyFee, {
    mode: 'renewal',
    subscription,
  });

  const paymentMethod = await paymentMethodService.getMine(subscription.parentId);

  if (!paymentMethod) {
    return { subscriptionId, outcome: 'failed_no_payment_method' };
  }

  const stripeCustomerId = await ensureStripeCustomer(parent);

  const newPeriodStart = subscription.currentPeriodEnd;
  const newPeriodEnd = addOneMonth(newPeriodStart);

  // Create the ledger row BEFORE charging (D4 step 4) — Guard B (the
  // {subscriptionId, periodMonth} partial unique index on the discriminator
  // schema) makes a concurrent duplicate insert impossible; a race loser
  // catches E11000 here and skips without ever reaching Stripe.
  let registration;

  try {
    registration = await SubscriptionCycleRegistration.create({
      serviceId: groupClassesService._id,
      subscriptionId,
      scheduleId: subscription.scheduleId,
      studentId: subscription.studentId,
      parentId: subscription.parentId,
      eventType: 'renewal',
      status: 'pending',
      amount,
      recordedBy,
      breakdown: {
        monthlyFee,
        registrationFeeCharged: 0,
        siblingDiscountApplied,
        siblingDiscountAmount,
      },
      periodStart: newPeriodStart,
      periodEnd: newPeriodEnd,
    });
  } catch (error) {
    if (error.code === 11000) {
      return { subscriptionId, outcome: 'skipped_concurrent' };
    }

    throw error;
  }

  return chargeAndEmail({
    row: registration,
    subscription,
    student,
    parent,
    paymentMethod,
    stripeCustomerId,
    monthlyFee,
    siblingDiscountApplied,
    siblingDiscountAmount,
  });
}

// The Charge dialog's "prorated from today" card option (docs/plans/
// payment-airtight-plan.md D4) — a superadmin-triggered catch-up charge for
// a lapsed/mid-month situation, anchored at TODAY rather than the
// subscription's own currentPeriodEnd. Mirrors renewOne's exact guard
// sequence (fresh fetch, active check, per-month ledger dedup via Guard B's
// periodMonth key, pending-row-first, THEN charge) — the only real
// differences are which period/amount get computed and that this does NOT
// gate on nextBillingDate, deliberately: it is an off-cycle tool, not the
// scheduled renewal.
async function chargeProratedNow(subscriptionId, adminUser) {
  const subscription = await Subscription.findById(subscriptionId);

  if (!subscription) {
    return { subscriptionId, outcome: 'not_found' };
  }

  if (subscription.status !== 'active') {
    return { subscriptionId, outcome: 'skipped_inactive' };
  }

  const levelId = await resolveLevelId(subscription);
  const monthlyFee = await resolveMonthlyFee(subscription);

  if (levelId === null || monthlyFee === null) {
    return { subscriptionId, outcome: 'failed_no_price' };
  }

  const today = todayDateOnly();
  const targetPeriodMonth = periodMonthOf(today);

  const existingRow = await findExistingRowForMonth(subscriptionId, targetPeriodMonth);

  if (existingRow && existingRow.status === 'completed') {
    return { subscriptionId, outcome: 'skipped_already_charged' };
  }

  const groupClassesService = await getServiceByCode('group-classes', { requireActive: true });
  assertBillingShape(groupClassesService, 'subscription_cycle');

  const student = await User.findById(subscription.studentId);
  const parent = await User.findById(subscription.parentId);

  const proration = await computeProration({ levelId, monthlyFee, registrationDate: today });
  const { amount, siblingDiscountApplied, siblingDiscountAmount } = await calculateChargeAmount(
    student,
    proration.proratedAmount,
    { mode: 'renewal', subscription }
  );

  const paymentMethod = await paymentMethodService.getMine(subscription.parentId);

  if (!paymentMethod) {
    return { subscriptionId, outcome: 'failed_no_payment_method' };
  }

  const stripeCustomerId = await ensureStripeCustomer(parent);

  let registration;

  try {
    registration = await SubscriptionCycleRegistration.create({
      serviceId: groupClassesService._id,
      subscriptionId,
      scheduleId: subscription.scheduleId,
      studentId: subscription.studentId,
      parentId: subscription.parentId,
      eventType: 'renewal',
      status: 'pending',
      amount,
      recordedBy: adminUser._id,
      breakdown: {
        monthlyFee,
        prorated: proration.prorated,
        proratedAmount: proration.proratedAmount,
        registrationFeeCharged: 0,
        siblingDiscountApplied,
        siblingDiscountAmount,
      },
      periodStart: today,
      periodEnd: proration.periodEnd,
    });
  } catch (error) {
    if (error.code === 11000) {
      return { subscriptionId, outcome: 'skipped_concurrent' };
    }

    throw error;
  }

  return chargeAndEmail({
    row: registration,
    subscription,
    student,
    parent,
    paymentMethod,
    stripeCustomerId,
    monthlyFee,
    siblingDiscountApplied,
    siblingDiscountAmount,
  });
}

// The superadmin's manual/offline payment path (docs/plans/payment-airtight
// -plan.md D5) — an admin-entered amount + required note, no Stripe call.
// Same guard sequence and pending-row-first discipline as every other
// charge pathway (fresh fetch, active check, per-month ledger dedup via
// Guard B's periodMonth key), so Guard B applies identically — this can
// never double-pay a month any other pathway already completed. Finalizes
// immediately via the SAME finalizeSuccessfulCharge every real Stripe
// charge uses, which is what actually clears dunning state
// (advanceSubscriptionPeriod resets retryCount/nextRetryAt) — recording a
// manual payment while a subscription is in dunning ends the dunning cycle,
// per D6.
//
// `period` is 'full' (the subscription's own next scheduled period,
// currentPeriodEnd -> +1 month — the SAME period a card "Full month" charge
// would target, even mid-dunning) or 'prorated' (today -> the 1st of next
// month, for a lapsed/mid-month restart). Unlike the card paths, a broken
// schedule/class chain does NOT block a 'prorated' recording — the admin's
// own entered amount is what actually gets recorded either way; only the
// informational breakdown.monthlyFee/prorated math degrades gracefully.
async function recordManualPayment(subscriptionId, { amount, note, period }, adminUser) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return { subscriptionId, outcome: 'invalid_amount' };
  }

  const trimmedNote = typeof note === 'string' ? note.trim() : '';

  if (trimmedNote.length === 0) {
    return { subscriptionId, outcome: 'invalid_note' };
  }

  if (period !== 'full' && period !== 'prorated') {
    return { subscriptionId, outcome: 'invalid_period' };
  }

  const subscription = await Subscription.findById(subscriptionId);

  if (!subscription) {
    return { subscriptionId, outcome: 'not_found' };
  }

  if (subscription.status !== 'active') {
    return { subscriptionId, outcome: 'skipped_inactive' };
  }

  let periodStart;
  let periodEnd;
  let breakdown;

  if (period === 'full') {
    periodStart = subscription.currentPeriodEnd;
    periodEnd = addOneMonth(periodStart);
    breakdown = {
      monthlyFee: amount,
      prorated: false,
      proratedAmount: null,
      registrationFeeCharged: 0,
      siblingDiscountApplied: false,
      siblingDiscountAmount: 0,
    };
  } else {
    const today = todayDateOnly();
    periodStart = today;

    const levelId = await resolveLevelId(subscription);
    const monthlyFee = await resolveMonthlyFee(subscription);
    const proration =
      levelId !== null && monthlyFee !== null
        ? await computeProration({ levelId, monthlyFee, registrationDate: today })
        : null;

    periodEnd = proration ? proration.periodEnd : firstOfNextMonth(today);
    breakdown = {
      monthlyFee: monthlyFee ?? amount,
      prorated: true,
      proratedAmount: amount,
      registrationFeeCharged: 0,
      siblingDiscountApplied: false,
      siblingDiscountAmount: 0,
    };
  }

  const existingRow = await findExistingRowForMonth(subscriptionId, periodMonthOf(periodStart));

  if (existingRow && existingRow.status === 'completed') {
    return { subscriptionId, outcome: 'skipped_already_charged' };
  }

  const groupClassesService = await getServiceByCode('group-classes', { requireActive: true });
  assertBillingShape(groupClassesService, 'subscription_cycle');

  let registration;

  try {
    registration = await SubscriptionCycleRegistration.create({
      serviceId: groupClassesService._id,
      subscriptionId,
      scheduleId: subscription.scheduleId,
      studentId: subscription.studentId,
      parentId: subscription.parentId,
      eventType: 'renewal',
      status: 'pending',
      amount,
      chargeMethod: 'manual',
      manualNote: trimmedNote,
      recordedBy: adminUser._id,
      breakdown,
      periodStart,
      periodEnd,
    });
  } catch (error) {
    if (error.code === 11000) {
      return { subscriptionId, outcome: 'skipped_concurrent' };
    }

    throw error;
  }

  const result = await finalizeSuccessfulCharge({
    row: registration,
    subscription,
    paymentIntentId: null,
    chargeAmount: amount,
    siblingDiscountApplied: false,
  });

  const student = await User.findById(subscription.studentId);
  const parent = await User.findById(subscription.parentId);

  await sendReceiptEmail(
    subscription,
    parent,
    student,
    amount,
    0,
    breakdown.monthlyFee,
    periodStart,
    registration._id,
    `Payment recorded by the academy — ${trimmedNote}`
  );

  return result;
}

// Superadmin manual Charge button's write path (docs/plans/manual-charge-
// and-pdf-invoice-plan.md D2; docs/plans/payment-airtight-plan.md D4 for
// the period/method options) — `period` ('full' | 'prorated', default
// 'full') routes to renewOne's own full-month math or the new
// chargeProratedNow above; dunning (retryCount > 0) always bypasses both
// and retries the locked failed-row amount via retryOne, unchanged — the
// SAME signal runRenewals/runRetries split their two phases on. Zero new
// charge logic beyond chargeProratedNow itself: every other guard (fresh
// re-fetch, not-due skip, ledger dedup, stale-pending recovery, idempotency
// keys, dunning state, emails) lives entirely in renewOne/retryOne,
// unchanged. `adminUser` is threaded into renewOne/chargeProratedNow as
// `recordedBy` for audit (D5) — never into retryOne, which never creates a
// new ledger row.
async function chargeNow(subscriptionId, { period = 'full', adminUser } = {}) {
  const subscription = await Subscription.findById(subscriptionId);

  if (!subscription) {
    return { subscriptionId, outcome: 'not_found' };
  }

  if (subscription.retryCount > 0) {
    return retryOne(subscriptionId);
  }

  if (period === 'prorated') {
    return chargeProratedNow(subscriptionId, adminUser);
  }

  return renewOne(subscriptionId, { recordedBy: adminUser ? adminUser._id : null });
}

// Cancels a subscription that has exhausted its retries — ported verbatim
// from CKQ's own zombie-loop fix (D6). Both halves of the update are
// load-bearing:
//  - `status: 'active'` in the filter makes this idempotent: only an
//    active subscription is ever cancelled here, so a repeat call (e.g. a
//    retried job run) never re-fires the side effects below.
//  - `$unset: { nextRetryAt: '' }`, never a plain `{ nextRetryAt: null }`
//    or `undefined` — Mongoose silently strips an `undefined` value from
//    an update, which would leave the OLD nextRetryAt in place. A stale
//    nextRetryAt on a cancelled subscription is exactly the zombie-loop
//    bug this ports the fix for: it would make the subscription keep
//    matching runRetries' own candidate query forever, status be damned,
//    if that query ever changes to stop filtering on status.
async function cancelAfterExhaustion(subscription, failedRow) {
  const cancelled = await Subscription.findOneAndUpdate(
    { _id: subscription._id, status: 'active' },
    { $set: { status: 'cancelled', retryCount: MAX_PAYMENT_RETRIES }, $unset: { nextRetryAt: '' } },
    { new: true }
  );

  if (!cancelled) {
    // Raced with something else (e.g. already cancelled by a concurrent
    // call) — the primary re-verification guard already happened in
    // retryOne before this was called; this is the same defense-in-depth
    // pattern renewOne's cancellation-finalize branch uses.
    return { subscriptionId: subscription._id, outcome: 'skipped_inactive' };
  }

  const schedule = await GroupClassSchedule.findById(subscription.scheduleId);

  if (schedule) {
    // A calendar-day sentinel, not a real instant — same fix as renewOne's
    // own cancellation-finalize branch above (docs/plans/utc-date-standard-
    // plan.md bug 5).
    await removeStudentFromRoster(schedule, subscription.studentId, todayDateOnly());
  }

  const student = await User.findById(subscription.studentId);
  const parent = await User.findById(subscription.parentId);

  // Inside the `if (cancelled)` guard above — an idempotent repeat call
  // (findOneAndUpdate matches nothing the second time) never re-sends this.
  await sendFailureEmail(subscription, parent, student, failedRow.amount, null, MAX_PAYMENT_RETRIES, true);

  return { subscriptionId: subscription._id, outcome: 'cancelled_exhausted' };
}

// Retries the most recent failed charge for exactly ONE subscription, with
// its OWN fresh fetch — same re-verification discipline renewOne documents
// (docs/decisions/001-in-house-subscription-billing.md safeguard #1),
// applied to the retry path too (the line-45 mandate,
// docs/TESTING_STRATEGY.md). This same path now also handles a NEVER-
// successfully-paid subscription (a brand-new registration whose first
// charge failed — docs/decisions/008-registration-create-pending-first.md)
// exactly like a renewal's failed charge; no separate logic exists or is
// needed for that case.
async function retryOne(subscriptionId) {
  const subscription = await Subscription.findById(subscriptionId);

  if (!subscription) {
    return { subscriptionId, outcome: 'not_found' };
  }

  // The re-verification step — a subscription cancelled (by anything, at
  // any point) between being listed as a phase-2 candidate and being
  // processed here is caught right here, not upstream. This is the
  // cancel-then-retry race the line-45 mandate requires a test for.
  if (subscription.status !== 'active') {
    return { subscriptionId, outcome: 'skipped_inactive' };
  }

  const failedRow = await SubscriptionCycleRegistration.findOne({
    subscriptionId,
    status: 'failed',
  }).sort({ createdAt: -1 });

  if (!failedRow) {
    // eslint-disable-next-line no-console -- operational logging for a
    // billing job, not debug output: a subscription with retryCount > 0
    // but no failed row at all is a data-integrity condition worth
    // surfacing, not something to silently skip.
    console.warn(
      `Retry skipped for subscription ${subscriptionId}: retryCount > 0 but no failed Registration row found.`
    );
    return { subscriptionId, outcome: 'skipped_no_failed_row' };
  }

  if (subscription.retryCount >= MAX_PAYMENT_RETRIES) {
    return cancelAfterExhaustion(subscription, failedRow);
  }

  const groupClassesService = await getServiceByCode('group-classes', { requireActive: true });
  assertBillingShape(groupClassesService, 'subscription_cycle');

  const student = await User.findById(subscription.studentId);
  const parent = await User.findById(subscription.parentId);

  const paymentMethod = await paymentMethodService.getMine(subscription.parentId);

  if (!paymentMethod) {
    return { subscriptionId, outcome: 'failed_no_payment_method' };
  }

  const stripeCustomerId = await ensureStripeCustomer(parent);

  return chargeAndEmail({
    row: failedRow,
    subscription,
    student,
    parent,
    paymentMethod,
    stripeCustomerId,
    monthlyFee: failedRow.breakdown.monthlyFee,
    siblingDiscountApplied: failedRow.breakdown.siblingDiscountApplied,
    siblingDiscountAmount: failedRow.breakdown.siblingDiscountAmount,
    attemptNumber: subscription.retryCount + 1,
  });
}

// Lists candidate subscription ids only (never a full document snapshot),
// then processes them ONE AT A TIME — awaiting each renewOne call before
// starting the next, never Promise.all. This isn't a performance choice: it
// is what makes renewOne's own fresh-fetch re-verification actually
// meaningful rather than cosmetic. Sequential processing means nothing else
// in THIS run could have raced a given subscription, but an external cancel
// request always could, and renewOne's re-check is what catches that.
//
// `retryCount: 0` in the candidate filter (docs/plans/registration-ledger-
// plan.md D6) keeps an in-retry subscription out of this phase entirely —
// it is picked up by runRetries (phase 2, below) instead.
async function runRenewals() {
  const candidates = await Subscription.find(
    { status: 'active', nextBillingDate: { $lte: todayAtMidnight() }, retryCount: 0 },
    '_id'
  );

  const results = [];

  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop -- sequential by design, see
    // the comment above.
    const result = await renewOne(candidate._id);
    results.push(result);
  }

  const counts = results.reduce((acc, result) => {
    acc[result.outcome] = (acc[result.outcome] || 0) + 1;
    return acc;
  }, {});

  const summaryLine =
    Object.entries(counts)
      .map(([outcome, count]) => `${outcome}: ${count}`)
      .join(', ') || 'none';

  // Operational logging for a scheduled billing job run, not debug output.
  // eslint-disable-next-line no-console
  console.log(`Renewal run complete — ${candidates.length} candidate(s). ${summaryLine}`);

  return { total: candidates.length, results };
}

// Phase 2 — same sequential, ids-only, fresh-fetch-per-item discipline as
// runRenewals above. `retryCount: { $gt: 0, $lte: MAX_PAYMENT_RETRIES }`
// scopes this to subscriptions currently in dunning; `nextRetryAt: { $lte:
// today }` is the daily cadence gate (D6: Day 0 -> 1 -> 2 -> 3-then-cancel).
// A cancelled subscription never matches this query again — see
// cancelAfterExhaustion's $unset comment for why that's specifically true
// even though `retryCount` itself is left at MAX_PAYMENT_RETRIES on a
// cancelled doc (the `status: 'active'` half of this filter alone already
// excludes it; nextRetryAt's $unset is the second, independent layer).
async function runRetries() {
  const candidates = await Subscription.find(
    {
      status: 'active',
      retryCount: { $gt: 0, $lte: MAX_PAYMENT_RETRIES },
      nextRetryAt: { $lte: todayAtMidnight() },
    },
    '_id'
  );

  const results = [];

  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop -- sequential by design, see
    // runRenewals' own comment above.
    const result = await retryOne(candidate._id);
    results.push(result);
  }

  const counts = results.reduce((acc, result) => {
    acc[result.outcome] = (acc[result.outcome] || 0) + 1;
    return acc;
  }, {});

  const summaryLine =
    Object.entries(counts)
      .map(([outcome, count]) => `${outcome}: ${count}`)
      .join(', ') || 'none';

  // eslint-disable-next-line no-console -- operational logging for a
  // scheduled billing job run, not debug output.
  console.log(`Retry run complete — ${candidates.length} candidate(s). ${summaryLine}`);

  return { total: candidates.length, results };
}

module.exports = {
  renewOne,
  runRenewals,
  retryOne,
  runRetries,
  previewRenewal,
  chargeNow,
  chargeProratedNow,
  recordManualPayment,
};
