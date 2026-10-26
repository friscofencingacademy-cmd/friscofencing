// getPaymentProvider(): selection by PAYMENT_PROVIDER, the unknown-value
// error, singleton caching, and the contract check on the selected adapter.

describe('getPaymentProvider', () => {
  const ORIGINAL = process.env.PAYMENT_PROVIDER;

  afterEach(() => {
    // `process.env.X = undefined` would store the string "undefined" — delete
    // instead when there was no value to begin with (a lesson CKQ's own test
    // for this file recorded).
    if (ORIGINAL === undefined) {
      delete process.env.PAYMENT_PROVIDER;
    } else {
      process.env.PAYMENT_PROVIDER = ORIGINAL;
    }
    jest.resetModules();
  });

  it('defaults to the stripe adapter when PAYMENT_PROVIDER is unset', () => {
    delete process.env.PAYMENT_PROVIDER;
    const { getPaymentProvider } = require('../../src/payments');

    expect(getPaymentProvider().name).toBe('stripe');
  });

  it('selects the stripe adapter explicitly', () => {
    process.env.PAYMENT_PROVIDER = 'stripe';
    const { getPaymentProvider } = require('../../src/payments');

    expect(getPaymentProvider()).toBe(require('../../src/payments/stripe/stripe.provider'));
  });

  it('throws, naming the value, on an unknown PAYMENT_PROVIDER', () => {
    process.env.PAYMENT_PROVIDER = 'not-a-provider';
    const { getPaymentProvider } = require('../../src/payments');

    expect(() => getPaymentProvider()).toThrow('[payments] unknown PAYMENT_PROVIDER: "not-a-provider"');
  });

  it('caches the selection — a later env change does not swap the provider mid-process', () => {
    process.env.PAYMENT_PROVIDER = 'stripe';
    const { getPaymentProvider } = require('../../src/payments');
    const first = getPaymentProvider();

    process.env.PAYMENT_PROVIDER = 'not-a-provider';

    expect(getPaymentProvider()).toBe(first);
  });

  it('_resetForTests clears the cache so the next call re-selects', () => {
    process.env.PAYMENT_PROVIDER = 'stripe';
    const { getPaymentProvider, _resetForTests } = require('../../src/payments');
    getPaymentProvider();

    _resetForTests();
    process.env.PAYMENT_PROVIDER = 'not-a-provider';

    expect(() => getPaymentProvider()).toThrow(/unknown PAYMENT_PROVIDER/);
  });

  it('refuses an adapter whose name differs from the PAYMENT_PROVIDER it was selected by', () => {
    process.env.PAYMENT_PROVIDER = 'stripe';
    const real = jest.requireActual('../../src/payments/stripe/stripe.provider');
    jest.doMock('../../src/payments/stripe/stripe.provider', () => ({ ...real, name: 'square' }));
    const { getPaymentProvider } = require('../../src/payments');

    expect(() => getPaymentProvider()).toThrow('[payments] adapter selected as "stripe" is named "square"');
    jest.dontMock('../../src/payments/stripe/stripe.provider');
  });

  it('refuses an adapter that does not implement the contract', () => {
    process.env.PAYMENT_PROVIDER = 'stripe';
    jest.doMock('../../src/payments/stripe/stripe.provider', () => ({ name: 'stripe' }));
    const { getPaymentProvider } = require('../../src/payments');

    expect(() => getPaymentProvider()).toThrow(/missing required member\(s\): capabilities, charge/);
    jest.dontMock('../../src/payments/stripe/stripe.provider');
  });
});
