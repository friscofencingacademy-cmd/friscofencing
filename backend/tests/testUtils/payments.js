const stripe = require('../../src/config/stripe');
const User = require('../../src/models/user.model');
const { getPaymentProvider } = require('../../src/payments');
const stripeProvider = require('../../src/payments/stripe/stripe.provider');

// The ONE place a test reaches the active payment provider's real test mode
// (docs/plans/payment-provider-port-plan.md D9). Every route/service test goes
// through these helpers and asserts only normalized shapes — never a
// provider's own objects — so the same suites run unchanged against any
// provider. Only this file and tests/payments/** may require a provider SDK
// (tests/payments/providerBoundaryGuard.test.js).
//
// A provider's TEST account is ONE account shared by every CI run and every
// developer machine at once, so nothing here reads the account as a whole
// (e.g. listing the newest payments, or finding a customer by email) —
// another run's objects would show up (docs/TESTING_STRATEGY.md, "never read
// the account as a whole"). Every lookup is keyed to something only the
// calling test owns: a payment id our code recorded, or the test parent's own
// freshly created customer.

function activeProviderName() {
  return getPaymentProvider().name;
}

function assertStripeActive(helper) {
  if (activeProviderName() !== 'stripe') {
    throw new Error(`tests/testUtils/payments.js ${helper}: no implementation for provider "${activeProviderName()}"`);
  }
}

/**
 * A fresh, real test-mode card token, as the browser's card form would hand
 * it to POST /payment-methods.
 *   'success'         — saves and charges successfully
 *   'declineAtAttach' — rejected when saved (attach), not only when charged
 * A token can be saved only once, so call this fresh for every save.
 */
async function mintCardToken(kind = 'success') {
  assertStripeActive('mintCardToken');
  const tokens = { success: 'tok_visa', declineAtAttach: 'tok_chargeDeclined' };

  if (!tokens[kind]) throw new Error(`mintCardToken: unknown kind "${kind}"`);

  const paymentMethod = await stripe.paymentMethods.create({ type: 'card', card: { token: tokens[kind] } });
  return paymentMethod.id;
}

/** The brand/last4 a 'success' card from mintCardToken saves as. */
function successCardDetails() {
  assertStripeActive('successCardDetails');
  return { brand: 'visa', last4: '4242' };
}

/**
 * A saved-card id that the provider declines WHEN CHARGED (it saves fine).
 * Tests overwrite a parent's stored card id with it to exercise a charge-time
 * decline. Stripe: its documented shared test PaymentMethod.
 */
function declineAtChargeCardId() {
  assertStripeActive('declineAtChargeCardId');
  return 'pm_card_chargeDeclined';
}

/**
 * The ACTIVE provider's customer id our code stored for this user, read from
 * our own database. Throws if the user has none on the active provider.
 */
async function customerIdOf(userId) {
  const user = await User.findById(userId, 'paymentProvider providerCustomerId').lean();

  if (!user || !user.providerCustomerId || user.paymentProvider !== activeProviderName()) {
    throw new Error(`User ${userId} has no ${activeProviderName()} customer yet`);
  }

  return user.providerCustomerId;
}

function toTestPayment(paymentIntent) {
  return {
    id: paymentIntent.id,
    status: stripeProvider._normalizeStatus(paymentIntent.status),
    amount: paymentIntent.amount / 100,
    reference: (paymentIntent.metadata && paymentIntent.metadata.registrationId) || null,
    customerId: typeof paymentIntent.customer === 'string' ? paymentIntent.customer : null,
  };
}

/** One payment by its provider id, normalized: { id, status, amount (dollars), reference, customerId }. */
async function retrievePayment(paymentId) {
  assertStripeActive('retrievePayment');
  return toTestPayment(await stripe.paymentIntents.retrieve(paymentId));
}

/**
 * Every payment ever made on this user's own provider customer, normalized —
 * the way to prove a code path charged exactly N times (0 for "never").
 * Each test parent gets a fresh customer, so the count is exact.
 */
async function listCustomerPayments(userId) {
  assertStripeActive('listCustomerPayments');
  const customer = await customerIdOf(userId);
  const payments = [];

  for await (const paymentIntent of stripe.paymentIntents.list({ customer, limit: 100 })) {
    payments.push(toTestPayment(paymentIntent));
  }

  return payments;
}

/**
 * Asserts the exact charge a ledger row recorded: the row names the active
 * provider, the payment exists, it succeeded, it was for `expectedAmount`
 * dollars, it carries the row's own id as its reference, and it belongs to
 * the row's own parent. Proves the
 * ledger-to-provider link, not merely that some charge of that amount exists.
 * Returns the normalized payment.
 */
async function expectLedgerChargeSucceeded(ledgerRow, expectedAmount) {
  if (!ledgerRow) {
    throw new Error('expectLedgerChargeSucceeded: no ledger row was found');
  }

  if (!ledgerRow.providerPaymentId) {
    throw new Error(
      `Ledger row ${ledgerRow._id} (status ${ledgerRow.status}) has no recorded payment id — no charge was recorded`
    );
  }

  expect(ledgerRow.provider).toBe(activeProviderName());

  const payment = await retrievePayment(ledgerRow.providerPaymentId);

  expect(payment.status).toBe('succeeded');
  expect(payment.amount).toBeCloseTo(expectedAmount, 2);
  expect(payment.reference).toBe(String(ledgerRow._id));
  expect(payment.customerId).toBe(await customerIdOf(ledgerRow.parentId));

  return payment;
}

/**
 * The ids of every card currently attached to (usable on) this user's own
 * provider customer — proves a replaced card was detached and a declined one
 * never attached.
 */
async function listCustomerCards(userId) {
  assertStripeActive('listCustomerCards');
  const customer = await customerIdOf(userId);
  const ids = [];

  for await (const paymentMethod of stripe.paymentMethods.list({ customer, limit: 100 })) {
    ids.push(paymentMethod.id);
  }

  return ids;
}

/**
 * Signs a webhook body the way the active provider would, offline (local
 * HMAC — no network). Returns the headers to send with the exact `payload`
 * string. Needs the provider's webhook secret in process.env.
 */
function signWebhook(payload) {
  assertStripeActive('signWebhook');
  return {
    'stripe-signature': stripe.webhooks.generateTestHeaderString({
      payload,
      secret: process.env.STRIPE_WEBHOOK_SECRET,
    }),
  };
}

module.exports = {
  mintCardToken,
  successCardDetails,
  declineAtChargeCardId,
  customerIdOf,
  retrievePayment,
  listCustomerPayments,
  expectLedgerChargeSucceeded,
  listCustomerCards,
  signWebhook,
};
