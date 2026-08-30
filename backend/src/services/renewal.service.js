const Subscription = require('../models/subscription.model');
const User = require('../models/user.model');
const GroupClassSchedule = require('../models/groupClassSchedule.model');
const GroupClass = require('../models/groupClass.model');
const Price = require('../models/price.model');
const { SubscriptionCycleRegistration } = require('../models/registration.model');
const { monthLabel: formatMonthLabel } = require('../email/dates');
const stripe = require('../config/stripe');
const paymentMethodService = require('./paymentMethod.service');
const { ensureStripeCustomer } = require('./stripeCustomer.service');
const { calculateChargeAmount } = require('./billing/calculateChargeAmount.service');
const {
  chargeAndFinalize,
  finalizeSuccessfulCharge,
  advanceSubscriptionPeriod,
} = require('./billing/chargeFinalization.service');
const { getServiceByCode, assertBillingShape } = require('./serviceCatalog.service');
const { addOneMonth, todayAtMidnight, todayDateOnly } = require('../utils/billingDates');
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
async function sendReceiptEmail(subscription, parent, student, chargeAmount, siblingDiscountAmount, monthlyFee, newPeriodStart, registrationId) {
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
  const { amount, siblingDiscountApplied, siblingDiscountAmount } = await calculateChargeAmount(
    student,
    monthlyFee,
    { mode: 'renewal', subscription }
  );

  return {
    ...base,
    inDunning: false,
    amount,
    breakdown: { monthlyFee, siblingDiscountApplied, siblingDiscountAmount },
  };
}

// Processes exactly ONE subscription, by id, with its OWN fresh fetch —
// never trusts a status/date snapshot taken earlier by the caller (e.g. the
// candidate list in runRenewals). This is what makes "a subscription
// cancelled between being listed as a candidate and being processed here
// must not be charged" a directly testable property of this function alone,
// not something only provable by racing real concurrency.
async function renewOne(subscriptionId) {
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

  // Ledger dedup check (D4 step 2), BEFORE computing anything — a prior run
  // may have already written a row for this exact period.
  const existingRow = await SubscriptionCycleRegistration.findOne({
    subscriptionId,
    periodStart: subscription.currentPeriodEnd,
    status: { $in: ['pending', 'completed'] },
  });

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
  // {subscriptionId, periodStart} partial unique index on the discriminator
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

// Superadmin manual Charge button's write path (docs/plans/manual-charge-
// and-pdf-invoice-plan.md D2) — routes to the exact same functions the
// unscheduled `npm run renewals` job would call, based on the SAME signal
// runRenewals/runRetries split their two phases on (retryCount > 0 = in
// dunning). Zero new charge logic: every guard (fresh re-fetch, not-due
// skip, ledger dedup, stale-pending recovery, idempotency keys, dunning
// state, emails) lives entirely in renewOne/retryOne, unchanged.
async function chargeNow(subscriptionId) {
  const subscription = await Subscription.findById(subscriptionId);

  if (!subscription) {
    return { subscriptionId, outcome: 'not_found' };
  }

  if (subscription.retryCount > 0) {
    return retryOne(subscriptionId);
  }

  return renewOne(subscriptionId);
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

module.exports = { renewOne, runRenewals, retryOne, runRetries, previewRenewal, chargeNow };
