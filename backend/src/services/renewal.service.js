const Subscription = require('../models/subscription.model');
const User = require('../models/user.model');
const GroupClassSchedule = require('../models/groupClassSchedule.model');
const GroupClassSession = require('../models/groupClassSession.model');
const GroupClass = require('../models/groupClass.model');
const Price = require('../models/price.model');
const stripe = require('../config/stripe');
const paymentMethodService = require('./paymentMethod.service');
const { ensureStripeCustomer } = require('./stripeCustomer.service');
const { calculateChargeAmount } = require('./billing/calculateChargeAmount.service');
const { addOneMonth, todayAtMidnight } = require('../utils/billingDates');
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

// Removes `studentId` from `schedule.students` (if present) and from every
// GroupClassSession of that schedule dated on/after `today` where they're
// currently on the roster — the exact mirror, in the opposite direction, of
// what registration.service.js does when enrolling a student.
async function removeStudentFromRoster(schedule, studentId, today) {
  const onSchedule = schedule.students.some((id) => String(id) === String(studentId));

  if (onSchedule) {
    schedule.students = schedule.students.filter((id) => String(id) !== String(studentId));
    await schedule.save();
  }

  const futureSessions = await GroupClassSession.find({
    scheduleId: schedule._id,
    date: { $gte: today },
  });

  await Promise.all(
    futureSessions.map((session) => {
      const onRoster = session.students.some(
        (entry) => String(entry.studentId) === String(studentId)
      );

      if (!onRoster) {
        return null;
      }

      session.students = session.students.filter(
        (entry) => String(entry.studentId) !== String(studentId)
      );
      return session.save();
    })
  );
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

  const student = await User.findById(subscription.studentId);
  const { amount, siblingDiscountApplied } = await calculateChargeAmount(student, monthlyFee);

  const paymentMethod = await paymentMethodService.getMine(subscription.parentId);

  if (!paymentMethod) {
    return { subscriptionId, outcome: 'failed_no_payment_method' };
  }

  const parent = await User.findById(subscription.parentId);
  const stripeCustomerId = await ensureStripeCustomer(parent);

  let paymentIntent;

  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: Math.round(amount * 100),
        currency: 'usd',
        customer: stripeCustomerId,
        payment_method: paymentMethod.stripePaymentMethodId,
        off_session: true,
        confirm: true,
      },
      {
        idempotencyKey: `renewal-${subscriptionId}-${subscription.currentPeriodEnd.toISOString()}`,
      }
    );
  } catch (error) {
    // A hard decline (e.g. card_declined) is a synchronous throw from the
    // Stripe SDK — Stripe attaches the resulting PaymentIntent to the error
    // object itself rather than returning it normally. Treat this the same
    // as a soft non-'succeeded' status below: leave the subscription
    // completely untouched so the next job run retries this period
    // naturally. Anything that isn't a card decline is a real,
    // unanticipated failure and is left to propagate.
    if (error.type === 'StripeCardError') {
      return {
        subscriptionId,
        outcome: 'failed_payment',
        paymentIntentStatus: error.payment_intent ? error.payment_intent.status : 'failed',
      };
    }

    throw error;
  }

  if (paymentIntent.status !== 'succeeded') {
    // Do NOT touch the subscription — leave period/nextBillingDate
    // untouched so the next job run retries it naturally. No
    // dunning/auto-cancel-after-N-failures: disclosed MVP limitation.
    return {
      subscriptionId,
      outcome: 'failed_payment',
      paymentIntentStatus: paymentIntent.status,
    };
  }

  const newPeriodStart = subscription.currentPeriodEnd;
  const newPeriodEnd = addOneMonth(newPeriodStart);

  await Subscription.findOneAndUpdate(
    { _id: subscriptionId, status: 'active' },
    {
      $set: {
        currentPeriodStart: newPeriodStart,
        currentPeriodEnd: newPeriodEnd,
        nextBillingDate: newPeriodEnd,
        lastChargeAmount: amount,
        lastSiblingDiscountApplied: siblingDiscountApplied,
      },
    }
  );

  // Re-fetch the schedule for the receipt email — resolveMonthlyFee already
  // walked this chain but doesn't return the schedule itself, and it isn't
  // worth restructuring that function's return shape just for this.
  const schedule = await GroupClassSchedule.findById(subscription.scheduleId);

  // Fire-and-forget receipt email — never throws, never affects this
  // outcome (see mail.service.js's send-function contract).
  await mailService.sendRenewalReceiptEmail({
    parent,
    student,
    schedule,
    chargeAmount: amount,
    siblingDiscountApplied,
  });

  return {
    subscriptionId,
    outcome: 'charged',
    chargeAmount: amount,
    siblingDiscountApplied,
  };
}

// Lists candidate subscription ids only (never a full document snapshot),
// then processes them ONE AT A TIME — awaiting each renewOne call before
// starting the next, never Promise.all. This isn't a performance choice: it
// is what makes renewOne's own fresh-fetch re-verification actually
// meaningful rather than cosmetic. Sequential processing means nothing else
// in THIS run could have raced a given subscription, but an external cancel
// request always could, and renewOne's re-check is what catches that.
async function runRenewals() {
  const candidates = await Subscription.find(
    { status: 'active', nextBillingDate: { $lte: todayAtMidnight() } },
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
