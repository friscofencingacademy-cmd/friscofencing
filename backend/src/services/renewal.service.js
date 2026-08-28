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
const { getServiceByCode, assertBillingShape } = require('./serviceCatalog.service');
const { addOneMonth, addOneDay, todayAtMidnight } = require('../utils/billingDates');
const { removeStudentFromRoster } = require('./roster.service');
const mailService = require('./mail.service');

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

// Rolls the Subscription's period fields forward and resets retry/dunning
// state — the ONE place that happens, shared by every path that ends in
// "this period is now paid for" (a fresh successful charge, the ledger-dedup
// recovery when a prior run already completed this period, and stale-
// pending adoption when a prior run's PaymentIntent is found to have
// actually succeeded). Same atomic-conditional-update shape the pre-ledger
// code used (docs/decisions/001-in-house-subscription-billing.md safeguard
// #2) — `status: 'active'` in the filter is defense-in-depth, not the
// primary guard; the primary guard is renewOne's own fresh-fetch re-check
// before any of this runs.
async function advanceSubscriptionPeriod(
  subscriptionId,
  newPeriodStart,
  newPeriodEnd,
  chargeAmount,
  siblingDiscountApplied
) {
  await Subscription.findOneAndUpdate(
    { _id: subscriptionId, status: 'active' },
    {
      $set: {
        currentPeriodStart: newPeriodStart,
        currentPeriodEnd: newPeriodEnd,
        nextBillingDate: newPeriodEnd,
        lastChargeAmount: chargeAmount,
        lastSiblingDiscountApplied: siblingDiscountApplied,
        retryCount: 0,
      },
      $unset: { nextRetryAt: '' },
    }
  );
}

