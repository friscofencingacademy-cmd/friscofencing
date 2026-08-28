const Subscription = require('../../models/subscription.model');
const { SubscriptionCycleRegistration } = require('../../models/registration.model');
const stripe = require('../../config/stripe');
const { addOneDay, todayAtMidnight } = require('../../utils/billingDates');

// Shared by renewal.service.js (renewOne/retryOne/recoverStalePending) AND
// registration.service.js's create() (docs/decisions/008-registration-
// create-pending-first.md) — the ONE place "charge a locked ledger-row
// amount via Stripe, then update the ledger row and the Subscription
// accordingly" is implemented, so a future fix to this mechanics lands once,
// not twice.
//
// Deliberately contains NO email-sending and NO roster-access logic. A
// renewal's success email (sendRenewalReceiptEmail) and an initial
// registration's success email (sendRegistrationConfirmationEmail, richer —
// level/location/coach/proration) are genuinely different templates with
// different data, and only an initial registration ever grants roster
// access. Those differences belong to each CALLER, which acts on the
// outcome this module returns — this module's only job is the money/ledger
// mechanics, identical either way.

// Rolls the Subscription's period fields forward (or, for a brand-new
// registration's first successful charge, simply confirms the period
// fields already set at Subscription-creation time — this is a $set, not
// an increment, so it's correct either way) and resets retry/dunning
// state — the ONE place that happens, shared by every path that ends in
// "this period is now paid for." `status: 'active'` in the filter is
// defense-in-depth, not the primary guard.
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

// Charges `row`'s LOCKED amount via Stripe, keyed on the row's own id
// (`payment_${row._id}`, or `payment_${row._id}_retry${attemptNumber}` for
// a retry attempt) so this is safe to call twice for the same row.
// Classifies the outcome and returns it — does NOT touch the Registration
// row, the Subscription, or send any email.
async function chargeLedgerRow({ row, paymentMethod, stripeCustomerId, attemptNumber = 1 }) {
  const idempotencyKey =
    attemptNumber > 1 ? `payment_${row._id}_retry${attemptNumber}` : `payment_${row._id}`;
  // In the params object, not the request-options object below — metadata
  // is a real field on the PaymentIntent itself (what stale-pending
  // recovery searches on), not a request-level option like idempotencyKey.
  const metadata =
    attemptNumber > 1
      ? { registrationId: String(row._id), retry: String(attemptNumber) }
      : { registrationId: String(row._id) };

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
        metadata,
      },
      { idempotencyKey }
    );
  } catch (error) {
    if (error.type === 'StripeCardError') {
      return {
        outcome: 'failed',
        failureMessage: error.message,
        paymentIntentId: error.payment_intent ? error.payment_intent.id : null,
      };
    }

    throw error;
  }

  if (paymentIntent.status !== 'succeeded') {
    return {
      outcome: 'failed',
      failureMessage: `PaymentIntent status: ${paymentIntent.status}`,
      paymentIntentId: paymentIntent.id,
    };
  }

  return { outcome: 'succeeded', paymentIntentId: paymentIntent.id };
}

// `chargeAmount` defaults to the ledger row's own `amount` — correct for a
// renewal, which never bundles a one-time fee into its charge. An initial
// registration's row.amount DOES include the one-time registration fee
// (registration.model.js's breakdown doc: "For 'initial' rows this amount
// INCLUDES the registration fee"), so registration.service.js's create()
// passes its OWN recurring-only chargeAmount explicitly — Subscription
// .lastChargeAmount must stay the recurring monthly amount only, never the
// one-time fee folded in (the fee is tracked in its own field and never
// recurs).
async function finalizeSuccessfulCharge({ row, subscription, paymentIntentId, chargeAmount = row.amount, siblingDiscountApplied, attemptNumber = 1 }) {
  await SubscriptionCycleRegistration.findByIdAndUpdate(row._id, {
    $set: {
      status: 'completed',
      stripePaymentIntentId: paymentIntentId,
      paidAt: new Date(),
      attempt: attemptNumber,
    },
  });

  await advanceSubscriptionPeriod(subscription._id, row.periodStart, row.periodEnd, chargeAmount, siblingDiscountApplied);

  return {
    subscriptionId: subscription._id,
    outcome: 'charged',
    chargeAmount,
    siblingDiscountApplied,
  };
}

async function finalizeFailedCharge({ row, subscription, failureMessage, paymentIntentId, attemptNumber = 1 }) {
  await SubscriptionCycleRegistration.findByIdAndUpdate(row._id, {
    $set: {
      status: 'failed',
      failureMessage,
      stripePaymentIntentId: paymentIntentId,
      attempt: attemptNumber,
    },
  });

  // Do NOT roll the period — leave currentPeriodEnd/nextBillingDate
  // untouched so the failed period stays "due" until a retry succeeds or
  // exhausts. Enter/advance retry state: retryCount tracks the attempt
  // that just failed, nextRetryAt is always +1 day from today regardless of
  // which attempt this was — the retry cadence is fixed daily, not
  // exponential (Day 0 -> 1 -> 2 -> 3-then-cancel).
  const nextRetryAt = addOneDay(todayAtMidnight());

  await Subscription.findOneAndUpdate(
    { _id: subscription._id, status: 'active' },
    { $set: { retryCount: attemptNumber, nextRetryAt } }
  );

  return {
    subscriptionId: subscription._id,
    outcome: 'failed_payment',
    failureMessage,
    nextRetryAt,
    attemptNumber,
  };
}

// Orchestrates the three functions above — charge, then finalize whichever
// way it went. Kept as one function (not repeated at every call site) so
// the "charge -> finalize" sequencing is defined exactly once. The caller
// branches on `result.outcome` to decide which email to send and (for a
// brand-new registration only) whether to grant roster access.
async function chargeAndFinalize({ row, subscription, paymentMethod, stripeCustomerId, chargeAmount, siblingDiscountApplied, attemptNumber = 1 }) {
  const result = await chargeLedgerRow({ row, paymentMethod, stripeCustomerId, attemptNumber });

  if (result.outcome === 'succeeded') {
    return finalizeSuccessfulCharge({
      row,
      subscription,
      paymentIntentId: result.paymentIntentId,
      chargeAmount,
      siblingDiscountApplied,
      attemptNumber,
    });
  }

  return finalizeFailedCharge({
    row,
    subscription,
    failureMessage: result.failureMessage,
    paymentIntentId: result.paymentIntentId,
    attemptNumber,
  });
}

module.exports = {
  advanceSubscriptionPeriod,
  chargeLedgerRow,
  finalizeSuccessfulCharge,
  finalizeFailedCharge,
  chargeAndFinalize,
};
