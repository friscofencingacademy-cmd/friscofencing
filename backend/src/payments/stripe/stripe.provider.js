const stripe = require('../../config/stripe');
const { httpError } = require('../../utils/errors');

// The Stripe adapter — implements the payment provider port (../contract.js).
// This is the ONLY file, besides src/config/stripe.js itself, allowed to
// require 'stripe' or config/stripe, and the only place a Stripe error shape
// is inspected (tests/payments/providerBoundaryGuard.test.js).
//
// The PaymentIntent payload is byte-identical to the pre-port charge call in
// chargeFinalization.service.js, and every stored message is unchanged
// (docs/plans/payment-provider-port-plan.md D11).

/** Maps a Stripe PaymentIntent status to the port's normalized status. */
function normalizeStatus(stripeStatus) {
  switch (stripeStatus) {
    case 'succeeded':
      return 'succeeded';
    case 'requires_action':
    case 'requires_confirmation':
      return 'requires_action';
    case 'processing':
      return 'processing';
    default:
      // requires_payment_method, canceled, or anything Stripe adds later
      return 'failed';
  }
}

/** The ledger-row failure text for a resolved, non-succeeded PaymentIntent. */
function nonSucceededMessage(stripeStatus) {
  return `PaymentIntent status: ${stripeStatus}`;
}

function isCardError(error) {
  return Boolean(error) && error.type === 'StripeCardError';
}

async function charge({ amount, customerId, paymentMethodId, idempotencyKey, metadata }) {
  let paymentIntent;

  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: Math.round(amount * 100),
        currency: 'usd',
        customer: customerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        // In the params object, not the request options — metadata is a real
        // field on the PaymentIntent (what findPayment's reference search reads).
        metadata,
      },
      { idempotencyKey }
    );
  } catch (error) {
    // A hard decline is a synchronous throw from the SDK, not a resolved
    // object — resolved as a failed charge, never re-thrown (port contract).
    if (isCardError(error)) {
      return {
        id: error.payment_intent ? error.payment_intent.id : null,
        status: 'failed',
        failureMessage: error.message,
        raw: error,
      };
    }

    throw error;
  }

  const status = normalizeStatus(paymentIntent.status);

  return {
    id: paymentIntent.id,
    status,
    failureMessage: status === 'succeeded' ? null : nonSucceededMessage(paymentIntent.status),
    raw: paymentIntent,
  };
}

async function createCustomer({ email, firstName, lastName, userId }) {
  const customer = await stripe.customers.create({
    email,
    name: `${firstName} ${lastName}`,
    metadata: { userId },
  });

  return customer.id;
}

async function attachPaymentMethod({ customerId, token }) {
  let attached;

  try {
    attached = await stripe.paymentMethods.attach(token, { customer: customerId });
  } catch (error) {
    // Some cards decline at attach() itself, not only at charge time (found
    // via the live audit, docs/plans/audit-system-plan.md's 2026-08-23
    // addendum) — a 402 like every other payment failure.
    if (isCardError(error)) {
      throw httpError(402, error.message);
    }

    throw error;
  }

  return {
    id: attached.id,
    brand: attached.card.brand,
    last4: attached.card.last4,
    expMonth: attached.card.exp_month,
    expYear: attached.card.exp_year,
  };
}

async function detachPaymentMethod({ paymentMethodId }) {
  await stripe.paymentMethods.detach(paymentMethodId);
}

function toFoundPayment(paymentIntent) {
  return {
    id: paymentIntent.id,
    status: normalizeStatus(paymentIntent.status),
    amount: paymentIntent.amount / 100,
    raw: paymentIntent,
  };
}

async function findPayment({ paymentId, reference } = {}) {
  if (paymentId) {
    try {
      return toFoundPayment(await stripe.paymentIntents.retrieve(paymentId));
    } catch (error) {
      if (error.type === 'StripeInvalidRequestError' && error.code === 'resource_missing') {
        return null;
      }

      throw error;
    }
  }

  if (reference) {
    // Keyed on our own Registration id in the PaymentIntent's metadata —
    // never by amount (docs/TESTING_STRATEGY.md "never read the account as a
    // whole"). Only a succeeded intent counts as "this charge already happened".
    const result = await stripe.paymentIntents.search({
      query: `metadata['registrationId']:'${reference}'`,
    });
    const succeeded = (result.data || []).find((paymentIntent) => paymentIntent.status === 'succeeded');

    return succeeded ? toFoundPayment(succeeded) : null;
  }

  return null;
}

const EVENT_TYPES = {
  'payment_intent.succeeded': 'payment.succeeded',
  'payment_intent.payment_failed': 'payment.failed',
};

async function verifyWebhook({ rawBody, headers }) {
  let event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    throw httpError(400, `Webhook signature verification failed: ${error.message}`);
  }

  const object = event.data && event.data.object ? event.data.object : {};

  return {
    eventId: event.id,
    type: EVENT_TYPES[event.type] || 'ignored',
    paymentId: object.id || null,
    providerStatus: object.status || null,
    providerEventType: event.type,
    raw: event,
  };
}

module.exports = {
  name: 'stripe',
  capabilities: { savedPaymentMethods: true, webhooks: true, findByReference: true },
  charge,
  createCustomer,
  attachPaymentMethod,
  detachPaymentMethod,
  findPayment,
  verifyWebhook,
  // Exported for direct unit tests of the pure mappings.
  _normalizeStatus: normalizeStatus,
  _nonSucceededMessage: nonSucceededMessage,
};
