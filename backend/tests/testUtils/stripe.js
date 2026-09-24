const stripe = require('../../src/config/stripe');
const User = require('../../src/models/user.model');

// Stripe lookups for tests that hit Stripe's real TEST mode.
//
// The TEST account is ONE account shared by every CI run and every developer
// machine at once, so a test must never read Stripe account-wide (e.g.
// `stripe.paymentIntents.list({ limit: 10 })`, or finding a customer by email).
// Another run's objects show up there: overlapping CI runs once picked up each
// other's PaymentIntents and failed (docs/TESTING_STRATEGY.md, "Real Stripe in
// tests"). Every lookup here is keyed to something only this test owns:
//   - a ledger row's own stripePaymentIntentId (the exact charge our code made)
//   - the test parent's own Stripe customer (created fresh for each parent)

/** The Stripe customer id our code stored for this user, read from our database. */
async function stripeCustomerIdOf(userId) {
  const user = await User.findById(userId, 'stripeCustomerId').lean();

  if (!user || !user.stripeCustomerId) {
    throw new Error(`User ${userId} has no Stripe customer yet`);
  }

  return user.stripeCustomerId;
}

/**
 * Every PaymentIntent ever created for this user's own Stripe customer — the
 * way to prove a code path charged exactly N times (0 for "never charged").
 */
async function listCustomerPaymentIntents(userId) {
  const customer = await stripeCustomerIdOf(userId);
  const intents = [];

  for await (const intent of stripe.paymentIntents.list({ customer, limit: 100 })) {
    intents.push(intent);
  }

  return intents;
}

/**
 * Asserts the exact Stripe charge a ledger row recorded: it exists, it
 * succeeded, it was for `expectedAmount` dollars, and it belongs to the row's
 * own parent. Returns the PaymentIntent for any further assertions.
 */
async function expectLedgerChargeSucceeded(ledgerRow, expectedAmount) {
  if (!ledgerRow) {
    throw new Error('expectLedgerChargeSucceeded: no ledger row was found');
  }

  if (!ledgerRow.stripePaymentIntentId) {
    throw new Error(
      `Ledger row ${ledgerRow._id} (status ${ledgerRow.status}) has no stripePaymentIntentId — no charge was recorded`
    );
  }

  const intent = await stripe.paymentIntents.retrieve(ledgerRow.stripePaymentIntentId);

  expect(intent.status).toBe('succeeded');
  expect(intent.amount).toBe(Math.round(expectedAmount * 100));
  expect(intent.customer).toBe(await stripeCustomerIdOf(ledgerRow.parentId));

  return intent;
}

module.exports = { stripeCustomerIdOf, listCustomerPaymentIntents, expectLedgerChargeSucceeded };