// Fire-and-forget receipt email — never throws, never affects the outcome
// (mail.service.js's send-function contract). Populate failures are
// deliberately kept inside this try/catch, alongside the send itself, so a
// lookup failure here can never undo an already-successful (and
// already-charged!) renewal.
async function sendReceiptEmail(subscription, parent, student, chargeAmount, siblingDiscountApplied, monthlyFee, newPeriodStart) {
  try {
    const schedule = await GroupClassSchedule.findById(subscription.scheduleId);
    const groupClass = schedule ? await GroupClass.findById(schedule.classId) : null;

    await mailService.sendRenewalReceiptEmail({
      parent,
      student,
      schedule,
      groupClass,
      monthLabel: formatMonthLabel(newPeriodStart),
      chargeAmount,
      monthlyFee,
      siblingDiscountAmount: siblingDiscountApplied ? monthlyFee * 0.1 : 0,
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

// Charges `row`'s LOCKED amount via Stripe, keyed on the row's own id
// (`payment_${row._id}`) so this is safe to call twice for the same row
// (a stale-pending re-drive within 24h replays the original Stripe
// outcome; beyond 24h the caller has already proven via search that no
// charge exists, so a fresh charge under the same key is correct —
// docs/plans/registration-ledger-plan.md D5). Handles both outcomes in
// place: completes/fails the SAME row, rolls the period or enters retry
// state, and sends the appropriate email. Returns the renewOne-shaped
// result.
async function chargeLedgerRow({ row, subscription, student, parent, paymentMethod, stripeCustomerId, monthlyFee, siblingDiscountApplied }) {
  let paymentIntent;

  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: Math.round(row.amount * 100),
        currency: 'usd',
        customer: stripeCustomerId,
        payment_method: paymentMethod.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        // In the params object, not the request-options object below —
        // metadata is a real field on the PaymentIntent itself (what D5's
        // stale-pending recovery searches on), not a request-level option
        // like idempotencyKey.
        metadata: { registrationId: String(row._id) },
      },
      {
        idempotencyKey: `payment_${row._id}`,
      }
    );
  } catch (error) {
    if (error.type === 'StripeCardError') {
      return finalizeFailedCharge({
        row,
        subscription,
        student,
        parent,
        failureMessage: error.message,
        paymentIntentId: error.payment_intent ? error.payment_intent.id : null,
      });
    }

    throw error;
  }

  if (paymentIntent.status !== 'succeeded') {
    return finalizeFailedCharge({
      row,
      subscription,
      student,
      parent,
      failureMessage: `PaymentIntent status: ${paymentIntent.status}`,
      paymentIntentId: paymentIntent.id,
    });
  }

  return finalizeSuccessfulCharge({
    row,
    subscription,
    student,
    parent,
    paymentIntentId: paymentIntent.id,
    monthlyFee,
    siblingDiscountApplied,
  });
}

async function finalizeSuccessfulCharge({ row, subscription, student, parent, paymentIntentId, monthlyFee, siblingDiscountApplied }) {
  await SubscriptionCycleRegistration.findByIdAndUpdate(row._id, {
    $set: { status: 'completed', stripePaymentIntentId: paymentIntentId, paidAt: new Date() },
  });

  await advanceSubscriptionPeriod(subscription._id, row.periodStart, row.periodEnd, row.amount, siblingDiscountApplied);

  await sendReceiptEmail(subscription, parent, student, row.amount, siblingDiscountApplied, monthlyFee, row.periodStart);

  return {
    subscriptionId: subscription._id,
    outcome: 'charged',
    chargeAmount: row.amount,
    siblingDiscountApplied,
  };
}

async function finalizeFailedCharge({ row, subscription, student, parent, failureMessage, paymentIntentId }) {
  await SubscriptionCycleRegistration.findByIdAndUpdate(row._id, {
    $set: {
      status: 'failed',
      failureMessage,
      stripePaymentIntentId: paymentIntentId,
    },
  });

  // Do NOT roll the period — leave currentPeriodEnd/nextBillingDate
  // untouched so the failed period stays "due" until a retry (PR 3)
  // succeeds or exhausts. Enter retry state (D6): Day 0 -> +1 day.
  const nextRetryAt = addOneDay(todayAtMidnight());

  await Subscription.findOneAndUpdate(
    { _id: subscription._id, status: 'active' },
    { $set: { retryCount: 1, nextRetryAt } }
  );

  await sendFailureEmail(subscription, parent, student, row.amount, nextRetryAt, 1, false);

  return {
    subscriptionId: subscription._id,
    outcome: 'failed_payment',
    failureMessage,
  };
}

// Stale-pending recovery (D5) — a `pending` row means a previous run died
// between insert and charge-resolution. Search Stripe for a PaymentIntent
// carrying this row's id in its metadata BEFORE ever charging again:
//   - a succeeded PI found -> adopt it (row completed, period rolled,
//     retry state reset) — NO new charge.
//   - none found, or only a terminal-failed one -> re-drive the charge
//     under the SAME idempotency key via chargeLedgerRow.
async function recoverStalePending({ row, subscription, student, parent, paymentMethod, stripeCustomerId, monthlyFee }) {
  const searchResult = await stripe.paymentIntents.search({
    query: `metadata['registrationId']:'${row._id}'`,
  });

  const succeededPI = searchResult.data.find((pi) => pi.status === 'succeeded');

  if (succeededPI) {
    return finalizeSuccessfulCharge({
      row,
      subscription,
      student,
      parent,
      paymentIntentId: succeededPI.id,
      monthlyFee,
      siblingDiscountApplied: row.breakdown.siblingDiscountApplied,
    });
  }

  return chargeLedgerRow({
    row,
    subscription,
    student,
    parent,
    paymentMethod,
    stripeCustomerId,
    monthlyFee,
    siblingDiscountApplied: row.breakdown.siblingDiscountApplied,
  });
}

// Processes exactly ONE subscription, by id, with its OWN fresh fetch —
// never trusts a status/date snapshot taken earlier by the caller (e.g. the
// candidate list in runRenewals). This is what makes "a subscription
// cancelled between being listed as a candidate and being processed here
// must not be charged" a directly testable property of this function alone,
// not something only provable by racing concurrent requests.
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
      await removeStudentFromRoster(schedule, subscription.studentId, today);
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

  const { amount, siblingDiscountApplied } = await calculateChargeAmount(student, monthlyFee);

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

  return chargeLedgerRow({
    row: registration,
    subscription,
    student,
    parent,
    paymentMethod,
    stripeCustomerId,
    monthlyFee,
    siblingDiscountApplied,
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
// it is picked up by the retry runner instead (PR 3; until that ships, a
// failed subscription simply waits at retryCount: 1 until then, visible in
// this run's summary as absent rather than silently re-charged/re-priced
// every day the way it used to be).
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

module.exports = { renewOne, runRenewals };
