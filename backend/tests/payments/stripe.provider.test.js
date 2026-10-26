// The Stripe adapter against Stripe's real TEST mode (never mocked —
// docs/TESTING_STRATEGY.md Mocking rules): the shared payment provider
// contract suite, plus the adapter's own pure status/message mappings. These
// are the only tests that create Stripe objects directly (tests/payments/**,
// see providerBoundaryGuard.test.js).
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_contract_suite_dummy_secret';
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_contract_suite_publishable';

const stripe = require('../../src/config/stripe');
const stripeProvider = require('../../src/payments/stripe/stripe.provider');
const { describeProviderContract } = require('./providerContract.shared');

async function paymentMethodFromToken(token) {
  const paymentMethod = await stripe.paymentMethods.create({ type: 'card', card: { token } });
  return paymentMethod.id;
}

function stripeEvent(id, type, object) {
  return { id, object: 'event', type, data: { object } };
}

describeProviderContract(() => stripeProvider, {
  successToken: () => paymentMethodFromToken('tok_visa'),
  declineAtAttachToken: () => paymentMethodFromToken('tok_chargeDeclined'),
  declineAtChargeCardId: 'pm_card_chargeDeclined',
  successCard: { brand: 'visa', last4: '4242' },
  customerIdempotent: false,
  unknownPaymentId: 'pi_contract_suite_does_not_exist',
  signWebhook: (event) => {
    const payload = JSON.stringify(event);
    return {
      rawBody: Buffer.from(payload),
      headers: {
        'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET }),
      },
    };
  },
  webhookEvents: {
    succeeded: stripeEvent('evt_contract_ok', 'payment_intent.succeeded', { id: 'pi_contract_ok', status: 'succeeded' }),
    failed: stripeEvent('evt_contract_fail', 'payment_intent.payment_failed', {
      id: 'pi_contract_fail',
      status: 'requires_payment_method',
    }),
    ignored: stripeEvent('evt_contract_ignored', 'customer.updated', { id: 'cus_contract' }),
  },
  secretValues: [process.env.STRIPE_SECRET_KEY, process.env.STRIPE_WEBHOOK_SECRET],
  unsignedHeaders: { 'stripe-signature': 't=1,v1=0000000000000000000000000000000000000000000000000000000000000000' },
});

describe('stripe.provider — pure mappings', () => {
  it.each([
    ['succeeded', 'succeeded'],
    ['requires_action', 'requires_action'],
    ['requires_confirmation', 'requires_action'],
    ['processing', 'processing'],
    ['requires_payment_method', 'failed'],
    ['canceled', 'failed'],
    ['a_status_stripe_adds_later', 'failed'],
  ])('normalizes PaymentIntent status %s to %s', (stripeStatus, expected) => {
    expect(stripeProvider._normalizeStatus(stripeStatus)).toBe(expected);
  });

  it('stores the pre-port failure text, byte for byte, for a resolved non-succeeded intent', () => {
    expect(stripeProvider._nonSucceededMessage('requires_payment_method')).toBe('PaymentIntent status: requires_payment_method');
  });

  it('publicConfig serves the publishable key', () => {
    expect(stripeProvider.publicConfig()).toEqual({ publishableKey: 'pk_test_contract_suite_publishable' });
  });

  it('publicConfig throws when the publishable key is not configured — a deployment defect, never a blank form', () => {
    const saved = process.env.STRIPE_PUBLISHABLE_KEY;
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    try {
      expect(() => stripeProvider.publicConfig()).toThrow('[payments] STRIPE_PUBLISHABLE_KEY is not configured');
    } finally {
      process.env.STRIPE_PUBLISHABLE_KEY = saved;
    }
  });

  it('declares itself as the stripe provider, able to search by reference', () => {
    expect(stripeProvider.name).toBe('stripe');
    expect(stripeProvider.capabilities).toEqual({ savedPaymentMethods: true, webhooks: true, findByReference: true });
  });
});
