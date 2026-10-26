const Subscription = require('../../models/subscription.model');
const { SubscriptionCycleRegistration } = require('../../models/registration.model');
const { getPaymentProvider } = require('../../payments');
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

// Charges `row`'s LOCKED amount through the active payment provider, keyed
// on the row's own id (`payment_${row._id}`, or
// `payment_${row._id}_retry${attemptNumber}` for a retry attempt) so this is
// safe to call twice for the same row. Classifies the outcome and returns it
// — does NOT touch the Registration row, the Subscription, or send any email.
// A card decline is a resolved `status: 'failed'` from the port, never a
// throw (docs/plans/payment-provider-port-plan.md D3); anything else the
// provider throws propagates unchanged. The result names the provider the
// attempt went through and its payment id (null when a decline produced no
// payment object), for the row's `provider`/`providerPaymentId`.
async function chargeLedgerRow({ row, paymentMethod, providerCustomerId, attemptNumber = 1 }) {
  const provider = getPaymentProvider();
  const idempotencyKey =
    attemptNumber > 1 ? `payment_${row._id}_retry${attemptNumber}` : `payment_${row._id}`;
  // Stored with the payment itself — stale-pending recovery looks a payment
  // up by this registrationId on a provider that can search (plan D4).
  const metadata =
    attemptNumber > 1
      ? { registrationId: String(row._id), retry: String(attemptNumber) }
      : { registrationId: String(row._id) };

  const result = await provider.charge({
    amount: row.amount,
    customerId: providerCustomerId,
    paymentMethodId: paymentMethod.providerPaymentMethodId,
    idempotencyKey,
    reference: String(row._id),
    metadata,
  });

  if (result.status !== 'succeeded') {
    return { outcome: 'failed', failureMessage: result.failureMessage, provider: provider.name, paymentId: result.id };
  }

  return { outcome: 'succeeded', provider: provider.name, paymentId: result.id };
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
async function finalizeSuccessfulCharge({ row, subscription, provider, paymentId, chargeAmount = row.amount, siblingDiscountApplied, attemptNumber = 1 }) {
  await SubscriptionCycleRegistration.findByIdAndUpdate(row._id, {
    $set: {
      status: 'completed',
      provider,
      providerPaymentId: paymentId,
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

async function finalizeFailedCharge({ row, subscription, failureMessage, provider, paymentId, attemptNumber = 1 }) {
  await SubscriptionCycleRegistration.findByIdAndUpdate(row._id, {
    $set: {
      status: 'failed',
      failureMessage,
      provider,
      providerPaymentId: paymentId,
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
async function chargeAndFinalize({ row, subscription, paymentMethod, providerCustomerId, chargeAmount, siblingDiscountApplied, attemptNumber = 1 }) {
  const result = await chargeLedgerRow({ row, paymentMethod, providerCustomerId, attemptNumber });

  if (result.outcome === 'succeeded') {
    return finalizeSuccessfulCharge({
      row,
      subscription,
      provider: result.provider,
      paymentId: result.paymentId,
      chargeAmount,
      siblingDiscountApplied,
      attemptNumber,
    });
  }

  return finalizeFailedCharge({
    row,
    subscription,
    failureMessage: result.failureMessage,
    provider: result.provider,
    paymentId: result.paymentId,
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
