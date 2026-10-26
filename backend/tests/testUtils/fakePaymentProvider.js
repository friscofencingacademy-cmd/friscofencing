const { REQUIRED_MEMBERS } = require('../../src/payments/contract');

// A complete, inert payment provider adapter for the port's OWN unit tests
// (tests/payments/contract.test.js, tests/payments/index.test.js) — copied
// from CKQ's makeFakePaymentProvider and reduced to this port's members.
//
// Never used by a business-service or route test: those run against the
// active provider's real test mode (docs/plans/payment-provider-port-plan.md
// D9, docs/TESTING_STRATEGY.md Mocking rules).
function makeFakePaymentProvider(overrides = {}) {
  const fake = {
    name: 'fake',
    capabilities: { savedPaymentMethods: true, webhooks: true, findByReference: false },
    charge: jest.fn().mockResolvedValue({ id: 'pay_fake_001', status: 'succeeded', failureMessage: null, raw: {} }),
    createCustomer: jest.fn().mockResolvedValue('cus_fake_001'),
    attachPaymentMethod: jest
      .fn()
      .mockResolvedValue({ id: 'card_fake_001', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 }),
    detachPaymentMethod: jest.fn().mockResolvedValue(undefined),
    findPayment: jest.fn().mockResolvedValue(null),
    verifyWebhook: jest.fn().mockResolvedValue({
      eventId: 'evt_fake',
      type: 'ignored',
      paymentId: null,
      providerStatus: null,
      providerEventType: 'fake.event',
      raw: {},
    }),
    ...overrides,
  };

  // Keeps this fake honest: if the contract gains a member, this throws until
  // the fake implements it too.
  const missing = REQUIRED_MEMBERS.filter((member) => !(member in fake));
  if (missing.length > 0) {
    throw new Error(`makeFakePaymentProvider is missing contract member(s): ${missing.join(', ')}`);
  }

  return fake;
}

module.exports = { makeFakePaymentProvider };
